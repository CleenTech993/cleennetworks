import { createFileRoute } from "@tanstack/react-router";
import { getRequestHost } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/provision/$token/router.rsc")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const token = params.token;
        const { data: router } = await supabaseAdmin
          .from("routers")
          .select("id,name,tenant_id,provision_token_expires_at")
          .eq("provision_token", token)
          .maybeSingle();

        if (!router) {
          return new Response("# unknown token\n", {
            status: 404,
            headers: { "content-type": "text/plain" },
          });
        }
        if (router.provision_token_expires_at && new Date(router.provision_token_expires_at) < new Date()) {
          return new Response("# token expired\n", {
            status: 410,
            headers: { "content-type": "text/plain" },
          });
        }

        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select("id,name,slug")
          .eq("id", router.tenant_id)
          .single();

        const host = getRequestHost();
        const portalUrl = `https://${host}/p/${tenant?.slug ?? ""}`;
        const callbackUrl = `https://${host}/api/public/router/heartbeat/${token}`;

        // Mark online on first fetch
        await supabaseAdmin
          .from("routers")
          .update({
            status: "online",
            last_seen_at: new Date().toISOString(),
            public_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
          })
          .eq("id", router.id);

        const rsc = buildRsc({
          tenantName: tenant?.name ?? "ISP",
          portalUrl,
          callbackUrl,
        });

        return new Response(rsc, {
          status: 200,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});

function buildRsc(p: { tenantName: string; portalUrl: string; callbackUrl: string }) {
  return `# NetGrid auto-config for ${p.tenantName}
:log info "NetGrid: applying auto-config"

/ip hotspot profile
add name=netgrid-hsprof hotspot-address=10.5.50.1 dns-name=hotspot.netgrid login-by=http-chap,mac-cookie html-directory=hotspot
:log info "NetGrid: hotspot profile ready"

/ip pool
add name=netgrid-hs-pool ranges=10.5.50.2-10.5.50.254

/ip hotspot
add name=netgrid-hs interface=ether2 address-pool=netgrid-hs-pool profile=netgrid-hsprof disabled=no

/ip hotspot walled-garden
add dst-host=*.lovable.app
add dst-host=${new URL(p.portalUrl).host}
add dst-host=sandbox.safaricom.co.ke
add dst-host=api.safaricom.co.ke

# Send users to the NetGrid captive portal
/ip hotspot walled-garden ip
add action=accept dst-host=${new URL(p.portalUrl).host}

# Heartbeat every minute with live metrics (CPU/RAM/uptime/temp/voltage/version/board/arch/wan-ip)
/system scheduler
add name=netgrid-heartbeat interval=1m on-event=":global hbUrl \\"${p.callbackUrl}\\"; :local r [/system resource get]; :local cpu (\\$r->\\"cpu-load\\"); :local mf ((\\$r->\\"free-memory\\")/1048576); :local mt ((\\$r->\\"total-memory\\")/1048576); :local up (\\$r->\\"uptime\\"); :local ver (\\$r->\\"version\\"); :local board (\\$r->\\"board-name\\"); :local arch (\\$r->\\"architecture-name\\"); :local hf 0; :do { :set hf (([/system resource get free-hdd-space])/1048576) } on-error={}; :local wan \\"\\"; :do { :set wan [/ip address get [find interface=ether1] address] } on-error={}; :local volt 0; :do { :set volt [/system health get voltage] } on-error={}; :local temp 0; :do { :set temp [/system health get temperature] } on-error={}; /tool fetch url=(\\$hbUrl . \\"?cpu=\\" . \\$cpu . \\"&mem-free=\\" . \\$mf . \\"&mem-total=\\" . \\$mt . \\"&hdd-free=\\" . \\$hf . \\"&uptime=\\" . \\$up . \\"&temp=\\" . \\$temp . \\"&voltage=\\" . \\$volt . \\"&version=\\" . \\$ver . \\"&board=\\" . \\$board . \\"&arch=\\" . \\$arch . \\"&wan-ip=\\" . \\$wan) mode=https keep-result=no"

:log info "NetGrid: auto-config complete"
:put "NetGrid auto-config applied. Portal: ${p.portalUrl}"
`;
}
