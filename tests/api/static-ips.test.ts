import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: createClientMock }));

import app from "../../apps/api/src/index";
import { isIpv4, parseStaticIpAssignment } from "../../packages/api-contracts/src/static-ips";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  FRONTEND_ORIGINS: "http://localhost:5173",
};

const customer = {
  id: "a1b2c3d4-e5f6-4789-8abc-123456789012",
  full_name: "Test Customer",
  phone: null,
  pppoe_username: "test.customer",
  status: "active",
  static_ip: "192.0.2.10",
};

function authenticatedClient() {
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
    from: vi.fn(),
  };
  createClientMock.mockReturnValue(client);
  return client;
}

beforeEach(() => {
  createClientMock.mockReset();
});

describe("static IP API", () => {
  it("reports health without requiring user authentication", async () => {
    const response = await app.request("/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("allows preflight requests only from configured frontend origins", async () => {
    const allowed = await app.request(
      "/v1/tenant/static-ips",
      {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "GET",
        },
      },
      env,
    );
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");

    const rejected = await app.request(
      "/v1/tenant/static-ips",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://untrusted.example",
          "Access-Control-Request-Method": "GET",
        },
      },
      env,
    );
    expect(rejected.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("rejects requests without a bearer token", async () => {
    const response = await app.request("/v1/tenant/static-ips", {}, env);
    expect(response.status).toBe(401);
  });

  it("rejects expired bearer tokens", async () => {
    const client = authenticatedClient();
    client.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 401 },
    });
    const response = await app.request(
      "/v1/tenant/static-ips",
      { headers: { Authorization: "Bearer expired-token" } },
      env,
    );
    expect(response.status).toBe(401);
  });

  it("lists PPPoE customer assignments using the authenticated Supabase client", async () => {
    const client = authenticatedClient();
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [customer], error: null }),
    };
    client.from.mockReturnValue(query);

    const response = await app.request(
      "/v1/tenant/static-ips",
      { headers: { Authorization: "Bearer valid-token" } },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([customer]);
    expect(client.from).toHaveBeenCalledWith("customers");
    expect(query.eq).toHaveBeenCalledWith("customer_type", "pppoe");
  });

  it("rejects an invalid assignment payload before querying customer data", async () => {
    const client = authenticatedClient();
    const response = await app.request(
      `/v1/tenant/static-ips/${customer.id}`,
      {
        method: "PUT",
        headers: { Authorization: "Bearer valid-token", "Content-Type": "application/json" },
        body: JSON.stringify({ staticIp: "999.0.0.1" }),
      },
      env,
    );
    expect(response.status).toBe(400);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("rejects duplicate assignments and returns conflicts as HTTP 409", async () => {
    const client = authenticatedClient();
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [{ id: "another-customer" }], error: null }),
    };
    client.from.mockReturnValue(query);
    const response = await app.request(
      `/v1/tenant/static-ips/${customer.id}`,
      {
        method: "PUT",
        headers: { Authorization: "Bearer valid-token", "Content-Type": "application/json" },
        body: JSON.stringify({ staticIp: "192.0.2.10" }),
      },
      env,
    );
    expect(response.status).toBe(409);
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("updates a customer's assignment using only the signed-in user's database access", async () => {
    const client = authenticatedClient();
    const conflictQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const updateQuery = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { ...customer, static_ip: "192.0.2.20" },
        error: null,
      }),
    };
    client.from.mockReturnValueOnce(conflictQuery).mockReturnValueOnce(updateQuery);

    const response = await app.request(
      `/v1/tenant/static-ips/${customer.id}`,
      {
        method: "PUT",
        headers: { Authorization: "Bearer valid-token", "Content-Type": "application/json" },
        body: JSON.stringify({ staticIp: "192.0.2.20" }),
      },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ static_ip: "192.0.2.20" });
    expect(updateQuery.update).toHaveBeenCalledWith({ static_ip: "192.0.2.20" });
    expect(createClientMock).toHaveBeenCalledWith(
      env.SUPABASE_URL,
      env.SUPABASE_PUBLISHABLE_KEY,
      expect.objectContaining({
        global: { headers: { Authorization: "Bearer valid-token" } },
      }),
    );
  });
});

describe("static IP contracts", () => {
  it("accepts only well-formed IPv4 addresses", () => {
    expect(isIpv4("192.0.2.1")).toBe(true);
    expect(isIpv4("0.0.0.0")).toBe(true);
    expect(isIpv4("256.0.0.1")).toBe(false);
    expect(isIpv4("192.00.2.1")).toBe(false);
    expect(isIpv4("192.0.2.1; reset")).toBe(false);
  });

  it("parses assignments and explicit removal separately from invalid input", () => {
    expect(parseStaticIpAssignment({ staticIp: "192.0.2.1" })).toEqual({
      staticIp: "192.0.2.1",
    });
    expect(parseStaticIpAssignment({ staticIp: null })).toEqual({ staticIp: null });
    expect(parseStaticIpAssignment({ staticIp: "invalid" })).toBeNull();
    expect(parseStaticIpAssignment({})).toBeNull();
  });
});
