#!/usr/bin/env bash
# Shared by tests/sql/run.sh and scripts/db/gen-live-check.sh: build a scratch Postgres database with
# every migration applied in dependency order. Source this file; it defines apply() and build_db().
#
# Two migration tracks exist and depend on each other:
#   supabase/migrations/*.sql   applied by the Supabase/Lovable pipeline, in version order
#   drizzle/migrations/000*.sql applied separately (Lovable's LOVABLE_DB_MIGRATION_URL); they need
#                               routers/customers (supabase, earlier) and are needed by the supabase
#                               migrations from DRIZZLE_BEFORE on (router_metrics, router_interfaces).
# So: all supabase migrations in version order, with the drizzle ones slotted in just before the first
# supabase migration at or after DRIZZLE_BEFORE. Selecting by version (not by date patterns) means a
# migration added later can never be silently skipped.

DRIZZLE_BEFORE=20261024000000   # first supabase migration that uses a drizzle-created table
ROLE_AWARE_FROM=20261025000000  # role-aware RLS + MFA; `--before` stops short of this

apply() { sed -E 's/CREATE EXTENSION IF NOT EXISTS pg_cron;//' "$1" | psql -q -d "$DB" -v ON_ERROR_STOP=1 -f -; }   # pg_cron not needed here

# migration_order [--before]: the files to apply, in order, one per line.
migration_order() {
  local bad; bad=$(ls supabase/migrations | grep -vE '^[0-9]{14}_.+\.sql$' || true)
  if [[ -n "$bad" ]]; then echo "migration file names must be <14-digit version>_name.sql; offending: $bad" >&2; return 1; fi
  local drizzle_done=0 f v d
  for f in $(ls supabase/migrations/*.sql | sort); do
    v=$(basename "$f" | cut -c1-14)
    if [[ "${1:-}" == "--before" && $((10#$v)) -ge $((10#$ROLE_AWARE_FROM)) ]]; then break; fi
    if [[ $drizzle_done -eq 0 && $((10#$v)) -ge $((10#$DRIZZLE_BEFORE)) ]]; then
      for d in drizzle/migrations/000*.sql; do echo "$d"; done; drizzle_done=1
    fi
    echo "$f"
  done
  if [[ $drizzle_done -eq 0 ]]; then for d in drizzle/migrations/000*.sql; do echo "$d"; done; fi
}

# init_db <name>: empty database with the Supabase stub (auth/storage/roles) installed.
init_db() {
  DB="$1"
  psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
  psql -q -d "$DB" -v ON_ERROR_STOP=1 -f tests/sql/00_supabase_stub.sql
}

# build_db <name> [--before]: fresh database with every migration applied in dependency order.
build_db() {
  local order f
  order=$(migration_order "${2:-}") || return 1
  init_db "$1"
  for f in $order; do apply "$f"; done
}
