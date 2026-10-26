import type { Tables } from "@/integrations/supabase/types";

type RouterRow = Tables<"routers">;
/** The only fields liveness needs, so callers that select just these columns can use it too. */
type CheckIn = Pick<RouterRow, "last_heartbeat_at" | "last_seen_at">;

/** A router counts as live if it checked in within this window (it heartbeats every minute). */
export const LIVE_WINDOW_MS = 3 * 60 * 1000;

export function lastCheckIn(r: CheckIn): string | null {
  return r.last_heartbeat_at ?? r.last_seen_at ?? null;
}

export function isRouterLive(r: CheckIn, now = Date.now()): boolean {
  const last = lastCheckIn(r);
  return last ? now - new Date(last).getTime() < LIVE_WINDOW_MS : false;
}

export function ramPercent(r: RouterRow): number | null {
  if (r.total_memory_mb && r.free_memory_mb != null) {
    return Math.round(((r.total_memory_mb - r.free_memory_mb) / r.total_memory_mb) * 100);
  }
  return r.ram_usage ?? null;
}

/** 0-100. An unreachable router scores 0; otherwise points are taken off for CPU, RAM and heat. */
export function healthScore(r: RouterRow, now = Date.now()): number {
  if (!isRouterLive(r, now)) return 0;
  let s = 100;
  const cpu = r.cpu_load ?? r.cpu_usage ?? 0;
  if (cpu > 80) s -= 25;
  else if (cpu > 60) s -= 10;
  const ram = ramPercent(r) ?? 0;
  if (ram > 85) s -= 25;
  else if (ram > 70) s -= 10;
  if (r.temperature != null && Number(r.temperature) > 70) s -= 20;
  return Math.max(0, s);
}

export type HealthTone = "good" | "warn" | "bad";
export function healthTone(score: number): HealthTone {
  return score >= 80 ? "good" : score >= 50 ? "warn" : "bad";
}

/**
 * RouterOS reports uptime as a duration such as "2d04:05:06", "1w2d03:04:05" or "00:12:30", not as
 * seconds. Accepts that format (or a plain number of seconds) and returns seconds, or null.
 */
export function parseRouterOsDuration(v: string | null | undefined): number | null {
  if (v == null) return null;
  const s = v.trim();
  if (s === "") return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  const m = /^(?:(\d+)w)?(?:(\d+)d)?(?:(\d+):(\d{1,2}):(\d{1,2})(?:\.\d+)?)?$/.exec(s);
  if (!m || (m[1] == null && m[2] == null && m[3] == null)) return null;
  const [w, d, h, mi, se] = [m[1], m[2], m[3], m[4], m[5]].map((x) => (x == null ? 0 : Number(x)));
  return w * 604800 + d * 86400 + h * 3600 + mi * 60 + se;
}
