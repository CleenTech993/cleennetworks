import { describe, expect, it } from "vitest";
import { generateTemporaryPassword } from "../src/lib/team-invite.server";
import { isStrongPassword } from "../src/lib/password-policy";

describe("generateTemporaryPassword", () => {
  it("generates strong passwords within the requested length", () => {
    for (const length of [12, 18, 32, 72]) {
      const password = generateTemporaryPassword(length);

      expect(password).toHaveLength(length);
      expect(isStrongPassword(password)).toBe(true);
    }
  });

  it("rejects lengths outside the supported range", () => {
    expect(() => generateTemporaryPassword(11)).toThrow();
    expect(() => generateTemporaryPassword(73)).toThrow();
  });
});
