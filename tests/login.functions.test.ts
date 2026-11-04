import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    validator: () => ({
      handler: (handler: (args: { data: { email: string; password: string } }) => unknown) =>
        handler,
    }),
  }),
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () =>
    new Request("https://portal.test/login", { headers: { "x-real-ip": "10.0.0.1" } }),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: mocks.rpc,
    from: () => ({ insert: mocks.insert }),
  },
}));

import { signInWithPassword } from "@/lib/login.functions";

const sessionResponse = () =>
  Response.json({
    access_token: "access-token",
    refresh_token: "refresh-token",
    user: { id: "user-1", email: "user@example.test" },
  });

beforeEach(() => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
  vi.stubEnv("SUPABASE_URL", "https://supabase.test");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sessionResponse()));
  mocks.rpc.mockReset().mockResolvedValue({
    data: null,
    error: { message: "record_auth_login_attempt function is unavailable" },
  });
  mocks.insert.mockReset().mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("signInWithPassword", () => {
  it("returns the authenticated session if recording the successful attempt fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await signInWithPassword({
      data: { email: "user@example.test", password: "correct-password" },
    });

    expect(result).toEqual({
      ok: true,
      session: { access_token: "access-token", refresh_token: "refresh-token" },
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_auth_login_attempt",
      expect.objectContaining({ p_succeeded: true }),
    );
    expect(console.error).toHaveBeenCalledWith(
      "Could not record auth login attempt:",
      expect.objectContaining({ message: "record_auth_login_attempt function is unavailable" }),
    );
  });
});
