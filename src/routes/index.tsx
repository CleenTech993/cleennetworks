import { createFileRoute, Link } from "@tanstack/react-router";
import { BarChart3, CreditCard, Radio, Router, Shield, Wifi } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { StatusDot } from "@/components/status-dot";
import { Button } from "@/components/ui/button";
import {
  faqJsonLd,
  organizationJsonLd,
  pageHead,
  softwareJsonLd,
  websiteJsonLd,
  type Faq,
} from "@/lib/seo";

const faqs: Faq[] = [
  {
    q: "What is NetGrid?",
    a: "NetGrid is a console for ISPs and Wi-Fi hotspot operators. It sets up MikroTik routers, sells hotspot and PPPoE packages, takes M-Pesa payments and shows which routers are online, all in one place.",
  },
  {
    q: "Which routers does it work with?",
    a: "MikroTik routers running RouterOS. You add a router in the console, paste one generated command into its terminal, and it configures hotspot, PPPoE and reporting by itself.",
  },
  {
    q: "How do customers pay?",
    a: "With M-Pesa. They get a payment prompt on their phone from your branded portal, and are connected once the payment provider confirms it.",
  },
  {
    q: "Can I sell both hotspot Wi-Fi and monthly home internet?",
    a: "Yes. Hotspot packages are sold by time and redeemed with M-Pesa checkout or vouchers. PPPoE packages carry a speed and an expiry for monthly subscribers. Both are managed from the same console.",
  },
  {
    q: "Is my business kept separate from other ISPs?",
    a: "Yes. Every ISP gets an isolated workspace with roles for administrators, technicians, billing agents and support staff, and the console asks for a two-step verification code at sign-in.",
  },
];

const guides = [
  {
    to: "/mikrotik-hotspot-billing",
    title: "Hotspot billing",
    body: "A branded captive portal, vouchers and M-Pesa checkout for paid Wi-Fi.",
  },
  {
    to: "/pppoe-billing",
    title: "PPPoE billing",
    body: "Monthly subscribers with a speed and an expiry, kept in step with the router.",
  },
  {
    to: "/mpesa-wifi-payments",
    title: "M-Pesa payments",
    body: "How customers pay, and how every payment is confirmed before access.",
  },
] as const;

export const Route = createFileRoute("/")({
  head: () =>
    pageHead("/", [organizationJsonLd(), websiteJsonLd(), softwareJsonLd(), faqJsonLd(faqs)]),
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
  { title: "Add a router", body: "Name it in the console and copy the setup line it generates." },
  {
    title: "Paste it into the MikroTik terminal",
    body: "The router configures hotspot, PPPoE and reporting by itself, then restarts.",
  },
  {
    title: "Customers pay and get online",
    body: "They buy a package with M-Pesa on your branded portal and receive a voucher right away.",
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
    body: "An M-Pesa prompt on the customer's phone. Packages activate as soon as the payment is confirmed.",
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
    body: "Every ISP gets an isolated workspace, with roles for admins, technicians and support.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

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
                <Link to="/signup">Request access</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/login">Sign in</Link>
              </Button>
            </div>
          </div>

          <div className="bg-grid rounded-2xl border border-sidebar-border bg-sidebar p-4 text-sidebar-foreground shadow-2xl shadow-sidebar/25 sm:p-5">
            <div className="flex items-baseline justify-between px-1">
              <p className="font-display text-base font-semibold text-sidebar-accent-foreground">
                Routers
              </p>
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
            <p className="mt-5 px-1 font-display text-base font-semibold text-sidebar-accent-foreground">
              Latest payments
            </p>
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
              From a new router to paying customers
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

        <section className="border-y bg-card/60" aria-labelledby="guides-heading">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
            <h2
              id="guides-heading"
              className="max-w-md text-2xl font-semibold tracking-tight sm:text-3xl"
            >
              Built for MikroTik ISPs
            </h2>
            <ul className="mt-8 grid gap-4 md:grid-cols-3">
              {guides.map((g) => (
                <li key={g.to}>
                  <Link
                    to={g.to}
                    className="block h-full rounded-xl border bg-card p-5 transition-colors hover:bg-accent"
                  >
                    <span className="font-semibold">{g.title}</span>
                    <span className="mt-2 block text-sm leading-relaxed text-muted-foreground">
                      {g.body}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-5 py-20 sm:px-8" aria-labelledby="faq-heading">
          <h2 id="faq-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Questions
          </h2>
          <div className="mt-8 divide-y rounded-xl border bg-card">
            {faqs.map((f) => (
              <div key={f.q} className="p-5">
                <h3 className="font-semibold">{f.q}</h3>
                <p className="mt-2 leading-relaxed text-muted-foreground">{f.a}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
