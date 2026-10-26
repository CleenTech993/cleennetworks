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

source "$(dirname "$0")/build-db.sh"   # apply() and build_db(): migration order lives there

build_db rls_roles_test "${1:-}"
psql -d rls_roles_test -v ON_ERROR_STOP=1 -f tests/sql/rls-roles.sql
[[ "${1:-}" != "--before" ]] && psql -d rls_roles_test -v ON_ERROR_STOP=1 -f tests/sql/payment-provider.sql
[[ "${1:-}" != "--before" ]] && psql -d rls_roles_test -v ON_ERROR_STOP=1 -f tests/sql/gateway-secrets.sql

if [[ "${1:-}" != "--before" ]]; then
  build_db router_tokens_test
  (cd tests/sql && psql -d router_tokens_test -v ON_ERROR_STOP=1 -q -f router-tokens.sql)
  echo "router-tokens: all expectations passed"
  build_db pppoe_router_test
  (cd tests/sql && psql -d pppoe_router_test -v ON_ERROR_STOP=1 -q -f pppoe-router.sql)
  echo "pppoe-router: all expectations passed"
fi

if [[ "${1:-}" != "--before" ]]; then
  # supabase/verify_live_db.sql is what you run against the LIVE database to see which migrations
  # it has. It must say OK for every migration on a database built from the migrations...
  bad=$(psql -X -d rls_roles_test -tA -F'|' -f supabase/verify_live_db.sql | awk -F'|' '$7!="OK" && $7!="n/a"' | cut -d'|' -f3,7)
  if [[ -n "$bad" ]]; then echo "verify_live_db.sql disagrees with the migrations:"; echo "$bad"; exit 1; fi
  echo "verify_live_db: every migration reads OK on a freshly built database"
  # ...and must be regenerated whenever a migration is added or changed.
  if ! node scripts/db/gen-live-check.mjs --stdout | diff -q - supabase/verify_live_db.sql >/dev/null; then
    echo "supabase/verify_live_db.sql is out of date: run 'npm run db:verify-gen' and commit the result" >&2; exit 1
  fi
  echo "verify_live_db: up to date with the migrations"
fi
