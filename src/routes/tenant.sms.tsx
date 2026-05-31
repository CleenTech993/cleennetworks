import { createFileRoute } from "@tanstack/react-router";
import { StubPage } from "@/components/stub-page";
export const Route = createFileRoute("/tenant/sms")({ component: () => <StubPage title="Notifications" description="SMS, Email, WhatsApp and Telegram alerts." /> });
