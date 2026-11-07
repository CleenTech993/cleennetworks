import { describe, expect, it } from "vitest";
import { isStrongPassword } from "../src/lib/password-policy";

describe("isStrongPassword", () => {
  it("accepts passwords with the required length and character classes", () => {
    expect(isStrongPassword("Abc!1234")).toBe(true);
    expect(isStrongPassword("Strong!Password7")).toBe(true);
  });

  it.each([
    ["Abc!123", "fewer than 8 characters"],
    ["lowercase!password7", "no uppercase letter"],
    ["UPPERCASE!PASSWORD7", "no lowercase letter"],
    ["NoNumber!Password", "no number"],
    ["NoSymbolPassword7", "no symbol"],
    ["Strong Password!7", "whitespace"],
    ["Aa1!" + "b".repeat(69), "more than 72 characters"],
  ])("rejects a password with %s", (password) => {
    expect(isStrongPassword(password)).toBe(false);
  });

  it("limits UTF-8 encoded passwords to 72 bytes", () => {
    expect(isStrongPassword("Strong!Passw" + "é".repeat(31))).toBe(false);
  });
});
