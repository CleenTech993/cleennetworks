import { describe, expect, it } from "vitest";
import {
  SYNC_MARGIN_MS,
  canRelogin,
  cleanRouterError,
  explainLoginError,
  voucherReachedRouter,
} from "../src/lib/voucher-login";

const T = Date.UTC(2026, 9, 28, 12, 0, 0);
const iso = (ms: number) => new Date(T + ms).toISOString();

describe("voucherReachedRouter", () => {
  it("is true once the router synced after the voucher existed", () => {
    expect(voucherReachedRouter(iso(60_000), iso(0))).toBe(true);
    expect(voucherReachedRouter(iso(SYNC_MARGIN_MS), iso(0))).toBe(true);
  });
  it("is false while the router's last sync is older than the voucher", () => {
    expect(voucherReachedRouter(iso(-60_000), iso(0))).toBe(false);
  });
  it("is false inside the safety margin, so a small clock difference cannot say 'synced' early", () => {
    expect(voucherReachedRouter(iso(0), iso(0))).toBe(false);
    expect(voucherReachedRouter(iso(SYNC_MARGIN_MS - 1), iso(0))).toBe(false);
  });
  it("is false when the router has never synced", () => {
    expect(voucherReachedRouter(null, iso(0))).toBe(false);
    expect(voucherReachedRouter(undefined, iso(0))).toBe(false);
  });
  it("has nothing to wait for when the voucher's age is unknown", () => {
    expect(voucherReachedRouter(null, null)).toBe(true);
    expect(voucherReachedRouter(iso(0), undefined)).toBe(true);
  });
  it("does not trust unparseable timestamps", () => {
    expect(voucherReachedRouter("garbage", iso(0))).toBe(false);
  });
});

describe("canRelogin", () => {
  const used = {
    status: "used",
    expires_at: null as string | null,
    bound_mac: null as string | null,
  };
  const MAC = "AA:BB:CC:DD:EE:01";

  it("lets a used, unexpired voucher log in again", () => {
    expect(canRelogin(used, 1, MAC, T)).toEqual({ ok: true });
    expect(canRelogin({ ...used, expires_at: iso(60_000) }, 1, MAC, T)).toEqual({ ok: true });
  });
  it("refuses once the voucher has expired", () => {
    expect(canRelogin({ ...used, expires_at: iso(-1) }, 1, MAC, T)).toEqual({
      ok: false,
      error: "Voucher expired",
    });
    expect(canRelogin({ ...used, expires_at: iso(0) }, 1, MAC, T)).toMatchObject({ ok: false });
  });
  it("refuses a code that is not simply 'used' (for example revoked)", () => {
    expect(canRelogin({ ...used, status: "revoked" }, 1, MAC, T)).toEqual({
      ok: false,
      error: "Voucher already used",
    });
  });
  it("one-device plan: the pinned device may come back, a different one may not", () => {
    const pinned = { ...used, bound_mac: MAC };
    expect(canRelogin(pinned, 1, MAC, T)).toEqual({ ok: true });
    expect(canRelogin(pinned, 1, MAC.toLowerCase(), T)).toEqual({ ok: true });
    const other = canRelogin(pinned, 1, "AA:BB:CC:DD:EE:99", T);
    expect(other).toMatchObject({ ok: false });
    expect(!other.ok && other.error).toMatch(/another device/i);
  });
  it("one-device plan: an unpinned code, or a missing MAC, is left to the router to enforce", () => {
    expect(canRelogin(used, 1, "AA:BB:CC:DD:EE:99", T)).toEqual({ ok: true });
    expect(canRelogin({ ...used, bound_mac: MAC }, 1, null, T)).toEqual({ ok: true });
  });
  it("multi-device plan: any device may log in (the router counts sessions)", () => {
    expect(canRelogin({ ...used, bound_mac: MAC }, 3, "AA:BB:CC:DD:EE:99", T)).toEqual({
      ok: true,
    });
  });
});

describe("cleanRouterError", () => {
  it("keeps a plain router message", () => {
    expect(cleanRouterError("invalid username or password")).toBe("invalid username or password");
  });
  it("returns null for nothing", () => {
    for (const v of [null, undefined, "", "   ", "\n\t"]) expect(cleanRouterError(v)).toBeNull();
  });
  it("strips markup characters and control characters, collapses whitespace", () => {
    expect(cleanRouterError("<script>alert(1)</script>\u0000  hi\n there")).toBe(
      "script alert(1) /script hi there",
    );
    expect(cleanRouterError("a<b>c")).not.toMatch(/[<>]/);
  });
  it("caps the length", () => {
    expect(cleanRouterError("x".repeat(1000))!.length).toBe(160);
  });
});

describe("explainLoginError", () => {
  it("tells the customer a brand-new voucher may just not have reached the router yet", () => {
    const h = explainLoginError("invalid username or password");
    expect(h.retry).toBe(true);
    expect(h.hint).toMatch(/2 minutes/);
  });
  it("explains the device limit and a device mismatch", () => {
    expect(explainLoginError("no more sessions are allowed for user ABC").hint).toMatch(/devices/i);
    expect(explainLoginError("user ABC is not allowed to login from this MAC").hint).toMatch(
      /different device/i,
    );
  });
  it("explains used-up vouchers", () => {
    expect(explainLoginError("uptime limit reached").retry).toBe(false);
  });
  it("gives unknown errors a generic, non-alarming hint", () => {
    expect(explainLoginError("something odd").hint.length).toBeGreaterThan(10);
  });
});
