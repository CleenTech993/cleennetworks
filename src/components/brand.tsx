// NetGrid mark: a 2x2 grid of nodes with one lit. Reads as "a network of sites, one reporting in".
export function BrandMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden="true">
      <rect x="2" y="2" width="11" height="11" rx="3" fill="currentColor" opacity="0.35" />
      <rect x="15" y="2" width="11" height="11" rx="3" fill="currentColor" opacity="0.35" />
      <rect x="2" y="15" width="11" height="11" rx="3" fill="currentColor" opacity="0.35" />
      <rect x="15" y="15" width="11" height="11" rx="3" fill="var(--color-signal)" />
    </svg>
  );
}

export function Brand({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 font-display text-lg font-semibold tracking-tight ${className}`}>
      <BrandMark />
      <span>NetGrid</span>
    </div>
  );
}
