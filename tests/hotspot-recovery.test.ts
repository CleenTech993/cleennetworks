import { describe, expect, it } from "vitest";
import { packageDurationSeconds, recoveryAllowance } from "../src/lib/hotspot-recovery";

describe("hotspot outage recovery allowance", () => {
  it("calculates supported package durations", () => {
    expect(packageDurationSeconds(1, "hours")).toBe(3600);
    expect(packageDurationSeconds(2, "days")).toBe(172800);
    expect(packageDurationSeconds(null, "hours")).toBeNull();
    expect(packageDurationSeconds(0, "minutes")).toBeNull();
  });

  it("requires at least half the paid package time to remain", () => {
    expect(recoveryAllowance(3600, 1800)).toEqual({ eligible: true, restoredSeconds: 1800 });
    expect(recoveryAllowance(3600, 1801)).toEqual({ eligible: false, restoredSeconds: 1799 });
    expect(recoveryAllowance(3600, 0)).toEqual({ eligible: true, restoredSeconds: 3600 });
  });

  it("never grants more than the package duration", () => {
    expect(recoveryAllowance(3600, 5000)).toEqual({ eligible: false, restoredSeconds: 0 });
    expect(recoveryAllowance(-1, 0)).toEqual({ eligible: false, restoredSeconds: 0 });
  });

  it("limits later recovery to the time still available from the previous recovery", () => {
    expect(recoveryAllowance(3600, 300, 1800)).toEqual({
      eligible: true,
      restoredSeconds: 1800,
    });
    expect(recoveryAllowance(3600, 300, 1799)).toEqual({
      eligible: false,
      restoredSeconds: 1799,
    });
  });
});
