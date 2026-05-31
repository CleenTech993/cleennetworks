import { createFileRoute, Link } from "@tanstack/react-router";
import { Radio, Wifi, Router, CreditCard, Shield, BarChart3, Zap } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NetGrid — Multi-tenant ISP, Hotspot & PPPoE SaaS" },
      { name: "description", content: "Run thousands of hotspots, PPPoE subscribers, MikroTik routers and M-Pesa payments from one dashboard." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Brand />
          <nav className="flex items-center gap-2">
            <Link to="/login"><Button variant="ghost" size="sm">Sign in</Button></Link>
            <Link to="/signup"><Button size="sm">Start free</Button></Link>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_oklch(0.65_0.18_220/0.15),_transparent_60%)]" />
        <div className="mx-auto max-w-6xl px-6 py-20 text-center">
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
            <Zap className="h-3 w-3 text-primary" /> Zero-touch MikroTik provisioning
          </div>
          <h1 className="text-4xl font-bold tracking-tight md:text-6xl">
            The ISP control plane for <span className="text-primary">Wi-Fi operators</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground md:text-lg">
            Multi-tenant hotspot, PPPoE and apartment internet automation. MikroTik provisioning,
            captive portals, M-Pesa STK Push and real-time monitoring — in one platform.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/signup"><Button size="lg">Launch your ISP</Button></Link>
            <Link to="/login"><Button size="lg" variant="outline">Sign in</Button></Link>
          </div>
        </div>
      </section>

      <section className="border-t bg-card/40">
        <div className="mx-auto grid max-w-6xl gap-6 px-6 py-16 md:grid-cols-3">
          {[
            { icon: Router, title: "Zero-touch routers", body: "Generate a one-line MikroTik command. Router auto-configures, reboots, reports back." },
            { icon: Wifi, title: "Captive portal", body: "Per-tenant branded portal with vouchers, OTP and M-Pesa STK Push checkout." },
            { icon: CreditCard, title: "M-Pesa Daraja", body: "STK Push, C2B callbacks, automatic package activation and SMS receipts." },
            { icon: Radio, title: "PPPoE & hotspot", body: "RADIUS-backed PPPoE for fiber subs, hotspot for Wi-Fi resale — same console." },
            { icon: BarChart3, title: "Live monitoring", body: "Router CPU/RAM, online users, throughput and revenue analytics in real time." },
            { icon: Shield, title: "Multi-tenant", body: "Strict tenant isolation with role-based access — super admin to support agent." },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-lg border bg-card p-6">
              <div className="mb-3 grid h-10 w-10 place-items-center rounded-md bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 text-sm text-muted-foreground">
          <Brand />
          <p>© {new Date().getFullYear()} NetGrid</p>
        </div>
      </footer>
    </div>
  );
}
