import { beforeEach, describe, expect, it } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { call, json } from "./helpers/call";
import { freshIp, h } from "./helpers/setup";
import { vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));

import { Route } from "@/routes/api/public/portal/$slug/voucher-ready";

const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER = "99999999-9999-9999-9999-999999999999";
const ROUTER = "11111111-aaaa-bbbb-cccc-000000000001";
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const ready = (qs: string, ip = freshIp(), slug = "acme") =>
  call(Route, "GET", { url: `https://portal.test/x?${qs}`, params: { slug }, ip });

beforeEach(() => {
  h.db = new FakeDb()
    .seed("tenants", [
      { id: TENANT, slug: "acme" },
      { id: OTHER, slug: "rival" },
    ])
    .seed("routers", [{ id: ROUTER, tenant_id: TENANT, name: "Tower", last_sync_at: ago(60_000) }])
    .seed("vouchers", [
      {
        id: "old",
        tenant_id: TENANT,
        code: "OLDCODE12",
        status: "used",
        created_at: ago(10 * 60_000),
      },
      { id: "new", tenant_id: TENANT, code: "NEWCODE12", status: "used", created_at: ago(10_000) },
      { id: "rv", tenant_id: OTHER, code: "RIVALCODE", status: "used", created_at: ago(10_000) },
    ]);
});

describe("voucher-ready", () => {
  it("is ready for a voucher the router already received", async () => {
    const res = await ready(`code=OLDCODE12&router=${ROUTER}`);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ready: true });
  });

  it("is not ready for a voucher newer than the router's last sync", async () => {
    expect(await json(await ready(`code=NEWCODE12&router=${ROUTER}`))).toEqual({ ready: false });
  });

  it("turns ready as soon as the router syncs again", async () => {
    expect((await json(await ready(`code=NEWCODE12&router=${ROUTER}`))).ready).toBe(false);
    h.db.rows("routers")[0].last_sync_at = new Date().toISOString();
    expect((await json(await ready(`code=NEWCODE12&router=${ROUTER}`))).ready).toBe(true);
  });

  it("accepts the code in any case", async () => {
    expect((await json(await ready(`code=newcode12&router=${ROUTER}`))).ready).toBe(false);
  });

  it("cannot be used to find out which codes exist: unknown codes simply read as ready", async () => {
    for (const qs of [`code=NOSUCHCODE&router=${ROUTER}`, `router=${ROUTER}`, "code=ab", "code="]) {
      expect(await json(await ready(qs))).toEqual({ ready: true });
    }
  });

  it("does not see another tenant's vouchers or an unknown portal", async () => {
    expect((await json(await ready(`code=RIVALCODE&router=${ROUTER}`))).ready).toBe(true);
    expect(
      (await json(await ready(`code=NEWCODE12&router=${ROUTER}`, freshIp(), "ghost"))).ready,
    ).toBe(true);
  });

  it("is never cached, so the page cannot be stuck on a stale answer", async () => {
    const res = await ready(`code=NEWCODE12&router=${ROUTER}`);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("allows steady polling but throttles hammering", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 42; i++)
      statuses.push((await ready(`code=NEWCODE12&router=${ROUTER}`, ip)).status);
    expect(statuses.slice(0, 40).every((s) => s === 200)).toBe(true);
    expect(statuses[41]).toBe(429);
  });
});
