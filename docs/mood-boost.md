# NETGRID Mood Boost

Mood Boost is an optional, tenant-configured dashboard card. It displays original, approved
typography-first ISP humour in English, Kiswahili, and Luganda, and does not use browser location.
The default country is `KE`; tenant administrators can set any two-letter ISO country code.
Region-neutral evergreen jokes are available when a country has no local content yet.

## Country topics and content review

Trending-topic discovery is intentionally admin-curated. A platform administrator records the
country, language, topic, public source name, and source URL, then verifies that source and confirms
the topic is suitable before it is eligible for caption generation. The app does not scrape social
media or claim an unverified topic is trending.

The scheduled job uses OpenAI to create an original caption from an active source topic, then checks
the caption and its optional translation with OpenAI Moderation. A moderation pass only creates a
private draft: a platform administrator must still approve it before tenants can see it. Flagged
drafts are rejected. If generation is not configured or no reviewed topic is available, approved
evergreen captions remain available. Cards use original text, not copied meme images.

## Deployment

1. Apply `supabase/migrations/20261217000000_netgrid_mood_boost.sql` using the normal migration
   pipeline. It creates tenant-isolated settings, personal history/feedback, source topics, content,
   admin settings, and RLS policies requiring AAL2.
2. Set `OPENAI_API_KEY` and a high-entropy `CRON_SECRET` as server-only Vercel environment
   variables. Never expose them through `VITE_*` variables or the browser.
3. Vercel runs `/api/cron/mood-boost` daily at 03:00 UTC. The endpoint checks `CRON_SECRET` and
   the platform-configured minimum interval before creating at most one draft per run. Without Vercel,
   invoke the same endpoint from an authorized scheduler.
4. Open **Super Admin → Mood Boost** to submit source-backed topics, verify topics, review drafts,
   handle reports, and adjust generation interval. Tenant administrators control the dashboard
   widget under **Settings → Preferences → NETGRID Mood Boost**.

The widget never sends tenant metrics, customer records, payment data, or router credentials to the
AI provider. Optional contextual captions are selected locally from aggregate online-client and
offline-router counts. Sound is off by default and can only play after a user manually refreshes.

After adding or changing the migration, run `npm run db:verify-gen` and `npm run test:sql`; the
SQL checks require the repository's scratch PostgreSQL setup.
