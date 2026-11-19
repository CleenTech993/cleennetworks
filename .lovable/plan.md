# Router Health Monitoring & NOC — Phased Plan

Stack stays **TanStack Start + Supabase**, with **Supabase Realtime** for live dashboards. The MikroTik agent is the existing `.rsc` script + scheduler heartbeat — extended each phase.

We ship phase-by-phase. After each phase you can use it end-to-end before we move on.

---

## Phase 1 — Live router status (foundation)

**Goal:** every router shows online/offline + basic identity in real time, on both Super-Admin NOC and Tenant dashboard.

- DB: extend `routers` (`cpu_load`, `free_memory_mb`, `total_memory_mb`, `hdd_free_mb`, `temperature`, `voltage`, `board_name`, `firmware_version`, `architecture`, `wan_ip`, `lan_ip`, `tags text[]`, `last_heartbeat_at`). Enable Realtime publication on `routers`.
- Heartbeat: extend `/api/public/router/heartbeat/$token` to accept query params (cpu, mem-free, mem-total, uptime, temp, voltage, version, board, wan-ip) — MikroTik `fetch` supports query strings.
- Provisioning `.rsc`: schedule sends those `/system resource` + `/ip address` values every 60s.
- Pages:
  - `super-admin/noc` — grid of all routers, live status dots, totals (online/offline/total), uses Realtime channel on `routers`.
  - `tenant/routers/$id` — detail page: identity, CPU/RAM gauges, last seen.

## Phase 2 — Time-series metrics + uptime graphs

- DB: new `router_metrics` (router_id, ts, cpu_pct, mem_pct, rx_bps, tx_bps, wan_latency_ms, wan_loss_pct, temp). Hypertable-style index on (router_id, ts desc). Retention policy (30d hot, daily rollup table `router_metrics_daily`).
- DB: new `router_uptime_events` (router_id, started_at, ended_at, kind: 'down'|'up'). pg trigger: when `last_heartbeat_at` gap > 3min, close current up-event and open down-event; reverse on next heartbeat.
- Heartbeat writes a row to `router_metrics` each call.
- pg_cron: every 5 min mark routers with `last_heartbeat_at < now()-3min` as `offline`; nightly rollup to `_daily`.
- UI: 24h / 7d / 30d / 12m uptime % per router, sparkline charts (Recharts), SLA % card.

## Phase 3 — Interface + WAN + traffic analytics

- `.rsc` script: extend scheduler to also push `/interface print stats` and a `/tool ping` to WAN gateway + 8.8.8.8 + portal host.
- DB: `router_interfaces` (router_id, name, status, speed, rx_bps, tx_bps, rx_errors, tx_errors, rx_drops, tx_drops, updated_at). `wan_checks` (router_id, ts, latency_ms, loss_pct, dns_ok bool).
- UI: per-router Interfaces tab (table + per-iface RX/TX chart), WAN tab (latency/loss graph, internet quality score), Traffic tab (top consumers from `sessions` joined to `customers`).

## Phase 4 — Hotspot + PPPoE NOC views

- Aggregate from existing `sessions`, `customers`, `payments`:
  - Active hotspot users, new today, expired, online sessions, avg session duration, bandwidth this period.
  - Active / offline / suspended / expired PPPoE customers.
- Super-Admin NOC adds: Active hotspot users (global), active PPPoE (global), total bandwidth, top tenants by traffic, top routers by load.
- Tenant NOC tab summarising same numbers scoped to tenant.

## Phase 5 — Alerts engine

- DB: `alert_rules` (tenant_id nullable for global, metric, op, threshold, window_sec, enabled, channels jsonb). `alerts` (rule_id, router_id, severity, opened_at, closed_at, message, ack_by). Realtime on `alerts`.
- Evaluator: pg_cron every 1 min → SQL function evaluates rules against latest `router_metrics` / `routers` / `wan_checks`; opens/closes alerts.
- UI: Alerts feed on NOC (live via Realtime), per-rule config screen with thresholds matching spec (CPU>80, RAM>90, loss>5, latency>100, temp, WAN downtime).
- Delivery (in-app only this phase). Channels SMS/Email/WhatsApp/Telegram are stubbed flags — wired in Phase 8.

## Phase 6 — Logs + Backups + Config mgmt

- DB: `router_logs` (router_id, ts, topic, level, message). `router_backups` (router_id, taken_at, size_bytes, storage_path, status, sha256). `router_configs` (router_id, captured_at, content text, version_no).
- New `/api/public/router/logs/$token` and `/backup/$token` endpoints; `.rsc` schedules `/log print` export + `/export` to push to platform; backups uploaded to Supabase Storage bucket `router-backups`.
- UI: Logs viewer (search/filter), Backup history (download/restore button generates a one-line restore command), Config diff viewer.

## Phase 7 — Auto-config / provisioning UX upgrades

- Expand `provision/$token/router.rsc` to fully match spec:
  - Detects WAN type (DHCP / static / PPPoE) from tenant-supplied form.
  - Renames ports, builds LAN bridge, DHCP, DNS, NAT, firewall, hotspot, PPPoE server, captive portal, walled garden, queues, FreeRADIUS pointer, monitoring scheduler.
  - Pre-flight tests (ping gateway / 8.8.8.8 / 1.1.1.1 / platform), aborts with log on failure.
  - Post-config validation block: hotspot up, PPPoE up, callback URL reachable; reboots if required, re-validates.
- Tenant "Add router" wizard captures WAN mode + IP pool prefs before generating the token.
- Retry/fallback: secondary `dst` URL + IP fallback documented in script.

## Phase 8 — Network map + Reports + Auto-recovery + Multi-channel alerts

- Network map: React Flow topology grouped by tenant → site → router → interfaces; live status colors via Realtime.
- Reports: server-fn report generator for uptime / downtime / bandwidth / sessions / SLA / revenue; export PDF (`@react-pdf/renderer`), Excel (`exceljs`), CSV.
- Auto-recovery: server-fn that, on `alerts.opened` of certain rules, queues a remediation command (service restart / reboot) executed via the next heartbeat's response payload (router polls a `commands` queue on each heartbeat — no inbound SSH needed).
- Alert channels: Email (Resend via Lovable AI/connector), SMS + WhatsApp (Africa's Talking or Twilio connector), Telegram (bot token).

---

## Tech notes / decisions

- **No WebSockets/Redis** — Supabase Realtime on the affected tables is enough and matches the stack.
- **No SSH inbound** — MikroTik can't be reached from the cloud through NAT; control = router *pulls* commands during heartbeat. This is the standard MikroTik-cloud pattern and avoids opening ports.
- **Metrics retention:** raw `router_metrics` 30 days, daily rollups 24 months. Adjustable.
- **Spec items intentionally out of scope of v1 NOC** (covered later phases): GPS location, NAND health, fan status (RouterOS rarely exposes), Kubernetes deployment (we run on Lovable Cloud).
- All new tables get RLS: tenant rows scoped via `user_tenant_id(auth.uid())`, super_admin full, `service_role` for heartbeat writes.

---

## What I'll build first (after you approve)

**Phase 1 only**, in one batch:
1. Migration: extend `routers`, enable Realtime on `routers`.
2. Update `/api/public/router/heartbeat/$token` to accept metrics in query string.
3. Update provisioning `.rsc` scheduler to push metrics.
4. New `src/routes/super-admin.noc.tsx` (live grid + Realtime subscription).
5. New `src/routes/tenant.routers.$id.tsx` (live detail).
6. Add NOC link to super-admin nav.

Reply **"go phase 1"** (or specify a different phase) and I'll ship it. Reply with edits if you want the plan reshaped first.
