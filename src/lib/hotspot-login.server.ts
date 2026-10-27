// Hotspot login page (login.html) that sends unauthenticated customers to the
// tenant's captive portal, tagged with the router they are connected to.
//
// The router DOWNLOADS this file from the platform (instead of the provisioning
// script writing it from an inline string) so there is no RouterOS quoting to get
// wrong, the write is a single file operation, and the router can re-fetch it
// whenever it goes missing or goes stale (see routerosHealLoginPage).
//
// Pure functions only (no env / DB access) so they are unit-testable.

/** FNV-1a 32-bit hash -> 8 hex chars. Small, sync, works in every runtime. */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** JSON string that is safe to drop inside an inline <script>. */
const jsString = (s: string) =>
  JSON.stringify(s).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");

export interface LoginPageInput {
  /** Absolute portal URL, e.g. https://app.example.com/p/my-isp */
  portalUrl: string;
  /** routers.id — identifies the router the customer is connected to. */
  routerId: string;
}

/**
 * The marker is embedded in the page as a <meta> tag. The router checks for it to
 * decide whether its copy is current. It changes whenever the portal URL, router
 * id or template changes, so a stale page is detected and replaced automatically.
 */
export function loginPageMarker(input: LoginPageInput): string {
  const body = renderBody(input);
  return `netgrid:${input.routerId}:${fnv1a(body)}`;
}

// $(mac), $(ip) and $(link-login-only) are MikroTik hotspot variables, substituted
// by the router when it serves the page. They must reach the router untouched.
function renderBody({ portalUrl, routerId }: LoginPageInput): string {
  const base = `${portalUrl}${portalUrl.includes("?") ? "&" : "?"}router=${encodeURIComponent(routerId)}`;
  // The portal needs `login` (the router's own login URL) to connect a customer after they redeem
  // a voucher, so every path into the portal must carry it. The no-script fallback includes it too.
  const noJsUrl = `${base}&mac=$(mac)&ip=$(ip)&login=$(link-login-only)`;
  return [
    // Only for browsers with scripting off. A plain meta refresh here used to race the script below:
    // after 1 second it re-navigated to a URL WITHOUT the login link and cancelled the real one.
    `<noscript><meta http-equiv="refresh" content="1; url=${escapeHtml(noJsUrl)}"></noscript>`,
    `<title>Connecting…</title>`,
    `</head><body style="font-family:sans-serif;text-align:center;padding:2rem">`,
    `<p>Taking you to the Wi-Fi portal…</p>`,
    `<p><a href="${escapeHtml(noJsUrl)}">Tap here if nothing happens</a></p>`,
    // The router fills $(error) with the reason a login was refused (empty on a first visit). It sits
    // in a <textarea> (raw text; only a closing textarea tag could end it) rather than inside a script
    // string, because the text is not under our control. The script passes it to the portal, which
    // shows it. Without this every refused login looked like a silent bounce back to the sign-in page.
    `<textarea id="ng-err" hidden>$(error)</textarea>`,
    `<script>`,
    `var ngErr = (document.getElementById("ng-err") || {}).value || "";`,
    `location.replace(${jsString(base)}`,
    `  + "&mac=" + encodeURIComponent("$(mac)")`,
    `  + "&ip=" + encodeURIComponent("$(ip)")`,
    `  + "&login=" + encodeURIComponent("$(link-login-only)")`,
    `  + (ngErr ? "&error=" + encodeURIComponent(ngErr.slice(0, 200)) : ""));`,
    `</script>`,
    `</body></html>`,
  ].join("\n");
}

export function buildLoginHtml(input: LoginPageInput): string {
  const marker = loginPageMarker(input);
  return [
    `<!DOCTYPE html>`,
    `<html><head><meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<meta name="generator" content="${marker}">`,
    renderBody(input),
    ``,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// RouterOS snippets. In a JS template literal "$name" (no brace) is literal, so
// RouterOS variables can be written as-is. Every command that can fail is guarded
// so one failure never aborts the surrounding /import.
// ---------------------------------------------------------------------------

/**
 * Provisioning: pick persistent storage, make sure the hotspot folder has files,
 * download the login page and verify it (3 tries). Expects $ngDir / $ngFile to be
 * defined earlier in the script (see ROUTEROS_PICK_HTML_DIR).
 */
export function routerosInstallLoginPage(a: { loginUrl: string; marker: string }): string {
  return `
# --- Hotspot login page -> captive portal (downloaded, verified, retried) ---
:do {
  :if ([:len [/file find name=$ngFile]] = 0) do={ /ip hotspot reset-html }
} on-error={}
:local ngOk false
:local ngTry 0
:while (!$ngOk && $ngTry < 3) do={
  :set ngTry ($ngTry + 1)
  :do {
    /tool fetch url="${a.loginUrl}" dst-path=$ngFile mode=https
    :delay 1s
    :local ngHave [/file get [/file find name=$ngFile] contents]
    :if ([:typeof [:find $ngHave "${a.marker}"]] != "nil") do={ :set ngOk true }
  } on-error={ :delay 3s }
}
:if ($ngOk) do={ :log info "NetGrid: hotspot login page installed in $ngDir" } else={ :log warning "NetGrid: hotspot login page not installed yet - the sync job will retry" }
`;
}

/**
 * Router-side variable setup. Routers that have a "flash" disk keep files outside
 * /flash in RAM, which is wiped on reboot — so the hotspot folder must live in
 * flash/ there to survive a restart.
 */
export const ROUTEROS_PICK_HTML_DIR = `
:local ngDir "hotspot"
:if ([:len [/file find name=flash]] > 0) do={ :set ngDir "flash/hotspot" }
:local ngFile ($ngDir . "/login.html")
`;

/**
 * Self-heal, appended to the sync script that routers run every few minutes.
 * Only writes to flash when the page is missing or stale (marker mismatch), and
 * restores the portal's walled-garden entry if it was lost.
 */
export function routerosHealLoginPage(a: {
  loginUrl: string;
  marker: string;
  portalHost: string;
}): string {
  return `
# NetGrid hotspot login page self-heal
:do {
  :local ngDir "hotspot"
  :do { :set ngDir [/ip hotspot profile get [/ip hotspot profile find name=netgrid-hsprof] html-directory] } on-error={}
  :local ngFile ($ngDir . "/login.html")
  :local ngHave ""
  :do { :set ngHave [/file get [/file find name=$ngFile] contents] } on-error={}
  :if ([:typeof [:find $ngHave "${a.marker}"]] = "nil") do={
    /tool fetch url="${a.loginUrl}" dst-path=$ngFile mode=https
    :log info "NetGrid: hotspot login page restored"
  }
  :if ([:len [/ip hotspot walled-garden ip find comment=netgrid]] = 0) do={
    /ip hotspot walled-garden ip add action=accept dst-host=${a.portalHost} comment=netgrid
  }
} on-error={ :log warning "NetGrid: hotspot login page check failed" }
`;
}
