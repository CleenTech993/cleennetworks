import { createFileRoute } from "@tanstack/react-router";
import { StubPage } from "@/components/stub-page";
export const Route = createFileRoute("/portal/invoices")({ component: () => <StubPage title="Invoices" description="Your M-Pesa payment receipts." /> });
