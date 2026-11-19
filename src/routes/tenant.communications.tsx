import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/dashboard-shell";
import { CommunicationsManager } from "@/components/communications-manager";

export const Route = createFileRoute("/tenant/communications")({
  head: () => ({ meta: [{ title: "Communications — Tenant console" }] }),
  component: () => (
    <div>
      <PageHeader
        title="Customer communications"
        description="Publish customer messages and manage maintenance for your ISP or a specific site."
      />
      <CommunicationsManager platform={false} />
    </div>
  ),
});
