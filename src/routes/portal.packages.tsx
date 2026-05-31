import { createFileRoute } from "@tanstack/react-router";
import { StubPage } from "@/components/stub-page";
export const Route = createFileRoute("/portal/packages")({ component: () => <StubPage title="Buy package" description="Select a hotspot plan and pay via M-Pesa STK Push." /> });
