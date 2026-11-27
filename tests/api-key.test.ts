import { describe, expect, it } from "vitest";
import { createTenantApiKey, hashTenantApiKey, TENANT_API_SCOPES } from "../src/lib/api-key";

describe("tenant API keys", () => {
  it("creates a prefixed key and stores only a stable SHA-256 hash", () => {
    const created = createTenantApiKey();
    expect(created.key).toMatch(/^ng_[a-f0-9]{64}$/);
    expect(created.prefix).toMatch(/^ng_[a-f0-9]{12}$/);
    expect(created.hash).toBe(hashTenantApiKey(created.key));
    expect(created.hash).toHaveLength(64);
  });

  it("exposes only the documented tenant API scopes", () => {
    expect(TENANT_API_SCOPES).toEqual([
      "static_ips:read",
      "static_ips:write",
      "routers:read",
      "customers:read",
    ]);
  });

  it("does not return the same key from its hash", () => {
    const created = createTenantApiKey();
    expect(hashTenantApiKey(created.key)).not.toContain("ng_");
  });
});
