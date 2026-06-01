import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";

export const Route = createFileRoute("/tenant/sms")({ component: SmsSettings });

function SmsSettings() {
  return (
    <div>
      <PageHeader title="Notifications" description="SMS, Email, WhatsApp and Telegram alerts." />
      <div className="grid gap-4 md:grid-cols-2">
        {[
          { name: "SMS (Africa's Talking)", body: "Send M-Pesa receipts and expiry reminders by SMS." },
          { name: "Email (SMTP)", body: "Send invoices and password resets via SMTP." },
          { name: "WhatsApp Business", body: "Send rich receipts and support replies on WhatsApp." },
          { name: "Telegram bot", body: "Send tenant-side ops alerts to a Telegram group." },
        ].map((c) => (
          <div key={c.name} className="rounded-lg border bg-card p-5">
            <h3 className="font-medium">{c.name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{c.body}</p>
            <button className="mt-3 text-xs text-primary hover:underline" disabled>Configure (soon)</button>
          </div>
        ))}
      </div>
      <div className="mt-6">
        <EmptyState title="No channels connected" description="Connect a provider above to start sending automated notifications to customers." />
      </div>
    </div>
  );
}
