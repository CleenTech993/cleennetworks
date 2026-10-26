import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit.server";
import { authenticateRouter } from "@/lib/router-auth.server";
import { deviceLimitOf, parseDeviceReport } from "@/lib/devices";
import { expiryFrom } from "@/lib/duration";

// Device report pushed by the router every 2 minutes (see buildDeviceAgentLines).
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
        const macs = records.map((r) => r.mac);
        const users = [...new Set(records.flatMap((r) => (r.user ? [r.user] : [])))];

        const sessionVouchers = users.length
          ? ((
              await supabaseAdmin
                .from("vouchers")
                .select("id,code,status,bound_mac,expires_at,package_id,payment_id")
                .eq("tenant_id", tenantId)
                .in("code", users)
            ).data ?? [])
          : [];
        const pkgIds = [
          ...new Set(sessionVouchers.flatMap((v) => (v.package_id ? [v.package_id] : []))),
        ];
        const pkgs = pkgIds.length
          ? ((
              await supabaseAdmin
                .from("packages")
                .select("id,device_limit,duration_value,duration_unit")
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
