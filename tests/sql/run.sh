#!/usr/bin/env bash
# Applies every migration to a throwaway PostgreSQL database and runs the SQL test suites.
# Needs a local PostgreSQL 15+ and a superuser connection via the usual PG* variables:
#   PGHOST=localhost PGUSER=postgres tests/sql/run.sh        (or:  bun run test:sql)
# The scratch database is created and dropped automatically.
set -euo pipefail
cd "$(dirname "$0")/../.."

DB="netgrid_sql_test_$$"
psql -d postgres -q -c "CREATE DATABASE $DB"
trap 'psql -d postgres -q -c "DROP DATABASE IF EXISTS $DB" >/dev/null' EXIT
run() { psql -d "$DB" -v ON_ERROR_STOP=1 -q "$@"; }

run -f tests/sql/_stub_supabase.sql 2>&1 | grep -v "wal_level\|HINT" || true
for f in $(ls supabase/migrations/*.sql | sort); do
  echo "migration: $(basename "$f")"
  sed -E '/CREATE EXTENSION.*pg_cron/d' "$f" | run
done
(cd tests/sql && for t in role-aware-rls router-tokens; do echo "suite: $t"; run -f "$t.sql" 2>&1 | grep -E "ERROR|expectations passed"; [ "${PIPESTATUS[0]}" -eq 0 ] || exit 1; done)
echo "SQL suites passed"
