import { createFileRoute } from "@tanstack/react-router";
import { getRequestHost } from "@tanstack/react-start/server";
import { dispatchPendingAlerts } from "@/lib/alerts.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loginPageMarker, routerosHealLoginPage } from "@/lib/hotspot-login.server";
import { buildDeviceMonitorLines } from "@/lib/inventory-monitor";
import { buildDoctorInstallLines } from "@/lib/router-doctor";
import { buildPppoeSyncLines } from "@/lib/pppoe";
import { buildTvSyncLines } from "@/lib/tv";
import { buildPppoeAgentLines } from "@/lib/pppoe-sessions";
import {
  buildBlockLines,
  buildDeviceAgentLines,
  buildHotspotUserLines,
  buildTetherLines,
  deviceLimitOf,
  type SyncVoucher,
} from "@/lib/devices";
import { authenticateRouter } from "@/lib/router-auth.server";
import { tooManyRequests } from "@/lib/rate-limit.server";

/**
 * A section whose database read failed (for example a migration that has not been applied yet) must
 * NOT be treated as "there is nothing": that would delete every PPPoE client, TV or block already on
 * the router. The section is skipped instead, so the router keeps what it has, and the problem is
 * logged on the server and on the router.
 */
function skipped(section: string, error: { message: string } | null | undefined): string[] {
  console.error(`sync: ${section} could not be read, router keeps its current state: ${error?.message}`);
  return [`:log warning "NetGrid: ${section} sync skipped (database problem), keeping current settings"`];
}

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
            : new Response("# unknown token\n", {
                status: 404,
                headers: { "content-type": "text/plain" },
              });
        }
        const router = auth.router;

        const now = new Date().toISOString();
        const [
          { data: tenant },
          { data: customers, error: customersError },
          { data: vouchers, error: vouchersError },
          { data: packages, error: packagesError },
          { data: tvs, error: tvsError },
          { data: hotspotPkgs },
          { data: blocked, error: blockedError },
          { data: routerRow, error: routerRowError },
          { data: monitored, error: monitoredError },
        ] = await Promise.all([
          supabaseAdmin.from("tenants").select("slug").eq("id", router.tenant_id).single(),
          // Only this router's clients, plus clients the tenant explicitly assigned to "All routers"
          // (router_id null). Other routers' credentials are never even read for this request.
          supabaseAdmin
            .from("customers")
            .select("pppoe_username,pppoe_password,status,expires_at,router_id,package_id")
            .eq("tenant_id", router.tenant_id)
            .eq("customer_type", "pppoe")
            .eq("status", "active")
            .or(`router_id.eq.${router.id},router_id.is.null`),
          supabaseAdmin
            .from("vouchers")
            .select("code,status,expires_at,bound_mac,package_id")
            .eq("tenant_id", router.tenant_id)
            .in("status", ["unused", "used"])
            .or(`expires_at.is.null,expires_at.gt.${now}`),
          supabaseAdmin
            .from("packages")
            .select("id,download_kbps,upload_kbps")
            .eq("tenant_id", router.tenant_id)
            .eq("kind", "pppoe"),
          supabaseAdmin
            .from("tv_devices")
            .select("mac_address,status,expires_at")
            .eq("tenant_id", router.tenant_id)
            .eq("status", "active")
            .gt("expires_at", now),
          // Device limit of each hotspot/voucher package (one package = one device by default).
          supabaseAdmin
            .from("packages")
            .select("id,device_limit")
            .eq("tenant_id", router.tenant_id)
            .in("kind", ["hotspot", "voucher"]),
          // Devices the tenant blocked, on any of its routers.
          supabaseAdmin
            .from("router_devices")
            .select("mac")
            .eq("tenant_id", router.tenant_id)
            .eq("blocked", true),
          supabaseAdmin.from("routers").select("block_tethering").eq("id", router.id).maybeSingle(),
          // Inventory devices (access points, switches, ONTs, ...) this router should ping and report on.
          supabaseAdmin
            .from("inventory_devices")
            .select("id,ip_address")
            .eq("tenant_id", router.tenant_id)
            .eq("monitor_router_id", router.id)
            .eq("monitor_enabled", true)
            .not("ip_address", "is", null),
        ]);

        const lines: string[] = ["# NetGrid sync"];
        const host = getRequestHost();

        // PPPoE: secrets + per-package speed profiles; expired/removed clients are disconnected.
        lines.push(
          ...(customersError || packagesError || !customers || !packages
            ? skipped("PPPoE", customersError ?? packagesError)
            : buildPppoeSyncLines({ routerId: router.id, customers, packages })),
        );
        // Smart TVs: paid MAC addresses bypass the hotspot login (expired ones are cut off).
        lines.push(...(tvsError || !tvs ? skipped("smart TV", tvsError) : buildTvSyncLines(tvs)));
        // Hotspot vouchers: one package = one device (shared-users limit + MAC pinned from the database).
        // If the voucher list cannot be read, the router must KEEP its current voucher users: an empty
        // list would delete every one of them. A missing bound_mac column (migration not applied yet)
        // is retried without it, so vouchers keep working, just without the device pin.
        type VoucherRow = { code: string; bound_mac?: string | null; package_id: string | null };
        let voucherRows: VoucherRow[] | null = vouchers;
        if (vouchersError) {
          console.warn(
            "sync: voucher query failed, retrying without bound_mac:",
            vouchersError.message,
          );
          const retry = await supabaseAdmin
            .from("vouchers")
            .select("code,status,expires_at,package_id")
            .eq("tenant_id", router.tenant_id)
            .in("status", ["unused", "used"])
            .or(`expires_at.is.null,expires_at.gt.${now}`);
          if (retry.error) console.error("sync: voucher query failed:", retry.error.message);
          voucherRows = retry.error ? null : retry.data;
        }
        if (voucherRows) {
          const limitByPackage = new Map((hotspotPkgs ?? []).map((p) => [p.id, deviceLimitOf(p)]));
          const syncVouchers: SyncVoucher[] = voucherRows.map((v) => ({
            code: v.code,
            bound_mac: v.bound_mac ?? null,
            limit: v.package_id ? (limitByPackage.get(v.package_id) ?? 1) : 1,
          }));
          lines.push(...buildHotspotUserLines(syncVouchers));
        } else {
          lines.push(':log warning "NetGrid: voucher list unavailable, keeping current vouchers"');
        }
        lines.push(
          ...(blockedError || !blocked
            ? skipped("blocked devices", blockedError)
            : buildBlockLines(blocked.map((b) => b.mac))),
        );
        // Anti-tethering rules and the periodic device report. Without a readable setting the rules
        // are left exactly as they are (never switched on by default because a read failed).
        lines.push(
          ...(routerRowError || !routerRow
            ? skipped("anti-tethering", routerRowError)
            : buildTetherLines(routerRow.block_tethering !== false)),
        );
        lines.push(
          ...buildDeviceAgentLines(`https://${host}/api/public/router/devices/${params.token}`),
        );
        // PPPoE session report (client MAC + connected state), installed the same way.
        lines.push(
          ...buildPppoeAgentLines(`https://${host}/api/public/router/pppoe/${params.token}`),
        );
        // Inventory monitoring: keep a netwatch entry per monitored device; the router reports up/down.
        lines.push(
          ...(monitoredError || !monitored
            ? skipped("device monitoring", monitoredError)
            : buildDeviceMonitorLines(
                monitored,
                `https://${host}/api/public/router/inventory/${params.token}`,
              )),
        );

        // Diagnostic script: afterwards `/system script run netgrid-doctor` explains what is wrong on this router.
        lines.push(...buildDoctorInstallLines(host));

        // Last on purpose: the login page is a nice-to-have, and a slow or failing download here must
        // never delay or block the user and PPPoE sync above.
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
        lines.push(':log info "NetGrid: users synced"', "");

        // Record that this router just received a sync, so the dashboard can show whether routers are
        // really syncing. Best effort: if the column does not exist yet this fails quietly.
        await supabaseAdmin.from("routers").update({ last_sync_at: now }).eq("id", router.id);

        // Send any alert SMS waiting for this tenant (e.g. low stock raised by the database).
        try {
          await dispatchPendingAlerts(router.tenant_id);
        } catch {
          /* never fail the router's sync */
        }

        return new Response(lines.join("\n"), {
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
        });
      },
    },
  },
});
