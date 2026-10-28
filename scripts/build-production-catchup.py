#!/usr/bin/env python3
"""Builds supabase/production-catchup.sql from the real migration files.

One script that brings a production database up to date from the point where recent migrations may be
missing. It is safe to run any number of times, on any database state:
  * every migration from FIRST onwards already uses IF NOT EXISTS / DROP ... IF EXISTS / CREATE OR REPLACE,
  * the few statements that CHANGE DATA (and would be wrong to repeat) are guarded so they only run when
    the migration they belong to was not applied yet,
  * the pg_cron scheduling step cannot abort the rest if the extension is not enabled.
Regenerate with:  python3 scripts/build-production-catchup.py
"""
import os, sys

FIRST = "20261023"           # first migration included
ROOT = os.path.join(os.path.dirname(__file__), "..")
MIG = os.path.join(ROOT, "supabase", "migrations")
OUT = os.path.join(ROOT, "supabase", "production-catchup.sql")

def must_replace(text, old, new, fname):
    if text.count(old) != 1:
        sys.exit(f"{fname}: expected exactly one occurrence of the statement to guard, found {text.count(old)}. "
                 "The migration changed: review scripts/build-production-catchup.py")
    return text.replace(old, new)

GUARDS = {
    "20261025010000_router_credentials.sql": [(
        "UPDATE public.routers SET legacy_token_auth = true WHERE provision_token IS NOT NULL;",
        """-- One-time: only when this migration had not been applied (re-running it would switch routers that
-- already use a device token back to the legacy token).
DO $catchup$
BEGIN
  IF current_setting('catchup.credentials_done') <> 'true' THEN
    UPDATE public.routers SET legacy_token_auth = true WHERE provision_token IS NOT NULL;
  END IF;
END
$catchup$;""")],
    "20261027000000_default_intasend.sql": [(
        "UPDATE public.platform_mpesa_config SET active_provider = 'intasend' WHERE active_provider <> 'intasend';",
        """-- One-time: only when IntaSend was not already the default (re-running it would override a provider
-- choice made on Super admin -> Platform Payments).
DO $catchup$
BEGIN
  IF current_setting('catchup.intasend_default_done') <> 'true' THEN
    UPDATE public.platform_mpesa_config SET active_provider = 'intasend' WHERE active_provider <> 'intasend';
  END IF;
END
$catchup$;""")],
    "20261024120000_router_liveness_check.sql": [(
        """CREATE EXTENSION IF NOT EXISTS pg_cron;
-- Scheduling with an existing job name replaces that job, so this is safe to re-run.
SELECT cron.schedule('router-liveness-check', '*/5 * * * *', 'SELECT public.check_router_liveness()');""",
        """-- Scheduling needs the pg_cron extension. If it is not enabled the rest of this script must still run.
DO $catchup$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule('router-liveness-check', '*/5 * * * *', 'SELECT public.check_router_liveness()');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron is not available (%), so the router liveness check was NOT scheduled. Enable the pg_cron extension in Supabase, then run: SELECT cron.schedule(''router-liveness-check'', ''*/5 * * * *'', ''SELECT public.check_router_liveness()'');', SQLERRM;
END
$catchup$;""")],
}

HEADER = f"""-- =====================================================================================================
-- NetGrid production catch-up  (generated from supabase/migrations/{FIRST}* onwards - do not edit by hand)
--
-- Run this once in Supabase -> SQL editor. It is SAFE TO RUN MORE THAN ONCE and on any database state:
-- it only adds what is missing and never repeats one-time data changes.
--
-- Before running: supabase/production-status.sql shows which parts are missing.
-- After running:  run production-status.sql again; every row should say true.
-- =====================================================================================================

-- Remember which one-time migrations were ALREADY applied, before anything below changes the database.
SELECT
  set_config('catchup.credentials_done', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'routers' AND column_name = 'legacy_token_auth')::text, false) AS credentials_already_applied,
  set_config('catchup.intasend_default_done', COALESCE((
    SELECT column_default LIKE '%intasend%' FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'platform_mpesa_config' AND column_name = 'active_provider'), false)::text, false) AS intasend_default_already_applied;
"""

def main():
    files = sorted(f for f in os.listdir(MIG) if f.endswith(".sql") and f >= FIRST)
    parts = [HEADER]
    used = set()
    for f in files:
        text = open(os.path.join(MIG, f)).read().rstrip() + "\n"
        for old, new in GUARDS.get(f, []):
            text = must_replace(text, old, new, f)
            used.add(f)
        parts.append(f"\n-- ===== {f} =====\n{text}")
    missing = set(GUARDS) - used
    if missing:
        sys.exit(f"guards not applied (migration file missing?): {sorted(missing)}")
    parts.append("\n-- ===== done =====\nSELECT 'catch-up complete: run supabase/production-status.sql to confirm' AS result;\n")
    open(OUT, "w").write("".join(parts))
    print(f"wrote {OUT}: {len(files)} migrations, {sum(len(p) for p in parts)//1024} KB")

main()
