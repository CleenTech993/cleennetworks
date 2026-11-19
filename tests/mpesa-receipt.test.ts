import { describe, expect, it } from "vitest";
import { extractMpesaReceiptCode } from "@/lib/mpesa-receipt";

describe("extractMpesaReceiptCode", () => {
  it("accepts a pasted receipt code", () => {
    expect(extractMpesaReceiptCode("  sfe1a2b3cd ")).toBe("SFE1A2B3CD");
  });

  it("extracts the code preceding Confirmed from a full M-Pesa SMS", () => {
    expect(
      extractMpesaReceiptCode(
        "SFE1A2B3CD Confirmed. Ksh50.00 sent to ACME ISP on 6/11/26 at 1:35 PM.",
      ),
    ).toBe("SFE1A2B3CD");
  });

  it("rejects messages with no confirmed receipt or ambiguous receipt codes", () => {
    expect(extractMpesaReceiptCode("Payment is being processed, please wait.")).toBeNull();
    expect(extractMpesaReceiptCode("AAAA1111 Confirmed. BBBB2222 Confirmed.")).toBeNull();
  });
});