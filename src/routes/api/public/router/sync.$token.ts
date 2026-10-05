import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// RouterOS script that syncs PPPoE secrets and voucher hotspot users from the platform.
// Routers fetch + import this every few minutes (see provisioning scheduler "netgrid-sync").
const SAFE = /^[A-Za-z0-9._@-]{1,64}$/;

export const Route = createFileRoute("/api/public/router/sync/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { data: router } = await supabaseAdmin
          .from("routers").select("id,tenant_id").eq("provision_token", params.token).maybeSingle();
        if (!router) return new Response("# unknown token\n", { status: 404, headers: { "content-type": "text/plain" } });

        const now = new Date().toISOString();
        const [{ data: customers }, { data: vouchers }] = await Promise.all([
          supabaseAdmin.from("customers")
            .select("pppoe_username,pppoe_password,status,expires_at,router_id")
            .eq("tenant_id", router.tenant_id).eq("customer_type", "pppoe").eq("status", "active"),
          supabaseAdmin.from("vouchers")
            .select("code,status,expires_at")
            .eq("tenant_id", router.tenant_id).in("status", ["unused", "used"])
            .or(`expires_at.is.null,expires_at.gt.${now}`),
        ]);

        const lines: string[] = [
          "# NetGrid sync",
          "/ppp secret",
          ':do { remove [find comment="netgrid"] } on-error={}',
        ];
        for (const c of customers ?? []) {
          if (c.router_id && c.router_id !== router.id) continue;
          if (c.expires_at && c.expires_at < now) continue;
          if (!c.pppoe_username || !c.pppoe_password) continue;
          if (!SAFE.test(c.pppoe_username) || !SAFE.test(c.pppoe_password)) continue;
          lines.push(`:do { add name="${c.pppoe_username}" password="${c.pppoe_password}" service=pppoe profile=netgrid-pppoe comment="netgrid" } on-error={}`);
        }
        lines.push("/ip hotspot user", ':do { remove [find comment="netgrid-voucher"] } on-error={}');
        for (const v of vouchers ?? []) {
          if (!SAFE.test(v.code)) continue;
          lines.push(`:do { add name="${v.code}" password="${v.code}" server=netgrid-hs comment="netgrid-voucher" } on-error={}`);
        }
        lines.push(':log info "NetGrid: users synced"', "");

        return new Response(lines.join("\n"), {
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
        });
      },
    },
  },
});
