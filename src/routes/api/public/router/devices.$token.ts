import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit.server";
import { authenticateRouter } from "@/lib/router-auth.server";
import { deviceLimitOf, isHotspotPackageKind, parseDeviceReport } from "@/lib/devices";
import { expiryFrom } from "@/lib/duration";

// Device report pushed by the router every minute (see buildDeviceAgentLines).
// Body: records "mac|ip|hostname|user|authorized|tether" separated by ";".
//
// Besides listing the devices, this closes two gaps in the voucher flow:
//  * A voucher used by logging in directly on the router (skipping the portal) is redeemed here,
//    so its usage clock starts and it no longer looks unused.
//  * A one-device voucher is pinned to the first device seen using it, even when that happened
//    without the portal. The pin is saved in the database and written back on the next sync.
export const Route = createFileRoute("/api/public/router/devices/$token")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        // Authenticate before reading the body so anonymous callers cannot make us buffer uploads.
        const auth = await authenticateRouter(request, params.token);
        if (!auth.ok)
          return auth.blocked ? tooManyRequests() : new Response("unknown", { status: 404 });
        const router = auth.router;
        if (!rateLimit(`devices:${router.id}`, 20, 60_000)) return tooManyRequests();
        const body = (await request.text()).slice(0, 64_000);

        const records = parseDeviceReport(body);
        if (!records.length) return new Response("ok");

        const tenantId = router.tenant_id;
        const now = new Date().toISOString();
        const nowMs = Date.parse(now);
        const macs = records.map((r) => r.mac);
        const { data: previousTraffic, error: previousTrafficError } = await supabaseAdmin
          .from("router_devices")
          .select("mac,traffic_bytes_in,traffic_bytes_out,last_seen_at")
          .eq("router_id", router.id)
          .in("mac", macs);
        if (previousTrafficError) {
          console.error("Could not read previous hotspot traffic samples", previousTrafficError);
          return new Response("error", { status: 500 });
        }
        const previousByMac = new Map((previousTraffic ?? []).map((row) => [row.mac, row]));
        const users = [...new Set(records.flatMap((r) => (r.user ? [r.user] : [])))];

        const [voucherResult, paymentResult, usageResult] = await Promise.all([
          users.length
            ? supabaseAdmin
                .from("vouchers")
                .select("id,code,status,bound_mac,expires_at,package_id,payment_id")
                .eq("tenant_id", tenantId)
                .in("code", users)
            : Promise.resolve({ data: [], error: null }),
          users.length
            ? supabaseAdmin
                .from("payments")
                .select("id,mpesa_receipt,package_id,router_id")
                .eq("tenant_id", tenantId)
                .eq("status", "success")
                .in("mpesa_receipt", users)
            : Promise.resolve({ data: [], error: null }),
          supabaseAdmin
            .from("hotspot_payment_sessions")
            .select(
              "id,payment_id,router_id,mac,connected_seconds,completed_seconds,last_router_uptime_seconds,active,last_active_at",
            )
            .eq("router_id", router.id)
            .in("mac", macs),
        ]);
        if (voucherResult.error || paymentResult.error || usageResult.error) {
          console.error("Could not load paid hotspot session tracking data", {
            voucherError: voucherResult.error,
            paymentError: paymentResult.error,
            usageError: usageResult.error,
          });
          return new Response("error", { status: 500 });
        }
        const sessionVouchers = voucherResult.data ?? [];
        const receiptPayments = paymentResult.data ?? [];
        const paymentByReceipt = new Map(
          receiptPayments
            .filter((payment) => payment.mpesa_receipt)
            .map((payment) => [payment.mpesa_receipt!, payment]),
        );
        const usageRows = usageResult.data ?? [];
        const usageByMac = new Map<string, (typeof usageRows)[number][]>();
        for (const row of usageRows) {
          const current = usageByMac.get(row.mac) ?? [];
          current.push(row);
          usageByMac.set(row.mac, current);
        }
        const pkgIds = [
          ...new Set([
            ...sessionVouchers.flatMap((v) => (v.package_id ? [v.package_id] : [])),
            ...receiptPayments.flatMap((p) => (p.package_id ? [p.package_id] : [])),
          ]),
        ];
        const pkgs = pkgIds.length
          ? ((
              await supabaseAdmin
                .from("packages")
                .select("id,device_limit,duration_value,duration_unit,kind")
                .eq("tenant_id", tenantId)
                .in("id", pkgIds)
            ).data ?? [])
          : [];
        const pkgById = new Map(pkgs.map((p) => [p.id, p]));
        const voucherByCode = new Map(sessionVouchers.map((v) => [v.code, v]));

        // Voucher sessions: redeem / pin to the device that is actually using the code.
        const pinned = new Map<string, string>(); // mac -> voucher code
        for (const r of records) {
          if (!r.authorized || !r.user) continue;
          const v = voucherByCode.get(r.user);
          if (!v) continue;
          const pkg = v.package_id ? pkgById.get(v.package_id) : undefined;
          const oneDevice = deviceLimitOf(pkg) === 1;

          if (v.status === "unused") {
            let expiresAt = v.expires_at;
            if (!v.payment_id && pkg?.duration_value && pkg.duration_unit) {
              expiresAt = expiryFrom(pkg.duration_value, pkg.duration_unit);
            }
            const patch: {
              status: string;
              used_at: string;
              used_by_mac: string;
              expires_at: string | null;
              bound_mac?: string;
            } = {
              status: "used",
              used_at: now,
              used_by_mac: r.mac,
              expires_at: expiresAt,
            };
            if (oneDevice && !v.bound_mac) patch.bound_mac = r.mac;
            const { data: claimed } = await supabaseAdmin
              .from("vouchers")
              .update(patch)
              .eq("id", v.id)
              .eq("tenant_id", tenantId)
              .eq("status", "unused")
              .select("id")
              .maybeSingle();
            if (claimed && patch.bound_mac) pinned.set(r.mac, v.code);
          } else if (oneDevice && !v.bound_mac) {
            const { data: bound } = await supabaseAdmin
              .from("vouchers")
              .update({ bound_mac: r.mac })
              .eq("id", v.id)
              .eq("tenant_id", tenantId)
              .is("bound_mac", null)
              .select("id")
              .maybeSingle();
            if (bound) pinned.set(r.mac, v.code);
          }
        }

        const activePaymentByMac = new Map(
          records.flatMap((record) => {
            const payment =
              record.authorized && record.activeUptimeSeconds != null && record.user
                ? paymentByReceipt.get(record.user)
                : undefined;
            const pkg = payment?.package_id ? pkgById.get(payment.package_id) : undefined;
            return payment && pkg && isHotspotPackageKind(pkg.kind)
              ? [[record.mac, payment] as const]
              : [];
          }),
        );
        const usageUpserts: {
          tenant_id: string;
          router_id: string;
          payment_id: string;
          mac: string;
          connected_seconds: number;
          completed_seconds: number;
          last_router_uptime_seconds: number;
          active: boolean;
          last_active_at: string;
          updated_at: string;
        }[] = [];
        const usageSamples: {
          tenant_id: string;
          router_id: string;
          payment_id: string;
          mac: string;
          connected_seconds: number;
          observed_at: string;
        }[] = [];

        for (const record of records) {
          const activePayment = activePaymentByMac.get(record.mac);
          for (const previous of usageByMac.get(record.mac) ?? []) {
            if (previous.active && previous.payment_id !== activePayment?.id) {
              usageUpserts.push({
                tenant_id: tenantId,
                router_id: router.id,
                payment_id: previous.payment_id,
                mac: record.mac,
                connected_seconds: previous.connected_seconds,
                completed_seconds: previous.connected_seconds,
                last_router_uptime_seconds: 0,
                active: false,
                last_active_at: previous.last_active_at,
                updated_at: now,
              });
            }
          }

          if (!activePayment || record.activeUptimeSeconds == null) continue;
          const previous = (usageByMac.get(record.mac) ?? []).find(
            (row) => row.payment_id === activePayment.id,
          );
          let completedSeconds = previous?.completed_seconds ?? 0;
          if (
            previous?.active &&
            record.activeUptimeSeconds < previous.last_router_uptime_seconds
          ) {
            completedSeconds += previous.last_router_uptime_seconds;
          } else if (previous && !previous.active) {
            completedSeconds = previous.connected_seconds;
          }
          const connectedSeconds = Math.min(
            Number.MAX_SAFE_INTEGER,
            completedSeconds + record.activeUptimeSeconds,
          );
          usageUpserts.push({
            tenant_id: tenantId,
            router_id: router.id,
            payment_id: activePayment.id,
            mac: record.mac,
            connected_seconds: connectedSeconds,
            completed_seconds: completedSeconds,
            last_router_uptime_seconds: record.activeUptimeSeconds,
            active: true,
            last_active_at: now,
            updated_at: now,
          });
          usageSamples.push({
            tenant_id: tenantId,
            router_id: router.id,
            payment_id: activePayment.id,
            mac: record.mac,
            connected_seconds: connectedSeconds,
            observed_at: now,
          });
          if (!activePayment.router_id) {
            const { error: routerLinkError } = await supabaseAdmin
              .from("payments")
              .update({ router_id: router.id })
              .eq("id", activePayment.id)
              .eq("tenant_id", tenantId)
              .is("router_id", null);
            if (routerLinkError) {
              console.error(
                "Could not link hotspot payment to the reporting router",
                routerLinkError,
              );
              return new Response("error", { status: 500 });
            }
            activePayment.router_id = router.id;
          }
        }

        if (usageUpserts.length) {
          const { error: usageUpsertError } = await supabaseAdmin
            .from("hotspot_payment_sessions")
            .upsert(usageUpserts, { onConflict: "payment_id,router_id,mac" });
          if (usageUpsertError) {
            console.error("Could not save paid hotspot session duration", usageUpsertError);
            return new Response("error", { status: 500 });
          }
        }
        if (usageSamples.length) {
          const { error: sampleInsertError } = await supabaseAdmin
            .from("hotspot_payment_session_samples")
            .insert(usageSamples);
          if (sampleInsertError) {
            console.error("Could not save hotspot session usage samples", sampleInsertError);
            return new Response("error", { status: 500 });
          }
        }
        const nowDate = new Date();
        const minuteOfDay = nowDate.getUTCHours() * 60 + nowDate.getUTCMinutes();
        const cleanupMinute = Number.parseInt(router.id.replaceAll("-", "").slice(0, 3), 16) % 1440;
        if (minuteOfDay === cleanupMinute) {
          const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
          const { error: sampleCleanupError } = await supabaseAdmin
            .from("hotspot_payment_session_samples")
            .delete()
            .eq("router_id", router.id)
            .lt("observed_at", cutoff);
          if (sampleCleanupError)
            console.warn("Could not prune old hotspot session samples", sampleCleanupError);
        }

        // Which devices are "registered": pinned to a voucher, or a paid smart TV.
        const [{ data: byMac }, { data: tvs }] = await Promise.all([
          supabaseAdmin
            .from("vouchers")
            .select("code,bound_mac")
            .eq("tenant_id", tenantId)
            .in("bound_mac", macs),
          supabaseAdmin
            .from("tv_devices")
            .select("mac_address")
            .eq("tenant_id", tenantId)
            .in("mac_address", macs),
        ]);
        const codeByMac = new Map<string, string>(
          (byMac ?? []).flatMap((v) =>
            v.bound_mac ? [[v.bound_mac, v.code] as [string, string]] : [],
          ),
        );
        for (const [mac, code] of pinned) codeByMac.set(mac, code);
        const tvMacs = new Set((tvs ?? []).map((t) => t.mac_address));

        const rows = records.map((r) => {
          const code = r.user ?? codeByMac.get(r.mac) ?? null;
          const previous = previousByMac.get(r.mac);
          const elapsedMs = previous?.last_seen_at ? nowMs - Date.parse(previous.last_seen_at) : 0;
          const sampleRate = (current: string | null, old: number | null | undefined) => {
            if (!current || old == null || elapsedMs < 1_000 || elapsedMs > 180_000) return 0;
            const delta = Number(current) - Number(old);
            return Number.isFinite(delta) && delta > 0
              ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor((delta * 1000) / elapsedMs))
              : 0;
          };
          return {
            tenant_id: tenantId,
            router_id: router.id,
            mac: r.mac,
            ip: r.ip,
            hostname: r.hostname,
            registered_kind: code ? "voucher" : tvMacs.has(r.mac) ? "tv" : null,
            voucher_code: code,
            authorized: r.authorized,
            tether_suspected: r.tether,
            traffic_bytes_in: r.bytesIn ? Number(r.bytesIn) : (previous?.traffic_bytes_in ?? null),
            traffic_bytes_out: r.bytesOut
              ? Number(r.bytesOut)
              : (previous?.traffic_bytes_out ?? null),
            upload_bps: sampleRate(r.bytesIn, previous?.traffic_bytes_in),
            download_bps: sampleRate(r.bytesOut, previous?.traffic_bytes_out),
            last_seen_at: now,
          };
        });
        // "blocked" and "first_seen_at" are deliberately not in the payload: they keep their values.
        const { error } = await supabaseAdmin
          .from("router_devices")
          .upsert(rows, { onConflict: "router_id,mac" });
        if (error) {
          console.error("device report upsert failed", error);
          return new Response("error", { status: 500 });
        }

        // Forget devices not seen for 30 days so the table does not grow forever.
        const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
        await supabaseAdmin
          .from("router_devices")
          .delete()
          .eq("router_id", router.id)
          .lt("last_seen_at", cutoff);

        return new Response("ok");
      },
    },
  },
});
