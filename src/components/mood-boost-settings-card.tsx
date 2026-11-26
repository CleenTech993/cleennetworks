import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  DEFAULT_MOOD_BOOST_SETTINGS,
  MOOD_BOOST_CATEGORIES,
  MOOD_BOOST_COUNTRIES,
  MOOD_BOOST_LANGUAGES,
  sanitizeMoodBoostSettings,
  type MoodBoostSettings,
} from "@/lib/mood-boost";

type SettingsForm = Omit<MoodBoostSettings, "tenant_id" | "updated_at">;

export function MoodBoostSettingsCard() {
  const { tenantId } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["mood-boost-settings", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mood_boost_settings")
        .select("*")
        .eq("tenant_id", tenantId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const [form, setForm] = useState<SettingsForm>(DEFAULT_MOOD_BOOST_SETTINGS);

  useEffect(() => {
    if (query.data) setForm(sanitizeMoodBoostSettings(query.data));
  }, [query.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("Tenant account is not available.");
      if (!/^[A-Za-z]{2}$/.test(form.country_code)) {
        throw new Error("Enter a two-letter ISO country code, such as KE or TZ.");
      }
      const config = sanitizeMoodBoostSettings(form);
      const { error } = await supabase
        .from("mood_boost_settings")
        .upsert({ tenant_id: tenantId, ...config }, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Mood Boost preferences saved");
      await queryClient.invalidateQueries({ queryKey: ["mood-boost-settings", tenantId] });
      await queryClient.invalidateQueries({ queryKey: ["mood-boost-content", tenantId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function set<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleCategory(category: string) {
    setForm((current) => ({
      ...current,
      categories: current.categories.includes(category)
        ? current.categories.filter((item) => item !== category)
        : [...current.categories, category],
    }));
  }

  if (query.isPending) {
    return <p className="text-sm text-muted-foreground">Loading Mood Boost preferences…</p>;
  }

  return (
    <section className="rounded-xl border bg-card p-5 md:col-span-2">
      <div className="mb-4">
        <h3 className="font-semibold">NETGRID Mood Boost</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Optional, original ISP humour. Country trends are added by platform admins with a source
          reference; generated captions are reviewed before they reach your team.
        </p>
      </div>
      {query.isError && (
        <div className="mb-4 rounded-lg border border-destructive/40 p-3" role="alert">
          <p className="text-sm text-destructive">
            Mood Boost preferences could not be loaded: {query.error.message}
          </p>
          <Button className="mt-2" size="sm" variant="outline" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {!query.isError && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => set("enabled", event.target.checked)}
              />
              Enable Mood Boost on the dashboard
            </label>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={form.show_trending}
                onChange={(event) => set("show_trending", event.target.checked)}
              />
              Include admin-verified trending topics
            </label>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={form.show_isp_humour}
                onChange={(event) => set("show_isp_humour", event.target.checked)}
              />
              Include ISP-related humour
            </label>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={form.contextual_humour_enabled}
                onChange={(event) => set("contextual_humour_enabled", event.target.checked)}
              />
              Show general, aggregate-state jokes
            </label>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={form.sound_enabled}
                onChange={(event) => set("sound_enabled", event.target.checked)}
              />
              Play a sound on manual refresh
            </label>
            <div>
              <Label htmlFor="mood-boost-country">Business country</Label>
              <input
                id="mood-boost-country"
                list="mood-boost-country-options"
                maxLength={2}
                value={form.country_code}
                onChange={(event) => set("country_code", event.target.value.toUpperCase())}
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                aria-describedby="mood-boost-country-help"
              />
              <datalist id="mood-boost-country-options">
                {MOOD_BOOST_COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.label}
                  </option>
                ))}
              </datalist>
              <p id="mood-boost-country-help" className="mt-1 text-xs text-muted-foreground">
                ISO country code; this is not inferred from your browser location.
              </p>
            </div>
            <div>
              <Label htmlFor="mood-boost-primary-language">Preferred language</Label>
              <select
                id="mood-boost-primary-language"
                value={form.primary_language}
                onChange={(event) => set("primary_language", event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {MOOD_BOOST_LANGUAGES.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="mood-boost-secondary-language">Secondary language</Label>
              <select
                id="mood-boost-secondary-language"
                value={form.secondary_language ?? ""}
                onChange={(event) => set("secondary_language", event.target.value || null)}
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">None</option>
                {MOOD_BOOST_LANGUAGES.filter(
                  (language) => language.code !== form.primary_language,
                ).map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="mood-boost-frequency">Content frequency</Label>
              <select
                id="mood-boost-frequency"
                value={form.content_frequency}
                onChange={(event) =>
                  set("content_frequency", event.target.value === "manual" ? "manual" : "daily")
                }
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="daily">Daily featured meme</option>
                <option value="manual">Manual refresh only</option>
              </select>
            </div>
          </div>
          <fieldset className="mt-5">
            <legend className="text-sm font-medium">Humour categories</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {MOOD_BOOST_CATEGORIES.map((category) => (
                <label key={category.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.categories.includes(category.id)}
                    onChange={() => toggleCategory(category.id)}
                  />
                  {category.label}
                </label>
              ))}
            </div>
          </fieldset>
          <Button
            className="mt-5"
            disabled={save.isPending || !tenantId}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Save Mood Boost preferences"}
          </Button>
        </>
      )}
    </section>
  );
}
