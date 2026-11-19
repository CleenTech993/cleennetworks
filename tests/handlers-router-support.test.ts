import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { call, json } from "./helpers/call";
import { h } from "./helpers/setup";
import { hashRouterSupportPassword } from "@/lib/router-support.server";

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));

import { Route } from "@/routes/api/public/router-support-sessions.$sessionId";

const SESSION_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ROUTER_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const PASSWORD = "A".repeat(43);
const PARAMS = { sessionId: SESSION_ID };

const get = (cookie?: string) =>
  call(Route, "GET", {
    url: `https://portal.test/api/public/router-support-sessions/${SESSION_ID}`,
    params: PARAMS,
    headers: cookie ? { cookie } : {},
  });

beforeEach(async () => {
  const passwordHash = await hashRouterSupportPassword(PASSWORD);
  h.db = new FakeDb()
    .seed("router_support_sessions", [
      {
        id: SESSION_ID,
        tenant_id: TENANT_ID,
        router_id: ROUTER_ID,
        password_hash: passwordHash,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        revoked_at: null,
        last_accessed_at: null,
        access_count: 0,
      },
    ])
    .seed("routers", [
      {
        id: ROUTER_ID,
        tenant_id: TENANT_ID,
        name: "Shop router",
        status: "online",
        last_heartbeat_at: new Date().toISOString(),
        cpu_load: 27,
        free_memory_mb: 700,
        total_memory_mb: 1000,
        uptime_seconds: 3600,
        temperature: 42,
        voltage: 24,
        public_ip: "203.0.113.8",
        wan_ip: "203.0.113.8",
        routeros_version: "7.14",
      },
    ])
    .seed("router_metrics", [
      {
        router_id: ROUTER_ID,
        tenant_id: TENANT_ID,
        ts: new Date().toISOString(),
        cpu_pct: 27,
        mem_pct: 30,
        wan_latency_ms: 12,
        wan_loss_pct: 0,
      },
    ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("external router support session", () => {
  it("requires the one-time password before showing router diagnostics", async () => {
    const response = await get();

    expect(response.status).toBe(401);
    expect(await json(response)).toMatchObject({ error: "Sign in to this support session." });
  });

  it("issues a secure session cookie after verifying the password", async () => {
    const response = await call(Route, "POST", {
      url: `https://portal.test/api/public/router-support-sessions/${SESSION_ID}`,
      params: PARAMS,
      body: { password: PASSWORD },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain(`ng_support_${SESSION_ID}=${PASSWORD}`);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Strict");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("returns only allowlisted health fields and records access", async () => {
    const response = await get(`ng_support_${SESSION_ID}=${PASSWORD}`);
    const body = await json(response);
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.router).toMatchObject({
      name: "Shop router",
      status: "online",
      cpuLoad: 27,
      memoryUsedPct: 30,
    });
    expect(serialized).not.toContain(ROUTER_ID);
    expect(serialized).not.toContain(TENANT_ID);
    expect(serialized).not.toContain("203.0.113.8");
    expect(serialized).not.toContain("7.14");
    expect(serialized).not.toContain(PASSWORD);
    expect(h.db.rows("router_support_sessions")[0].access_count).toBe(1);
  });

  it("rejects expired, revoked, and incorrect-password sessions", async () => {
    const invalidLogin = await call(Route, "POST", {
      url: `https://portal.test/api/public/router-support-sessions/${SESSION_ID}`,
      params: PARAMS,
      body: { password: "B".repeat(43) },
    });
    expect(invalidLogin.status).toBe(401);

    h.db.rows("router_support_sessions")[0].expires_at = new Date(Date.now() - 1).toISOString();
    expect((await get(`ng_support_${SESSION_ID}=${PASSWORD}`)).status).toBe(401);

    h.db.rows("router_support_sessions")[0].expires_at = new Date(Date.now() + 60_000).toISOString();
    h.db.rows("router_support_sessions")[0].revoked_at = new Date().toISOString();
    expect((await get(`ng_support_${SESSION_ID}=${PASSWORD}`)).status).toBe(401);
  });
});