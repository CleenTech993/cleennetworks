import { createFileRoute } from "@tanstack/react-router";
import { StubPage } from "@/components/stub-page";
export const Route = createFileRoute("/super-admin/billing")({ component: () => <StubPage title="SaaS Billing" description="Tenant subscriptions, invoices and plan changes." /> });
