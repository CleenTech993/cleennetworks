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
  buildHotspotSuspendLines,
  buildHotspotVoucherRefreshLines,
  buildHotspotUserLines,
  buildTetherLines,
  deviceLimitOf,
  type SyncVoucher,
} from "@/lib/devices";
import { authenticateRouter } from "@/lib/router-auth.server";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit.server";

/**
 * A section whose database read failed (for example a migration that has not been applied yet) must
 * NOT be treated as "there is nothing": that would delete every PPPoE client, TV or block already on
 * the router. The section is skipped instead, so the router keeps what it has, and the problem is
 * logged on the server and on the router.
 */
function skipped(section: string, error: { message: string } | null | undefined): string[] {
  console.error(
    `sync: ${section} could not be read, router keeps its current state: ${error?.message}`,
  );
  return [
    `:log warning "NetGrid: ${section} sync skipped (database problem), keeping current settings"`,
  ];
}

async function voucherRefreshResponse(router: { id: string; tenant_id: string }): Promise<Response> {
  const now = new Date().toISOString();
  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from("tenants")
    .select("status,billing_suspended_at")
    .eq("id", router.tenant_id)
    .single();
  if (tenantError || !tenant)
    return new Response("# voucher sync unavailable\n", { status: 503 });

  const restricted = tenant.status === "suspended" || Boolean(tenant.billing_suspended_at);
  if (restricted) {
    return new Response(buildHotspotSuspendLines().join("\n"), {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const queryVouchers = (includeMac: boolean) =>
    supabaseAdmin
      .from("vouchers")
      .select(includeMac ? "code,expires_at,bound_mac,package_id" : "code,expires_at,package_id")
      .eq("tenant_id", router.tenant_id)
      .in("status", ["unused", "used", "active"])
      .or(`expires_at.is.null,expires_at.gt.${now}`);

  let voucherQuery = await queryVouchers(true);
  if (voucherQuery.error && /bound_mac/.test(voucherQuery.error.message ?? ""))
    voucherQuery = await queryVouchers(false);
  if (voucherQuery.error || !voucherQuery.data) {
    console.error("sync: fast voucher query failed", voucherQuery.error);
    return new Response("# voucher sync unavailable\n", { status: 503 });
  }

  // The two select shapes above (with and without bound_mac) produce a union type the generated
  // row parser cannot narrow, so the rows are pinned to one explicit shape here.
  type RefreshVoucherRow = {
    code: string;
    expires_at: string | null;
    bound_mac?: string | null;
    package_id: string | null;
  };
  const voucherRows = voucherQuery.data as unknown as RefreshVoucherRow[];

  const packageIds = [
    ...new Set(voucherRows.flatMap((voucher) => (voucher.package_id ? [voucher.package_id] : []))),
  ];
  const packages = packageIds.length
    ? await supabaseAdmin
        .from("packages")
        .select("id,device_limit")
        .eq("tenant_id", router.tenant_id)
        .in("id", packageIds)
    : { data: [], error: null };
  if (packages.error || !packages.data) {
    console.error("sync: fast voucher package query failed", packages.error);
    return new Response("# voucher sync unavailable\n", { status: 503 });
  }

  const limitByPackage = new Map(packages.data.map((pkg) => [pkg.id, deviceLimitOf(pkg)]));
  const vouchers: SyncVoucher[] = voucherRows.map((voucher) => ({
    code: voucher.code,
    bound_mac: "bound_mac" in voucher ? (voucher.bound_mac ?? null) : null,
    limit: voucher.package_id ? (limitByPackage.get(voucher.package_id) ?? 1) : 1,
  }));
  return new Response(buildHotspotVoucherRefreshLines(vouchers).join("\n"), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
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

        // New vouchers are polled independently so the full configuration can stay on its slower cadence.
        if (new URL(request.url).searchParams.get("vouchers") === "1") {
          if (!rateLimit(`voucher-sync:${router.id}`, 20, 60_000)) return tooManyRequests();
          return voucherRefreshResponse(router);
        }

        const now = new Date().toISOString();
        const [
          { data: tenant, error: tenantError },
          { data: customers, error: customersError },
          { data: vouchers, error: vouchersError },
          { data: packages, error: packagesError },
          { data: tvs, error: tvsError },
          { data: hotspotPkgs },
          { data: blocked, error: blockedError },
          { data: routerRow, error: routerRowError },
          { data: monitored, error: monitoredError },
        ] = await Promise.all([
          supabaseAdmin
            .from("tenants")
            .select("slug,status,billing_suspended_at")
            .eq("id", router.tenant_id)
            .single(),
          // Only this router's clients, plus clients the tenant explicitly assigned to "All routers"
          // (router_id null). Other routers' credentials are never even read for this request.
          supabaseAdmin
            .from("customers")
            .select(
              "pppoe_username,pppoe_password,status,expires_at,router_id,package_id,data_used_bytes",
            )
            .eq("tenant_id", router.tenant_id)
            .eq("customer_type", "pppoe")
            .eq("status", "active")
            .or(`router_id.eq.${router.id},router_id.is.null`),
          supabaseAdmin
            .from("vouchers")
            .select("code,status,expires_at,bound_mac,package_id")
            .eq("tenant_id", router.tenant_id)
            .in("status", ["unused", "used", "active"])
            .or(`expires_at.is.null,expires_at.gt.${now}`),
          supabaseAdmin
            .from("packages")
            .select(
              "id,download_kbps,upload_kbps,data_limit_mb,unlimited,fup_download_kbps,fup_upload_kbps",
            )
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

        if (tenantError || !tenant) {
          console.error("sync: tenant billing status could not be read", tenantError);
          return new Response("# tenant billing status unavailable; sync aborted\n", {
            status: 503,
            headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
          });
        }
        const serviceRestricted =
          tenant.status === "suspended" || Boolean(tenant.billing_suspended_at);

        const host = getRequestHost();
        const lines: string[] = [
          "# NetGrid sync",
          ':do { :if ([:len [/system scheduler find name=netgrid-sync]] = 0) do={ /system scheduler add name=netgrid-sync interval=5m on-event="/system script run netgrid-sync" } else={ /system scheduler set [find name=netgrid-sync] interval=5m } } on-error={}',
          ':do { :if ([:len [/system scheduler find name=netgrid-wan]] = 0) do={ /system scheduler add name=netgrid-wan interval=1m on-event="/system script run netgrid-wan" } else={ /system scheduler set [find name=netgrid-wan] interval=1m } } on-error={}',
          "/system script",
          ':do { remove [find name=netgrid-voucher-sync] } on-error={}',
          `add name=netgrid-voucher-sync source={
  :do {
    /tool fetch url="https://${host}/api/public/router/sync/${params.token}?vouchers=1" dst-path=netgrid-vouchers.rsc mode=https
    :delay 1s
    /import file-name=netgrid-vouchers.rsc verbose=no
    :do { /file remove [find name=netgrid-vouchers.rsc] } on-error={}
  } on-error={ :log warning "NetGrid: voucher refresh failed" }
}`,
          ":do { remove [find where name=netgrid-heartbeat] } on-error={}",
          `:do { add name=netgrid-heartbeat source={
  :global ngLat; :global ngLoss; :global ngJit; :global ngDns;
  :local r [/system resource get];
  :local cpu ($r->"cpu-load");
  :local mf (($r->"free-memory")/1048576);
  :local mt (($r->"total-memory")/1048576);
  :local up ($r->"uptime");
  :local ver ($r->"version");
  :local board ($r->"board-name");
  :local arch ($r->"architecture-name");
  :local hf 0; :do { :set hf (([/system resource get free-hdd-space])/1048576) } on-error={};
  :local wan ""; :do { :set wan [/ip address get [find interface=ether1] address] } on-error={};
  :if ($wan = "") do={ :do { :set wan [/ip address get [find dynamic=yes and disabled=no] address] } on-error={} };
  :local lan ""; :do { :set lan [/ip address get [find interface=netgrid-lan] address] } on-error={};
  :local volt 0; :do { :set volt [/system health get voltage] } on-error={};
  :local temp 0; :do { :set temp [/system health get temperature] } on-error={};
  :local d ("cpu=" . $cpu . "&mem-free=" . $mf . "&mem-total=" . $mt . "&hdd-free=" . $hf . "&uptime=" . $up . "&temp=" . $temp . "&voltage=" . $volt . "&version=" . $ver . "&board=" . $board . "&arch=" . $arch . "&wan-ip=" . $wan . "&lan-ip=" . $lan . "&latency=" . $ngLat . "&loss=" . $ngLoss . "&jitter=" . $ngJit . "&dns=" . $ngDns);
  :do {
    /tool fetch url="https://${host}/api/public/router/heartbeat/${params.token}" http-method=post http-data=$d mode=https keep-result=no
  } on-error={ :log warning "NetGrid: heartbeat failed" }
} } on-error={}`,
          ':do { :if ([:len [/system scheduler find name=netgrid-heartbeat]] = 0) do={ /system scheduler add name=netgrid-heartbeat interval=1m on-event="/system script run netgrid-heartbeat" } else={ /system scheduler set [find name=netgrid-heartbeat] interval=1m on-event="/system script run netgrid-heartbeat" } } on-error={}',
          ":do { /system script run netgrid-heartbeat } on-error={}",
          "/system scheduler",
          ':do { :if ([:len [find name=netgrid-voucher-sync]] = 0) do={ add name=netgrid-voucher-sync interval=10s on-event="/system script run netgrid-voucher-sync" } else={ set [find name=netgrid-voucher-sync] interval=10s on-event="/system script run netgrid-voucher-sync" } } on-error={}',
        ];

        // PPPoE: secrets + per-package speed profiles; expired/removed clients are disconnected.
        lines.push(
          ...(customersError || packagesError || !customers || !packages
            ? serviceRestricted
              ? buildPppoeSyncLines({ routerId: router.id, customers: [], packages: [] })
              : skipped("PPPoE", customersError ?? packagesError)
            : buildPppoeSyncLines({
                routerId: router.id,
                customers: serviceRestricted ? [] : customers,
                packages: serviceRestricted ? [] : packages,
              })),
        );
        // Smart TVs: paid MAC addresses bypass the hotspot login (expired ones are cut off).
        lines.push(
          ...(serviceRestricted
            ? buildTvSyncLines([])
            : tvsError || !tvs
              ? skipped("smart TV", tvsError)
              : buildTvSyncLines(tvs)),
        );
        // Hotspot vouchers: one package = one device (shared-users limit + MAC pinned from the database).
        // If the voucher list cannot be read, the router must KEEP its current voucher users: an empty
        // list would delete every one of them. A missing bound_mac column (migration not applied yet)
        // is retried without it, so vouchers keep working, just without the device pin.
        type VoucherRow = { code: string; bound_mac?: string | null; package_id: string | null };
        let voucherRows: VoucherRow[] | null = vouchers;
        if (!serviceRestricted && vouchersError) {
          console.warn(
            "sync: voucher query failed, retrying without bound_mac:",
            vouchersError.message,
          );
          const retry = await supabaseAdmin
            .from("vouchers")
            .select("code,status,expires_at,package_id")
            .eq("tenant_id", router.tenant_id)
            .in("status", ["unused", "used", "active"])
            .or(`expires_at.is.null,expires_at.gt.${now}`);
          if (retry.error) console.error("sync: voucher query failed:", retry.error.message);
          voucherRows = retry.error ? null : retry.data;
        }

        if (serviceRestricted) {
          lines.push(...buildHotspotSuspendLines());
        } else if (voucherRows) {
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

        // Blocked devices
        lines.push(
          ...(blockedError || !blocked
            ? skipped("blocked devices", blockedError)
            : buildBlockLines(blocked.map((b) => b.mac))),
        );

        // Anti-tethering
        lines.push(
          ...(routerRowError || !routerRow
            ? skipped("anti-tethering", routerRowError)
            : buildTetherLines(routerRow.block_tethering !== false)),
        );

        // Keep customers signed in: RouterOS removes idle hotspot hosts unless the timeout is none.
        // Customers experienced this as "the router keeps logging me out" and re-entering the
        // voucher. Voucher expiry is enforced from the database, so the router adds no silent
        // timeout of its own. Runs on every sync, so existing routers are fixed without re-running
        // Setup.
        lines.push(
          ':do { /ip hotspot set [find name=netgrid-hs] idle-timeout=none keepalive-timeout=none } on-error={ :log warning "NetGrid: could not relax hotspot session timeouts" }',
        );

        // Diagnostics and agents
        lines.push(
          ...buildDeviceAgentLines(`https://${host}/api/public/router/devices/${params.token}`),
        );
        lines.push(
          ...buildPppoeAgentLines(`https://${host}/api/public/router/pppoe/${params.token}`),
        );
        lines.push(
          ...(monitoredError || !monitored
            ? skipped("device monitoring", monitoredError)
            : buildDeviceMonitorLines(
                monitored,
                `https://${host}/api/public/router/inventory/${params.token}`,
              )),
        );
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
        lines.push(
          ':log info "NetGrid: users synced"',
          ':do { /file remove [find name=netgrid-sync.rsc] } on-error={}',
          "",
        );

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
