import { describe, expect, it } from "vitest";
import { classifyStoreError, MIGRATION_FILE, storeProblemMessage } from "../src/lib/gateway-secrets-errors";

describe("credential store errors", () => {
  it("recognises a table that doesn't exist (PostgREST and Postgres wording)", () => {
    expect(classifyStoreError({ code: "PGRST205", message: "Could not find the table 'public.platform_gateway_secrets' in the schema cache" })).toBe("missing");
    expect(classifyStoreError({ code: "42P01", message: 'relation "platform_gateway_secrets" does not exist' })).toBe("missing");
    expect(classifyStoreError({ message: "Could not find the table in the schema cache" })).toBe("missing");
  });
  it("recognises a permissions problem", () => {
    expect(classifyStoreError({ code: "42501", message: "permission denied for table platform_gateway_secrets" })).toBe("denied");
  });
  it("treats anything else as a generic error", () => {
    expect(classifyStoreError({ code: "23514", message: "check violation" })).toBe("error");
    expect(classifyStoreError(null)).toBe("error");
  });
  it("tells the person what to do, and never leaks database details", () => {
    expect(storeProblemMessage("missing")).toContain(MIGRATION_FILE);
    expect(storeProblemMessage("denied")).toContain("grants");
    const generic = storeProblemMessage("error", "XX000");
    expect(generic).toContain("XX000");
    expect(generic).not.toMatch(/relation|schema|SELECT/i);
  });
});
