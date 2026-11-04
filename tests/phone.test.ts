import { describe, expect, it } from "vitest";
import { isValidKenyanMobile } from "../src/lib/phone";

describe("isValidKenyanMobile", () => {
  it("accepts normalized Safaricom-style numbers", () => {
    expect(isValidKenyanMobile("254712345678")).toBe(true);
    expect(isValidKenyanMobile("254112345678")).toBe(true);
  });

  it("rejects junk, short and foreign numbers", () => {
    for (const phone of [
      "",
      "0712345678",
      "25471234567",
      "2547123456789",
      "254212345678",
      "447911123456",
      "abc",
    ]) {
      expect(isValidKenyanMobile(phone)).toBe(false);
    }
  });
});
