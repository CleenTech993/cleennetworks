import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { call } from "./helpers/call";
import { freshIp, h } from "./helpers/setup";

vi.mock("@/integrations/supabase/client.server", () => ({ get supabaseAdmin() { return h.db; } }));
vi.mock("@tanstack/react-start/server", () => ({ getRequestHost: () => "portal.test" }));

import { Route as Heartbeat } from "@/routes/api/public/router/heartbeat.$token";
import { Route as Interfaces } from "@/routes/api/public/router/interfaces.$token";
import { Route as Sync } from "@/routes/api/public/router/sync.$token";
import { Route as LoginHtml } from "@/routes/api/public/provision/$token/login[.]html";
import { Route as Rsc } from "@/routes/api/public/provision/$token/router[.]rsc";
import { issueDeviceToken, sha256Hex, mintDeviceToken, TOKEN_MISS_LIMIT } from "@/lib/router-auth.server";

const T = "11111111-1111-1111-1111-111111111111";
const OTHER_T = "99999999-9999-9999-9999-999999999999";
const R1 = "r1000000-0000-0000-0000-000000000001";
const R2 = "r2000000-0000-0000-0000-000000000002";
const R3 = "r3000000-0000-0000-0000-000000000003";
const BOOT1 = "bootstrap1".padEnd(32, "x");
const LEGACY2 = "legacytoken2".padEnd(32, "y");

const hb = (token: string, ip = freshIp(), qs = "") => call(Heartbeat, "GET", { url: `https://portal.test/hb${qs}`, params: { token }, ip });
const router = (id: string) => h.db.rows("routers").find((r) => r.id === id)!;

beforeEach(() => {
  h.db = new FakeDb()
    .seed("tenants", [{ id: T, slug: "acme", name: "Acme ISP" }, { id: OTHER_T, slug: "rival", name: "Rival" }])
    .seed("routers", [
      { id: R1, tenant_id: T, name: "Tower 1", status: "pending", provision_token: BOOT1, provision_token_expires_at: new Date(Date.now() + 3_600_000).toISOString(), legacy_token_auth: false },
      { id: R2, tenant_id: T, name: "Legacy box", status: "online", provision_token: LEGACY2, provision_token_expires_at: null, legacy_token_auth: true },
      { id: R3, tenant_id: OTHER_T, name: "Rival router", status: "online", provision_token: "rivaltoken".padEnd(32, "z"), provision_token_expires_at: null, legacy_token_auth: false },
    ]);
});
afterEach(() => vi.restoreAllMocks());

describe("device token generation", () => {
  it("mints 256-bit url-safe tokens that never repeat", () => {
    const a = mintDeviceToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set(Array.from({ length: 200 }, mintDeviceToken)).size).toBe(200);
  });

  it("stores only a hash of the token", async () => {
    const token = await issueDeviceToken(R1);
    const [cred] = h.db.rows("router_credentials");
    expect(cred.router_id).toBe(R1);
    expect(cred.token_hash).toBe(await sha256Hex(token));
    expect(JSON.stringify(h.db.tables)).not.toContain(token);
  });

  it("replaces the previous credential and retires legacy auth", async () => {
    const first = await issueDeviceToken(R2);
    const second = await issueDeviceToken(R2);
    expect(h.db.rows("router_credentials")).toHaveLength(1);
    expect(router(R2).legacy_token_auth).toBe(false);
    expect((await hb(first)).status).toBe(404);
    expect((await hb(second)).status).toBe(200);
  });
});

