import { createFileRoute } from "@tanstack/react-router";
import { StubPage } from "@/components/stub-page";
export const Route = createFileRoute("/tenant/hotspot")({ component: () => <StubPage title="Hotspot" description="Active hotspot users, vouchers and live sessions." /> });
