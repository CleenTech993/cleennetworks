import { createFileRoute } from "@tanstack/react-router";
import { StubPage } from "@/components/stub-page";
export const Route = createFileRoute("/super-admin/users")({ component: () => <StubPage title="Users" description="Global user directory and role management." /> });
