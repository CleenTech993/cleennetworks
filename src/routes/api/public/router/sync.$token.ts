import { createFileRoute } from "@tanstack/react-router";
import { getRequestHost } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loginPageMarker, routerosHealLoginPage } from "@/lib/hotspot-login.server";
import { buildDeviceMonitorLines } from "@/lib/inventory-monitor";
import { buildPppoeSyncLines } from "@/lib/pppoe";
import { buildTvSyncLines } from "@/lib/tv";

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
        const [{ data: tenant }, { data: customers }, { data: vouchers }, { data: packages }, { data: tvs }, { data: monitored }] = await Promise.all([
          supabaseAdmin.from("tenants").select("slug").eq("id", router.tenant_id).single(),
          supabaseAdmin.from("customers")
            .select("pppoe_username,pppoe_password,status,expires_at,router_id,package_id")
            .eq("tenant_id", router.tenant_id).eq("customer_type", "pppoe").eq("status", "active"),
          supabaseAdmin.from("vouchers")
            .select("code,status,expires_at")
            .eq("tenant_id", router.tenant_id).in("status", ["unused", "used"])
            .or(`expires_at.is.null,expires_at.gt.${now}`),
          supabaseAdmin.from("packages")
            .select("id,download_kbps,upload_kbps")
            .eq("tenant_id", router.tenant_id).eq("kind", "pppoe"),
          supabaseAdmin.from("tv_devices")
            .select("mac_address,status,expires_at")
            .eq("tenant_id", router.tenant_id).eq("status", "active").gt("expires_at", now),
          // Inventory devices (access points, switches, ONTs, ...) this router should ping and report on.
          supabaseAdmin.from("inventory_devices")
            .select("id,ip_address")
            .eq("tenant_id", router.tenant_id).eq("monitor_router_id", router.id)
            .eq("monitor_enabled", true).not("ip_address", "is", null),
        ]);

        const lines: string[] = ["# NetGrid sync"];

        // Self-heal the hotspot login page (captive-portal redirect): if the router's copy is
        // missing, stale or was reset, re-download it. No flash write when it is already current.
        if (tenant?.slug) {
          const host = getRequestHost();
          const portalUrl = `https://${host}/p/${encodeURIComponent(tenant.slug)}`;
          lines.push(
            routerosHealLoginPage({
              loginUrl: `https://${host}/api/public/provision/${params.token}/login.html`,
              marker: loginPageMarker({ portalUrl, routerId: router.id }),
              portalHost: host,
            }),
          );
        }
        // PPPoE: secrets + per-package speed profiles; expired/removed clients are disconnected.
        lines.push(
          ...buildPppoeSyncLines({
            routerId: router.id,
            customers: customers ?? [],
            packages: packages ?? [],
          }),
        );
        // Smart TVs: paid MAC addresses bypass the hotspot login (expired ones are cut off).
        lines.push(...buildTvSyncLines(tvs ?? []));
        // Inventory monitoring: keep a netwatch entry per monitored device; the router reports up/down.
        lines.push(
          ...buildDeviceMonitorLines(monitored ?? [], `https://${getRequestHost()}/api/public/router/devices/${params.token}`),
        );
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
