import { describe, expect, it } from "vitest";
import { syncStatus } from "../src/lib/sync-status";

const NOW = Date.parse("2026-10-30T12:00:00.000Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe("syncStatus", () => {
  it("is healthy shortly after a sync", () => {
    expect(syncStatus(ago(1), NOW)).toMatchObject({ level: "ok", label: "last synced 1 min ago" });
    expect(syncStatus(ago(0), NOW).label).toBe("last synced just now");
    expect(syncStatus(ago(6), NOW).level).toBe("ok");
  });
  it("warns when a few intervals have been missed", () => {
    expect(syncStatus(ago(7), NOW).level).toBe("warn");
    expect(syncStatus(ago(15), NOW).level).toBe("warn");
  });
  it("is bad once the router has stopped syncing, and says what that means for vouchers", () => {
    const s = syncStatus(ago(16), NOW);
    expect(s.level).toBe("bad");
    expect(s.detail).toMatch(/cannot connect/);
    expect(syncStatus(ago(3 * 1440), NOW).label).toBe("last synced 3 d ago");
    expect(syncStatus(ago(180), NOW).label).toBe("last synced 3 h ago");
  });
  it("treats a router with no recorded sync as unknown rather than healthy", () => {
    for (const v of [null, undefined, ""]) expect(syncStatus(v, NOW).level).toBe("warn");
  });
});
