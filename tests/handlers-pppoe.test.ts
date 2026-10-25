import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { call } from "./helpers/call";
import { freshIp, h } from "./helpers/setup";

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));
vi.mock("@tanstack/react-start/server", () => ({ getRequestHost: () => "portal.test" }));

import { Route as Pppoe } from "@/routes/api/public/router/pppoe.$token";
import { Route as Sync } from "@/routes/api/public/router/sync.$token";
import { issueDeviceToken } from "@/lib/router-auth.server";

const T = "11111111-1111-1111-1111-111111111111";
const OTHER_T = "99999999-9999-9999-9999-999999999999";
const R1 = "r1000000-0000-0000-0000-000000000001";
const R3 = "r3000000-0000-0000-0000-000000000003";
const R4 = "r4000000-0000-0000-0000-000000000004";

const send = (token: string, body: string, ip = freshIp()) =>
  call(Pppoe, "POST", { params: { token }, rawBody: body, ip });
const rpcCalls = () =>
  h.db.log.filter((l) => l.table === "rpc" && l.op === "record_pppoe_sessions");

beforeEach(() => {
  h.db = new FakeDb()
    .seed("tenants", [
      { id: T, slug: "acme", name: "Acme ISP" },
      { id: OTHER_T, slug: "rival", name: "Rival" },
    ])
    .seed("routers", [
      {
        id: R1,
        tenant_id: T,
        name: "Tower 1",
        status: "online",
        provision_token: "boot".padEnd(32, "x"),
        legacy_token_auth: false,
        block_tethering: true,
      },
      {
        id: R3,
        tenant_id: OTHER_T,
        name: "Rival",
        status: "online",
        provision_token: "rival".padEnd(32, "z"),
        legacy_token_auth: false,
        block_tethering: true,
      },
    ]);
  h.db.rpcs.record_pppoe_sessions = (args: { p_sessions: unknown[] }) => ({
    data: args.p_sessions.length,
  });
});
afterEach(() => vi.restoreAllMocks());

describe("PPPoE session report endpoint", () => {
  it("hands the parsed sessions to the database, scoped to the router that authenticated", async () => {
    const token = await issueDeviceToken(R1);
    const res = await send(
      token,
      "alice|aa-bb-cc-dd-ee-01|10.10.0.2;bob|AA:BB:CC:DD:EE:02|10.10.0.3;",
    );
    expect(res.status).toBe(200);
    expect(rpcCalls()).toHaveLength(1);
    expect(rpcCalls()[0].payload).toEqual({
      p_router_id: R1,
      p_tenant_id: T,
      p_sessions: [
        { username: "alice", mac: "AA:BB:CC:DD:EE:01", ip: "10.10.0.2" },
        { username: "bob", mac: "AA:BB:CC:DD:EE:02", ip: "10.10.0.3" },
      ],
    });
  });

  it("takes router and tenant from the token, never from anything in the body", async () => {
    const token = await issueDeviceToken(R1);
    await send(
      token,
      `alice|AA:BB:CC:DD:EE:01|10.0.0.2;p_tenant_id|${OTHER_T}|x;tenant|${OTHER_T}|${R3}`,
    );
    const args = rpcCalls()[0].payload as { p_router_id: string; p_tenant_id: string };
    expect(args.p_router_id).toBe(R1);
    expect(args.p_tenant_id).toBe(T);
  });

  it("rejects unknown tokens and does not touch the database", async () => {
    const res = await send("x".repeat(40), "alice|AA:BB:CC:DD:EE:01|10.0.0.2");
    expect(res.status).toBe(404);
    expect(rpcCalls()).toHaveLength(0);
  });

  it("does not accept the 24 h bootstrap token on this endpoint", async () => {
    const res = await send("boot".padEnd(32, "x"), "alice|AA:BB:CC:DD:EE:01|10.0.0.2");
    expect(res.status).toBe(404);
    expect(rpcCalls()).toHaveLength(0);
  });

  it("accepts an empty or fully invalid report without calling the database", async () => {
    const token = await issueDeviceToken(R1);
    expect((await send(token, "")).status).toBe(200);
    expect((await send(token, "garbage;more|garbage")).status).toBe(200);
    expect(rpcCalls()).toHaveLength(0);
  });

  it("reports a database failure as 500 so the router logs it", async () => {
    const token = await issueDeviceToken(R1);
    h.db.failNext("rpc", "record_pppoe_sessions", "db down");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await send(token, "alice|AA:BB:CC:DD:EE:01|10.0.0.2")).status).toBe(500);
  });

  it("limits how often one router can report", async () => {
    // Its own router: the limiter's counters are shared by every test in this file.
    h.db.seed("routers", [
      {
        id: R4,
        tenant_id: T,
        name: "Tower 4",
        status: "online",
        provision_token: "t4".padEnd(32, "x"),
        legacy_token_auth: false,
      },
    ]);
    const token = await issueDeviceToken(R4);
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++)
      statuses.push((await send(token, "alice|AA:BB:CC:DD:EE:01|10.0.0.2")).status);
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[31]).toBe(429);
  });
});

describe("sync installs the PPPoE report", () => {
  it("adds the netgrid-pppoe script pointing at this router's token, alongside the device report", async () => {
    const token = await issueDeviceToken(R1);
    const res = await call(Sync, "GET", { params: { token }, ip: freshIp() });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain("add name=netgrid-pppoe source={");
    expect(text).toContain(`https://portal.test/api/public/router/pppoe/${token}`);
    expect(text).toContain("netgrid-devices"); // the existing hotspot device report is unaffected
  });
});
