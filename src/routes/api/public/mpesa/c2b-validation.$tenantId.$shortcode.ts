import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/mpesa/c2b-validation/$tenantId/$shortcode")({
  server: {
    handlers: {
      POST: async () => Response.json({ ResultCode: 0, ResultDesc: "Accepted" }),
    },
  },
});
