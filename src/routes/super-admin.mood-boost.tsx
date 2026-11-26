import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  MOOD_BOOST_CATEGORIES,
  MOOD_BOOST_COUNTRIES,
  MOOD_BOOST_LANGUAGES,
  moodBoostCategoryLabel,
} from "@/lib/mood-boost";
import type { Tables } from "@/integrations/supabase/types";

type Topic = Tables<"mood_boost_topics">;
type Content = Tables<"mood_boost_content">;
type Feedback = Tables<"mood_boost_feedback">;
type PlatformSettings = Tables<"mood_boost_platform_settings">;
const EMPTY_TOPICS: Topic[] = [];
const EMPTY_CONTENT: Content[] = [];
const EMPTY_FEEDBACK: Feedback[] = [];

export const Route = createFileRoute("/super-admin/mood-boost")({
  head: () => ({ meta: [{ title: "Mood Boost — Super Admin" }] }),
  component: MoodBoostAdmin,
});

function MoodBoostAdmin() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [topicForm, setTopicForm] = useState({
    country_code: "KE",
    language: "en",
    topic: "",
    source: "",
    source_reference: "",
    relevance_score: "0.7",
  });
  const [safeTopics, setSafeTopics] = useState<Set<string>>(() => new Set());
  const topicsQuery = useQuery({
    queryKey: ["admin-mood-boost-topics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mood_boost_topics")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });
  const contentQuery = useQuery({
    queryKey: ["admin-mood-boost-content"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mood_boost_content")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });
  const feedbackQuery = useQuery({
    queryKey: ["admin-mood-boost-reports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mood_boost_feedback")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data;
    },
  });
  const configQuery = useQuery({
    queryKey: ["admin-mood-boost-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mood_boost_platform_settings")
        .select("*")
        .eq("id", true)
        .single();
      if (error) throw error;
      return data;
    },
  });
  const topics = topicsQuery.data ?? EMPTY_TOPICS;
  const content = contentQuery.data ?? EMPTY_CONTENT;
  const feedback = feedbackQuery.data ?? EMPTY_FEEDBACK;
  const reports = feedback.filter((item) => item.feedback_type === "report");
  const config = configQuery.data;
  const contentById = useMemo(() => new Map(content.map((item) => [item.id, item])), [content]);
  const stats = useMemo(
    () => ({
      drafts: content.filter((item) => item.moderation_status === "pending").length,
      published: content.filter(
        (item) => item.moderation_status === "approved" && item.campaign_enabled,
      ).length,
      likes: feedback.filter((item) => item.feedback_type === "like").length,
      dislikes: feedback.filter((item) => item.feedback_type === "dislike").length,
      reports: reports.length,
      topics: topics.filter((topic) => topic.status === "active").length,
    }),
    [content, feedback, reports.length, topics],
  );

  async function refreshAdminQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-mood-boost-topics"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-mood-boost-content"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-mood-boost-reports"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-mood-boost-config"] }),
    ]);
  }

  const addTopic = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Sign in as a platform administrator.");
      const topic = topicForm.topic.trim();
      const source = topicForm.source.trim();
      const sourceReference = topicForm.source_reference.trim();
      if (!/^[A-Z]{2}$/.test(topicForm.country_code)) {
        throw new Error("Country must be a two-letter ISO code.");
      }
      if (topic.length < 4 || topic.length > 200)
        throw new Error("Topic must be 4–200 characters.");
      if (source.length < 2 || source.length > 120) throw new Error("Add a short source name.");
      const parsed = new URL(sourceReference);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error("Source reference must be a public HTTP or HTTPS URL without credentials.");
      }
      const relevance = Number(topicForm.relevance_score);
      if (!Number.isFinite(relevance) || relevance < 0 || relevance > 1) {
        throw new Error("Relevance must be between 0 and 1.");
      }
      const { error } = await supabase.from("mood_boost_topics").insert({
        country_code: topicForm.country_code,
        language: topicForm.language,
        topic,
        source,
        source_reference: parsed.toString(),
        relevance_score: relevance,
        status: "pending",
        safety_confirmed: false,
        discovered_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        created_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Source topic submitted for review");
      setTopicForm((current) => ({ ...current, topic: "", source: "", source_reference: "" }));
      await refreshAdminQueries();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reviewTopic = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "active" | "rejected" }) => {
      const { error } = await supabase
        .from("mood_boost_topics")
        .update({
          status,
          safety_confirmed: status === "active",
          reviewed_by: user?.id ?? null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: async (_data, variables) => {
      setSafeTopics((current) => {
        const next = new Set(current);
        next.delete(variables.id);
        return next;
      });
      await refreshAdminQueries();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reviewContent = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const { error } = await supabase
        .from("mood_boost_content")
        .update({
          moderation_status: approve ? "approved" : "rejected",
          reviewed_by: user?.id ?? null,
          moderated_at: new Date().toISOString(),
          published_at: approve ? new Date().toISOString() : null,
        })
        .eq("id", id)
        .eq("moderation_status", "pending");
      if (error) throw error;
    },
    onSuccess: refreshAdminQueries,
    onError: (error: Error) => toast.error(error.message),
  });

  const disableCampaign = useMutation({
    mutationFn: async (tag: string) => {
      if (!tag || tag === "evergreen")
        throw new Error("Use content review to disable evergreen content.");
      const { error } = await supabase
        .from("mood_boost_content")
        .update({ campaign_enabled: false })
        .eq("campaign_tag", tag);
      if (error) throw error;
    },
    onSuccess: refreshAdminQueries,
    onError: (error: Error) => toast.error(error.message),
  });

  const saveConfig = useMutation({
    mutationFn: async (values: Pick<PlatformSettings, "enabled" | "refresh_interval_hours">) => {
      const { error } = await supabase
        .from("mood_boost_platform_settings")
        .update({ ...values, updated_at: new Date().toISOString() })
        .eq("id", true);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Mood Boost generation settings saved");
      await refreshAdminQueries();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const hasError =
    topicsQuery.isError || contentQuery.isError || feedbackQuery.isError || configQuery.isError;

  return (
    <div className="space-y-6">
      <PageHeader
        title="NETGRID Mood Boost"
        description="Review source-backed country topics, approve moderated original captions, and monitor reports."
      />
      {hasError && (
        <div className="rounded-xl border border-destructive/40 bg-card p-4" role="alert">
          <p className="font-medium">Mood Boost administration data could not be loaded.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {[topicsQuery.error, contentQuery.error, feedbackQuery.error, configQuery.error].find(
              Boolean,
            )?.message ?? "Please retry."}
          </p>
          <Button
            className="mt-3"
            variant="outline"
            onClick={() => {
              void topicsQuery.refetch();
              void contentQuery.refetch();
              void feedbackQuery.refetch();
              void configQuery.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Active source topics" value={stats.topics} />
        <Stat label="Published cards" value={stats.published} />
        <Stat label="Pending review" value={stats.drafts} />
        <Stat label="Likes" value={stats.likes} />
        <Stat label="Dislikes" value={stats.dislikes} />
        <Stat label="User reports" value={stats.reports} />
      </div>

      {config && (
        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Generation schedule</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The scheduled job only uses active topics with a recorded source. Drafts remain private
            until a platform administrator approves them.
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(event) =>
                  saveConfig.mutate({
                    enabled: event.target.checked,
                    refresh_interval_hours: config.refresh_interval_hours,
                  })
                }
              />
              Enable scheduled caption drafts
            </label>
            <div>
              <Label htmlFor="mood-boost-refresh-hours">Minimum interval</Label>
              <select
                id="mood-boost-refresh-hours"
                value={config.refresh_interval_hours}
                onChange={(event) =>
                  saveConfig.mutate({
                    enabled: config.enabled,
                    refresh_interval_hours: Number(event.target.value),
                  })
                }
                className="mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {[24, 48, 72, 168, 336, 720].map((hours) => (
                  <option key={hours} value={hours}>
                    {hours < 168 ? `${hours} hours` : `${hours / 24} days`}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-muted-foreground">
              Last run:{" "}
              {config.last_run_at ? new Date(config.last_run_at).toLocaleString() : "Never"}
            </p>
          </div>
        </section>
      )}

      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Add an evidenced local topic</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Add only a topic you have checked in the cited public source. No social account scraping
          is performed. Topics require review before caption generation.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label htmlFor="mood-topic-country">Country</Label>
            <input
              id="mood-topic-country"
              list="mood-topic-country-options"
              maxLength={2}
              value={topicForm.country_code}
              onChange={(event) =>
                setTopicForm((form) => ({
                  ...form,
                  country_code: event.target.value.toUpperCase(),
                }))
              }
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <datalist id="mood-topic-country-options">
              {MOOD_BOOST_COUNTRIES.map((country) => (
                <option key={country.code} value={country.code} label={country.label} />
              ))}
            </datalist>
          </div>
          <div>
            <Label htmlFor="mood-topic-language">Language</Label>
            <select
              id="mood-topic-language"
              value={topicForm.language}
              onChange={(event) =>
                setTopicForm((form) => ({ ...form, language: event.target.value }))
              }
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {MOOD_BOOST_LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </select>
          </div>
          <Field
            id="mood-topic-relevance"
            label="Relevance score (0–1)"
            value={topicForm.relevance_score}
            onChange={(value) => setTopicForm((form) => ({ ...form, relevance_score: value }))}
            type="number"
            min="0"
            max="1"
            step="0.05"
          />
          <Field
            id="mood-topic-title"
            label="Topic"
            value={topicForm.topic}
            onChange={(value) => setTopicForm((form) => ({ ...form, topic: value }))}
            maxLength={200}
          />
          <Field
            id="mood-topic-source"
            label="Source name"
            value={topicForm.source}
            onChange={(value) => setTopicForm((form) => ({ ...form, source: value }))}
            maxLength={120}
          />
          <Field
            id="mood-topic-reference"
            label="Public source URL"
            value={topicForm.source_reference}
            onChange={(value) => setTopicForm((form) => ({ ...form, source_reference: value }))}
            type="url"
          />
        </div>
        <Button className="mt-4" onClick={() => addTopic.mutate()} disabled={addTopic.isPending}>
          {addTopic.isPending ? "Submitting…" : "Submit for source review"}
        </Button>
      </section>

      <section className="rounded-xl border bg-card">
        <div className="border-b p-5">
          <h2 className="font-semibold">Source topic review</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Only topics marked active are eligible for original AI caption drafts.
          </p>
        </div>
        <div className="divide-y">
          {topics.map((topic) => (
            <article key={topic.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{topic.topic}</p>
                  <Status value={topic.status} />
                  <span className="text-xs text-muted-foreground">
                    {topic.country_code} · {topic.language} · relevance {topic.relevance_score}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {topic.source} · discovered {new Date(topic.discovered_at).toLocaleDateString()}
                </p>
                <a
                  href={topic.source_reference}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block break-all text-xs text-primary underline"
                >
                  {topic.source_reference}
                </a>
              </div>
              {topic.status === "pending" && (
                <div className="flex shrink-0 flex-col gap-2">
                  <label className="flex max-w-sm items-start gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={safeTopics.has(topic.id)}
                      onChange={(event) =>
                        setSafeTopics((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(topic.id);
                          else next.delete(topic.id);
                          return next;
                        })
                      }
                    />
                    I checked the source and confirmed this topic is suitable for light humour—not
                    political, tragic, discriminatory, or about an identifiable person.
                  </label>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => reviewTopic.mutate({ id: topic.id, status: "active" })}
                      disabled={reviewTopic.isPending || !safeTopics.has(topic.id)}
                    >
                      Verify &amp; mark safe
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => reviewTopic.mutate({ id: topic.id, status: "rejected" })}
                      disabled={reviewTopic.isPending}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              )}
              {topic.status === "active" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => reviewTopic.mutate({ id: topic.id, status: "rejected" })}
                  disabled={reviewTopic.isPending}
                >
                  Disable topic
                </Button>
              )}
            </article>
          ))}
          {!topics.length && <p className="p-5 text-sm text-muted-foreground">No topics yet.</p>}
        </div>
      </section>

      <section className="rounded-xl border bg-card">
        <div className="border-b p-5">
          <h2 className="font-semibold">Generated caption review</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            AI moderation is a first filter, not an approval. Review every draft before publishing.
          </p>
        </div>
        <div className="divide-y">
          {content.map((item) => (
            <article key={item.id} className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Status value={item.moderation_status} />
                    <span className="text-xs text-muted-foreground">
                      {item.country_code} · {item.language} ·{" "}
                      {moodBoostCategoryLabel(item.category)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Campaign: {item.campaign_tag}
                    </span>
                    {!item.campaign_enabled && <Status value="disabled" />}
                  </div>
                  <p className="mt-2 text-sm font-medium">{item.caption}</p>
                  {item.original_caption && (
                    <p className="mt-1 text-sm text-muted-foreground">{item.original_caption}</p>
                  )}
                  {item.source_reference && (
                    <a
                      href={item.source_reference}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 block break-all text-xs text-primary underline"
                    >
                      Topic source: {item.source_reference}
                    </a>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Moderation: {moderationSummary(item.moderation_result)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {item.moderation_status === "pending" && (
                    <>
                      <Button
                        size="sm"
                        onClick={() => reviewContent.mutate({ id: item.id, approve: true })}
                        disabled={reviewContent.isPending}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => reviewContent.mutate({ id: item.id, approve: false })}
                        disabled={reviewContent.isPending}
                      >
                        Reject
                      </Button>
                    </>
                  )}
                  {item.campaign_tag !== "evergreen" && item.campaign_enabled && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => disableCampaign.mutate(item.campaign_tag)}
                      disabled={disableCampaign.isPending}
                    >
                      Disable campaign
                    </Button>
                  )}
                </div>
              </div>
            </article>
          ))}
          {!content.length && <p className="p-5 text-sm text-muted-foreground">No captions yet.</p>}
        </div>
      </section>

      <section className="rounded-xl border bg-card">
        <div className="border-b p-5">
          <h2 className="font-semibold">Reported content</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Reports are visible only to platform administrators.
          </p>
        </div>
        <div className="divide-y">
          {reports.map((report) => (
            <ReportedContent
              key={report.id}
              report={report}
              content={contentById.get(report.content_id)}
              reviewerId={user?.id}
            />
          ))}
          {!reports.length && <p className="p-5 text-sm text-muted-foreground">No reports.</p>}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Status({ value }: { value: string }) {
  return (
    <span className="rounded-full border px-2 py-0.5 text-xs capitalize text-muted-foreground">
      {value}
    </span>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  maxLength,
  min,
  max,
  step,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  maxLength?: number;
  min?: string;
  max?: string;
  step?: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={maxLength}
        min={min}
        max={max}
        step={step}
        className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
      />
    </div>
  );
}

function ReportedContent({
  report,
  content,
  reviewerId,
}: {
  report: Feedback;
  content?: Content;
  reviewerId?: string;
}) {
  const queryClient = useQueryClient();
  return (
    <article className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{content?.caption ?? "Content unavailable"}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Category: {report.category ?? (content ? moodBoostCategoryLabel(content.category) : "—")}{" "}
          · reported {new Date(report.created_at).toLocaleString()}
        </p>
      </div>
      {content?.moderation_status === "approved" && (
        <Button
          size="sm"
          variant="destructive"
          onClick={async () => {
            const { error } = await supabase
              .from("mood_boost_content")
              .update({
                moderation_status: "rejected",
                campaign_enabled: false,
                reviewed_by: reviewerId ?? null,
                moderated_at: new Date().toISOString(),
              })
              .eq("id", content.id);
            if (error) toast.error(`Could not remove reported content: ${error.message}`);
            else {
              toast.success("Reported content removed");
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["admin-mood-boost-content"] }),
                queryClient.invalidateQueries({ queryKey: ["admin-mood-boost-reports"] }),
              ]);
            }
          }}
        >
          Remove from rotation
        </Button>
      )}
    </article>
  );
}

function moderationSummary(value: Content["moderation_result"]): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Not available";
  const result = value as { flagged?: unknown };
  return result.flagged === false
    ? "Passed automated screening; pending human review"
    : "Review required";
}
