import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { h } from "./helpers/setup";

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));

import { tenantServiceRestriction } from "@/lib/platform-billing.server";

const TENANT = "11111111-1111-1111-1111-111111111111";

describe("tenantServiceRestriction", () => {
  beforeEach(() => {
    h.db = new FakeDb().seed("tenants", [
      { id: TENANT, status: "active", billing_suspended_at: null },
    ]);
  });

  it("allows an active tenant with no overdue invoice", async () => {
    await expect(tenantServiceRestriction(TENANT)).resolves.toBeNull();
  });

  it("restricts service for an overdue commission invoice", async () => {
    h.db.rows("tenants")[0]!.billing_suspended_at = "2026-11-01T10:00:00Z";
    await expect(tenantServiceRestriction(TENANT)).resolves.toBe("commission_overdue");
  });

  it("preserves manual tenant suspension as a separate restriction", async () => {
    h.db.rows("tenants")[0]!.status = "suspended";
    await expect(tenantServiceRestriction(TENANT)).resolves.toBe("tenant_suspended");
  });

  it("surfaces database errors instead of failing open", async () => {
    h.db.failNext("tenants", "select", "database unavailable");
    await expect(tenantServiceRestriction(TENANT)).rejects.toThrow("database unavailable");
  });
});
