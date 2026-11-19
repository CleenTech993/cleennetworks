import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/dashboard-shell";
import { CommunicationsManager } from "@/components/communications-manager";

export const Route = createFileRoute("/super-admin/communications")({
  head: () => ({ meta: [{ title: "Communications — Super Admin" }] }),
  component: () => (
    <div>
      <PageHeader
        title="Platform communications"
        description="Send platform-wide updates or messages to customers of a selected tenant. Publish platform maintenance notices."
      />
      <CommunicationsManager platform />
    </div>
  ),
});
