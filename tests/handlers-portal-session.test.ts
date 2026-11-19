import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { call, json } from "./helpers/call";
import { freshIp, h } from "./helpers/setup";

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));

import { Route } from "@/routes/api/public/portal/$slug/session";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ROUTER = "22222222-2222-4222-8222-222222222222";
const MAC = "AA:BB:CC:DD:EE:FF";

const check = (ip = freshIp()) =>
  call(Route, "GET", {
    url: `https://portal.test/api/public/portal/acme/session?mac=${MAC}&routerId=${ROUTER}`,
    ip,
    params: { slug: "acme" },
  });

beforeEach(() => {
  h.db = new FakeDb()
    .seed("tenants", [{ id: TENANT, slug: "acme" }])
    .seed("routers", [{ id: ROUTER, tenant_id: TENANT }])
    .seed("router_devices", [
      {
        tenant_id: TENANT,
        router_id: ROUTER,
        mac: MAC,
        authorized: true,
        last_seen_at: new Date().toISOString(),
      },
    ]);
});

afterEach(() => vi.restoreAllMocks());

describe("captive portal router session check", () => {
  it("reports an authorized device with a recent router report as connected", async () => {
    const response = await check();

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ active: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("reports a recently seen but unauthorized device as disconnected", async () => {
    h.db.rows("router_devices")[0]!.authorized = false;

    expect(await json(await check())).toEqual({ active: false });
  });

  it("does not trust an old authorized session report", async () => {
    h.db.rows("router_devices")[0]!.last_seen_at = new Date(Date.now() - 3 * 60_000).toISOString();

    expect(await json(await check())).toEqual({ active: false });
  });

  it("does not disclose session state for another tenant's router", async () => {
    h.db.rows("routers")[0]!.tenant_id = "99999999-9999-4999-8999-999999999999";

    expect((await check()).status).toBe(404);
  });

  it("returns an explicit service error when session state cannot be checked", async () => {
    h.db.failNext("router_devices", "select");

    expect((await check()).status).toBe(503);
  });
});
