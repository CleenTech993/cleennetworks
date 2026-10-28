import { Link } from "@tanstack/react-router";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";

// Crawlable links to every public page, shown in the header and footer of each.
const PRODUCT_LINKS = [
  { to: "/mikrotik-hotspot-billing", label: "Hotspot billing" },
  { to: "/pppoe-billing", label: "PPPoE billing" },
  { to: "/mpesa-wifi-payments", label: "M-Pesa payments" },
] as const;

export function SiteHeader() {
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
      <Link to="/" aria-label="NetGrid home" className="rounded-md">
        <Brand />
      </Link>
      <nav
        className="hidden items-center gap-5 text-sm text-muted-foreground md:flex"
        aria-label="Product"
      >
        {PRODUCT_LINKS.map((l) => (
          <Link key={l.to} to={l.to} className="transition-colors hover:text-foreground">
            {l.label}
          </Link>
        ))}
      </nav>
      <nav className="flex items-center gap-2" aria-label="Account">
        <Button asChild variant="ghost" size="sm">
          <Link to="/login">Sign in</Link>
        </Button>
        <Button asChild size="sm">
          <Link to="/signup">Request access</Link>
        </Button>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-6 px-5 py-8 text-sm text-muted-foreground sm:px-8">
        <div className="space-y-3">
          <Brand className="text-foreground" />
          <p>© {new Date().getFullYear()} NetGrid</p>
        </div>
        <nav aria-label="Product" className="space-y-2">
          <p className="font-medium text-foreground">Product</p>
          <ul className="space-y-1.5">
            {PRODUCT_LINKS.map((l) => (
              <li key={l.to}>
                <Link to={l.to} className="transition-colors hover:text-foreground">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Account" className="space-y-2">
          <p className="font-medium text-foreground">Account</p>
          <ul className="space-y-1.5">
            <li>
              <Link to="/login" className="transition-colors hover:text-foreground">
                Sign in
              </Link>
            </li>
            <li>
              <Link to="/signup" className="transition-colors hover:text-foreground">
                Request access
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
