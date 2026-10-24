import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getRequestHost } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadPlatformMpesaConfig, normalizePhone, stkPush } from "@/lib/mpesa.server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit.server";
import { isRandomizedMac, normalizeMac } from "@/lib/tv";

// Smart-TV registration. A TV cannot show the captive portal, so the customer registers its MAC
// address from a phone, pays, and the payment callback activates the device. The router picks it
// up on its next sync (every 2 minutes) and bypasses the hotspot login for that MAC.
const Schema = z.object({
  mac: z.string().min(11).max(40),
  name: z.string().trim().max(60).optional(),
  packageId: z.string().uuid(),
  phone: z.string().min(7).max(20),
});

const BAD_MAC =
  "That doesn't look like a valid MAC address. It has 12 characters (0-9, A-F), e.g. AA:BB:CC:DD:EE:FF.";

export const Route = createFileRoute("/api/public/portal/$slug/tv")({
  server: {
    handlers: {
      // Status of one TV: GET ?mac=AA:BB:...
      GET: async ({ request, params }) => {
        if (!rateLimit(`tvstatus:${params.slug}:${clientIp(request)}`, 20, 60_000)) return tooManyRequests();
        const mac = normalizeMac(new URL(request.url).searchParams.get("mac") ?? "");
        if (!mac) return Response.json({ error: BAD_MAC }, { status: 400 });

        const { data: tenant } = await supabaseAdmin
          .from("tenants").select("id").eq("slug", params.slug).maybeSingle();
        if (!tenant) return Response.json({ error: "Portal not found" }, { status: 404 });

        const { data: tv } = await supabaseAdmin
          .from("tv_devices")
          .select("status,expires_at")
          .eq("tenant_id", tenant.id)
          .eq("mac_address", mac)
          .maybeSingle();
        const active = !!tv && tv.status === "active" && !!tv.expires_at && new Date(tv.expires_at) > new Date();
        return Response.json({ registered: !!tv, active, expires_at: active ? tv!.expires_at : null });
      },

      // Register (or renew) a TV and start the M-Pesa payment.
      POST: async ({ request, params }) => {
        if (!rateLimit(`tv:${params.slug}:${clientIp(request)}`, 5, 60_000)) return tooManyRequests();
        let body: unknown;
        try { body = await request.json(); } catch { return Response.json({ error: "Bad JSON" }, { status: 400 }); }
        const parsed = Schema.safeParse(body);
        if (!parsed.success) return Response.json({ error: "Please fill in all fields." }, { status: 400 });

        const mac = normalizeMac(parsed.data.mac);
        if (!mac) return Response.json({ error: BAD_MAC }, { status: 400 });

        const { data: tenant } = await supabaseAdmin
          .from("tenants").select("id").eq("slug", params.slug).maybeSingle();
        if (!tenant) return Response.json({ error: "Portal not found" }, { status: 404 });

        const { data: pkg } = await supabaseAdmin
          .from("packages")
          .select("id,price,kind,active,duration_value,duration_unit")
          .eq("id", parsed.data.packageId)
          .eq("tenant_id", tenant.id)
          .maybeSingle();
        if (!pkg || !pkg.active || (pkg.kind !== "hotspot" && pkg.kind !== "voucher")) {
          return Response.json({ error: "Invalid package" }, { status: 400 });
        }
        if (!pkg.duration_value || !pkg.duration_unit) {
          return Response.json({ error: "This package can't be used for a TV." }, { status: 400 });
        }

        const phone = normalizePhone(parsed.data.phone);
        const now = new Date().toISOString();

        // Register the device, or update the existing one. Never touch status/expires_at of an
        // existing device here: a renewal must not switch off a TV that is still paid up.
        const { data: existing } = await supabaseAdmin
          .from("tv_devices")
          .select("id,status")
          .eq("tenant_id", tenant.id)
          .eq("mac_address", mac)
          .maybeSingle();
        if (existing?.status === "blocked") {
          return Response.json({ error: "This device has been blocked. Contact support." }, { status: 403 });
        }

        let deviceId = existing?.id;
        if (existing) {
          await supabaseAdmin
            .from("tv_devices")
            .update({ phone, package_id: pkg.id, updated_at: now, ...(parsed.data.name ? { name: parsed.data.name } : {}) })
            .eq("id", existing.id);
        } else {
          const { data: created, error } = await supabaseAdmin
            .from("tv_devices")
            .insert({ tenant_id: tenant.id, mac_address: mac, name: parsed.data.name ?? null, phone, package_id: pkg.id })
            .select("id")
            .single();
          if (error || !created) {
            console.error("tv register failed", error);
            return Response.json({ error: "Could not register the TV. Please try again." }, { status: 500 });
          }
          deviceId = created.id;
        }

        const { data: pay, error: payErr } = await supabaseAdmin
          .from("payments")
          .insert({
            tenant_id: tenant.id,
            package_id: pkg.id,
            phone,
            amount: pkg.price,
            status: "pending",
            tv_device_id: deviceId,
          })
          .select("id")
          .single();
        if (payErr || !pay) {
          console.error("tv payment insert failed", payErr);
          return Response.json({ error: "Could not start the payment. Please try again." }, { status: 500 });
        }

        try {
          const cfg = await loadPlatformMpesaConfig();
          const callbackBase = cfg.callback_base_url?.replace(/\/$/, "") ?? `https://${getRequestHost()}`;
          const result = await stkPush({
            cfg,
            amount: Number(pkg.price),
            phone,
            reference: pay.id,
            description: "Smart TV",
            callbackUrl: `${callbackBase}/api/public/mpesa/callback/${tenant.id}`,
          });
          await supabaseAdmin
            .from("payments")
            .update({ checkout_request_id: result.CheckoutRequestID, merchant_request_id: result.MerchantRequestID })
            .eq("id", pay.id);
          return Response.json({
            paymentId: pay.id,
            mac,
            randomizedMac: isRandomizedMac(mac),
            message: result.CustomerMessage,
          });
        } catch (e) {
          await supabaseAdmin.from("payments").update({ status: "failed" }).eq("id", pay.id);
          return Response.json({ error: e instanceof Error ? e.message : "Payment failed" }, { status: 502 });
        }
      },
    },
  },
});
