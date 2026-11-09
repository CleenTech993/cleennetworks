import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { Button } from "@/components/ui/button";
import type { Faq } from "@/lib/seo";

export interface MarketingSection {
  heading: string;
  body: string;
  points?: string[];
}

type GuidePath = "/mikrotik-hotspot-billing" | "/pppoe-billing" | "/mpesa-wifi-payments";

interface MarketingPageProps {
  /** Short name for the breadcrumb, e.g. "PPPoE billing". */
  crumb: string;
  /** The page's one <h1>. */
  title: string;
  intro: string;
  sections: MarketingSection[];
  faqs: Faq[];
  related: { to: GuidePath; label: string; blurb: string }[];
}

const primaryButton = "rounded-full bg-[#153c32] px-6 hover:bg-[#205747]";

/** Shared layout for the public guide pages: real HTML text, one h1, h2 sections, an FAQ. */
export function MarketingPage({
  crumb,
  title,
  intro,
  sections,
  faqs,
  related,
}: MarketingPageProps) {
  return (
    <div className="min-h-screen overflow-hidden bg-[#f7f8f6] text-[#12211e]">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-5 pb-24 pt-6 sm:px-8">
        <nav aria-label="Breadcrumb" className="text-sm text-[#68756f]">
          <ol className="flex items-center gap-2">
            <li>
              <Link to="/" className="transition-colors hover:text-[#142b26]">
                Home
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="text-[#142b26]">
              {crumb}
            </li>
          </ol>
        </nav>

        <h1 className="mt-6 font-display text-4xl font-semibold leading-[1.02] tracking-[-0.045em] text-[#142b26] sm:text-5xl">
          {title}
        </h1>
        <p className="mt-6 text-lg leading-8 text-[#586761]">{intro}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg" className={primaryButton}>
            <Link to="/signup">
              Create ISP account <ArrowUpRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="rounded-full border-[#d6e0d8] bg-white/70"
          >
            <Link to="/">See the whole platform</Link>
          </Button>
        </div>

        {sections.map((s) => (
          <section key={s.heading} className="mt-14">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-[#142b26]">
              {s.heading}
            </h2>
            <p className="mt-3 leading-7 text-[#586761]">{s.body}</p>
            {s.points && (
              <ul className="mt-4 list-disc space-y-2 pl-5 leading-7 text-[#586761] marker:text-[#54836a]">
                {s.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </section>
        ))}

        <section className="mt-16" aria-labelledby="faq-heading">
          <p className="text-xs font-semibold tracking-[0.16em] text-[#54836a]">QUESTIONS</p>
          <h2
            id="faq-heading"
            className="mt-2 font-display text-2xl font-semibold tracking-tight text-[#142b26]"
          >
            The short answers
          </h2>
          <div className="mt-6 divide-y divide-[#e5e9e4] rounded-2xl border border-[#e4e9e4] bg-[#fbfcfa]">
            {faqs.map((f) => (
              <div key={f.q} className="p-6">
                <h3 className="font-display text-lg font-semibold tracking-tight text-[#1a3028]">
                  {f.q}
                </h3>
                <p className="mt-2 leading-7 text-[#586761]">{f.a}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-16 flex flex-col items-start justify-between gap-6 rounded-2xl border border-[#e2e9e1] bg-[#edf4ee] p-6 sm:flex-row sm:items-center sm:p-9">
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] text-[#54836a]">
              READY WHEN YOU ARE
            </p>
            <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-[#142b26]">
              Bring your network into focus.
            </h2>
          </div>
          <Button asChild size="lg" className={`shrink-0 ${primaryButton}`}>
            <Link to="/signup">
              Create ISP account <ArrowUpRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </section>

        <nav aria-label="Related guides" className="mt-14">
          <h2 className="font-display text-lg font-semibold text-[#142b26]">Keep reading</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {related.map((r) => (
              <li key={r.to}>
                <Link
                  to={r.to}
                  className="block h-full rounded-2xl border border-[#e4e9e4] bg-[#fbfcfa] p-5 transition-all hover:-translate-y-0.5 hover:border-[#c5d9cb]"
                >
                  <span className="font-display font-semibold text-[#1a3028]">{r.label}</span>
                  <span className="mt-1 block text-sm leading-6 text-[#68756f]">{r.blurb}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>
      <SiteFooter />
    </div>
  );
}
