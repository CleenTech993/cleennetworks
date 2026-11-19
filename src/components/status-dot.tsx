import { cn } from "@/lib/utils";

const tone: Record<string, string> = {
  online: "bg-signal",
  active: "bg-signal",
  success: "bg-signal",
  degraded: "bg-warning",
  pending: "bg-warning",
  offline: "bg-muted-foreground/50",
  failed: "bg-destructive",
};

/** Small status indicator. Online/active states pulse gently (disabled for reduced-motion users). */
export function StatusDot({ status, className }: { status: string; className?: string }) {
  const live = status === "online" || status === "active";
  return (
    <span
      className={cn("relative inline-flex h-2 w-2 shrink-0", className)}
      role="img"
      aria-label={status}
    >
      {live && (
        <span className="absolute inset-0 rounded-full bg-signal opacity-60 motion-safe:animate-ping" />
      )}
      <span
        className={cn(
          "relative inline-block h-2 w-2 rounded-full",
          tone[status] ?? "bg-muted-foreground/50",
        )}
      />
    </span>
  );
}
