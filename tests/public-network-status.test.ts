import { describe, expect, it } from "vitest";
import { publicNetworkStatus } from "../src/lib/public-network-status";

describe("publicNetworkStatus", () => {
  it("reports operational only when every enrolled router is live", () => {
    expect(publicNetworkStatus(3, 3)).toBe("operational");
  });

  it("distinguishes partial and total outages", () => {
    expect(publicNetworkStatus(3, 1)).toBe("degraded");
    expect(publicNetworkStatus(3, 0)).toBe("outage");
  });

  it("does not claim healthy service without valid router counts", () => {
    expect(publicNetworkStatus(0, 0)).toBe("unknown");
    expect(publicNetworkStatus(2, 3)).toBe("unknown");
    expect(publicNetworkStatus(Number.NaN, 0)).toBe("unknown");
  });
});
