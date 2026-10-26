import { describe, expect, it } from "vitest";
import { SYNC_SETTLE_MS, voucherReady } from "../src/lib/voucher-ready";

const T0 = Date.parse("2026-10-29T10:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();

describe("voucherReady", () => {
  it("is not ready when the router has never synced", () => {
    expect(voucherReady({ voucherCreatedAt: at(0), lastSyncAt: null, now: T0 + 60_000 })).toBe(false);
  });
  it("is not ready when the last sync happened before the voucher existed", () => {
    // bought at 10:00:30, router last synced 10:00:10: it doesn't have it yet
    expect(voucherReady({ voucherCreatedAt: at(30_000), lastSyncAt: at(10_000), now: T0 + 90_000 })).toBe(false);
  });
  it("is ready once a sync that includes the voucher has had time to run", () => {
    expect(voucherReady({ voucherCreatedAt: at(30_000), lastSyncAt: at(60_000), now: T0 + 60_000 + SYNC_SETTLE_MS })).toBe(true);
  });
  it("waits a few seconds after the sync so the router can run the script", () => {
    expect(voucherReady({ voucherCreatedAt: at(0), lastSyncAt: at(5_000), now: T0 + 5_000 + SYNC_SETTLE_MS - 1 })).toBe(false);
  });
  it("copes with bad timestamps", () => {
    expect(voucherReady({ voucherCreatedAt: "nope", lastSyncAt: at(0), now: T0 + 60_000 })).toBe(false);
    expect(voucherReady({ voucherCreatedAt: at(0), lastSyncAt: "nope", now: T0 + 60_000 })).toBe(false);
  });
});
