export const LABEL_KEYS = [
  "overview",
  "noc",
  "hotspot",
  "pppoe",
  "routers",
  "packages",
  "customers",
  "payments",
] as const;

export type LabelKey = (typeof LABEL_KEYS)[number];
export type TenantLabels = Record<LabelKey, string>;

export const DEFAULT_TENANT_LABELS: TenantLabels = {
  overview: "Overview",
  noc: "NOC Monitor",
  hotspot: "Hotspot",
  pppoe: "PPPoE",
  routers: "Routers",
  packages: "Packages",
  customers: "Customers",
  payments: "Payments",
};

export type UserPreferences = {
  theme: "light" | "dark";
  dateFormat: "dmy" | "mdy" | "iso";
  timeZone: string;
  dashboardLayout: "comfortable" | "compact";
};

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  theme: "light",
  dateFormat: "dmy",
  timeZone: "local",
  dashboardLayout: "comfortable",
};

export function sanitizeTenantLabels(value: unknown): TenantLabels {
  const labels = { ...DEFAULT_TENANT_LABELS };
  if (!value || typeof value !== "object" || Array.isArray(value)) return labels;
  for (const key of LABEL_KEYS) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "string" && candidate.trim()) {
      labels[key] = candidate.trim().slice(0, 40);
    }
  }
  return labels;
}

export function sanitizeUserPreferences(value: unknown): UserPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_USER_PREFERENCES };
  }
  const input = value as Record<string, unknown>;
  const theme = input.theme === "dark" ? "dark" : "light";
  const dateFormat =
    input.dateFormat === "mdy" || input.dateFormat === "iso" ? input.dateFormat : "dmy";
  const dashboardLayout = input.dashboardLayout === "compact" ? "compact" : "comfortable";
  const rawTimeZone = typeof input.timeZone === "string" ? input.timeZone : "local";
  let timeZone = "local";
  if (rawTimeZone === "UTC") timeZone = "UTC";
  else if (rawTimeZone !== "local") {
    try {
      new Intl.DateTimeFormat("en", { timeZone: rawTimeZone });
      timeZone = rawTimeZone;
    } catch {
      timeZone = "local";
    }
  }
  return { theme, dateFormat, timeZone, dashboardLayout };
}

export function formatTenantDate(
  value: string | Date | null | undefined,
  options: { dateOnly?: boolean; preferences?: UserPreferences } = {},
): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  let preferences = options.preferences;
  if (!preferences && typeof localStorage !== "undefined") {
    try {
      const saved = localStorage.getItem("user-preferences");
      preferences = saved ? sanitizeUserPreferences(JSON.parse(saved)) : undefined;
    } catch {
      preferences = undefined;
    }
  }
  const resolved = preferences ?? DEFAULT_USER_PREFERENCES;
  const locale =
    resolved.dateFormat === "mdy" ? "en-US" : resolved.dateFormat === "iso" ? "sv-SE" : "en-GB";
  const format: Intl.DateTimeFormatOptions = options.dateOnly
    ? { year: "numeric", month: "2-digit", day: "2-digit" }
    : {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      };
  if (resolved.timeZone !== "local") format.timeZone = resolved.timeZone;
  return new Intl.DateTimeFormat(locale, format).format(date);
}

export function normalizeCustomDomain(value: string): string | null {
  const input = value.trim().replace(/\.$/, "").toLowerCase();
  if (!input || input.length > 253 || /\s|:|\/|@/.test(input)) return null;
  const labels = input.split(".");
  if (labels.length < 2) return null;
  if (
    labels.some(
      (label) =>
        label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    return null;
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(input)) return null;
  return input;
}
