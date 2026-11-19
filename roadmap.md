# Roadmap

1. Remove the sign-in security limit (failed-password lockout) — migration applied via tool (drizzle/migrations/0004_remove_login_throttle.sql); remaining: db:verify-gen + test:sql + typecheck.
2. Support chat that answers customer questions from help docs and order data, with human handoff when unsure — pending; needs conversation shape and storage choices from the user.
3. Optimize platform load on MikroTik resources (CPU/RAM) — audit polling: router 2-min sync scheduler, heartbeat/telemetry cadence, dashboard 30s refresh; reduce frequency and batch calls.
4. Audit database migrations for incomplete or unapplied changes — pending.
