import type { Tables } from "@/integrations/supabase/types";

export const MOOD_BOOST_CATEGORY_IDS = [
  "isp_life",
  "wifi_problems",
  "customer_behaviour",
  "mpesa_moments",
  "network_technicians",
  "router_problems",
  "internet_speed",
  "business_life",
  "local_life",
  "technology",
  "trending_topics",
  "weekend_humour",
] as const;

export type MoodBoostCategory = (typeof MOOD_BOOST_CATEGORY_IDS)[number];

const categoryLabels: Record<MoodBoostCategory, string> = {
  isp_life: "ISP Life",
  wifi_problems: "Wi-Fi Problems",
  customer_behaviour: "Customer Behaviour",
  mpesa_moments: "M-Pesa Moments",
  network_technicians: "Network Technicians",
  router_problems: "Router Problems",
  internet_speed: "Internet Speed",
  business_life: "Business Life",
  local_life: "Local Life",
  technology: "Technology",
  trending_topics: "Trending Topics",
  weekend_humour: "Weekend Humour",
};

export const MOOD_BOOST_CATEGORIES = MOOD_BOOST_CATEGORY_IDS.map((id) => ({
  id,
  label: categoryLabels[id],
}));

export const MOOD_BOOST_COUNTRIES = [
  { code: "KE", label: "Kenya" },
  { code: "TZ", label: "Tanzania" },
  { code: "UG", label: "Uganda" },
  { code: "RW", label: "Rwanda" },
  { code: "ET", label: "Ethiopia" },
  { code: "NG", label: "Nigeria" },
  { code: "ZA", label: "South Africa" },
  { code: "GH", label: "Ghana" },
] as const;

export const MOOD_BOOST_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "sw", label: "Kiswahili" },
  { code: "lg", label: "Luganda" },
] as const;

export type MoodBoostSettings = Tables<"mood_boost_settings">;
export type MoodBoostContent = Tables<"mood_boost_content">;

export const DEFAULT_MOOD_BOOST_SETTINGS: Omit<MoodBoostSettings, "tenant_id" | "updated_at"> = {
  enabled: true,
  country_code: "KE",
  primary_language: "en",
  secondary_language: "sw",
  categories: MOOD_BOOST_CATEGORIES.map(({ id }) => id),
  content_frequency: "daily",
  show_trending: true,
  show_isp_humour: true,
  contextual_humour_enabled: false,
  sound_enabled: false,
};

const categoryIds = new Set<string>(MOOD_BOOST_CATEGORIES.map(({ id }) => id));
const languageCodes = new Set<string>(MOOD_BOOST_LANGUAGES.map(({ code }) => code));

export function sanitizeMoodBoostSettings(
  input: Partial<MoodBoostSettings> | null | undefined,
): Omit<MoodBoostSettings, "tenant_id" | "updated_at"> {
  const country = input?.country_code?.toUpperCase() ?? DEFAULT_MOOD_BOOST_SETTINGS.country_code;
  const primaryLanguage = input?.primary_language?.toLowerCase() ?? "en";
  const secondaryLanguage = input?.secondary_language?.toLowerCase() ?? null;
  const primary = languageCodes.has(primaryLanguage) ? primaryLanguage : "en";

  return {
    enabled: input?.enabled ?? true,
    country_code: /^[A-Z]{2}$/.test(country) ? country : "KE",
    primary_language: primary,
    secondary_language:
      secondaryLanguage && secondaryLanguage !== primary && languageCodes.has(secondaryLanguage)
        ? secondaryLanguage
        : null,
    categories: (input?.categories ?? [...DEFAULT_MOOD_BOOST_SETTINGS.categories]).filter((item) =>
      categoryIds.has(item),
    ),
    content_frequency: input?.content_frequency === "manual" ? "manual" : "daily",
    show_trending: input?.show_trending ?? true,
    show_isp_humour: input?.show_isp_humour ?? true,
    contextual_humour_enabled: input?.contextual_humour_enabled ?? false,
    sound_enabled: input?.sound_enabled ?? false,
  };
}

export function selectMoodBoostContent(
  content: MoodBoostContent[],
  options: {
    viewedContentIds: Set<string>;
    hiddenContentIds: Set<string>;
    hiddenCategories: Set<string>;
    preferredCategories?: Set<string>;
    excludedContentIds?: Set<string>;
    todayContentId?: string | null;
  },
): MoodBoostContent | null {
  const candidates = content.filter(
    (item) =>
      !options.hiddenContentIds.has(item.id) &&
      !options.hiddenCategories.has(item.category) &&
      !options.excludedContentIds?.has(item.id),
  );
  candidates.sort(
    (left, right) =>
      Number(options.preferredCategories?.has(right.category) ?? false) -
      Number(options.preferredCategories?.has(left.category) ?? false),
  );

  if (options.todayContentId) {
    const saved = candidates.find((item) => item.id === options.todayContentId);
    if (saved) return saved;
  }

  return candidates.find((item) => !options.viewedContentIds.has(item.id)) ?? null;
}

export function contextualMoodCaption(context: {
  offlineRouters: number;
  onlineClients: number;
}): string | null {
  if (context.offlineRouters > 0) return "Router imeamua kuchukua leave bila kuomba permission.";
  if (context.onlineClients >= 50) return "Hii si Wi-Fi tena, ni matatu ya Nairobi!";
  return null;
}

export function moodBoostCategoryLabel(category: string): string {
  return MOOD_BOOST_CATEGORIES.find((item) => item.id === category)?.label ?? "ISP Life";
}

export function moodBoostCountryLabel(countryCode: string): string {
  const code = countryCode.toUpperCase();
  if (code === "ZZ") return "Global";
  const configuredCountry = MOOD_BOOST_COUNTRIES.find((country) => country.code === code);
  if (configuredCountry) return configuredCountry.label;
  const localizedCountry = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
  return localizedCountry && localizedCountry !== code ? localizedCountry : code;
}
