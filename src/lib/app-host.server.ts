const DEFAULT_VERCEL_HOST = "cleennetworks.vercel.app";

export function appHost(fallbackHost: string): string {
  const configuredHost = process.env.APP_CANONICAL_HOST?.trim();
  if (
    process.env.VERCEL &&
    (!configuredHost || configuredHost.toLowerCase().endsWith(".workers.dev"))
  ) {
    return process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || DEFAULT_VERCEL_HOST;
  }
  return configuredHost || fallbackHost;
}