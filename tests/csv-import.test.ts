import { describe, expect, it } from "vitest";
import { CSV_TEMPLATES, parseCsv } from "../src/lib/csv-import";

describe("parseCsv", () => {
  it("parses headers, quoted commas, escaped quotes, and embedded newlines", () => {
    expect(parseCsv('name,phone\r\n"Doe, Jane",123\r\n"Line 1\nLine ""2""",456')).toEqual({
      headers: ["name", "phone"],
      rows: [
        { name: "Doe, Jane", phone: "123" },
        { name: 'Line 1\nLine "2"', phone: "456" },
      ],
    });
  });

  it("normalizes a BOM and ignores blank rows", () => {
    expect(parseCsv("\uFEFFname,kind\nPackage,pppoe\n\n")).toEqual({
      headers: ["name", "kind"],
      rows: [{ name: "Package", kind: "pppoe" }],
    });
  });

  it("rejects malformed, ambiguous, and oversized CSV input", () => {
    expect(() => parseCsv("name,name\none,two")).toThrow("duplicate column names");
    expect(() => parseCsv('name\n"unclosed')).toThrow("unclosed quoted field");
    expect(() => parseCsv('name\n"closed"trailing')).toThrow("characters after a quoted field");
    expect(() => parseCsv("name,phone\nonly-one")).toThrow("expected 2");
    expect(() => parseCsv("x".repeat(5 * 1024 * 1024 + 1))).toThrow("5 MB or smaller");
  });
});

describe("CSV templates", () => {
  it("provides headers for each supported migration type", () => {
    expect(CSV_TEMPLATES.packages).toContain("fup_download_kbps,fup_upload_kbps");
    expect(CSV_TEMPLATES.customers.startsWith("full_name,phone,email")).toBe(true);
    expect(CSV_TEMPLATES.vouchers.startsWith("code,customer_name,phone")).toBe(true);
    expect(CSV_TEMPLATES.vouchers).toContain("legacy_cash_access");
  });
});
