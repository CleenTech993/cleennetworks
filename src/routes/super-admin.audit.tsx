import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/dashboard-shell";
import { AuditLogViewer } from "@/components/audit-log-viewer";

export const Route = createFileRoute("/super-admin/audit")({
  head: () => ({
    meta: [
      { title: "Platform Audit Log — NetGrid Super Admin" },
      { name: "description", content: "Global platform audit trail across all tenants and administrators." },
    ],
  }),
  component: SuperAdminAuditPage,
});

function SuperAdminAuditPage() {
  return (
    <div>
      <PageHeader
        title="Platform Audit Trail"
        description="Global record of security events, administrative activities, and router outages across the platform."
      />
      <AuditLogViewer isSuperAdmin />
    </div>
  );
}
