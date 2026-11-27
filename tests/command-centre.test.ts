import { describe, expect, it } from "vitest";
import { buildCommandCentreItems } from "../src/lib/command-centre";

const now = new Date("2026-11-27T12:00:00.000Z");

describe("NETGRID Command Centre", () => {
  it("ranks offline routers ahead of support and overdue records", () => {
    const items = buildCommandCentreItems({
      now,
      routers: [{ id: "r1", name: "Router", last_heartbeat_at: null, last_seen_at: null }],
      tickets: [
        {
          id: "t1",
          subject: "Down",
          status: "open",
          priority: "urgent",
          created_at: "2026-11-27T10:00:00Z",
        },
      ],
      workOrders: [
        {
          id: "w1",
          title: "Visit",
          status: "open",
          priority: "high",
          scheduled_at: "2026-11-26T12:00:00Z",
          created_at: "2026-11-26T10:00:00Z",
        },
      ],
      invoices: [
        {
          id: "i1",
          invoice_number: "INV-1",
          amount: 500,
          status: "overdue",
          due_at: "2026-11-25T12:00:00Z",
        },
      ],
    });
    expect(items[0]?.id).toBe("network-offline");
    expect(items.some((item) => item.id === "support-priority")).toBe(true);
  });

  it("returns an all-clear item when no priority records exist", () => {
    const items = buildCommandCentreItems({
      now,
      routers: [
        { id: "r1", name: "Router", last_heartbeat_at: "2026-11-27T11:59:30Z", last_seen_at: null },
      ],
      tickets: [],
      workOrders: [],
      invoices: [],
    });
    expect(items).toEqual([expect.objectContaining({ id: "all-clear", severity: "info" })]);
  });
});
