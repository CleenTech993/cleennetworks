import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizePhone } from "@/lib/mpesa.server";
import { extractMpesaReceiptCode } from "@/lib/mpesa-receipt";
import { deviceLimitOf, isHotspotPackageKind, normalizeMac, SAFE_CODE } from "@/lib/devices";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit.server";
import {
  tenantServiceRestriction,
  tenantServiceRestrictionMessage,
} from "@/lib/platform-billing.server";
import { portalMaintenanceBlock } from "@/lib/maintenance.server";

const RECENT_DEVICE_REPORT_MS = 2 * 60_000;

// The M-Pesa receipt code is required: a phone number alone is not a secret, so it must
// never be enough to retrieve a paid voucher. Phone, if given, is an extra filter.
const Schema = z.object({
  phone: z.string().min(7).max(20).optional(),
  mpesaCode: z.string().trim().min(6).max(1000),
  routerId: z.string().uuid().optional(),
  mac: z.string().max(32).optional(),
});

export const Route = createFileRoute("/api/public/portal/$slug/reconnect")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!rateLimit(`reconnect:${params.slug}:${clientIp(request)}`, 10, 60_000))
          return tooManyRequests();
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Bad JSON" }, { status: 400 });
        }
        const parsed = Schema.safeParse(body);
        if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
        const mpesaCode = extractMpesaReceiptCode(parsed.data.mpesaCode);
        if (!mpesaCode) {
          return Response.json(
            { error: "Paste a valid M-Pesa receipt code or its confirmation message." },
            { status: 400 },
          );
        }

        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select("id")
          .eq("slug", params.slug)
          .maybeSingle();
        if (!tenant) return Response.json({ error: "Portal not found" }, { status: 404 });
        const restriction = await tenantServiceRestriction(tenant.id);
        if (restriction) {
          return Response.json(
            { error: tenantServiceRestrictionMessage(restriction) },
            { status: 423 },
          );
        }
        const maintenanceBlock = await portalMaintenanceBlock(
          tenant.id,
          parsed.data.routerId ?? null,
        );
        if (maintenanceBlock) return Response.json({ error: maintenanceBlock }, { status: 423 });

        let q = supabaseAdmin
          .from("payments")
          .select(
            "id,status,expires_at,phone,mpesa_receipt,bound_mac,package_id,router_id,created_at",
          )
          .eq("tenant_id", tenant.id)
          .eq("status", "success")
          .order("created_at", { ascending: false })
          .limit(1);

        q = q.eq("mpesa_receipt", mpesaCode);
        if (parsed.data.phone) q = q.eq("phone", normalizePhone(parsed.data.phone));

        const { data: pay, error: paymentError } = await q.maybeSingle();
        if (paymentError) {
          console.error("Could not verify M-Pesa receipt for hotspot access", paymentError);
          return Response.json({ error: "Could not verify the M-Pesa receipt." }, { status: 500 });
        }
        if (!pay) return Response.json({ active: false, reason: "No purchase found" });

        const now = Date.now();
        const exp = pay.expires_at ? new Date(pay.expires_at).getTime() : 0;
        if (!exp || exp <= now) {
          return Response.json({ active: false, reason: "Package expired" });
        }

        const { data: pkg, error: packageError } = pay.package_id
          ? await supabaseAdmin
              .from("packages")
              .select("name,kind,device_limit,duration_value,duration_unit")
              .eq("id", pay.package_id)
              .eq("tenant_id", tenant.id)
              .maybeSingle()
          : { data: null, error: null };
        if (packageError) {
          console.error("Could not load package for M-Pesa hotspot access", packageError);
          return Response.json({ error: "Could not verify the paid package." }, { status: 500 });
        }
        if (!pkg || !isHotspotPackageKind(pkg.kind)) {
          return Response.json({ active: false, reason: "No hotspot purchase found" });
        }

        const accessCode = pay.mpesa_receipt;
        if (!accessCode || !SAFE_CODE.test(accessCode)) {
          return Response.json({
            active: false,
            reason: "The M-Pesa receipt is not available yet. Try again shortly.",
          });
        }
        if (deviceLimitOf(pkg) === 1) {
          const mac = normalizeMac(parsed.data.mac ?? "");
          if (!mac) {
            return Response.json({
              active: false,
              reason: "Reconnect from the hotspot network so this device can be secured.",
            });
          }
          if (pay.bound_mac && pay.bound_mac !== mac) {
            const routerId = parsed.data.routerId;
            if (!routerId) {
              return Response.json({
                active: false,
                reason: "This M-Pesa access code is already assigned to another device.",
              });
            }
            if (pay.router_id && pay.router_id !== routerId) {
              return Response.json({
                active: false,
                reason: "Reconnect through the hotspot where this access code was purchased.",
              });
            }

            const { data: previousDevice, error: previousDeviceError } = await supabaseAdmin
              .from("router_devices")
              .select("authorized,last_seen_at")
              .eq("tenant_id", tenant.id)
              .eq("router_id", routerId)
              .eq("mac", pay.bound_mac)
              .maybeSingle();
            if (previousDeviceError) {
              console.error(
                "Could not check the previous paid hotspot device",
                previousDeviceError,
              );
              return Response.json(
                { error: "Could not check the previous device. Please try again." },
                { status: 503 },
              );
            }

            const lastSeen = previousDevice ? Date.parse(previousDevice.last_seen_at) : Number.NaN;
            const previousDeviceIsActive =
              previousDevice?.authorized === true &&
              Number.isFinite(lastSeen) &&
              lastSeen <= Date.now() + 30_000 &&
              Date.now() - lastSeen <= RECENT_DEVICE_REPORT_MS;
            if (previousDeviceIsActive) {
              return Response.json({
                active: false,
                reason:
                  "This access code is still active on another device. Disconnect that device from Wi-Fi, then try again.",
              });
            }

            const { data: rebound, error: rebindError } = await supabaseAdmin
              .from("payments")
              .update({ bound_mac: mac })
              .eq("id", pay.id)
              .eq("tenant_id", tenant.id)
              .eq("bound_mac", pay.bound_mac)
              .select("bound_mac")
              .maybeSingle();
            if (rebindError) {
              console.error("Could not move paid hotspot access to the new device", rebindError);
              return Response.json({ error: "Could not secure this device." }, { status: 500 });
            }
            if (rebound?.bound_mac !== mac) {
              const { data: current, error: bindingReadError } = await supabaseAdmin
                .from("payments")
                .select("bound_mac")
                .eq("id", pay.id)
                .eq("tenant_id", tenant.id)
                .maybeSingle();
              if (bindingReadError) {
                console.error(
                  "Could not verify the updated hotspot device binding",
                  bindingReadError,
                );
                return Response.json({ error: "Could not verify this device." }, { status: 500 });
              }
              if (current?.bound_mac !== mac) {
                return Response.json({
                  active: false,
                  reason: "This M-Pesa access code is already assigned to another device.",
                });
              }
            }
          }
          if (!pay.bound_mac) {
            const { data: bound, error: bindError } = await supabaseAdmin
              .from("payments")
              .update({ bound_mac: mac })
              .eq("id", pay.id)
              .eq("tenant_id", tenant.id)
              .is("bound_mac", null)
              .select("bound_mac")
              .maybeSingle();
            if (bindError) {
              console.error("Could not bind M-Pesa access to the requesting device", bindError);
              return Response.json({ error: "Could not secure this device." }, { status: 500 });
            }
            if (bound?.bound_mac !== mac) {
              const { data: current, error: bindingReadError } = await supabaseAdmin
                .from("payments")
                .select("bound_mac")
                .eq("id", pay.id)
                .eq("tenant_id", tenant.id)
                .maybeSingle();
              if (bindingReadError) {
                console.error("Could not verify the M-Pesa device binding", bindingReadError);
                return Response.json({ error: "Could not verify this device." }, { status: 500 });
              }
              if (current?.bound_mac !== mac) {
                return Response.json({
                  active: false,
                  reason: "This M-Pesa access code is already assigned to another device.",
                });
              }
            }
          }
        }

        return Response.json({
          active: true,
          package: pkg,
          expires_at: pay.expires_at,
          remaining_minutes: Math.max(0, Math.floor((exp - now) / 60000)),
          access_code: accessCode,
          mpesa_receipt: accessCode,
        });
      },
    },
  },
});
