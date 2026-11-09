import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHost } from "@tanstack/react-start/server";
import { resolveOrigin } from "@/lib/seo";

// The address this page is being served from, for canonical URLs and social cards. Works on any
// domain without configuration; set VITE_SITE_URL to pin one canonical address once a custom
// domain exists (so preview and mirror URLs point search engines at the real one).
const configured = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SITE_URL;

export const siteOrigin = createIsomorphicFn()
  .server(() => {
    const host = getRequestHost();
    const proto = /^(localhost|127\.|\[::1\])/.test(host) ? "http" : "https";
    return resolveOrigin(configured, `${proto}://${host}`);
  })
  .client(() => resolveOrigin(configured, window.location.origin));
