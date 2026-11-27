import { randomBytes, createHash } from "node:crypto";

export type TenantApiScope =
  "static_ips:read" | "static_ips:write" | "routers:read" | "customers:read";

export const TENANT_API_SCOPES: readonly TenantApiScope[] = [
  "static_ips:read",
  "static_ips:write",
  "routers:read",
  "customers:read",
];

export function createTenantApiKey() {
  const secret = randomBytes(32).toString("hex");
  const key = `ng_${secret}`;
  return {
    key,
    prefix: key.slice(0, 15),
    hash: createHash("sha256").update(key).digest("hex"),
  };
}

export function hashTenantApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
