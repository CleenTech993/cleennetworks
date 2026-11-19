import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { h } from "./helpers/setup";

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));

import {
  activeMaintenance,
  blocksAllConnections,
  blocksNewConnections,
  maintenanceMessage,
} from "@/lib/maintenance.server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const SITE = "33333333-3333-4333-8333-333333333333";
const OTHER_SITE = "44444444-4444-4444-8444-444444444444";
const now = new Date();
const activeDate = new Date(now.getTime() - 60_000).toISOString();
const futureDate = new Date(now.getTime() + 60 * 60_000).toISOString();
const expiredDate = new Date(now.getTime() - 30_000).toISOString();

beforeEach(() => {
  h.db = new FakeDb().seed("service_maintenance_windows", [
    {
      id: "platform",
      tenant_id: null,
      router_id: null,
      title: "Platform work",
      body: "Platform notice",
      mode: "notice",
      starts_at: activeDate,
      ends_at: futureDate,
      active: true,
    },
    {
      id: "tenant",
      tenant_id: TENANT,
      router_id: null,
      title: "Provider work",
      body: "All sites",
      mode: "notice",
      starts_at: activeDate,
      ends_at: null,
      active: true,
    },
    {
      id: "site",
      tenant_id: TENANT,
      router_id: SITE,
      title: "Site work",
      body: "New sales paused",
      mode: "block_new",
      starts_at: activeDate,
      ends_at: futureDate,
      active: true,
    },
    {
      id: "other-site",
      tenant_id: TENANT,
      router_id: OTHER_SITE,
      title: "Other site work",
      body: "Disconnecting",
      mode: "block_all",
      starts_at: activeDate,
      ends_at: futureDate,
      active: true,
    },
    {
      id: "other-tenant",
      tenant_id: OTHER_TENANT,
      router_id: null,
      title: "Other tenant",
      body: "Private",
      mode: "block_all",
      starts_at: activeDate,
      ends_at: null,
      active: true,
    },
    {
      id: "expired",
      tenant_id: TENANT,
      router_id: null,
      title: "Old notice",
      body: "Ended",
      mode: "block_all",
      starts_at: activeDate,
      ends_at: expiredDate,
      active: true,
    },
  ]);
});

afterEach(() => vi.restoreAllMocks());

describe("maintenance scope and modes", () => {
  it("returns platform, tenant-wide, and current-site windows only", async () => {
    const notices = await activeMaintenance(TENANT, SITE);

    expect(notices.map((notice) => notice.id).sort()).toEqual(["platform", "site", "tenant"]);
    expect(blocksNewConnections(notices)).toBe(true);
    expect(blocksAllConnections(notices)).toBe(false);
    expect(maintenanceMessage(notices)).toContain("Site work");
  });

  it("does not apply site-specific blocks to a portal without site context", async () => {
    const notices = await activeMaintenance(TENANT, null);

    expect(notices.map((notice) => notice.id).sort()).toEqual(["platform", "tenant"]);
    expect(blocksNewConnections(notices)).toBe(false);
    expect(blocksAllConnections(notices)).toBe(false);
  });

  it("distinguishes all-connection blocks from notice-only maintenance", () => {
    expect(
      blocksAllConnections([
        {
          id: "block",
          title: "Network work",
          body: "Disconnect",
          mode: "block_all",
          starts_at: activeDate,
          ends_at: null,
        },
      ]),
    ).toBe(true);
    expect(
      blocksNewConnections([
        {
          id: "notice",
          title: "Planned work",
          body: "No block",
          mode: "notice",
          starts_at: activeDate,
          ends_at: null,
        },
      ]),
    ).toBe(false);
  });
});
