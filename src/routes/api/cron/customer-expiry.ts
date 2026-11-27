import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function isAuthorized(request: Request): boolean {
  const expected = process.env["CRON_SECRET"];
  const authorization = request.headers.get("authorization") ?? "";
  if (!expected || !authorization.startsWith("Bearer ")) return false;
  const supplied = authorization.slice("Bearer ".length);
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

export const Route = createFileRoute("/api/cron/customer-expiry")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthorized(request)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        const { data, error } = await supabaseAdmin.rpc("expire_customer_access");
        if (error) {
          console.error("Could not expire customer access", error);
          return Response.json({ error: "Could not expire customer access" }, { status: 500 });
        }
        return Response.json({ expired: data });
      },
      POST: async ({ request }) => {
        if (!isAuthorized(request)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        const { data, error } = await supabaseAdmin.rpc("expire_customer_access");
        if (error) {
          console.error("Could not expire customer access", error);
          return Response.json({ error: "Could not expire customer access" }, { status: 500 });
        }
        return Response.json({ expired: data });
      },
    },
  },
});
