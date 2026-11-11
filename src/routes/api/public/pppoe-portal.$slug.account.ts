import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { readPppoePortalSession } from "@/lib/pppoe-portal.server";

export const Route = createFileRoute("/api/public/pppoe-portal/$slug/account")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await readPppoePortalSession(request, params.slug);
        if (!session)
          return Response.json({ error: "Sign in to view your account." }, { status: 401 });

        const [
          { data: customer, error: customerError },
          { data: tenant, error: tenantError },
          { data: packages, error: packagesError },
          { data: payments, error: paymentsError },
        ] = await Promise.all([
          supabaseAdmin
            .from("customers")
            .select(
              "full_name,pppoe_username,status,expires_at,package_id,last_ip,last_seen_at,usage_bytes_in,usage_bytes_out",
            )
            .eq("id", session.customerId)
            .eq("tenant_id", session.tenantId)
            .eq("customer_type", "pppoe")
            .maybeSingle(),
          supabaseAdmin
            .from("tenants")
            .select("name,slug,primary_color,logo_url,support_phone,support_email")
            .eq("id", session.tenantId)
            .eq("slug", params.slug)
            .maybeSingle(),
          supabaseAdmin
            .from("packages")
            .select(
              "id,name,description,price,duration_value,duration_unit,download_kbps,upload_kbps",
            )
            .eq("tenant_id", session.tenantId)
            .eq("kind", "pppoe")
            .eq("active", true)
            .order("price"),
          supabaseAdmin
            .from("payments")
            .select("id,package_id,amount,status,mpesa_receipt,created_at")
            .eq("tenant_id", session.tenantId)
            .eq("customer_id", session.customerId)
            .order("created_at", { ascending: false })
            .limit(10),
        ]);
        if (customerError || tenantError || packagesError || paymentsError) {
          console.error(
            "Could not load PPPoE customer portal",
            customerError ?? tenantError ?? packagesError ?? paymentsError,
          );
          return Response.json({ error: "Account temporarily unavailable." }, { status: 503 });
        }
        if (!customer || !tenant)
          return Response.json({ error: "Account not found." }, { status: 404 });

        let currentPackage = (packages ?? []).find((pkg) => pkg.id === customer.package_id) ?? null;
        if (customer.package_id && !currentPackage) {
          const { data, error } = await supabaseAdmin
            .from("packages")
            .select(
              "id,name,description,price,duration_value,duration_unit,download_kbps,upload_kbps",
            )
            .eq("id", customer.package_id)
            .eq("tenant_id", session.tenantId)
            .maybeSingle();
          if (error) {
            console.error("Could not load current PPPoE package", error);
            return Response.json({ error: "Account temporarily unavailable." }, { status: 503 });
          }
          currentPackage = data;
        }

        const paymentPackageIds = [
          ...new Set(
            (payments ?? []).flatMap((payment) => (payment.package_id ? [payment.package_id] : [])),
          ),
        ];
        const { data: paymentPackages, error: paymentPackagesError } = paymentPackageIds.length
          ? await supabaseAdmin
              .from("packages")
              .select("id,name")
              .eq("tenant_id", session.tenantId)
              .in("id", paymentPackageIds)
          : { data: [], error: null };
        if (paymentPackagesError) {
          console.error("Could not load PPPoE payment package names", paymentPackagesError);
          return Response.json({ error: "Account temporarily unavailable." }, { status: 503 });
        }
        const packageNames = new Map((paymentPackages ?? []).map((pkg) => [pkg.id, pkg.name]));

        return Response.json(
          {
            customer,
            tenant,
            currentPackage,
            packages: packages ?? [],
            payments: (payments ?? []).map((payment) => ({
              ...payment,
              package_name: payment.package_id
                ? (packageNames.get(payment.package_id) ?? null)
                : null,
            })),
          },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
