import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/dashboard-shell";
import { useAuth } from "@/hooks/use-auth";
import { AuditLogViewer } from "@/components/audit-log-viewer";

export const Route = createFileRoute("/tenant/audit")({
  head: () => ({
    meta: [
      { title: "Audit Log — NetGrid" },
      { name: "description", content: "Audit trail of operations, router changes, and security events." },
    ],
  }),
  component: TenantAuditPage,
});

function TenantAuditPage() {
  const { tenantId } = useAuth();

  return (
    <div>
      <PageHeader
        title="Audit Log"
        description="Comprehensive audit trail of administrator actions, router events, and security changes."
      />
      <AuditLogViewer tenantId={tenantId} />
    </div>
  );
}
