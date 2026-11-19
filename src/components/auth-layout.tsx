import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Brand } from "@/components/brand";

const points = [
  "MikroTik routers configure themselves from one pasted line",
  "Customers pay with M-Pesa and get online automatically",
  "Each ISP only ever sees its own customers and payments",
];

export function AuthLayout({
  title,
  description,
  icon,
  children,
  footer,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="bg-grid relative hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <Link to="/" aria-label="NetGrid home">
          <Brand className="text-sidebar-accent-foreground" />
        </Link>
        <div className="max-w-md">
          <p className="font-display text-4xl font-semibold leading-[1.1] tracking-tight text-sidebar-accent-foreground">
            Know which sites are up, and who has paid.
          </p>
          <ul className="mt-8 space-y-3 text-sm">
            {points.map((p) => (
              <li key={p} className="flex gap-3">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-sidebar-primary" />
                <span className="text-sidebar-foreground/85">{p}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-sidebar-foreground/50">© {new Date().getFullYear()} NetGrid</p>
      </aside>

      <main className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-sm">
          <Link to="/" className="mb-10 inline-flex lg:hidden" aria-label="NetGrid home">
            <Brand />
          </Link>
          <div className="flex items-center gap-2.5">
            {icon}
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          </div>
          {description && <p className="mt-2 text-sm text-muted-foreground">{description}</p>}
          <div className="mt-7">{children}</div>
          {footer && <div className="mt-6 text-sm text-muted-foreground">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
