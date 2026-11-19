const DEFAULT_APP_HOST = "cleennetworks.ochiengclinton993.workers.dev";

export function appOrigin(currentOrigin: string): string {
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(currentOrigin)) return currentOrigin;

  const host = (import.meta.env.VITE_APP_CANONICAL_HOST ?? DEFAULT_APP_HOST).trim();
  return `https://${host || DEFAULT_APP_HOST}`;
}