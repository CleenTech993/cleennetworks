import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit.server";
import { authenticateRouter } from "@/lib/router-auth.server";
import { parseDeviceReport } from "@/lib/devices";
import { expiryFrom } from "@/lib/duration";

// Device report pushed by the router every minute (see buildDeviceAgentLines).
// Body: records "mac|ip|hostname|user|authorized|tether|uptime" separated by ";".
//
// Besides listing the devices, this closes two gaps in the voucher flow:
//  * A voucher used by logging in directly on the router (skipping the portal) is redeemed here,
//    so its usage clock starts and it no longer looks unused.
//  * Every voucher is pinned to the first MAC seen using it, including direct router logins.
//  * Voucher session uptime is sampled and retained for the tenant's support history.
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
        const sessionTelemetry = new URL(request.url).searchParams.get("v") === "2";
        if (!records.length && !sessionTelemetry) return new Response("ok");

        const tenantId = router.tenant_id;
        const now = new Date().toISOString();
        const macs = records.map((r) => r.mac);
        const users = [...new Set(records.flatMap((r) => (r.user ? [r.user] : [])))];

        const voucherResult = users.length
          ? await supabaseAdmin
              .from("vouchers")
              .select("id,code,status,bound_mac,used_by_mac,expires_at,package_id,payment_id")
              .eq("tenant_id", tenantId)
              .in("code", users)
          : null;
        if (voucherResult?.error) {
          console.error("device report could not read voucher bindings", voucherResult.error);
          return new Response("voucher binding unavailable", { status: 500 });
        }
        const sessionVouchers = voucherResult?.data ?? [];
        const pkgIds = [
          ...new Set(sessionVouchers.flatMap((v) => (v.package_id ? [v.package_id] : []))),
        ];
        const pkgs = pkgIds.length
          ? ((
              await supabaseAdmin
                .from("packages")
                .select("id,duration_value,duration_unit")
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
          if (v.bound_mac && v.bound_mac !== r.mac) continue;
          if (v.used_by_mac && v.used_by_mac !== r.mac) continue;
          const pkg = v.package_id ? pkgById.get(v.package_id) : undefined;

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
              bound_mac: r.mac,
            };
            const { data: claimed, error: claimError } = await supabaseAdmin
              .from("vouchers")
              .update(patch)
              .eq("id", v.id)
              .eq("tenant_id", tenantId)
              .eq("status", "unused")
              .select("id")
              .maybeSingle();
            if (claimError) {
              console.error("voucher MAC binding failed", claimError);
              return new Response("voucher binding unavailable", { status: 500 });
            }
            if (claimed) {
              Object.assign(v, patch);
              pinned.set(r.mac, v.code);
            }
          } else if (!v.bound_mac) {
            const { data: bound, error: boundError } = await supabaseAdmin
              .from("vouchers")
              .update({ bound_mac: r.mac, used_by_mac: v.used_by_mac ?? r.mac })
              .eq("id", v.id)
              .eq("tenant_id", tenantId)
              .is("bound_mac", null)
              .select("id")
              .maybeSingle();
            if (boundError) {
              console.error("voucher MAC binding failed", boundError);
              return new Response("voucher binding unavailable", { status: 500 });
            }
            if (bound) {
              v.bound_mac = r.mac;
              v.used_by_mac = v.used_by_mac ?? r.mac;
              pinned.set(r.mac, v.code);
            }
          }
        }

        // Which devices are "registered": pinned to a voucher, or a paid smart TV.
        const [{ data: byMac }, { data: tvs }] = macs.length
          ? await Promise.all([
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
            ])
          : [{ data: [] }, { data: [] }];
        const codeByMac = new Map<string, string>(
          (byMac ?? []).flatMap((v) =>
            v.bound_mac ? [[v.bound_mac, v.code] as [string, string]] : [],
          ),
        );
        for (const [mac, code] of pinned) codeByMac.set(mac, code);
        const tvMacs = new Set((tvs ?? []).map((t) => t.mac_address));

        const rows = records.map((r) => {
          const userVoucher = r.user ? voucherByCode.get(r.user) : undefined;
          const belongsToMac =
            userVoucher &&
            (!userVoucher.bound_mac || userVoucher.bound_mac === r.mac) &&
            (!userVoucher.used_by_mac || userVoucher.used_by_mac === r.mac);
          const code = (belongsToMac ? r.user : null) ?? codeByMac.get(r.mac) ?? null;
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
        if (rows.length) {
          const { error } = await supabaseAdmin
            .from("router_devices")
            .upsert(rows, { onConflict: "router_id,mac" });
          if (error) {
            console.error("device report upsert failed", error);
            return new Response("error", { status: 500 });
          }
        }

        if (sessionTelemetry) {
          const active = new Map(
            records
              .filter((r) => r.authorized && r.user && r.sessionUptimeSeconds !== null)
              .flatMap((r) => {
                const voucher = r.user ? voucherByCode.get(r.user) : undefined;
                if (
                  !voucher ||
                  voucher.status === "unused" ||
                  (voucher.bound_mac && voucher.bound_mac !== r.mac) ||
                  (voucher.used_by_mac && voucher.used_by_mac !== r.mac)
                )
                  return [];
                return [[r.mac, { record: r, voucher_code: voucher.code }] as const];
              }),
          );
          const { data: openSessions, error: sessionReadError } = await supabaseAdmin
            .from("router_hotspot_sessions")
            .select("id,mac,voucher_code,started_at,session_uptime_seconds")
            .eq("router_id", router.id)
            .is("ended_at", null);
          if (sessionReadError || !openSessions) {
            console.error("hotspot session history read failed", sessionReadError);
            return new Response("session history unavailable", { status: 500 });
          }

          const starts = new Map<string, Record<string, unknown>>();
          for (const [mac, session] of active) {
            const record = session.record;
            const uptime = record.sessionUptimeSeconds!;
            starts.set(mac, {
              tenant_id: tenantId,
              router_id: router.id,
              mac,
              hostname: record.hostname,
              voucher_code: session.voucher_code,
              started_at: new Date(Date.parse(now) - uptime * 1000).toISOString(),
              last_seen_at: now,
              session_uptime_seconds: uptime,
              duration_seconds: uptime,
            });
          }

          const handled = new Set<string>();
          for (const session of openSessions) {
            const current = starts.get(session.mac);
            const reset =
              current &&
              (current.voucher_code !== session.voucher_code ||
                Number(current.session_uptime_seconds) < Number(session.session_uptime_seconds));
            if (current && !reset) {
              const { error } = await supabaseAdmin
                .from("router_hotspot_sessions")
                .update({
                  hostname: current.hostname,
                  last_seen_at: now,
                  session_uptime_seconds: current.session_uptime_seconds,
                  duration_seconds: current.duration_seconds,
                })
                .eq("id", session.id);
              if (error) {
                console.error("hotspot session history update failed", error);
                return new Response("session history unavailable", { status: 500 });
              }
              handled.add(session.mac);
              continue;
            }

            const endedAt = reset ? String(current.started_at) : now;
            const { error } = await supabaseAdmin
              .from("router_hotspot_sessions")
              .update({
                ended_at: endedAt,
                duration_seconds: session.session_uptime_seconds,
              })
              .eq("id", session.id);
            if (error) {
              console.error("hotspot session close failed", error);
              return new Response("session history unavailable", { status: 500 });
            }
          }

          const newSessions = [...starts]
            .filter(([mac]) => !handled.has(mac))
            .map(([, session]) => session);
          if (newSessions.length) {
            const { error } = await supabaseAdmin.from("router_hotspot_sessions").insert(newSessions);
            if (error) {
              console.error("hotspot session history insert failed", error);
              return new Response("session history unavailable", { status: 500 });
            }
          }
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
