import { createFileRoute } from "@tanstack/react-router";
import { StubPage } from "@/components/stub-page";
export const Route = createFileRoute("/super-admin/health")({ component: () => <StubPage title="Platform Health" description="API uptime, callback success rates, queue depth." /> });
