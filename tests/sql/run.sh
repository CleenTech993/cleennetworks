#!/usr/bin/env bash
# Role-aware RLS + MFA checks against a scratch Postgres (no Supabase needed).
#   PGHOST/PGUSER/... must point at a superuser-capable server; the DB `rls_roles_test` is recreated.
#   Applies supabase/migrations + drizzle/migrations in dependency order, then tests/sql/rls-roles.sql.
#   Pass --before to stop before the role/MFA migration (shows what the test catches on the old schema).
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=rls_roles_test
psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
P="psql -q -d $DB -v ON_ERROR_STOP=1"
apply() { sed -E 's/CREATE EXTENSION IF NOT EXISTS pg_cron;//' "$1" | $P -f -; }   # pg_cron not needed here
$P -f tests/sql/00_supabase_stub.sql
for f in $(ls supabase/migrations/*.sql | sort); do
  case "$(basename "$f")" in 20261024*|20261025*|2026102[6-9]*|202611*|2027*) continue;; esac; apply "$f"
done
for f in drizzle/migrations/000*.sql; do apply "$f"; done           # needs routers/customers first
for f in $(ls supabase/migrations/20261024*.sql 2>/dev/null | sort); do apply "$f"; done   # liveness needs drizzle tables
if [[ "${1:-}" != "--before" ]]; then
  for f in $(ls supabase/migrations/20261025*.sql | sort); do apply "$f"; done
  # Router credential rules (bootstrap/device tokens). Self-contained: runs in a transaction and rolls back.
  (cd tests/sql && psql -d "$DB" -v ON_ERROR_STOP=1 -q -f router-tokens.sql 2>&1 | grep -E "expectations|ERROR")
fi
psql -d $DB -v ON_ERROR_STOP=1 -f tests/sql/rls-roles.sql
