import { vi } from "vitest";
import type { FakeDb } from "./fake-supabase";

/** Shared mutable handle so vi.mock factories (hoisted) can reach the per-test fake DB. */
export const h: { db: FakeDb } = { db: null as unknown as FakeDb };

let ipCounter = 0;
/** Each test gets its own client IP so the in-memory rate limiter never leaks between tests. */
export const freshIp = () => `10.1.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

export function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => handler(String(url), init));
  vi.stubGlobal("fetch", spy);
  return spy;
}
