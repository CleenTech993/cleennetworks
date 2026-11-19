import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/mpesa/platform-c2b-validation/$token")({
  server: {
    handlers: {
      POST: async ({ params }) => {
        const { data, error } = await supabaseAdmin
          .from("platform_mpesa_config")
          .select("id")
          .eq("id", 1)
          .eq("c2b_callback_token", params.token)
          .maybeSingle();
        if (error) {
          console.error("Platform C2B validation token lookup failed", error);
          return Response.json(
            { ResultCode: 1, ResultDesc: "Validation temporarily unavailable" },
            { status: 503 },
          );
        }
        if (!data)
          return Response.json({ ResultCode: 1, ResultDesc: "Invalid callback" }, { status: 404 });
        return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
      },
    },
  },
});
