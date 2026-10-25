// Pure helpers (no env / DB access) so they are unit-testable.

const UNIT_MS: Record<string, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
};

/**
 * Expiry timestamp for a package duration. Packages store plural units
 * ("minutes", "hours", "days", ...) while older callers used singular ones, so both are accepted.
 * Unknown units fall back to days (previous behaviour).
 */
export function expiryFrom(value: number, unit: string, from: number = Date.now()): string {
  const key = unit.trim().toLowerCase().replace(/s$/, "");
  const ms = UNIT_MS[key] ?? UNIT_MS.day;
  return new Date(from + value * ms).toISOString();
}

/** "1 hour", "3 hours", "1 day": singular when the value is 1. Plans store plural units. */
export function formatDuration(value: number | null | undefined, unit: string | null | undefined): string {
  if (!value || !unit) return "";
  const u = unit.trim().toLowerCase().replace(/s$/, "");
  return `${value} ${value === 1 ? u : `${u}s`}`;
}
