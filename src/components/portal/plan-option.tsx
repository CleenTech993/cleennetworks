import { formatDuration } from "@/lib/duration";
import { formatSpeed } from "@/lib/pppoe";
import { speedBars, type PortalThemeDef } from "@/lib/portal-themes";
import { cn } from "@/lib/utils";

export interface PortalPlan {
  id: string;
  name: string;
  price: number | string;
  duration_value: number | null;
  duration_unit: string | null;
  download_kbps: number | null;
}

interface PlanOptionProps {
  theme: PortalThemeDef;
  plan: PortalPlan;
  selected: boolean;
  onSelect: () => void;
  /** Brand fill colour (already adjusted for the theme). */
  accent: string;
}

function SignalBars({ kbps, accent }: { kbps: number | null; accent: string }) {
  const n = speedBars(kbps);
  return (
    <span className="pt-bars shrink-0" style={{ color: accent }} role="img" aria-label={n ? `Speed: ${n} of 4 bars` : "Speed not set"}>
      {[1, 2, 3, 4].map((i) => <i key={i} data-on={n >= i ? "" : undefined} />)}
    </span>
  );
}

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background";

/** One selectable plan. The markup differs per theme; the data and behaviour do not. */
export function PlanOption({ theme, plan, selected, onSelect, accent }: PlanOptionProps) {
  const price = `KES ${Number(plan.price).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const duration = formatDuration(plan.duration_value, plan.duration_unit);
  const speed = plan.download_kbps ? formatSpeed(plan.download_kbps) : null;
  const detail = [duration, speed].filter(Boolean).join(" · ");
  const press = { type: "button" as const, onClick: onSelect, "aria-pressed": selected };

  switch (theme.plan) {
    case "ticket": {
      const unit = (plan.duration_unit ?? "").replace(/s$/, "");
      return (
        <button {...press} className={cn("pt-ticket", FOCUS)}>
          <span className="pt-ticket__stub">
            <span className="pt-ticket__num">{plan.duration_value ?? "–"}</span>
            <span className="pt-ticket__unit">{plan.duration_value === 1 ? unit : `${unit}s`}</span>
          </span>
          <span className="pt-ticket__body">
            <span className="min-w-0">
              <span className="block break-words font-semibold">{plan.name}</span>
              {speed && <span className="block text-xs text-muted-foreground">{speed}</span>}
            </span>
            <span className="pt-mono shrink-0 text-lg font-bold tabular-nums">{price}</span>
          </span>
        </button>
      );
    }

    case "block":
      return (
        <button
          {...press}
          className={cn("pt-surface block w-full rounded-xl border bg-card p-4 text-left transition-colors", FOCUS)}
          style={selected ? { backgroundColor: accent, color: "var(--pt-on-accent)" } : undefined}
        >
          <span className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="pt-heading block break-words text-lg font-extrabold leading-tight">{plan.name}</span>
              <span className={cn("block text-xs font-medium", selected ? "opacity-90" : "text-muted-foreground")}>{detail}</span>
            </span>
            <span className="pt-heading shrink-0 text-xl font-extrabold tabular-nums">{price}</span>
          </span>
        </button>
      );

    case "leader":
      return (
        <button {...press} className={cn("block w-full py-2 text-left", FOCUS)}>
          <span className="flex items-baseline gap-2">
            <span className="pt-mono shrink-0" aria-hidden>{selected ? "[x]" : "[ ]"}</span>
            <span className={cn("shrink-0", selected ? "font-bold" : "font-medium")}>{plan.name}</span>
            <span className="pt-leader" aria-hidden />
            <span className="shrink-0 font-semibold tabular-nums">{price}</span>
          </span>
          <span className="mt-0.5 block pl-9 text-xs text-muted-foreground">{detail}</span>
        </button>
      );

    case "bars":
      return (
        <button
          {...press}
          className={cn("pt-surface flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-left transition", FOCUS)}
          style={selected ? { borderColor: accent, boxShadow: `0 0 0 1px ${accent}` } : undefined}
        >
          <SignalBars kbps={plan.download_kbps} accent={accent} />
          <span className="min-w-0 flex-1">
            <span className="block break-words font-medium">{plan.name}</span>
            <span className="block text-xs text-muted-foreground">{detail}</span>
          </span>
          <span className="shrink-0 text-base font-semibold tabular-nums">{price}</span>
        </button>
      );

    case "card":
    default:
      return (
        <button
          {...press}
          className={cn("pt-surface block w-full rounded-xl border bg-card p-4 text-left transition", FOCUS)}
          style={selected ? { borderColor: accent, boxShadow: `0 0 0 2px ${accent}33` } : undefined}
        >
          <span className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block break-words font-medium">{plan.name}</span>
              <span className="block text-xs text-muted-foreground">{detail}</span>
            </span>
            <span className="shrink-0 text-base font-semibold tabular-nums">{price}</span>
          </span>
        </button>
      );
  }
}
