import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const WG_KEY_RE = /^[A-Za-z0-9+/]{43}=$/;

async function findRouter(token: string) {
  const { data } = await supabaseAdmin
    .from("routers")
    .select("id,tenant_id,wg_public_key,wg_tunnel_ip")
    .eq("provision_token", token)
    .maybeSingle();
  return data;
}

// Assign the next free address in the tunnel network (server holds .1).
async function assignTunnelIp(network: string): Promise<string> {
  const base = network.split("/")[0]; // e.g. 10.99.0.0
  const parts = base.split(".");
  const prefix = `${parts[0]}.${parts[1]}.${parts[2]}.`;
  const { data } = await supabaseAdmin
    .from("routers")
    .select("wg_tunnel_ip")
    .not("wg_tunnel_ip", "is", null);
  let max = 1; // .1 is the platform server
  for (const row of data ?? []) {
    const ip = row.wg_tunnel_ip?.split("/")[0];
    if (ip?.startsWith(prefix)) {
      const host = parseInt(ip.split(".")[3] ?? "0", 10);
      if (host > max) max = host;
    }
  }
  return `${prefix}${max + 1}/24`;
}

export const Route = createFileRoute("/api/public/router/wireguard/$token")({
  server: {
    handlers: {
      // Router POSTs its WireGuard public key; platform stores it and assigns a tunnel IP.
      POST: async ({ params, request }) => {
        const router = await findRouter(params.token);
        if (!router) return new Response("unknown token", { status: 404 });

        const pubkey = (await request.text()).trim();
        if (!WG_KEY_RE.test(pubkey)) {
          return new Response("invalid public key", { status: 400 });
        }

        const { data: cfg } = await supabaseAdmin
          .from("platform_wg_config")
          .select("tunnel_network,enabled")
          .eq("id", 1)
          .maybeSingle();
        if (!cfg?.enabled) return new Response("wireguard disabled", { status: 409 });

        const tunnelIp = router.wg_tunnel_ip ?? (await assignTunnelIp(cfg.tunnel_network));
        await supabaseAdmin
          .from("routers")
          .update({ wg_public_key: pubkey, wg_tunnel_ip: tunnelIp })
          .eq("id", router.id);

        return new Response(`tunnel-ip=${tunnelIp}\n`, {
          headers: { "content-type": "text/plain" },
        });
      },

      // Router fetches its WireGuard interface/peer config as an .rsc snippet.
      GET: async ({ params }) => {
        const router = await findRouter(params.token);
        if (!router) return new Response("# unknown token\n", { status: 404 });

        const { data: cfg } = await supabaseAdmin
          .from("platform_wg_config")
          .select("server_host,server_port,server_public_key,tunnel_network,enabled")
          .eq("id", 1)
          .maybeSingle();

        if (!cfg?.enabled || !cfg.server_host || !cfg.server_public_key) {
          return new Response("# wireguard not configured on platform\n", { status: 409 });
        }
        if (!router.wg_tunnel_ip) {
          return new Response("# register public key first (POST)\n", { status: 409 });
        }

        const rsc = `# NetGrid WireGuard tunnel
/interface wireguard
remove [find name=netgrid-wg]
add name=netgrid-wg listen-port=13231 comment="NetGrid management tunnel"
/interface wireguard peers
remove [find interface=netgrid-wg]
add interface=netgrid-wg public-key="${cfg.server_public_key}" endpoint-address=${cfg.server_host} endpoint-port=${cfg.server_port} allowed-address=${cfg.tunnel_network} persistent-keepalive=25s comment="NetGrid platform"
/ip address
remove [find interface=netgrid-wg]
add address=${router.wg_tunnel_ip} interface=netgrid-wg comment="NetGrid tunnel"
:log info "NetGrid: WireGuard tunnel configured (${router.wg_tunnel_ip})"
`;
        return new Response(rsc, {
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
        });
      },
    },
  },
});
