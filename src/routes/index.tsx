import { createFileRoute, Link } from "@tanstack/react-router";
import { BarChart3, CreditCard, Radio, Router, Shield, Wifi } from "lucide-react";
import { Brand } from "@/components/brand";
import { StatusDot } from "@/components/status-dot";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ISP Management Software for MikroTik | NetGrid" },
      {
        name: "description",
        content:
          "Manage a hotspot or PPPoE ISP with MikroTik provisioning, M-Pesa payments, and live router monitoring in one platform.",
      },
      { property: "og:title", content: "ISP Management Software for MikroTik | NetGrid" },
      {
        property: "og:description",
        content:
          "Manage a hotspot or PPPoE ISP with MikroTik provisioning, M-Pesa payments, and live router monitoring in one platform.",
      },
      { name: "twitter:title", content: "ISP Management Software for MikroTik | NetGrid" },
      {
        name: "twitter:description",
        content:
          "Manage a hotspot or PPPoE ISP with MikroTik provisioning, M-Pesa payments, and live router monitoring in one platform.",
      },
    ],
    links: [{ rel: "canonical", href: "/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "NetGrid",
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          description:
            "Manage a hotspot or PPPoE ISP with MikroTik provisioning, M-Pesa payments, and live router monitoring.",
        }),
      },
    ],
  }),
  component: Landing,
});

const routers = [
  { name: "Kakamega Market", status: "online", detail: "128 users" },
  { name: "Mumias Plaza", status: "online", detail: "64 users" },
  { name: "Lurambi Apartments", status: "degraded", detail: "High latency" },
  { name: "Butere Cyber", status: "offline", detail: "Down 14 min" },
];

const payments = [
  { amount: "KES 50", item: "1-hour pass", when: "2 min ago" },
  { amount: "KES 300", item: "Weekly pass", when: "9 min ago" },
  { amount: "KES 1,500", item: "Home fibre, monthly", when: "26 min ago" },
];

const steps = [
  {
    title: "Create your ISP workspace",
    body: "Enter your business name, contact person, phone and email. Verify your email if prompted—no super-admin approval is needed.",
  },
  {
    title: "Connect your MikroTik",
    body: "Add a router in the console and paste the generated setup command into its terminal.",
  },
  {
    title: "Configure services and go live",
    body: "Set up hotspot or PPPoE packages, your branded portal and your M-Pesa collections.",
  },
];

