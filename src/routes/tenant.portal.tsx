import { createFileRoute } from "@tanstack/react-router";
import { StubPage } from "@/components/stub-page";
export const Route = createFileRoute("/tenant/portal")({ component: () => <StubPage title="Captive Portal" description="Branding, themes, terms and login methods for your captive portal." /> });
