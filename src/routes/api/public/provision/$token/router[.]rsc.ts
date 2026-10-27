import { createFileRoute } from "@tanstack/react-router";
import { getRequestHost } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  loginPageMarker,
  routerosInstallLoginPage,
  ROUTEROS_PICK_HTML_DIR,
} from "@/lib/hotspot-login.server";
import { authenticateBootstrap, isMissingSchema, issueDeviceToken } from "@/lib/router-auth.server";
import { tooManyRequests } from "@/lib/rate-limit.server";

export const Route = createFileRoute("/api/public/provision/$token/router.rsc")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        // The URL carries the short-lived BOOTSTRAP token. It is only good for fetching this script;
        // the long-lived device token that the router's scheduler uses is minted below.
        const auth = await authenticateBootstrap(request, params.token);
        if (!auth.ok) {
          if (auth.blocked) return tooManyRequests();
          const [status, msg] = auth.expired
            ? [
                410,
                "# This provisioning command has expired. Open Routers in the platform and choose New provisioning command.\n",
              ]
            : [404, "# unknown token\n"];
          return new Response(msg, { status, headers: { "content-type": "text/plain" } });
        }
        const router = auth.router;

        // Everything that can fail without side effects happens before the old credential is replaced.
        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select("id,name,slug")
          .eq("id", router.tenant_id)
          .single();
        if (!tenant) {
          return new Response("# could not provision this router right now, please retry\n", {
            status: 500,
            headers: { "content-type": "text/plain" },
          });
        }

        let token: string;
        try {
          token = await issueDeviceToken(router.id);
        } catch (e) {
          console.error("provision: could not issue device token", e);
          if (!isMissingSchema(e instanceof Error ? e.message : String(e))) {
            return new Response("# could not provision this router right now, please retry\n", {
              status: 500,
              headers: { "content-type": "text/plain" },
            });
          }
          // The credentials migration has not been applied yet. Provision the way routers were set up
          // before it existed (the router keeps using this token) instead of refusing to set it up.
          console.error("provision: apply migration 20261025010000_router_credentials.sql; using the previous token scheme");
          token = params.token;
        }

        const host = getRequestHost();
        const portalUrl = `https://${host}/p/${encodeURIComponent(tenant.slug)}`;
        const callbackUrl = `https://${host}/api/public/router/heartbeat/${token}`;
        const loginUrl = `https://${host}/api/public/provision/${token}/login.html`;
        const marker = loginPageMarker({ portalUrl, routerId: router.id });

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
          tenantName: tenant.name ?? "ISP",
          portalUrl,
          callbackUrl,
          interfacesUrl: `https://${host}/api/public/router/interfaces/${token}`,
          syncUrl: `https://${host}/api/public/router/sync/${token}`,
          loginUrl,
          marker,
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

