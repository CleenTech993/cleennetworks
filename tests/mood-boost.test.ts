import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOOD_BOOST_SETTINGS,
  moodBoostCountryLabel,
  sanitizeMoodBoostSettings,
  selectMoodBoostContent,
  contextualMoodCaption,
  type MoodBoostContent,
} from "@/lib/mood-boost";

const makeContent = (id: string, category = "isp_life"): MoodBoostContent => ({
  id,
  country_code: "KE",
  language: "en",
  category,
  caption: `Caption ${id}`,
  original_caption: null,
  image_url: null,
  source_topic_id: null,
  source_topic: null,
  source_reference: null,
  relevance_score: 0.5,
  moderation_status: "approved",
  moderation_result: null,
  campaign_tag: "evergreen",
  campaign_enabled: true,
  generation_day: null,
  created_by: null,
  reviewed_by: null,
  created_at: "2026-01-01T00:00:00.000Z",
  moderated_at: null,
  published_at: "2026-01-01T00:00:00.000Z",
  expires_at: null,
});

describe("Mood Boost settings and selection", () => {
  it("uses safe Kenyan defaults and accepts a configured ISO country code", () => {
    expect(DEFAULT_MOOD_BOOST_SETTINGS).toMatchObject({
      enabled: true,
      country_code: "KE",
      primary_language: "en",
      secondary_language: "sw",
      sound_enabled: false,
    });
    expect(sanitizeMoodBoostSettings({ country_code: "gh" }).country_code).toBe("GH");
    expect(sanitizeMoodBoostSettings({ country_code: "x" }).country_code).toBe("KE");
    expect(moodBoostCountryLabel("CA")).toBe("Canada");
    expect(moodBoostCountryLabel("ZZ")).toBe("Global");
  });

  it("keeps the saved daily meme and excludes unwanted, hidden, and recently viewed content", () => {
    const content = [
      makeContent("saved"),
      makeContent("disliked"),
      makeContent("hidden-category", "router_problems"),
      makeContent("fresh"),
    ];
    expect(
      selectMoodBoostContent(content, {
        viewedContentIds: new Set(["saved"]),
        hiddenContentIds: new Set(["disliked"]),
        hiddenCategories: new Set(["router_problems"]),
        todayContentId: "saved",
      })?.id,
    ).toBe("saved");
    expect(
      selectMoodBoostContent(content, {
        viewedContentIds: new Set(["saved"]),
        hiddenContentIds: new Set(["disliked"]),
        hiddenCategories: new Set(["router_problems"]),
        excludedContentIds: new Set(["saved"]),
      })?.id,
    ).toBe("fresh");
  });

  it("returns no meme rather than repeating an exhausted candidate pool", () => {
    expect(
      selectMoodBoostContent([makeContent("seen")], {
        viewedContentIds: new Set(["seen"]),
        hiddenContentIds: new Set(),
        hiddenCategories: new Set(),
      }),
    ).toBeNull();
  });

  it("prioritizes categories the user has liked", () => {
    expect(
      selectMoodBoostContent(
        [makeContent("other", "wifi_problems"), makeContent("liked", "isp_life")],
        {
          viewedContentIds: new Set(),
          hiddenContentIds: new Set(),
          hiddenCategories: new Set(),
          preferredCategories: new Set(["isp_life"]),
        },
      )?.id,
    ).toBe("liked");
  });

  it("uses only aggregate network state for optional contextual humour", () => {
    expect(contextualMoodCaption({ offlineRouters: 1, onlineClients: 90 })).toContain("leave");
    expect(contextualMoodCaption({ offlineRouters: 0, onlineClients: 50 })).toContain("matatu");
    expect(contextualMoodCaption({ offlineRouters: 0, onlineClients: 4 })).toBeNull();
  });
});
