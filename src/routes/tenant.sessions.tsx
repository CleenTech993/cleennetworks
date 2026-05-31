import { createFileRoute } from "@tanstack/react-router";
import { StubPage } from "@/components/stub-page";
export const Route = createFileRoute("/tenant/sessions")({ component: () => <StubPage title="Sessions" description="Live and historical user sessions across all routers." /> });