function buildRsc(p: {
  tenantName: string;
  portalUrl: string;
  callbackUrl: string;
  interfacesUrl: string;
  syncUrl: string;
  loginUrl: string;
  marker: string;
}) {
  const portalHost = new URL(p.portalUrl).host;
  return `# NetGrid auto-config for ${p.tenantName}
# Layout: ether1 = Internet (WAN, DHCP client). ether2-ether5 + Wi-Fi (wlan/wifi) = customer LAN bridge
# running Hotspot (10.5.50.0/24) and PPPoE server (10.10.0.0/24).
# Safe to re-run: previous NetGrid items are removed first.
:log info "NetGrid: applying auto-config"

# --- Clean previous NetGrid config ---
:do { /ip hotspot remove [find name=netgrid-hs] } on-error={}
:do { /ip hotspot profile remove [find name=netgrid-hsprof] } on-error={}
:do { /ip dhcp-server remove [find name=netgrid-dhcp] } on-error={}
:do { /ip dhcp-server network remove [find comment=netgrid] } on-error={}
:do { /interface pppoe-server server remove [find service-name=netgrid] } on-error={}
:do { /ppp profile remove [find name=netgrid-pppoe] } on-error={}
:do { /ip pool remove [find name~"^netgrid-"] } on-error={}
:do { /ip address remove [find comment=netgrid] } on-error={}
:do { /ip firewall nat remove [find comment~"^netgrid"] } on-error={}

# --- WAN: ether1 gets internet via DHCP ---
/ip dhcp-client
:if ([:len [find interface=ether1]] = 0) do={ add interface=ether1 disabled=no add-default-route=yes use-peer-dns=no comment=netgrid }

# --- DNS ---
/ip dns set servers=8.8.8.8,1.1.1.1 allow-remote-requests=yes

# --- LAN bridge (the ports join it at the very end of this script) ---
/interface bridge
:if ([:len [find name=netgrid-lan]] = 0) do={ add name=netgrid-lan comment="NetGrid customer LAN" }

# --- Addresses ---
/ip address
:do { add address=10.5.50.1/24 interface=netgrid-lan comment=netgrid } on-error={ :log warning "NetGrid: LAN address failed" }

# --- Pools ---
/ip pool
:do { add name=netgrid-hs-pool ranges=10.5.50.10-10.5.50.254 } on-error={ :log warning "NetGrid: hotspot address pool failed" }
:do { add name=netgrid-pppoe-pool ranges=10.10.0.2-10.10.0.254 } on-error={ :log warning "NetGrid: PPPoE address pool failed" }

# --- DHCP server for hotspot clients ---
/ip dhcp-server
:do { add name=netgrid-dhcp interface=netgrid-lan address-pool=netgrid-hs-pool lease-time=1h disabled=no } on-error={ :log warning "NetGrid: DHCP server failed" }
/ip dhcp-server network
:do { add address=10.5.50.0/24 gateway=10.5.50.1 dns-server=10.5.50.1 comment=netgrid } on-error={ :log warning "NetGrid: DHCP network failed" }

# --- NAT: share internet from ether1 ---
/ip firewall nat
:do { add chain=srcnat out-interface=ether1 action=masquerade comment="netgrid masquerade" } on-error={ :log warning "NetGrid: internet sharing (NAT) failed" }

# --- Hotspot ---${ROUTEROS_PICK_HTML_DIR}/ip hotspot profile
:do { add name=netgrid-hsprof hotspot-address=10.5.50.1 dns-name=hotspot.netgrid login-by=http-chap,http-pap,mac-cookie html-directory=hotspot } on-error={ :log warning "NetGrid: hotspot profile failed" }
/ip hotspot
:do { add name=netgrid-hs interface=netgrid-lan address-pool=netgrid-hs-pool profile=netgrid-hsprof disabled=no } on-error={ :log warning "NetGrid: hotspot server failed" }

/ip hotspot walled-garden
:do { remove [find comment=netgrid] } on-error={}
:do { add dst-host=*.lovable.app comment=netgrid } on-error={ :log warning "NetGrid: walled-garden entry failed" }
:do { add dst-host=${portalHost} comment=netgrid } on-error={ :log warning "NetGrid: walled-garden entry failed" }
:do { add dst-host=*.payhero.co.ke comment=netgrid } on-error={ :log warning "NetGrid: walled-garden entry failed" }
:do { add dst-host=*.safaricom.co.ke comment=netgrid } on-error={ :log warning "NetGrid: walled-garden entry failed" }
/ip hotspot walled-garden ip
:do { remove [find comment=netgrid] } on-error={}
# dst-host is resolved when added; if the WAN is not up yet, the sync job re-adds it later.
:do { add action=accept dst-host=${portalHost} comment=netgrid } on-error={ :log warning "NetGrid: portal walled-garden entry deferred (no DNS yet)" }

# --- PPPoE server ---
/ppp profile
:do { add name=netgrid-pppoe local-address=10.10.0.1 remote-address=netgrid-pppoe-pool dns-server=8.8.8.8,1.1.1.1 only-one=yes } on-error={ :log warning "NetGrid: PPPoE profile failed" }
/interface pppoe-server server
:do { add service-name=netgrid interface=netgrid-lan default-profile=netgrid-pppoe authentication=pap,chap,mschap2 one-session-per-host=yes disabled=no } on-error={ :log warning "NetGrid: PPPoE server failed" }
/ip firewall nat
:do { add chain=srcnat src-address=10.10.0.0/24 out-interface=ether1 action=masquerade comment="netgrid pppoe" } on-error={ :log warning "NetGrid: PPPoE internet sharing (NAT) failed" }

:log info "NetGrid: network, NAT, hotspot and PPPoE configured"




# WAN quality check: latency, jitter, loss (8.8.8.8) and DNS resolution
/system script
remove [find name=netgrid-wan]
add name=netgrid-wan source={
  :global ngLat; :global ngLoss; :global ngJit; :global ngDns;
  :local rcv 0; :local sum 0; :local mn 100000; :local mx 0;
  :for i from=1 to=5 do={
    :do {
      :local res [/ping 8.8.8.8 count=1 as-value];
      :if ([:len $res] > 0) do={
        :local s [:tostr ($res->0->"time")];
        :local t [:tonum [:pick $s 0 [:find $s "ms"]]];
        :set rcv ($rcv + 1); :set sum ($sum + $t);
        :if ($t < $mn) do={ :set mn $t }
        :if ($t > $mx) do={ :set mx $t }
      }
    } on-error={}
    :delay 1s
  }
  :if ($rcv > 0) do={ :set ngLat ($sum / $rcv); :set ngJit ($mx - $mn) } else={ :set ngLat 0; :set ngJit 0 }
  :set ngLoss ((5 - $rcv) * 20);
  :set ngDns 0; :do { :resolve google.com; :set ngDns 1 } on-error={}
}

# Interface stats push (name|running|disabled|rx|tx|rx-err|tx-err|rx-drop|tx-drop)
remove [find name=netgrid-ifaces]
add name=netgrid-ifaces source={
  :local d "";
  :foreach i in=[/interface find] do={
    :local x [/interface get $i];
    :set d ($d . ($x->"name") . "|" . ($x->"running") . "|" . ($x->"disabled") . "|" . ($x->"rx-byte") . "|" . ($x->"tx-byte") . "|" . ($x->"rx-error") . "|" . ($x->"tx-error") . "|" . ($x->"rx-drop") . "|" . ($x->"tx-drop") . ";")
  }
  :do { /tool fetch url="${p.interfacesUrl}" http-method=post http-data=$d mode=https keep-result=no } on-error={ :log warning "NetGrid: interface push failed" }
}

# PPPoE secrets + voucher users sync from the platform
remove [find name=netgrid-sync]
add name=netgrid-sync source={
  :do {
    /tool fetch url="${p.syncUrl}" dst-path=netgrid-sync.rsc mode=https
    :delay 2s
    /import file-name=netgrid-sync.rsc
  } on-error={ :log warning "NetGrid: user sync failed" }
}

/system scheduler
remove [find name~"netgrid-"]
add name=netgrid-wan interval=1m on-event="/system script run netgrid-wan"
add name=netgrid-ifaces interval=1m on-event="/system script run netgrid-ifaces"
add name=netgrid-sync interval=2m on-event="/system script run netgrid-sync"
# Heartbeat every minute with live metrics (CPU/RAM/uptime/temp/voltage/version/board/arch/wan-ip + WAN quality)
add name=netgrid-heartbeat interval=1m on-event=":global hbUrl \\"${p.callbackUrl}\\"; :global ngLat; :global ngLoss; :global ngJit; :global ngDns; :local r [/system resource get]; :local cpu (\\$r->\\"cpu-load\\"); :local mf ((\\$r->\\"free-memory\\")/1048576); :local mt ((\\$r->\\"total-memory\\")/1048576); :local up (\\$r->\\"uptime\\"); :local ver (\\$r->\\"version\\"); :local board (\\$r->\\"board-name\\"); :local arch (\\$r->\\"architecture-name\\"); :local hf 0; :do { :set hf (([/system resource get free-hdd-space])/1048576) } on-error={}; :local wan \\"\\"; :do { :set wan [/ip address get [find interface=ether1] address] } on-error={}; :local volt 0; :do { :set volt [/system health get voltage] } on-error={}; :local temp 0; :do { :set temp [/system health get temperature] } on-error={}; /tool fetch url=(\\$hbUrl . \\"?cpu=\\" . \\$cpu . \\"&mem-free=\\" . \\$mf . \\"&mem-total=\\" . \\$mt . \\"&hdd-free=\\" . \\$hf . \\"&uptime=\\" . \\$up . \\"&temp=\\" . \\$temp . \\"&voltage=\\" . \\$volt . \\"&version=\\" . \\$ver . \\"&board=\\" . \\$board . \\"&arch=\\" . \\$arch . \\"&wan-ip=\\" . \\$wan . \\"&latency=\\" . \\$ngLat . \\"&loss=\\" . \\$ngLoss . \\"&jitter=\\" . \\$ngJit . \\"&dns=\\" . \\$ngDns) mode=https keep-result=no"

# --- LAN ports join the hotspot bridge LAST ---
# Moving the port you are connected through (cable, Wi-Fi or MAC-Winbox) into a new bridge can cut
# your session, and a cut session ends a running /import. Everything above is already applied by now,
# so even if this is the point where the connection drops, the router is fully configured.
:log info "NetGrid: moving LAN ports into the hotspot bridge"
:foreach p in={"ether2";"ether3";"ether4";"ether5";"wlan1";"wlan2";"wifi1";"wifi2"} do={
  :do {
    /interface bridge port remove [find interface=$p]
    /interface bridge port add bridge=netgrid-lan interface=$p
  } on-error={}
}

# --- Hotspot login page (optional, last) ---
# Everything customers need is configured and the ports are connected by now. Downloading the page
# can be slow when the internet is not up yet, so it must never hold the rest up; the sync job
# installs it later if this attempt does not succeed.
${routerosInstallLoginPage({ loginUrl: p.loginUrl, marker: p.marker })}
:log info "NetGrid: auto-config complete"
:put "NetGrid auto-config applied. Portal: ${p.portalUrl}"
`;
}
