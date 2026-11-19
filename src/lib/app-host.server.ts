export function appHost(fallbackHost: string): string {
  return process.env.APP_CANONICAL_HOST?.trim() || fallbackHost;
}