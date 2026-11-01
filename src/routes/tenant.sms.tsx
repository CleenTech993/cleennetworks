import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/tenant/sms")({
  beforeLoad: () => {
    throw redirect({ to: "/tenant/settings" });
  },
  component: () => null,
});
