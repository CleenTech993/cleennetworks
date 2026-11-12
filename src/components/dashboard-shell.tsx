import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { ChevronDown, LogOut, Menu, ShieldCheck } from "lucide-react";
import { MfaSecurityDialog } from "@/components/mfa-security-card";
import { ConfirmSignOut } from "@/components/confirm-sign-out";
import { RouterAlertsNotification } from "@/components/router-alerts-notification";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useUserPreferences } from "@/hooks/use-user-preferences";

export interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group?: string;
}

interface Props {
  title: string;
  subtitle?: string;
  nav: NavItem[];
  headerAction?: ReactNode;
  children: ReactNode;
}

function NavList({
  nav,
  subtitle,
  onNavigate,
}: {
  nav: NavItem[];
  subtitle?: string;
  onNavigate?: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activeItem =
    nav.find((item) => pathname === item.to) ??
    nav
      .filter((item) => pathname.startsWith(item.to + "/"))
      .sort((a, b) => b.to.length - a.to.length)[0];
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // The root item (e.g. /tenant) must only match exactly, or it would be active on every page.
  const rootTo = nav.reduce((a, b) => (b.to.length < a.length ? b.to : a), nav[0]?.to ?? "");
  const renderedGroups = new Set<string>();

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="border-b border-sidebar-border px-5 py-6">
        <Brand className="text-sidebar-accent-foreground" />
        {subtitle && (
          <p className="mt-2 pl-[38px] text-[11px] font-medium uppercase tracking-[0.12em] text-sidebar-foreground/55">
            {subtitle}
          </p>
        )}
      </div>
      <div className="px-5 pb-1 pt-5 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/40">
        Workspace
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2" aria-label="Main">
        {nav.map((item) => {
          if (item.group && renderedGroups.has(item.group)) return null;
          if (item.group) renderedGroups.add(item.group);

          const groupItems = item.group
            ? nav.filter((entry) => entry.group === item.group)
            : [item];
          const isExpanded = item.group
            ? (expandedGroups[item.group] ?? activeItem?.group === item.group)
            : true;

          const renderItem = (navItem: NavItem) => {
            const active =
              navItem.to === rootTo
                ? pathname === navItem.to
                : pathname === navItem.to || pathname.startsWith(navItem.to + "/");
            const Icon = navItem.icon;
            return (
              <Link
                key={navItem.to}
                to={navItem.to}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-sidebar-primary"
                    : "text-sidebar-foreground/65 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "h-[17px] w-[17px] shrink-0",
                    active ? "text-sidebar-primary" : "text-sidebar-foreground/55",
                  )}
                  aria-hidden="true"
                />
                {navItem.label}
              </Link>
            );
          };

          if (!item.group) return renderItem(item);

          return (
            <div key={item.group}>
              <button
                type="button"
                aria-expanded={isExpanded}
                onClick={() =>
                  setExpandedGroups((current) => ({
                    ...current,
                    [item.group!]: !current[item.group!],
                  }))
                }
                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/45 transition-colors hover:text-sidebar-foreground/75"
              >
                {item.group}
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform", isExpanded && "rotate-180")}
                  aria-hidden="true"
                />
              </button>
              {isExpanded && <div className="space-y-0.5">{groupItems.map(renderItem)}</div>}
            </div>
          );
        })}
      </nav>
      <div className="space-y-1 border-t border-sidebar-border p-3">
        <MfaSecurityDialog />
        <ConfirmSignOut
          trigger={
            <Button
              variant="ghost"
              size="sm"
              className="h-10 w-full justify-start rounded-lg text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          }
        />
        <p className="px-3 pb-1 pt-2 text-[10px] text-sidebar-foreground/35">
          NetGrid ISP workspace
        </p>
      </div>
    </div>
  );
}

export function DashboardShell({ title, subtitle, nav, headerAction, children }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { preferences } = useUserPreferences();
  const compact = preferences.dashboardLayout === "compact";

  // Close the mobile drawer after any navigation, including programmatic ones.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="flex min-h-screen w-full bg-background">
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 border-r border-sidebar-border shadow-[8px_0_30px_-28px_rgba(0,0,0,0.5)] md:block",
          compact ? "w-56" : "w-64",
        )}
      >
        <NavList nav={nav} subtitle={subtitle} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col bg-[radial-gradient(ellipse_at_top_right,oklch(0.94_0.025_150/0.55),transparent_35%)]">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border/70 bg-background/85 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-72 max-w-[85vw] border-sidebar-border bg-sidebar p-0 md:hidden [&>button]:text-sidebar-foreground"
            >
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <NavList nav={nav} subtitle={subtitle} onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="min-w-0">
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
              NetGrid
            </p>
            <h1 className="truncate text-sm font-semibold text-foreground">{title}</h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {headerAction}
            <RouterAlertsNotification isSuperAdmin={pathname.startsWith("/super-admin")} />
            <MfaSecurityDialog
              trigger={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 gap-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground"
                >
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                  <span className="hidden sm:inline">Two-Step Auth</span>
                </Button>
              }
            />
            <ThemeToggle />
          </div>
        </header>
        <main
          className={cn(
            "mx-auto w-full flex-1",
            compact
              ? "max-w-[100rem] px-3 py-4 sm:px-4 lg:px-6 lg:py-6"
              : "max-w-[90rem] px-4 py-6 sm:px-6 lg:px-10 lg:py-9",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col gap-3 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-[2rem]">
          {title}
        </h2>
        {description && (
          <p className="mt-1.5 max-w-prose text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-[0_8px_30px_-26px_rgba(20,50,39,0.35)] transition-shadow hover:shadow-[0_14px_36px_-28px_rgba(20,50,39,0.45)]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground/70" />}
      </div>
      <p className="mt-3 font-display text-3xl font-semibold tabular-nums tracking-tight">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon: Icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/70 px-6 py-12 text-center">
      {Icon && (
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-accent text-accent-foreground">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
