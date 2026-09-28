import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Interface stats pushed by the MikroTik scheduler.
// Body: one line per interface: name|running|disabled|rx-byte|tx-byte|rx-err|tx-err|rx-drop|tx-drop
export const Route = createFileRoute("/api/public/router/interfaces/$token")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const body = (await request.text()).slice(0, 64_000);
        const { data: router } = await supabaseAdmin
          .from("routers")
          .select("id,tenant_id")
          .eq("provision_token", params.token)
          .maybeSingle();
        if (!router) return new Response("unknown", { status: 404 });

        const { data: prev } = await supabaseAdmin
          .from("router_interfaces")
          .select("name,rx_bytes,tx_bytes,updated_at")
          .eq("router_id", router.id);
        const prevMap = new Map((prev ?? []).map((p) => [p.name, p]));
        const now = Date.now();
        const n = (v?: string) => {
          const x = Number(v);
          return Number.isFinite(x) && x >= 0 ? Math.round(x) : 0;
        };

        const rows = body
          .split(/\r?\n|;/)
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 128)
          .map((line) => {
            const [name, running, disabled, rb, tb, re, te, rd, td] = line.split("|");
            if (!name || name.length > 64) return null;
            const rx = n(rb), tx = n(tb);
            const p = prevMap.get(name);
            let rxBps = 0, txBps = 0;
            if (p) {
              const dt = (now - new Date(p.updated_at).getTime()) / 1000;
              if (dt > 5 && dt < 900) {
                rxBps = rx >= p.rx_bytes ? Math.round(((rx - p.rx_bytes) * 8) / dt) : 0;
                txBps = tx >= p.tx_bytes ? Math.round(((tx - p.tx_bytes) * 8) / dt) : 0;
              }
            }
            return {
              router_id: router.id,
              tenant_id: router.tenant_id,
              name,
              running: running === "true",
              disabled: disabled === "true",
              rx_bytes: rx,
              tx_bytes: tx,
              rx_bps: rxBps,
              tx_bps: txBps,
              rx_errors: n(re),
              tx_errors: n(te),
              rx_drops: n(rd),
              tx_drops: n(td),
              updated_at: new Date(now).toISOString(),
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);

        if (rows.length) {
          await supabaseAdmin.from("router_interfaces").upsert(rows, { onConflict: "router_id,name" });
          // Feed WAN (ether1) throughput into the latest metrics row
          const wan = rows.find((r) => r.name === "ether1");
          if (wan) {
            const { data: last } = await supabaseAdmin
              .from("router_metrics")
              .select("id")
              .eq("router_id", router.id)
              .order("ts", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (last) {
              await supabaseAdmin
                .from("router_metrics")
                .update({ rx_bps: wan.rx_bps, tx_bps: wan.tx_bps })
                .eq("id", last.id);
            }
          }
        }
        return new Response("ok", { headers: { "content-type": "text/plain" } });
      },
    },
  },
});
