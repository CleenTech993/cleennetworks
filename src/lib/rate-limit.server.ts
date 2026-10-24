// Best-effort in-memory rate limiter for public endpoints.
// NOTE: state is per server instance/isolate, so this slows casual abuse but is not
// a hard guarantee. For strict limits add a Cloudflare rate-limiting rule or a DB counter.
const buckets = new Map<string, { count: number; reset: number }>();

export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/** Returns true if the request is allowed. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
  }
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

export function tooManyRequests(): Response {
  return Response.json(
    { error: "Too many attempts. Please wait a minute and try again." },
    { status: 429, headers: { "retry-after": "60" } },
  );
}