describe("device endpoint authentication (heartbeat)", () => {
  it("accepts a device token and records metrics against that router only", async () => {
    const token = await issueDeviceToken(R1);
    const res = await hb(token, freshIp(), "?cpu=12&mem-free=256&mem-total=1024");
    expect(res.status).toBe(200);
    expect(router(R1)).toMatchObject({ status: "online", cpu_load: 12, ram_usage: 75 });
    expect(router(R2).cpu_load).toBeUndefined();
    expect(router(R3).cpu_load).toBeUndefined();
    expect(h.db.rows("router_metrics")).toMatchObject([{ router_id: R1, tenant_id: T, cpu_pct: 12 }]);
  });

  it("rejects unknown and malformed tokens, and malformed ones never reach the database", async () => {
    expect((await hb("x".repeat(40))).status).toBe(404);
    h.db.log.length = 0;
    for (const bad of ["short", "has space in it........", "semi;colon;colon;colon;", "x".repeat(200)]) {
      expect((await hb(bad)).status).toBe(404);
    }
    expect(h.db.log).toHaveLength(0);
  });

  it("does not accept a modern router's bootstrap token on a device endpoint", async () => {
    expect((await hb(BOOT1)).status).toBe(404);
    expect(router(R1).status).toBe("pending");
  });

  it("keeps routers that were provisioned before this change working, until they re-provision", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await hb(LEGACY2)).status).toBe(200);
    await issueDeviceToken(R2);
    expect((await hb(LEGACY2)).status).toBe(404);
  });

  it("stops a revoked router at once", async () => {
    const token = await issueDeviceToken(R1);
    expect((await hb(token)).status).toBe(200);
    h.db.tables["router_credentials"] = []; // what rotate_router_token(revoke) does
    expect((await hb(token)).status).toBe(404);
  });

  it("slows token guessing: after the miss limit an IP is told to back off, others are unaffected", async () => {
    const token = await issueDeviceToken(R1);
    const attacker = freshIp();
    for (let i = 0; i < TOKEN_MISS_LIMIT; i++) await hb(`guess${i}`.padEnd(24, "g"), attacker);
    expect((await hb(token, attacker)).status).toBe(429);
    expect((await hb(token, freshIp())).status).toBe(200);
  });
});

describe("interfaces endpoint", () => {
  it("authenticates before doing any work", async () => {
    const res = await call(Interfaces, "POST", { params: { token: "x".repeat(40) }, rawBody: "ether1|true|false|1|2|0|0|0|0", ip: freshIp() });
    expect(res.status).toBe(404);
    expect(h.db.rows("router_interfaces")).toHaveLength(0);
  });
  it("stores interface rows for the authenticated router", async () => {
    const token = await issueDeviceToken(R1);
    const res = await call(Interfaces, "POST", { params: { token }, rawBody: "ether1|true|false|1000|2000|0|0|0|0", ip: freshIp() });
    expect(res.status).toBe(200);
    expect(h.db.rows("router_interfaces").every((r) => r.router_id === R1 && r.tenant_id === T)).toBe(true);
    expect(h.db.rows("router_interfaces").length).toBeGreaterThan(0);
  });
});

describe("sync script scoping", () => {
  const pppoe = (u: string, p: string, router_id: string | null, extra: Record<string, unknown> = {}) =>
    ({ tenant_id: T, customer_type: "pppoe", status: "active", pppoe_username: u, pppoe_password: p, router_id, expires_at: null, package_id: null, ...extra });
  const sync = async (token: string) => {
    const res = await call(Sync, "GET", { params: { token }, ip: freshIp() });
    return { res, text: await res.text() };
  };

  beforeEach(() => {
    h.db
      .seed("customers", [
        pppoe("alice", "alicepass1", R1),
        pppoe("bob", "bobpass2", R2),
        pppoe("carol", "carolpass3", null), // explicit "All routers"
        pppoe("dave", "davepass4", R1, { expires_at: "2020-01-01T00:00:00Z" }),
        pppoe("erin", "erinpass5", R1, { status: "suspended" }),
        { ...pppoe("mallory", "rivalpass6", null), tenant_id: OTHER_T },
      ])
      .seed("vouchers", [
        { tenant_id: T, code: "UNUSED2345", status: "unused", expires_at: null },
        { tenant_id: T, code: "USED22345A", status: "used", expires_at: null },
        { tenant_id: T, code: "EXPIRED234", status: "unused", expires_at: "2020-01-01T00:00:00Z" },
        { tenant_id: OTHER_T, code: "RIVALCODE2", status: "unused", expires_at: null },
      ]);
  });

  it("gives a router only its own clients plus the explicit all-router ones", async () => {
    const { res, text } = await sync(await issueDeviceToken(R1));
    expect(res.status).toBe(200);
    expect(text).toContain("alice");
    expect(text).toContain("carol");
    for (const secret of ["bob", "bobpass2"]) expect(text).not.toContain(secret);
  });

  it("never emits expired, suspended or other tenants' clients", async () => {
    const { text } = await sync(await issueDeviceToken(R1));
    for (const s of ["dave", "erin", "mallory", "rivalpass6"]) expect(text).not.toContain(s);
  });

  it("never even READS other routers' client rows for this request", async () => {
    await sync(await issueDeviceToken(R1));
    // proves the filter happens in the query, not only in post-processing
    const q = h.db.log.filter((l) => l.table === "customers" && l.op === "select");
    expect(q).toHaveLength(1);
    const readable = h.db.rows("customers").filter((c) => c.tenant_id === T && c.status === "active" && (c.router_id === R1 || c.router_id == null));
    expect(readable.map((c) => c.pppoe_username).sort()).toEqual(["alice", "carol", "dave"]);
  });

  it("serves a second router its own set", async () => {
    const { text } = await sync(await issueDeviceToken(R2));
    expect(text).toContain("bob");
    expect(text).toContain("carol");
    expect(text).not.toContain("alice");
  });

  it("only includes this tenant's live vouchers", async () => {
    const { text } = await sync(await issueDeviceToken(R1));
    expect(text).toContain("UNUSED2345");
    expect(text).toContain("USED22345A");
    for (const s of ["EXPIRED234", "RIVALCODE2"]) expect(text).not.toContain(s);
  });

  it("embeds the device token (not the bootstrap token) in the login-page URL", async () => {
    const token = await issueDeviceToken(R1);
    const { text } = await sync(token);
    expect(text).toContain(`/api/public/provision/${token}/login.html`);
    expect(text).not.toContain(BOOT1);
  });

  it("refuses unknown tokens with a comment-only body", async () => {
    const { res, text } = await sync("x".repeat(40));
    expect(res.status).toBe(404);
    expect(text).not.toContain("alice");
  });
});

