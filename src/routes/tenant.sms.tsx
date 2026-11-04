import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/tenant/sms")({ component: Notifications });

function Notifications() {
  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Review your notification setup and manage connected service accounts."
      />
      <section className="max-w-2xl rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Service accounts and API credentials</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Daraja and SMS credentials are managed in Settings, where they are encrypted and never
          returned to the browser.
        </p>
        <Button asChild className="mt-4">
          <Link to="/tenant/settings">Open Settings</Link>
        </Button>
      </section>
    </div>
  );
}
