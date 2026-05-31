import { createFileRoute } from "@tanstack/react-router";
import { StubPage } from "@/components/stub-page";
export const Route = createFileRoute("/portal/usage")({ component: () => <StubPage title="Usage" description="Your session history and data consumed." /> });
