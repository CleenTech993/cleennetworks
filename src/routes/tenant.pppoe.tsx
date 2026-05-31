import { createFileRoute } from "@tanstack/react-router";
import { StubPage } from "@/components/stub-page";
export const Route = createFileRoute("/tenant/pppoe")({ component: () => <StubPage title="PPPoE" description="PPPoE profiles, secrets and active connections." /> });
