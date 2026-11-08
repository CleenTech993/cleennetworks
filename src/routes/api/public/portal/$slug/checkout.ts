import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getRequestHost } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadTenantBySlugAdmin, normalizePhone } from "@/lib/mpesa.server";
import {
  tenantServiceRestriction,
  tenantServiceRestrictionMessage,
} from "@/lib/platform-billing.server";
import { startDarajaStkPush } from "@/lib/daraja.server";
import { isValidKenyanMobile } from "@/lib/phone";
import { portalMaintenanceBlock } from "@/lib/maintenance.server";
import { normalizeMac } from "@/lib/tv";
import { parseHotspotDestinationUrl } from "@/lib/hotspot-redirect";
import { assertSupportedOmadaVersion } from "@/lib/omada-controller.server";
import type { OmadaPortalContext } from "@/lib/omada-portal";

const MacSchema = z
  .string()
  .transform((value) => normalizeMac(value) ?? "")
  .refine((value) => Boolean(value), "Enter a valid device MAC address.");
const OmadaContextSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("eap"),
    clientMac: MacSchema,
    apMac: MacSchema,
    ssidName: z.string().trim().min(1).max(128),
    radioId: z.enum(["0", "1"]),
    siteName: z.string().trim().min(1).max(128),
    redirectUrl: z
      .string()
      .max(2048)
      .nullable()
      .optional()
      .transform((value) => parseHotspotDestinationUrl(value)),
  }),
  z.object({
    kind: z.literal("gateway"),
    clientMac: MacSchema,
    gatewayMac: MacSchema,
    vlanId: z.string().regex(/^(?:0|[1-9]\d{0,3})$/).refine((value) => Number(value) <= 4094),
    siteName: z.string().trim().min(1).max(128),
    redirectUrl: z
      .string()
      .max(2048)
      .nullable()
      .optional()
      .transform((value) => parseHotspotDestinationUrl(value)),
  }),
]);
const Schema = z.object({
  packageId: z.string().uuid(),
  phone: z.string().min(7).max(20),
  tvMac: z.string().min(11).max(40).optional(),
  routerId: z.string().uuid().optional(),
  omadaContext: OmadaContextSchema.optional(),
});
const STK_PENDING_TIMEOUT_MS = 10 * 60_000;
const BAD_MAC =
  "That doesn't look like a valid MAC address. Enter the TV's Wi-Fi MAC, e.g. AA:BB:CC:DD:EE:FF.";

