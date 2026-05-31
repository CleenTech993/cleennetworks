import { createFileRoute } from "@tanstack/react-router";
import { StubPage } from "@/components/stub-page";
export const Route = createFileRoute("/tenant/tickets")({ component: () => <StubPage title="Support" description="Customer tickets and internal notes." /> });
