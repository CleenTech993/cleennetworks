import { describe, expect, it } from "vitest";
import { isAal2 } from "../src/lib/aal";

describe("isAal2", () => {
  it("is true only for an aal2 token", () => {
    expect(isAal2({ aal: "aal2" })).toBe(true);
    expect(isAal2({ aal: "aal1" })).toBe(false);
    expect(isAal2({})).toBe(false);
    expect(isAal2(null)).toBe(false);
    expect(isAal2(undefined)).toBe(false);
    expect(isAal2({ aal: "AAL2" })).toBe(false);
  });
});
