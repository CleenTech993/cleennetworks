import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EyeOff, Flag, Laugh, RefreshCw, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  DEFAULT_MOOD_BOOST_SETTINGS,
  MOOD_BOOST_CATEGORIES,
  contextualMoodCaption,
  moodBoostCategoryLabel,
  moodBoostCountryLabel,
  sanitizeMoodBoostSettings,
  selectMoodBoostContent,
  type MoodBoostSettings,
} from "@/lib/mood-boost";
import type { Tables } from "@/integrations/supabase/types";

type SettingsForm = Omit<MoodBoostSettings, "tenant_id" | "updated_at">;
type HistoryEntry = { content_id: string; viewed_at: string };
type FeedbackEntry = { content_id: string; feedback_type: string; category: string | null };
const EMPTY_CONTENT: Tables<"mood_boost_content">[] = [];
const EMPTY_HISTORY: HistoryEntry[] = [];
const EMPTY_FEEDBACK: FeedbackEntry[] = [];
const EMPTY_CATEGORIES: string[] = [];

export function MoodBoostWidget({
  offlineRouters,
  onlineClients,
  readOnly = false,
}: {
  offlineRouters: number;
  onlineClients: number;
  readOnly?: boolean;
}) {
  const { tenantId, user } = useAuth();
  const queryClient = useQueryClient();
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [emptyAfterRefresh, setEmptyAfterRefresh] = useState(false);
  const [sessionViewedIds, setSessionViewedIds] = useState<Set<string>>(() => new Set());
  const settingsQuery = useQuery({
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
  const settings: SettingsForm = settingsQuery.data
    ? sanitizeMoodBoostSettings(settingsQuery.data)
    : DEFAULT_MOOD_BOOST_SETTINGS;
  const categoryFilterKey = settings.categories.join(",");

  const contentQuery = useQuery({
    queryKey: [
      "mood-boost-content",
      tenantId,
      user?.id,
      settings.country_code,
      settings.primary_language,
      settings.secondary_language,
      settings.categories,
      settings.show_trending,
      settings.show_isp_humour,
    ],
    enabled:
      !!tenantId &&
      !!user?.id &&
      !settingsQuery.isPending &&
      !settingsQuery.isError &&
      settings.enabled,
    queryFn: async () => {
      if (!tenantId || !user) throw new Error("Mood Boost requires an active tenant session.");
      const availableCategories = settings.categories.filter((category) => {
        if (!settings.show_trending && category === "trending_topics") return false;
        if (
          !settings.show_isp_humour &&
          [
            "isp_life",
            "wifi_problems",
            "customer_behaviour",
            "mpesa_moments",
            "router_problems",
            "network_technicians",
            "internet_speed",
          ].includes(category)
        )
          return false;
        return true;
      });
      if (!availableCategories.length) {
        return { content: [], history: [], feedback: [], hiddenCategories: [] };
      }

      const languages = [
        ...new Set(
          [settings.primary_language, settings.secondary_language].filter(
            (language): language is string => !!language,
          ),
        ),
      ];
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const [contentResult, historyResult, feedbackResult, preferencesResult] = await Promise.all([
        supabase
          .from("mood_boost_content")
          .select("*")
          .in("country_code", [settings.country_code, "ZZ"])
          .in("language", languages)
          .in("category", availableCategories)
          .order("published_at", { ascending: false })
          .limit(100),
        supabase
          .from("mood_boost_history")
          .select("content_id,viewed_at")
          .eq("tenant_id", tenantId)
          .eq("user_id", user.id)
          .gte("viewed_at", since)
          .order("viewed_at", { ascending: false })
          .limit(100),
        supabase
          .from("mood_boost_feedback")
          .select("content_id,feedback_type,category")
          .eq("tenant_id", tenantId)
          .eq("user_id", user.id),
        supabase
          .from("mood_boost_user_preferences")
          .select("hidden_categories")
          .eq("tenant_id", tenantId)
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);
      for (const result of [contentResult, historyResult, feedbackResult, preferencesResult]) {
        if (result.error) throw result.error;
      }
      return {
        content: (contentResult.data ?? []).filter(
          (item) => settings.show_trending || !item.source_topic_id,
        ),
        history: historyResult.data ?? [],
        feedback: feedbackResult.data ?? [],
        hiddenCategories: preferencesResult.data?.hidden_categories ?? [],
      };
    },
  });

  const content = contentQuery.data?.content ?? EMPTY_CONTENT;
  const history = contentQuery.data?.history ?? EMPTY_HISTORY;
  const feedback = contentQuery.data?.feedback ?? EMPTY_FEEDBACK;
  const hiddenCategories = contentQuery.data?.hiddenCategories ?? EMPTY_CATEGORIES;
  const hiddenContentIds = useMemo(
    () =>
      new Set(
        feedback
          .filter((item) => item.feedback_type === "dislike" || item.feedback_type === "report")
          .map((item) => item.content_id),
      ),
    [feedback],
  );
  const liked = useMemo(
    () =>
      new Set(
        feedback.filter((item) => item.feedback_type === "like").map((item) => item.content_id),
      ),
    [feedback],
  );
  const likedCategories = useMemo(
    () =>
      new Set(
        feedback
          .filter((item) => item.feedback_type === "like")
          .flatMap((item) => (item.category ? [item.category] : [])),
      ),
    [feedback],
  );
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const recentSavedId =
    settings.content_frequency === "manual"
      ? history[0]?.content_id
      : history.find((item) => new Date(item.viewed_at) >= todayStart)?.content_id;
  const current = useMemo(() => {
    if (emptyAfterRefresh) return null;
    if (currentId) return content.find((item) => item.id === currentId) ?? null;
    return selectMoodBoostContent(content, {
      viewedContentIds: new Set([...history.map((item) => item.content_id), ...sessionViewedIds]),
      hiddenContentIds,
      hiddenCategories: new Set(hiddenCategories),
      preferredCategories: likedCategories,
      todayContentId: recentSavedId,
    });
  }, [
    content,
    currentId,
    emptyAfterRefresh,
    hiddenCategories,
    hiddenContentIds,
    history,
    likedCategories,
    recentSavedId,
    sessionViewedIds,
  ]);
  const viewKey = current?.id;

  useEffect(() => {
    setCurrentId(null);
    setEmptyAfterRefresh(false);
  }, [
    settings.country_code,
    settings.primary_language,
    settings.secondary_language,
    categoryFilterKey,
    settings.show_trending,
    settings.show_isp_humour,
  ]);

  useEffect(() => {
    if (!viewKey || !tenantId || !user?.id) return;
    setCurrentId((selected) => selected ?? viewKey);
    setSessionViewedIds((ids) => new Set(ids).add(viewKey));
    if (readOnly) return;
    if (history.some((item) => item.content_id === viewKey)) return;
    void supabase
      .from("mood_boost_history")
      .upsert(
        {
          tenant_id: tenantId,
          user_id: user.id,
          content_id: viewKey,
          viewed_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,user_id,content_id" },
      )
      .then(({ error }) => {
        if (error) console.error("Could not save Mood Boost view history", error);
      });
  }, [history, readOnly, tenantId, user?.id, viewKey]);

  const feedbackMutation = useMutation({
    mutationFn: async (feedbackType: "like" | "dislike" | "report") => {
      if (!tenantId || !user?.id || !current)
        throw new Error("Select a meme before giving feedback.");
      const { error } = await supabase.from("mood_boost_feedback").upsert(
        {
          tenant_id: tenantId,
          user_id: user.id,
          content_id: current.id,
          feedback_type: feedbackType,
          category: current.category,
        },
        { onConflict: "tenant_id,user_id,content_id" },
      );
      if (error) throw error;
      return feedbackType;
    },
    onSuccess: async (feedbackType) => {
      if (feedbackType === "report")
        toast.success("Thanks. This content has been hidden and reported.");
      await queryClient.invalidateQueries({ queryKey: ["mood-boost-content", tenantId] });
      if (feedbackType !== "like") {
        setCurrentId(null);
        setEmptyAfterRefresh(false);
      }
    },
    onError: (error: Error) => toast.error(`Could not save your feedback: ${error.message}`),
  });

  const hideCategoryMutation = useMutation({
    mutationFn: async () => {
      if (!tenantId || !user?.id || !current) throw new Error("Select a meme first.");
      const categories = [...new Set([...hiddenCategories, current.category])];
      const { error } = await supabase.from("mood_boost_user_preferences").upsert(
        {
          tenant_id: tenantId,
          user_id: user.id,
          hidden_categories: categories,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,user_id" },
      );
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["mood-boost-content", tenantId] });
      setCurrentId(null);
      setEmptyAfterRefresh(false);
    },
    onError: (error: Error) => toast.error(`Could not hide this category: ${error.message}`),
  });

  const restoreCategoryMutation = useMutation({
    mutationFn: async (category: string) => {
      if (!tenantId || !user?.id) throw new Error("Sign in to update Mood Boost preferences.");
      const { error } = await supabase.from("mood_boost_user_preferences").upsert(
        {
          tenant_id: tenantId,
          user_id: user.id,
          hidden_categories: hiddenCategories.filter((item) => item !== category),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,user_id" },
      );
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["mood-boost-content", tenantId] });
      setCurrentId(null);
      setEmptyAfterRefresh(false);
    },
    onError: (error: Error) => toast.error(`Could not restore this category: ${error.message}`),
  });

  function refresh() {
    const next = selectMoodBoostContent(content, {
      viewedContentIds: new Set([...history.map((item) => item.content_id), ...sessionViewedIds]),
      hiddenContentIds,
      hiddenCategories: new Set(hiddenCategories),
      preferredCategories: likedCategories,
      excludedContentIds: current ? new Set([current.id]) : undefined,
    });
    setCurrentId(next?.id ?? "");
    setEmptyAfterRefresh(!next);
    if (settings.sound_enabled && typeof window !== "undefined") playRefreshSound();
  }

  if (!tenantId || !user || !settings.enabled || settingsQuery.isPending) return null;

  if (settingsQuery.isError || contentQuery.isError) {
    const error = settingsQuery.isError ? settingsQuery.error : contentQuery.error;
    return (
      <section className="rounded-xl border bg-card p-4" aria-label="NETGRID Mood Boost">
        <p className="font-medium">Mood Boost is taking a breather.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The dashboard is still working normally. {error?.message}
        </p>
        <Button
          className="mt-3"
          size="sm"
          variant="outline"
          onClick={() => {
            void settingsQuery.refetch();
            void contentQuery.refetch();
          }}
        >
          Try again
        </Button>
      </section>
    );
  }

  if (contentQuery.isPending) {
    return (
      <section className="rounded-xl border bg-card p-4" aria-label="NETGRID Mood Boost">
        <p className="text-sm text-muted-foreground">Finding a little network humour…</p>
      </section>
    );
  }

  const contextCaption = settings.contextual_humour_enabled
    ? contextualMoodCaption({ offlineRouters, onlineClients })
    : null;

  return (
    <section
      className="overflow-hidden rounded-xl border bg-gradient-to-br from-amber-500/10 via-card to-primary/5"
      aria-label="NETGRID Mood Boost"
    >
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300">
            <Laugh className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              NETGRID Mood Boost
            </p>
            <p className="text-xs text-muted-foreground">
              {current
                ? `${moodBoostCategoryLabel(current.category)} · ${moodBoostCountryLabel(settings.country_code)}`
                : `${moodBoostCountryLabel(settings.country_code)} · A little ISP humour`}
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={refresh}
          aria-label="Refresh Mood Boost meme"
          disabled={content.length === 0}
        >
          <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Refresh
        </Button>
      </div>
      <div className="p-4">
        {current ? (
          <>
            <div className="relative grid min-h-32 place-items-center overflow-hidden rounded-lg border bg-background/80 p-5 text-center">
              <Sparkles
                className="absolute right-3 top-3 h-4 w-4 text-amber-500/70"
                aria-hidden="true"
              />
              <p className="relative max-w-prose text-lg font-semibold leading-relaxed sm:text-xl">
                {current.caption}
              </p>
            </div>
            {current.original_caption && current.original_caption !== current.caption && (
              <p className="mt-2 text-sm text-muted-foreground">Also: {current.original_caption}</p>
            )}
            {current.source_topic && (
              <p className="mt-2 text-xs text-muted-foreground">
                Admin-verified public topic: {current.source_topic}
                {current.source_reference && (
                  <>
                    {" · "}
                    <a
                      href={current.source_reference}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline"
                    >
                      Source
                    </a>
                  </>
                )}
              </p>
            )}
            {contextCaption && (
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-primary/5 px-3 py-2 text-sm">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>{contextCaption}</span>
              </p>
            )}
            {!readOnly && (
              <div className="mt-3 flex flex-wrap items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={liked.has(current.id) ? "secondary" : "ghost"}
                  onClick={() => feedbackMutation.mutate("like")}
                  disabled={feedbackMutation.isPending}
                  aria-label="Like this meme"
                >
                  <ThumbsUp className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Like
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => feedbackMutation.mutate("dislike")}
                  disabled={feedbackMutation.isPending}
                >
                  <ThumbsDown className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Not for me
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => hideCategoryMutation.mutate()}
                  disabled={hideCategoryMutation.isPending}
                >
                  <EyeOff className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Hide {moodBoostCategoryLabel(current.category)}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => feedbackMutation.mutate("report")}
                  disabled={feedbackMutation.isPending}
                >
                  <Flag className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Report
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="rounded-lg border border-dashed bg-background/60 p-5 text-center">
            <p className="font-medium">You’re all caught up.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              We’ll save another original, approved laugh for later.
            </p>
          </div>
        )}
        {hiddenCategories.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Hidden categories:</span>
            {hiddenCategories.map((category) => (
              <Button
                key={category}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => restoreCategoryMutation.mutate(category)}
                disabled={restoreCategoryMutation.isPending}
              >
                Restore {moodBoostCategoryLabel(category)}
              </Button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function playRefreshSound() {
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 660;
  gain.gain.value = 0.035;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.08);
  oscillator.addEventListener("ended", () => void context.close(), { once: true });
}
