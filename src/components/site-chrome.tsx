import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";

// Crawlable links to every guide page, shown in the header and footer of each.
export const GUIDE_LINKS = [
  { to: "/mikrotik-hotspot-billing", label: "Hotspot billing" },
  { to: "/pppoe-billing", label: "PPPoE billing" },
  { to: "/mpesa-wifi-payments", label: "M-Pesa payments" },
] as const;

// Same look as the landing page's header and footer, so the guide pages feel like one site.
export function SiteHeader() {
  return (
    <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
      <Link to="/" aria-label="NetGrid home" className="rounded-md">
        <Brand />
      </Link>
      <nav
        className="hidden items-center gap-8 text-sm font-medium text-[#52615d] md:flex"
        aria-label="Guides"
      >
        {GUIDE_LINKS.map((l) => (
          <Link key={l.to} to={l.to} className="transition-colors hover:text-[#142b26]">
            {l.label}
          </Link>
        ))}
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
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-[#e5e9e4] bg-white/60">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-6 sm:px-8 lg:px-12">
        <Brand className="text-[#1b3028]" />
        <nav aria-label="Guides" className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-[#52615d]">
          {GUIDE_LINKS.map((l) => (
            <Link key={l.to} to={l.to} className="transition-colors hover:text-[#142b26]">
              {l.label}
            </Link>
          ))}
        </nav>
        <p className="text-sm text-[#78837e]">
          © {new Date().getFullYear()} NetGrid. Built for better-connected communities.
        </p>
      </div>
    </footer>
  );
}
