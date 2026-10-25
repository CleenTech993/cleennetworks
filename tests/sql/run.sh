#!/usr/bin/env bash
# Role-aware RLS + MFA + router-token checks against a scratch Postgres (no Supabase needed).
#   PGHOST/PGUSER/... must point at a superuser-capable server; the scratch DBs are recreated.
#   Applies supabase/migrations + drizzle/migrations in dependency order, then runs
#     tests/sql/rls-roles.sql       in database rls_roles_test
#     tests/sql/router-tokens.sql   in database router_tokens_test
#   (each suite gets its own database: they use the same fixture ids and helper schema).
#   Pass --before to stop before the role/MFA migration and run only the RLS suite
#   (shows what the test catches on the old schema).
set -euo pipefail
cd "$(dirname "$0")/../.."

apply() { sed -E 's/CREATE EXTENSION IF NOT EXISTS pg_cron;//' "$1" | psql -q -d "$DB" -v ON_ERROR_STOP=1 -f -; }   # pg_cron not needed here

# build_db <name> [--before]: fresh database with every migration applied in dependency order.
build_db() {
  DB="$1"
  psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
  psql -q -d "$DB" -v ON_ERROR_STOP=1 -f tests/sql/00_supabase_stub.sql
  for f in $(ls supabase/migrations/*.sql | sort); do
    case "$(basename "$f")" in 20261024*|20261025*|2026102[6-9]*|202611*|2027*) continue;; esac; apply "$f"
  done
  for f in drizzle/migrations/000*.sql; do apply "$f"; done           # needs routers/customers first
  for f in $(ls supabase/migrations/20261024*.sql 2>/dev/null | sort); do apply "$f"; done   # liveness needs drizzle tables
  if [[ "${2:-}" != "--before" ]]; then
    for f in $(ls supabase/migrations/20261025*.sql | sort); do apply "$f"; done
  fi
}

build_db rls_roles_test "${1:-}"
psql -d rls_roles_test -v ON_ERROR_STOP=1 -f tests/sql/rls-roles.sql

if [[ "${1:-}" != "--before" ]]; then
  build_db router_tokens_test
  (cd tests/sql && psql -d router_tokens_test -v ON_ERROR_STOP=1 -q -f router-tokens.sql)
  echo "router-tokens: all expectations passed"
fi
