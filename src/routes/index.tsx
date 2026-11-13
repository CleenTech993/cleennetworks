import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  CreditCard,
  Radio,
  Router,
  Shield,
  Wifi,
} from "lucide-react";
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
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    const currentHost = window.location.hostname.toLowerCase();
    const canonicalHost = (import.meta.env.VITE_APP_CANONICAL_HOST ?? "").trim().toLowerCase();
    if (canonicalHost && currentHost === canonicalHost) return;

    void fetch("/api/public/domain", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("Custom domain is temporarily unavailable.");
        return (await response.json()) as { purpose?: string; slug?: string };
      })
      .then((mapping) => {
        if (!active || !mapping) return;
        if (mapping.purpose === "hotspot" && mapping.slug) {
          void navigate({ to: "/p/$slug", params: { slug: mapping.slug } });
        } else if (mapping.purpose === "console") {
          window.location.assign("/login");
        }
      })
      .catch((error: unknown) => {
        if (active) console.error("Custom domain routing failed", error);
      });

    return () => {
      active = false;
    };
  }, [navigate]);

  return (
    <div className="min-h-screen overflow-hidden bg-[#f7f8f6] text-[#12211e]">
      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
        <Link to="/" aria-label="NetGrid home" className="rounded-md">
          <Brand />
        </Link>
        <nav
          className="hidden items-center gap-8 text-sm font-medium text-[#52615d] md:flex"
          aria-label="Main"
        >
          <a className="transition-colors hover:text-[#142b26]" href="#features">
            Platform
          </a>
          <a className="transition-colors hover:text-[#142b26]" href="#how-it-works">
            How it works
          </a>
          <a className="transition-colors hover:text-[#142b26]" href="#pricing">
            Pricing
          </a>
        </nav>
        <nav className="flex items-center gap-2" aria-label="Account">
          <Button asChild variant="ghost" size="sm" className="text-[#31423e]">
            <Link to="/login">Sign in</Link>
          </Button>
          <Button asChild size="sm" className="rounded-full bg-[#153c32] px-4 hover:bg-[#205747]">
            <Link to="/signup">
              Get started <ArrowUpRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </nav>
      </header>

      <main>
        <section className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 pb-20 pt-12 sm:px-8 sm:pt-16 lg:grid-cols-[0.9fr_1.1fr] lg:px-12 lg:pb-28 lg:pt-20">
          <div className="pointer-events-none absolute -left-48 top-0 h-[34rem] w-[34rem] rounded-full bg-[#dceee4] opacity-70 blur-3xl" />
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#d6e5dc] bg-white/70 px-3 py-1.5 text-xs font-semibold tracking-wide text-[#285b48] shadow-sm">
              <span className="h-2 w-2 rounded-full bg-[#45a575]" />
              ISP OPERATIONS, MADE SIMPLE
            </div>
            <h1 className="mt-7 max-w-2xl font-display text-5xl font-semibold leading-[0.99] tracking-[-0.055em] text-[#142b26] sm:text-6xl lg:text-[4.65rem]">
              Your network.
              <br />
              <span className="text-[#498467]">One clear view.</span>
            </h1>
            <p className="mt-7 max-w-xl text-base leading-7 text-[#586761] sm:text-lg sm:leading-8">
              Run your MikroTik ISP from one calm, connected workspace. Manage routers, sell hotspot
              and PPPoE plans, collect with M-Pesa, and know what is happening across your network.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button
                asChild
                size="lg"
                className="h-12 rounded-full bg-[#153c32] px-6 text-base hover:bg-[#205747]"
              >
                <Link to="/signup">
                  Create your workspace <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="ghost"
                className="h-12 rounded-full px-5 text-[#30433c]"
              >
                <Link to="/login">I already have an account</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-12 rounded-full border-[#cbd9d0] px-5 text-[#30433c]"
              >
                <a href="/signup?demo=true">Try a sample workspace</a>
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[#66736e]">
              <span className="inline-flex items-center gap-2">
                <Check className="h-4 w-4 text-[#458363]" /> Set up at your pace
              </span>
              <span className="inline-flex items-center gap-2">
                <Check className="h-4 w-4 text-[#458363]" /> Built for MikroTik
              </span>
            </div>
          </div>

          <div className="relative z-10 mx-auto w-full max-w-[42rem] lg:ml-auto">
            <div className="absolute -right-5 -top-7 h-36 w-36 rounded-full bg-[#d5e9d9] blur-2xl sm:-right-8" />
            <div className="absolute -bottom-8 -left-8 h-40 w-40 rounded-full bg-[#dbe9df] blur-2xl" />
            <div className="relative rounded-[1.7rem] border border-white/10 bg-[#14251f] p-3 shadow-[0_32px_90px_-32px_rgba(20,50,39,0.5)] sm:p-4">
              <div className="rounded-[1.2rem] border border-white/10 bg-[#192d25] p-4 text-white sm:p-5">
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#294537] text-[#a6d9b6]">
                      <Activity className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">Network overview</p>
                      <p className="mt-0.5 text-xs text-white/50">ISP workspace · Live status</p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-2 rounded-full border border-[#4c8062]/40 bg-[#244734] px-3 py-1.5 text-xs font-medium text-[#b8e3c2]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#72d092]" /> Monitoring
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-white/[0.07] bg-white/[0.045] p-3.5">
                    <p className="text-xs text-white/50">Routers online</p>
                    <p className="mt-2 font-display text-2xl font-semibold tracking-tight">
                      2<span className="ml-1 text-sm font-normal text-white/40">/ 4</span>
                    </p>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full w-1/2 rounded-full bg-[#77c790]" />
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/[0.07] bg-white/[0.045] p-3.5">
                    <p className="text-xs text-white/50">Active sessions</p>
                    <p className="mt-2 font-display text-2xl font-semibold tracking-tight">192</p>
                    <p className="mt-2 text-[11px] text-[#9bd7a9]">Across all sites</p>
                  </div>
                  <div className="col-span-2 rounded-xl border border-white/[0.07] bg-white/[0.045] p-3.5 sm:col-span-1">
                    <p className="text-xs text-white/50">Payments today</p>
                    <p className="mt-2 font-display text-2xl font-semibold tracking-tight">
                      KES 1,850
                    </p>
                    <p className="mt-2 text-[11px] text-white/40">M-Pesa collections</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-[1.1fr_0.9fr]">
                  <div className="rounded-xl border border-white/[0.07] bg-white/[0.035] p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Router health</p>
                        <p className="mt-1 text-xs text-white/45">Status across your sites</p>
                      </div>
                      <Router className="h-4 w-4 text-[#9acbaa]" />
                    </div>
                    <ul className="mt-3 space-y-1.5">
                      {routers.slice(0, 3).map((router) => (
                        <li
                          key={router.name}
                          className="flex items-center gap-2.5 rounded-lg bg-white/[0.04] px-2.5 py-2"
                        >
                          <StatusDot status={router.status} />
                          <span className="min-w-0 flex-1 truncate text-xs text-white/80">
                            {router.name}
                          </span>
                          <span className="text-[10px] text-white/40">{router.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-xl border border-white/[0.07] bg-white/[0.035] p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Recent activity</p>
                        <p className="mt-1 text-xs text-white/45">Payments received</p>
                      </div>
                      <CreditCard className="h-4 w-4 text-[#9acbaa]" />
                    </div>
                    <ul className="mt-3 space-y-2.5">
                      {payments.slice(0, 3).map((payment) => (
                        <li key={payment.item} className="flex items-center gap-2">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#294537] text-[#a6d9b6]">
                            <Check className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[11px] text-white/75">
                              {payment.item}
                            </span>
                            <span className="block text-[10px] text-white/40">{payment.when}</span>
                          </span>
                          <span className="text-[11px] font-medium tabular-nums text-white/85">
                            {payment.amount}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <p className="mt-3 text-right text-[10px] text-white/30">
                  Illustrative sample dashboard
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="border-y border-[#e5e9e4] bg-white/75">
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:px-12 lg:py-24">
            <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
              <div>
                <p className="text-xs font-semibold tracking-[0.16em] text-[#54836a]">
                  ONE WORKSPACE
                </p>
                <h2 className="mt-3 max-w-xl font-display text-3xl font-semibold tracking-tight text-[#142b26] sm:text-4xl">
                  Less tab-switching.
                  <br className="hidden sm:block" /> More network clarity.
                </h2>
              </div>
              <p className="max-w-md text-sm leading-6 text-[#68756f] sm:text-base">
                The tools to run day-to-day ISP operations, from router setup to customer payments,
                connected in one place.
              </p>
            </div>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map(({ icon: Icon, title, body }, index) => (
                <article
                  key={title}
                  className={`group rounded-2xl border border-[#e4e9e4] bg-[#fbfcfa] p-6 transition-all hover:-translate-y-1 hover:border-[#c5d9cb] hover:shadow-[0_18px_40px_-28px_rgba(23,66,47,0.35)] ${index === 0 ? "lg:col-span-2 lg:flex lg:items-start lg:gap-6" : ""}`}
                >
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#e8f1e9] text-[#397353] transition-colors group-hover:bg-[#dcecdf]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className={index === 0 ? "mt-4 lg:mt-0" : "mt-5"}>
                    <h3 className="font-display text-lg font-semibold tracking-tight text-[#1a3028]">
                      {title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-[#68756f]">{body}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          id="how-it-works"
          className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:px-12 lg:py-24"
        >
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] text-[#54836a]">
              GET UP AND RUNNING
            </p>
            <h2 className="mt-3 max-w-md font-display text-3xl font-semibold tracking-tight text-[#142b26] sm:text-4xl">
              Your next step is a simple one.
            </h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-[#68756f] sm:text-base">
              Create your workspace and configure your services when you’re ready. No approval queue
              to hold up setup.
            </p>
            <Button asChild className="mt-7 rounded-full bg-[#153c32] px-5 hover:bg-[#205747]">
              <Link to="/signup">
                Start setting up <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
          <ol className="grid gap-3">
            {steps.map((step, index) => (
              <li
                key={step.title}
                className="flex gap-5 rounded-2xl border border-[#e4e9e4] bg-white/75 p-5 sm:p-6"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e8f1e9] font-display text-sm font-semibold text-[#397353]">
                  0{index + 1}
                </span>
                <div>
                  <h3 className="font-display text-lg font-semibold tracking-tight text-[#1a3028]">
                    {step.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-6 text-[#68756f]">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id="pricing" className="mx-auto max-w-7xl px-5 pb-20 sm:px-8 lg:px-12 lg:pb-24">
          <div className="relative overflow-hidden rounded-[1.75rem] bg-[#18352b] px-6 py-8 text-white sm:px-10 sm:py-10 lg:px-12">
            <div className="pointer-events-none absolute -right-20 -top-28 h-80 w-80 rounded-full border border-white/[0.08]" />
            <div className="pointer-events-none absolute -right-5 -top-14 h-52 w-52 rounded-full border border-white/[0.08]" />
            <div className="relative grid gap-8 lg:grid-cols-[1fr_0.85fr] lg:items-center">
              <div>
                <p className="text-xs font-semibold tracking-[0.16em] text-[#a9d8b7]">
                  CLEAR MONTHLY COMMISSION
                </p>
                <h2 className="mt-3 max-w-xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                  Know what you owe.
                  <br />
                  See how it’s calculated.
                </h2>
                <p className="mt-4 max-w-xl text-sm leading-6 text-white/65 sm:text-base">
                  Your monthly invoice separates hotspot and PPPoE income. Review the breakdown, pay
                  the platform PayBill, and follow your payment status in the console.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-5">
                  <p className="text-sm text-white/65">Hotspot / voucher</p>
                  <p className="mt-2 font-display text-3xl font-semibold">2%</p>
                  <p className="mt-1 text-xs text-white/45">of successful income</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-5">
                  <p className="text-sm text-white/65">PPPoE</p>
                  <p className="mt-2 font-display text-3xl font-semibold">1%</p>
                  <p className="mt-1 text-xs text-white/45">of successful income</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 pb-20 sm:px-8 lg:px-12">
          <div className="flex flex-col items-start justify-between gap-6 rounded-2xl border border-[#e2e9e1] bg-[#edf4ee] p-6 sm:flex-row sm:items-center sm:p-9">
            <div>
              <p className="text-xs font-semibold tracking-[0.16em] text-[#54836a]">
                READY WHEN YOU ARE
              </p>
              <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-[#142b26] sm:text-3xl">
                Bring your network into focus.
              </h2>
            </div>
            <Button
              asChild
              size="lg"
              className="shrink-0 rounded-full bg-[#153c32] px-6 hover:bg-[#205747]"
            >
              <Link to="/signup">
                Create ISP account <ArrowUpRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#e5e9e4] bg-white/60">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-6 sm:px-8 lg:px-12">
          <Brand className="text-[#1b3028]" />
          <p className="text-sm text-[#78837e]">
            © {new Date().getFullYear()} NetGrid. Built for better-connected communities.
          </p>
          <Link
            to="/login"
            className="inline-flex items-center gap-1 text-sm font-medium text-[#426451] hover:text-[#173d30]"
          >
            Sign in <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </footer>
    </div>
  );
}
