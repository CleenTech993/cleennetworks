import nodemailer from "nodemailer";

export interface PlatformInvoiceEmail {
  recipient: string;
  tenantName: string;
  invoiceNumber: string;
  periodStart: string;
  periodEnd: string;
  issuedAt: string;
  dueAt: string;
  grossAmount: number;
  commissionAmount: number;
  commissionRatePct: number;
  platformShortcode: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeZone: "Africa/Nairobi",
  }).format(new Date(value));
}

function formatAmount(amount: number): string {
  return `KES ${amount.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function sendPlatformInvoiceEmail(invoice: PlatformInvoiceEmail): Promise<void> {
  const host = process.env["SMTP_HOST"]?.trim();
  const port = Number(process.env["SMTP_PORT"] ?? 587);
  const from = process.env["SMTP_FROM"]?.trim();
  const user = process.env["SMTP_USER"]?.trim();
  const password = process.env["SMTP_PASS"];
  if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Platform SMTP is not configured.");
  }
  if ((user && !password) || (!user && password)) {
    throw new Error("Platform SMTP authentication is incomplete.");
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: process.env["SMTP_SECURE"] === "true" || port === 465,
    ...(user && password ? { auth: { user, pass: password } } : {}),
  });

  const values = {
    tenantName: escapeHtml(invoice.tenantName),
    invoiceNumber: escapeHtml(invoice.invoiceNumber),
    periodStart: escapeHtml(formatDate(invoice.periodStart)),
    periodEnd: escapeHtml(
      formatDate(new Date(new Date(invoice.periodEnd).getTime() - 1000).toISOString()),
    ),
    issuedAt: escapeHtml(formatDate(invoice.issuedAt)),
    dueAt: escapeHtml(formatDate(invoice.dueAt)),
    gross: escapeHtml(formatAmount(invoice.grossAmount)),
    commission: escapeHtml(formatAmount(invoice.commissionAmount)),
    rate: escapeHtml(`${invoice.commissionRatePct}%`),
    shortcode: invoice.platformShortcode
      ? `<p>Paybill/Till: <strong>${escapeHtml(invoice.platformShortcode)}</strong></p>`
      : "",
  };

  await transport.sendMail({
    from,
    to: invoice.recipient,
    subject: `Platform commission invoice ${invoice.invoiceNumber}`,
    text: [
      `Hello ${invoice.tenantName},`,
      "",
      `Invoice: ${invoice.invoiceNumber}`,
      `Period: ${formatDate(invoice.periodStart)} to ${formatDate(new Date(new Date(invoice.periodEnd).getTime() - 1000).toISOString())}`,
      `Issued: ${formatDate(invoice.issuedAt)}`,
      `Due: ${formatDate(invoice.dueAt)}`,
      `Customer payments: ${formatAmount(invoice.grossAmount)}`,
      `Commission (${invoice.commissionRatePct}%): ${formatAmount(invoice.commissionAmount)}`,
      invoice.platformShortcode ? `Platform Paybill/Till: ${invoice.platformShortcode}` : "",
      "",
      "Please settle the commission by the due date. Tenant customer service may be paused if the invoice remains unpaid.",
    ]
      .filter(Boolean)
      .join("\n"),
    html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#172033">
      <h1 style="font-size:22px">Platform commission invoice</h1>
      <p>Hello ${values.tenantName},</p>
      <p>Invoice <strong>${values.invoiceNumber}</strong> covers ${values.periodStart} to ${values.periodEnd}.</p>
      <p>Issued ${values.issuedAt}; due ${values.dueAt}.</p>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:8px;border-bottom:1px solid #ddd">Customer payments</td><td style="padding:8px;border-bottom:1px solid #ddd;text-align:right">${values.gross}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #ddd">Commission (${values.rate})</td><td style="padding:8px;border-bottom:1px solid #ddd;text-align:right"><strong>${values.commission}</strong></td></tr>
      </table>
      ${values.shortcode}
      <p>Please settle the commission by the due date. Tenant customer service may be paused if the invoice remains unpaid.</p>
    </div>`,
  });
}