const features = [
  {
    icon: Router,
    title: "Router setup in one line",
    body: "A single generated command configures hotspot, PPPoE and monitoring on a MikroTik.",
  },
  {
    icon: Wifi,
    title: "Your own captive portal",
    body: "Your logo and colours, with voucher redemption and M-Pesa checkout built in.",
  },
  {
    icon: CreditCard,
    title: "M-Pesa payments",
    body: "Customers pay through your Daraja account. Packages activate as soon as payment is confirmed.",
  },
  {
    icon: Radio,
    title: "Hotspot and PPPoE",
    body: "Sell Wi-Fi by the hour or manage monthly home subscribers from the same console.",
  },
  {
    icon: BarChart3,
    title: "Live monitoring",
    body: "Router status, CPU, memory, traffic and revenue, updated as they happen.",
  },
  {
    icon: Shield,
    title: "Separate workspaces",
    body: "Every ISP gets an isolated workspace. Team members can hold multiple roles, such as technician and billing agent.",
  },
  {
    icon: CreditCard,
    title: "Clear monthly platform invoices",
    body: "Hotspot and voucher income is charged 2%; PPPoE income is charged 1%. Review the monthly breakdown and submit your M-Pesa payment code in the console.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Brand />
        <nav className="flex items-center gap-2" aria-label="Account">
          <Button asChild variant="ghost" size="sm">
            <Link to="/login">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/signup">Create ISP account</Link>
          </Button>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-10 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
          <div>
            <h1 className="max-w-xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              Every router, voucher and payment in one place
            </h1>
            <p className="mt-6 max-w-lg text-base leading-relaxed text-muted-foreground sm:text-lg">
              NetGrid sets up your MikroTik routers, sells hotspot and PPPoE packages through
              M-Pesa, and shows you which sites are online right now.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/signup">Create ISP account</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/login">Sign in</Link>
              </Button>
            </div>
          </div>

          <div className="bg-grid rounded-2xl border border-sidebar-border bg-sidebar p-4 text-sidebar-foreground shadow-2xl shadow-sidebar/25 sm:p-5">
            <div className="flex items-baseline justify-between px-1">
              <h2 className="font-display text-base font-semibold text-sidebar-accent-foreground">
                Routers
              </h2>
              <p className="text-xs text-sidebar-foreground/70">
                <span className="tabular-nums">2</span> of <span className="tabular-nums">4</span>{" "}
                healthy
              </p>
            </div>
            <ul className="mt-3 space-y-1.5">
              {routers.map((r) => (
                <li
                  key={r.name}
                  className="flex items-center gap-3 rounded-lg bg-sidebar-accent/70 px-3 py-2.5"
                >
                  <StatusDot status={r.status} />
                  <span className="flex-1 truncate text-sm font-medium text-sidebar-accent-foreground">
                    {r.name}
                  </span>
                  <span className="text-xs text-sidebar-foreground/70 tabular-nums">
                    {r.detail}
                  </span>
                </li>
              ))}
            </ul>
            <h2 className="mt-5 px-1 font-display text-base font-semibold text-sidebar-accent-foreground">
              Latest payments
            </h2>
            <ul className="mt-3 divide-y divide-sidebar-border">
              {payments.map((p) => (
                <li key={p.item} className="flex items-baseline gap-3 px-1 py-2.5 text-sm">
                  <span className="w-20 font-display font-semibold tabular-nums text-sidebar-accent-foreground">
                    {p.amount}
                  </span>
                  <span className="flex-1 truncate text-sidebar-foreground/90">{p.item}</span>
                  <span className="text-xs text-sidebar-foreground/60">{p.when}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 px-1 text-xs text-sidebar-foreground/50">Sample data</p>
          </div>
        </section>

        <section className="border-y bg-card/60">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
            <h2 className="max-w-md text-2xl font-semibold tracking-tight sm:text-3xl">
              Start without waiting for approval
            </h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-3">
              {steps.map((s, i) => (
                <li key={s.title} className="relative border-t-2 border-primary/70 pt-5">
                  <span className="font-display text-sm font-semibold tabular-nums text-primary">
                    Step {i + 1}
                  </span>
                  <h3 className="mt-1 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
                    {s.body}
                  </p>
                </li>
              ))}
            </ol>
            <div className="mt-10 rounded-xl border bg-background p-5">
              <h3 className="font-semibold">Monthly platform commission</h3>
              <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <p className="rounded-lg bg-muted/50 p-3">
                  <span className="font-medium">Hotspot / voucher:</span> 2% of successful income
                </p>
                <p className="rounded-lg bg-muted/50 p-3">
                  <span className="font-medium">PPPoE:</span> 1% of successful income
                </p>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                You receive a monthly invoice with both income totals and the amount due. Pay to
                the platform account shown in your console, submit your M-Pesa transaction code,
                and the payment is confirmed when a platform admin matches the code. Your workspace
                is created as soon as setup is complete; only email verification is required when
                enabled for your account.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <h2 className="max-w-md text-2xl font-semibold tracking-tight sm:text-3xl">
            What you get
          </h2>
          <div className="mt-10 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, body }) => (
              <div key={title} className="border-t pt-5">
                <div className="flex items-center gap-2.5">
                  <Icon className="h-4 w-4 text-primary" />
                  <h3 className="text-base font-semibold">{title}</h3>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-muted-foreground sm:px-8">
          <Brand className="text-foreground" />
          <p>© {new Date().getFullYear()} NetGrid</p>
        </div>
      </footer>
    </div>
  );
}
