import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const diagnoseTunnel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        routerId: z.string().uuid(),
        status: z.string().max(20000),
        logs: z.string().max(40000),
        notes: z.string().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // RLS ensures the caller can only read routers in their tenant.
    const { data: r, error } = await context.supabase
      .from("routers")
      .select("name, wg_tunnel_ip, wg_public_key, wg_last_handshake_at, last_seen_at, routeros_version")
      .eq("id", data.routerId)
      .maybeSingle();
    if (error || !r) throw new Error("Router not found");
    const { data: cfg } = await context.supabase
      .from("platform_wg_config")
      .select("server_host, server_port, tunnel_network, enabled")
      .maybeSingle();
    const { diagnoseWireguard } = await import("./wg-diagnose.server");
    const prompt = `Platform context:
- Router: ${r.name} (RouterOS ${r.routeros_version ?? "unknown"})
- Assigned tunnel IP: ${r.wg_tunnel_ip ?? "none"}
- Router public key registered: ${r.wg_public_key ? "yes" : "no"}
- Last handshake recorded by platform: ${r.wg_last_handshake_at ?? "never"}
- Last heartbeat: ${r.last_seen_at ?? "never"}
- Server endpoint: ${cfg ? `${cfg.server_host}:${cfg.server_port} (network ${cfg.tunnel_network}, ${cfg.enabled ? "enabled" : "disabled"})` : "not configured"}

Administrator notes:
${data.notes || "(none)"}

WireGuard status output:
${data.status || "(not provided)"}

Connection logs:
${data.logs || "(not provided)"}`;
    return { diagnosis: await diagnoseWireguard(prompt) };
  });
