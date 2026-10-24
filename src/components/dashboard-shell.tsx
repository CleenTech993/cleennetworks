import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { LogOut, Menu } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface Props {
  title: string;
  subtitle?: string;
  nav: NavItem[];
  children: ReactNode;
}

export function DashboardShell({ title, subtitle, nav, children }: Props) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile drawer after navigating.
  useEffect(() => setMenuOpen(false), [pathname]);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  }

  return (
    <div className="flex min-h-screen w-full bg-background">
      <aside className="hidden w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <SidebarBody subtitle={subtitle} nav={nav} pathname={pathname} onSignOut={signOut} />
      </aside>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="flex w-72 max-w-[85vw] flex-col border-sidebar-border bg-sidebar p-0 text-sidebar-foreground md:hidden">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarBody subtitle={subtitle} nav={nav} pathname={pathname} onSignOut={signOut} />
        </SheetContent>
      </Sheet>
      <main className="flex-1 min-w-0">
        <header className="flex items-center gap-3 border-b bg-card px-4 py-4 md:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="-ml-2 md:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="min-w-0 truncate text-lg font-semibold">{title}</h1>
        </header>
        <div className="px-4 py-6 md:px-6">{children}</div>
      </main>
    </div>
  );
}

function SidebarBody({
  subtitle,
  nav,
  pathname,
  onSignOut,
}: {
  subtitle?: string;
  nav: NavItem[];
  pathname: string;
  onSignOut: () => void;
}) {
  return (
    <>
      <div className="px-5 py-5 border-b border-sidebar-border">
        <Brand className="text-sidebar-foreground" />
        {subtitle && (
          <p className="mt-1 text-xs text-sidebar-foreground/60">{subtitle}</p>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {nav.map((item) => {
          const active = pathname === item.to || pathname.startsWith(item.to + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <Button variant="ghost" size="sm" onClick={onSignOut} className="w-full justify-start text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent">
          <LogOut className="h-4 w-4" /> Sign out
        </Button>
      </div>
    </>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed bg-card p-10 text-center">
      <h3 className="text-base font-medium">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
