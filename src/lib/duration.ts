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