export const Route = createFileRoute("/api/public/portal/$slug/checkout")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Bad JSON" }, { status: 400 });
        }
        const parsed = Schema.safeParse(body);
        if (!parsed.success)
          return Response.json({ error: "Please fill in all fields." }, { status: 400 });

        const phone = normalizePhone(parsed.data.phone);
        if (!isValidKenyanMobile(phone)) {
          return Response.json(
            { error: "Enter a valid M-Pesa number, e.g. 0712345678." },
            { status: 400 },
          );
        }

        try {
          const tenant = await loadTenantBySlugAdmin(params.slug).catch(() => null);
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

          let selectedRouterVendor: string | null = null;
          let omadaIntegration:
            | {
                site_name: string;
                controller_version: string;
                enabled: boolean;
              }
            | null = null;
          if (parsed.data.routerId) {
            const { data: router, error: routerError } = await supabaseAdmin
              .from("routers")
              .select("id,vendor")
              .eq("id", parsed.data.routerId)
              .eq("tenant_id", tenant.id)
              .maybeSingle();
            if (routerError) {
              console.error("Could not verify the checkout router", routerError);
              return Response.json({ error: "Could not start the payment." }, { status: 500 });
            }
            if (!router) return Response.json({ error: "Invalid site." }, { status: 400 });
            selectedRouterVendor = router.vendor;
            if (router.vendor === "tp_link_omada") {
              const { data, error } = await supabaseAdmin
                .from("omada_integrations")
                .select("site_name,controller_version,enabled")
                .eq("router_id", router.id)
                .eq("tenant_id", tenant.id)
                .maybeSingle();
              if (error) {
                console.error("Could not load Omada checkout settings", error);
                return Response.json({ error: "Could not start the payment." }, { status: 500 });
              }
              omadaIntegration = data;
            }
          }
          if (parsed.data.omadaContext) {
            if (selectedRouterVendor !== "tp_link_omada" || !omadaIntegration?.enabled) {
              return Response.json(
                { error: "This Omada site is not configured for paid access." },
                { status: 409 },
              );
            }
            if (parsed.data.omadaContext.siteName !== omadaIntegration.site_name) {
              return Response.json({ error: "The Omada site does not match this portal." }, {
                status: 400,
              });
            }
            try {
              assertSupportedOmadaVersion(omadaIntegration.controller_version);
            } catch (error) {
              return Response.json(
                {
                  error:
                    error instanceof Error ? error.message : "This Omada version is unsupported.",
                },
                { status: 409 },
              );
            }
          } else if (selectedRouterVendor === "tp_link_omada" && omadaIntegration?.enabled) {
            return Response.json(
              { error: "Omada connection details are missing. Reconnect to the guest Wi-Fi and try again." },
              { status: 400 },
            );
          }

          const { data: pkg } = await supabaseAdmin
            .from("packages")
            .select("id,name,price,kind,tenant_id,active")
            .eq("id", parsed.data.packageId)
            .single();
          if (!pkg || pkg.tenant_id !== tenant.id || !pkg.active) {
            return Response.json({ error: "Invalid package" }, { status: 400 });
          }
          if (!["hotspot", "voucher", "hotspot_tv"].includes(pkg.kind)) {
            return Response.json(
              { error: "This package cannot be purchased from the portal." },
              { status: 400 },
            );
          }
          const tvMac = pkg.kind === "hotspot_tv" ? normalizeMac(parsed.data.tvMac ?? "") : null;
          if (pkg.kind === "hotspot_tv" && !tvMac) {
            return Response.json({ error: BAD_MAC }, { status: 400 });
          }
          const amount = Math.ceil(Number(pkg.price));
          if (!Number.isFinite(amount) || amount < 1) {
            return Response.json(
              { error: "This package cannot be paid for online." },
              { status: 400 },
            );
          }

          const staleBefore = new Date(Date.now() - STK_PENDING_TIMEOUT_MS).toISOString();
          const { error: expireError } = await supabaseAdmin
            .from("payments")
            .update({ status: "failed" })
            .eq("tenant_id", tenant.id)
            .eq("phone", phone)
            .eq("status", "pending")
            .lt("created_at", staleBefore);
          if (expireError) {
            console.error("Could not expire stale STK payment", expireError);
            return Response.json({ error: "Could not start the payment." }, { status: 500 });
          }

          const { data: activePayment, error: activePaymentError } = await supabaseAdmin
            .from("payments")
            .select("id,package_id,tv_device_id")
            .eq("tenant_id", tenant.id)
            .eq("phone", phone)
            .eq("status", "pending")
            .gte("created_at", staleBefore)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (activePaymentError) {
            console.error("Could not check for an active STK payment", activePaymentError);
            return Response.json({ error: "Could not start the payment." }, { status: 500 });
          }
          if (activePayment && activePayment.package_id !== pkg.id) {
            return Response.json(
              {
                error:
                  "A payment prompt is already active for this number. Complete it or wait for it to expire.",
              },
              { status: 409 },
            );
          }
          if (activePayment?.tv_device_id && pkg.kind !== "hotspot_tv") {
            return Response.json(
              {
                error:
                  "A payment prompt is already active for this number. Complete it or wait for it to expire.",
              },
              { status: 409 },
            );
          }
          if (activePayment && parsed.data.omadaContext) {
            const { data: activeOmadaJob, error: activeJobError } = await supabaseAdmin
              .from("omada_authorization_jobs")
              .select(
                "context_kind,client_mac,ap_mac,gateway_mac,ssid_name,radio_id,vlan_id,site_name,redirect_url",
              )
              .eq("payment_id", activePayment.id)
              .eq("tenant_id", tenant.id)
              .maybeSingle();
            if (activeJobError) {
              console.error("Could not verify active Omada payment context", activeJobError);
              return Response.json({ error: "Could not start the payment." }, { status: 500 });
            }
            const context = parsed.data.omadaContext;
            const sameContext =
              activeOmadaJob?.context_kind === context.kind &&
              activeOmadaJob.client_mac === context.clientMac &&
              activeOmadaJob.site_name === context.siteName &&
              activeOmadaJob.redirect_url === context.redirectUrl &&
              (context.kind === "eap"
                ? activeOmadaJob.ap_mac === context.apMac &&
                  activeOmadaJob.ssid_name === context.ssidName &&
                  activeOmadaJob.radio_id === context.radioId
                : activeOmadaJob.gateway_mac === context.gatewayMac &&
                  activeOmadaJob.vlan_id === context.vlanId);
            if (!sameContext) {
              return Response.json(
                {
                  error:
                    "A payment prompt is already active. Complete it or wait for it to expire before trying again.",
                },
                { status: 409 },
              );
            }
          }

          let tvDeviceId: string | undefined;
          if (pkg.kind === "hotspot_tv" && tvMac) {
            const { data: existingTv, error: tvLookupError } = await supabaseAdmin
              .from("tv_devices")
              .select("id,status,phone")
              .eq("tenant_id", tenant.id)
              .eq("mac_address", tvMac)
              .maybeSingle();
            if (tvLookupError) {
              console.error("Could not check the hybrid package TV", tvLookupError);
              return Response.json({ error: "Could not start the payment." }, { status: 500 });
            }
            if (existingTv?.status === "blocked") {
              return Response.json(
                { error: "This device has been blocked. Contact support." },
                { status: 403 },
              );
            }
            if (existingTv && existingTv.phone !== phone) {
              return Response.json(
                { error: "This phone number doesn't match the TV's registration." },
                { status: 403 },
              );
            }
            if (activePayment && activePayment.tv_device_id !== existingTv?.id) {
              return Response.json(
                {
                  error:
                    "A payment prompt is already active for this number. Complete it or wait for it to expire.",
                },
                { status: 409 },
              );
            }

            if (existingTv) {
              const { error: tvUpdateError } = await supabaseAdmin
                .from("tv_devices")
                .update({ updated_at: new Date().toISOString() })
                .eq("id", existingTv.id);
              if (tvUpdateError) {
                console.error("Could not update the hybrid package TV", tvUpdateError);
                return Response.json({ error: "Could not start the payment." }, { status: 500 });
              }
              tvDeviceId = existingTv.id;
            } else {
              const { data: createdTv, error: tvInsertError } = await supabaseAdmin
                .from("tv_devices")
                .insert({
                  tenant_id: tenant.id,
                  mac_address: tvMac,
                  phone,
                  package_id: pkg.id,
                  status: "pending",
                })
                .select("id")
                .single();
              if (tvInsertError || !createdTv) {
                console.error("Could not register the hybrid package TV", tvInsertError);
                return Response.json({ error: "Could not register the TV." }, { status: 500 });
              }
              tvDeviceId = createdTv.id;
            }
          }

          if (activePayment) {
            return Response.json({
              paymentId: activePayment.id,
              message: "A payment prompt is already active for this number.",
            });
          }

          const { data: pay, error: payErr } = await supabaseAdmin
            .from("payments")
            .insert({
              tenant_id: tenant.id,
              package_id: pkg.id,
              phone,
              amount,
              status: "pending",
              provider: "daraja",
              ...(tvDeviceId ? { tv_device_id: tvDeviceId } : {}),
            })
            .select("id,created_at,status,package_id")
            .single();
          if (payErr || !pay)
            return Response.json({ error: "Could not start the payment." }, { status: 500 });

          if (parsed.data.omadaContext && parsed.data.routerId) {
            const context: OmadaPortalContext = parsed.data.omadaContext;
            const job =
              context.kind === "eap"
                ? {
                    payment_id: pay.id,
                    tenant_id: tenant.id,
                    router_id: parsed.data.routerId,
                    context_kind: context.kind,
                    client_mac: context.clientMac,
                    ap_mac: context.apMac,
                    ssid_name: context.ssidName,
                    radio_id: context.radioId,
                    site_name: context.siteName,
                    redirect_url: context.redirectUrl,
                  }
                : {
                    payment_id: pay.id,
                    tenant_id: tenant.id,
                    router_id: parsed.data.routerId,
                    context_kind: context.kind,
                    client_mac: context.clientMac,
                    gateway_mac: context.gatewayMac,
                    vlan_id: context.vlanId,
                    site_name: context.siteName,
                    redirect_url: context.redirectUrl,
                  };
            const { error: jobError } = await supabaseAdmin
              .from("omada_authorization_jobs")
              .insert({
                ...job,
                status: "pending",
                attempts: 0,
                next_attempt_at: new Date().toISOString(),
              });
            if (jobError) {
              console.error("Could not save Omada authorization context", jobError);
              await supabaseAdmin.from("payments").update({ status: "failed" }).eq("id", pay.id);
              return Response.json({ error: "Could not start the payment." }, { status: 500 });
            }
          }

          let started;
          try {
            started = await startDarajaStkPush({
              tenantId: tenant.id,
              amount,
              phone,
              paymentId: pay.id,
              description: `${tenant.name || "Internet"} - ${pkg.name}`,
              accountReference: pkg.name,
              callbackUrl: `https://${getRequestHost()}/api/public/mpesa/callback/${tenant.id}`,
            });
          } catch (e) {
            // Gateway text can contain internals (URLs, account ids): log it and show a generic message.
            console.error("checkout: STK push failed", e);
            // Close the attempt so it is not left "pending" for ever. It stays on record: the checkout
            // limiter counts every attempt, which stops failed prompts being used to spam a phone.
            await supabaseAdmin.from("payments").update({ status: "failed" }).eq("id", pay.id);
            return Response.json(
              {
                error: `We couldn't start the M-Pesa prompt. Check the phone number and try again. If it still fails, contact ${tenant.name || "the provider"} to verify the PayBill's Daraja setup.`,
              },
              { status: 502 },
            );
          }

          await supabaseAdmin
            .from("payments")
            .update({
              checkout_request_id: started.checkoutRequestId,
              merchant_request_id: started.merchantRequestId,
            })
            .eq("id", pay.id);

          return Response.json({
            paymentId: pay.id,
            checkoutRequestId: started.checkoutRequestId,
            message: "Check your phone for the M-Pesa prompt",
          });
        } catch (e) {
          console.error("checkout failed", e);
          return Response.json(
            { error: "Something went wrong. Please try again." },
            { status: 500 },
          );
        }
      },
    },
  },
});
