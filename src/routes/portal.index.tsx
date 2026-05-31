import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, StatCard } from "@/components/dashboard-shell";
export const Route = createFileRoute("/portal/")({
  component: () => (
    <div>
      <PageHeader title="My account" description="Your active package, usage and renewal." />
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Active package" value="—" hint="No active subscription" />
        <StatCard label="Data remaining" value="—" />
        <StatCard label="Expires" value="—" />
      </div>
    </div>
  ),
});
