import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { call, json } from "./helpers/call";
import { h } from "./helpers/setup";

const emailMock = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));
vi.mock("@/lib/platform-invoice-email.server", () => ({
  sendPlatformInvoiceEmail: emailMock.send,
}));

import { Route } from "@/routes/api/cron/platform-billing";

const TENANT = "11111111-1111-1111-1111-111111111111";
const INVOICE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const invoice = {
  id: INVOICE,
  tenant_id: TENANT,
  invoice_number: "INV-202610-11111111111111111111111111111111",
  payment_reference: "NG1234567890AB",
  period_start: "2026-10-01T00:00:00.000Z",
  period_end: "2026-11-01T00:00:00.000Z",
  gross_amount: 1000,
  commission_amount: 18,
  commission_rate_pct: null,
  hotspot_gross_amount: 800,
  pppoe_gross_amount: 200,
  hotspot_commission_amount: 16,
  pppoe_commission_amount: 2,
  hotspot_commission_rate_pct: 2,
  pppoe_commission_rate_pct: 1,
  tenant_mpesa_receipt: null,
  status: "pending",
  mpesa_receipt: null,
  created_at: "2026-11-01T00:00:00.000Z",
  issued_at: "2026-11-01T00:00:00.000Z",
  due_at: "2026-11-04T00:00:00.000Z",
  email_status: "sending",
  email_error: null,
  email_attempted_at: "2026-11-01T00:00:00.000Z",
  email_sent_at: null,
  collected_at: null,
};

const send = (authorization?: string) =>
  call(Route, "POST", {
    url: "https://portal.test/api/cron/platform-billing",
    headers: authorization ? { authorization } : {},
    body: {},
  });

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
  emailMock.send.mockReset().mockResolvedValue(undefined);
  h.db = new FakeDb()
    .seed("tenants", [{ id: TENANT, name: "Example ISP", support_email: "billing@example.test" }])
    .seed("platform_mpesa_config", [{ id: 1, shortcode: "123456" }])
    .seed("platform_commissions", [{ ...invoice }]);
  h.db.rpcs.generate_monthly_platform_commission_invoices = () => ({ data: 1 });
  h.db.rpcs.refresh_overdue_tenant_billing = () => ({ data: 0 });
  h.db.rpcs.claim_platform_invoice_emails = () => ({ data: [{ ...invoice }] });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("platform billing scheduled job", () => {
  it("rejects requests without the configured bearer secret", async () => {
    const response = await send("Bearer wrong-secret");
    expect(response.status).toBe(401);
    expect(h.db.log.filter((entry) => entry.op.startsWith("generate_"))).toHaveLength(0);
  });

  it("generates invoices, reconciles overdue tenants, and records successful email delivery", async () => {
    const response = await send("Bearer test-cron-secret");

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      invoicesCreated: 1,
      tenantsSuspended: 0,
      emailsSent: 1,
      emailsFailed: 0,
    });
    expect(emailMock.send).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: "billing@example.test",
        invoiceNumber: invoice.invoice_number,
        paymentReference: invoice.payment_reference,
        commissionAmount: 18,
        hotspotGrossAmount: 800,
        pppoeGrossAmount: 200,
        hotspotCommissionAmount: 16,
        pppoeCommissionAmount: 2,
        platformShortcode: "123456",
      }),
    );
    expect(h.db.rows("platform_commissions")[0]).toMatchObject({
      email_status: "sent",
      email_sent_at: expect.any(String),
    });
  });

  it("records email failures for retry without losing the invoice", async () => {
    emailMock.send.mockRejectedValue(new Error("SMTP unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await send("Bearer test-cron-secret");

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ emailsSent: 0, emailsFailed: 1 });
    expect(h.db.rows("platform_commissions")[0]).toMatchObject({
      status: "pending",
      email_status: "failed",
      email_error: "Email delivery failed. Check platform SMTP configuration.",
    });
  });
});
