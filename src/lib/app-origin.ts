const DEFAULT_APP_HOST = "cleennetworks.ochiengclinton993.workers.dev";

export function appOrigin(currentOrigin: string): string {
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(currentOrigin)) return currentOrigin;

  const currentUrl = new URL(currentOrigin);
  const configuredHost = (import.meta.env.VITE_APP_CANONICAL_HOST ?? "").trim();
  if (
    currentUrl.hostname.toLowerCase().endsWith(".vercel.app") &&
    (!configuredHost || configuredHost.toLowerCase().endsWith(".workers.dev"))
  ) {
    return currentUrl.origin;
  }

  const host = configuredHost || DEFAULT_APP_HOST;
  return `https://${host || DEFAULT_APP_HOST}`;
}