describe("login.html", () => {
  it("needs a valid device token", async () => {
    expect((await call(LoginHtml, "GET", { params: { token: "x".repeat(40) }, ip: freshIp() })).status).toBe(404);
    const token = await issueDeviceToken(R1);
    expect((await call(LoginHtml, "GET", { params: { token }, ip: freshIp() })).status).toBe(200);
  });
});

describe("router.rsc provisioning", () => {
  const rsc = (token: string, ip = freshIp()) => call(Rsc, "GET", { params: { token }, ip });
  const credFor = (id: string) => h.db.rows("router_credentials").find((c) => c.router_id === id);

  it("exchanges the bootstrap token for a fresh device token and embeds only the device token", async () => {
    const res = await rsc(BOOT1);
    const script = await res.text();
    expect(res.status).toBe(200);
    expect(script).not.toContain(BOOT1);
    const [, deviceToken] = script.match(/api\/public\/router\/heartbeat\/([A-Za-z0-9_-]{43})/) ?? [];
    expect(deviceToken).toBeTruthy();
    expect(script).toContain(`/router/sync/${deviceToken}`);
    expect(script).toContain(`/router/interfaces/${deviceToken}`);
    expect(credFor(R1)?.token_hash).toBe(await sha256Hex(deviceToken));
    expect((await hb(deviceToken)).status).toBe(200);
  });

  it("marks the router online and retires legacy auth", async () => {
    await rsc(BOOT1);
    expect(router(R1).status).toBe("online");
    await rsc(LEGACY2);
    expect(router(R2).legacy_token_auth).toBe(false);
  });

  it("re-running within the window issues a new device token and the old one stops working", async () => {
    const tokenOf = async () => ((await (await rsc(BOOT1)).text()).match(/heartbeat\/([A-Za-z0-9_-]{43})/) ?? [])[1];
    const first = await tokenOf();
    const second = await tokenOf();
    expect(first).not.toBe(second);
    expect((await hb(first)).status).toBe(404);
    expect((await hb(second)).status).toBe(200);
  });

  it("refuses an expired bootstrap token and changes nothing", async () => {
    router(R1).provision_token_expires_at = new Date(Date.now() - 1000).toISOString();
    const res = await rsc(BOOT1);
    expect(res.status).toBe(410);
    expect(await res.text()).toMatch(/expired/i);
    expect(h.db.rows("router_credentials")).toHaveLength(0);
  });

  it("refuses unknown tokens, and a device token cannot be used as a bootstrap token", async () => {
    expect((await rsc("x".repeat(40))).status).toBe(404);
    const device = await issueDeviceToken(R1);
    expect((await rsc(device)).status).toBe(404);
  });

  it("does not hand out a script if the credential cannot be stored", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.db.failNext("router_credentials", "upsert", "db down");
    const res = await rsc(BOOT1);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("/router/heartbeat/");
  });

  it("leaves the existing credential alone if the tenant lookup fails", async () => {
    const existing = await issueDeviceToken(R1);
    h.db.failNext("tenants", "select");
    await rsc(BOOT1);
    expect((await hb(existing)).status).toBe(200);
  });
});
