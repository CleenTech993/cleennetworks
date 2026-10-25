import { createFileRoute } from "@tanstack/react-router";
import { getRequestHost } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loginPageMarker, routerosHealLoginPage } from "@/lib/hotspot-login.server";
import { buildPppoeSyncLines } from "@/lib/pppoe";
import { buildTvSyncLines } from "@/lib/tv";
import { buildPppoeAgentLines } from "@/lib/pppoe-sessions";
import {
  buildBlockLines, buildDeviceAgentLines, buildHotspotUserLines, buildTetherLines, deviceLimitOf, type SyncVoucher,
} from "@/lib/devices";
import { authenticateRouter } from "@/lib/router-auth.server";
import { tooManyRequests } from "@/lib/rate-limit.server";

// RouterOS script that syncs PPPoE secrets and voucher hotspot users from the platform.
// Routers fetch + import this every few minutes (see provisioning scheduler "netgrid-sync").

export const Route = createFileRoute("/api/public/router/sync/$token")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const auth = await authenticateRouter(request, params.token);
        if (!auth.ok) {
          return auth.blocked
            ? tooManyRequests()
            : new Response("# unknown token\n", { status: 404, headers: { "content-type": "text/plain" } });
        }
        const router = auth.router;

        const now = new Date().toISOString();
        const [{ data: tenant }, { data: customers }, { data: vouchers }, { data: packages }, { data: tvs }, { data: hotspotPkgs }, { data: blocked }, { data: routerRow }] = await Promise.all([
          supabaseAdmin.from("tenants").select("slug").eq("id", router.tenant_id).single(),
          // Only this router's clients, plus clients the tenant explicitly assigned to "All routers"
          // (router_id null). Other routers' credentials are never even read for this request.
          supabaseAdmin.from("customers")
            .select("pppoe_username,pppoe_password,status,expires_at,router_id,package_id")
            .eq("tenant_id", router.tenant_id).eq("customer_type", "pppoe").eq("status", "active")
            .or(`router_id.eq.${router.id},router_id.is.null`),
          supabaseAdmin.from("vouchers")
            .select("code,status,expires_at,bound_mac,package_id")
            .eq("tenant_id", router.tenant_id).in("status", ["unused", "used"])
            .or(`expires_at.is.null,expires_at.gt.${now}`),
          supabaseAdmin.from("packages")
            .select("id,download_kbps,upload_kbps")
            .eq("tenant_id", router.tenant_id).eq("kind", "pppoe"),
          supabaseAdmin.from("tv_devices")
            .select("mac_address,status,expires_at")
            .eq("tenant_id", router.tenant_id).eq("status", "active").gt("expires_at", now),
          // Device limit of each hotspot/voucher package (one package = one device by default).
          supabaseAdmin.from("packages")
            .select("id,device_limit")
            .eq("tenant_id", router.tenant_id).in("kind", ["hotspot", "voucher"]),
          // Devices the tenant blocked, on any of its routers.
          supabaseAdmin.from("router_devices")
            .select("mac")
            .eq("tenant_id", router.tenant_id).eq("blocked", true),
          supabaseAdmin.from("routers").select("block_tethering").eq("id", router.id).maybeSingle(),
        ]);

        const lines: string[] = ["# NetGrid sync"];
        const host = getRequestHost();

        // Self-heal the hotspot login page (captive-portal redirect): if the router's copy is
        // missing, stale or was reset, re-download it. No flash write when it is already current.
        if (tenant?.slug) {
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
        // Hotspot vouchers: one package = one device (shared-users limit + MAC pinned from the database).
        const limitByPackage = new Map((hotspotPkgs ?? []).map((p) => [p.id, deviceLimitOf(p)]));
        const syncVouchers: SyncVoucher[] = (vouchers ?? []).map((v) => ({
          code: v.code,
          bound_mac: v.bound_mac,
          limit: v.package_id ? (limitByPackage.get(v.package_id) ?? 1) : 1,
        }));
        lines.push(...buildHotspotUserLines(syncVouchers));
        lines.push(...buildBlockLines((blocked ?? []).map((b) => b.mac)));
        // Anti-tethering rules and the periodic device report.
        lines.push(...buildTetherLines(routerRow?.block_tethering !== false));
        lines.push(...buildDeviceAgentLines(`https://${host}/api/public/router/devices/${params.token}`));
        // PPPoE session report (client MAC + connected state), installed the same way.
        lines.push(...buildPppoeAgentLines(`https://${host}/api/public/router/pppoe/${params.token}`));
        lines.push(':log info "NetGrid: users synced"', "");

        return new Response(lines.join("\n"), {
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
        });
      },
    },
  },
});
