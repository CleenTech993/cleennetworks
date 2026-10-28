import { Link } from "@tanstack/react-router";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { Button } from "@/components/ui/button";
import type { Faq } from "@/lib/seo";

export interface MarketingSection {
  heading: string;
  body: string;
  points?: string[];
}

interface MarketingPageProps {
  /** Short name for the breadcrumb, e.g. "PPPoE billing". */
  crumb: string;
  /** The page's one <h1>. */
  title: string;
  intro: string;
  sections: MarketingSection[];
  faqs: Faq[];
  related: {
    to: "/" | "/mikrotik-hotspot-billing" | "/pppoe-billing" | "/mpesa-wifi-payments";
    label: string;
    blurb: string;
  }[];
}

/** Shared layout for the public content pages: real HTML text, one h1, h2 sections, an FAQ. */
export function MarketingPage({
  crumb,
  title,
  intro,
  sections,
  faqs,
  related,
}: MarketingPageProps) {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-5 pb-20 pt-6 sm:px-8">
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <ol className="flex items-center gap-2">
            <li>
              <Link to="/" className="hover:text-foreground">
                Home
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="text-foreground">
              {crumb}
            </li>
          </ol>
        </nav>

        <h1 className="mt-6 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl">
          {title}
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-muted-foreground">{intro}</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/signup">Request access</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/">See the whole platform</Link>
          </Button>
        </div>

        {sections.map((s) => (
          <section key={s.heading} className="mt-14">
            <h2 className="text-2xl font-semibold tracking-tight">{s.heading}</h2>
            <p className="mt-3 leading-relaxed text-muted-foreground">{s.body}</p>
            {s.points && (
              <ul className="mt-4 list-disc space-y-2 pl-5 leading-relaxed text-muted-foreground marker:text-foreground/40">
                {s.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </section>
        ))}

        <section className="mt-16" aria-labelledby="faq-heading">
          <h2 id="faq-heading" className="text-2xl font-semibold tracking-tight">
            Questions
          </h2>
          <div className="mt-4 divide-y rounded-xl border bg-card">
            {faqs.map((f) => (
              <div key={f.q} className="p-5">
                <h3 className="font-semibold">{f.q}</h3>
                <p className="mt-2 leading-relaxed text-muted-foreground">{f.a}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-16 rounded-2xl border bg-sidebar p-7 text-sidebar-foreground">
          <h2 className="font-display text-2xl font-semibold text-sidebar-accent-foreground">
            Ready to run your network from one console?
          </h2>
          <p className="mt-2 max-w-lg text-sidebar-foreground/80">
            Request access and we'll set up your workspace.
          </p>
          <div className="mt-5">
            <Button asChild size="lg">
              <Link to="/signup">Request access</Link>
            </Button>
          </div>
        </section>

        <nav aria-label="Related pages" className="mt-14">
          <h2 className="text-lg font-semibold">Keep reading</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {related.map((r) => (
              <li key={r.to}>
                <Link
                  to={r.to}
                  className="block rounded-xl border bg-card p-4 transition-colors hover:bg-accent"
                >
                  <span className="font-medium">{r.label}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{r.blurb}</span>
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
