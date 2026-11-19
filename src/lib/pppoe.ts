// PPPoE client helpers. Pure functions (no env / DB access) so they are unit-testable.
import { expiryFrom } from "./duration";

// Credentials end up inside generated RouterOS scripts, so they are restricted to a
// character set that can never break out of a quoted string.
export const PPPOE_USERNAME_RE = /^[A-Za-z0-9._@-]{3,64}$/;
export const PPPOE_PASSWORD_RE = /^[A-Za-z0-9._@-]{4,64}$/;
const SAFE = /^[A-Za-z0-9._@-]{1,64}$/;

/** Returns an error message, or null when both credentials are acceptable. */
export function validatePppoeCredentials(username: string, password: string): string | null {
  if (!PPPOE_USERNAME_RE.test(username)) {
    return "Username: 3–64 characters, letters, numbers and . _ @ - only.";
  }
  if (!PPPOE_PASSWORD_RE.test(password)) {
    return "Password: 4–64 characters, letters, numbers and . _ @ - only.";
  }
  return null;
}

/** Shared default profile created by the provisioning script (no speed limit). */
export const DEFAULT_PPPOE_PROFILE = "netgrid-pppoe";

/** RouterOS profile name for a package, e.g. "ng-3f9a1c2b". */
export function pppoeProfileName(packageId: string): string {
  const hex = packageId
    .replace(/[^0-9a-f]/gi, "")
    .slice(0, 8)
    .toLowerCase();
  return hex ? `ng-${hex}` : DEFAULT_PPPOE_PROFILE;
}

/**
 * RouterOS PPP profile rate-limit: "rx/tx" from the ROUTER's point of view, so rx is what the
 * client uploads and tx is what the client downloads. "0" means unlimited for that direction.
 * Returns null when the package has no speed limit at all.
 */
export function pppoeRateLimit(
  downloadKbps: number | null,
  uploadKbps: number | null,
): string | null {
  const dl = downloadKbps && downloadKbps > 0 ? Math.round(downloadKbps) : 0;
  const ul = uploadKbps && uploadKbps > 0 ? Math.round(uploadKbps) : 0;
  if (!dl && !ul) return null;
  const side = (k: number) => (k ? `${k}k` : "0");
  return `${side(ul)}/${side(dl)}`;
}

/** "5 Mbps", "512 kbps" or "Unlimited". */
export function formatSpeed(kbps: number | null | undefined): string {
  if (!kbps || kbps <= 0) return "Unlimited";
  if (kbps >= 1000) {
    const m = kbps / 1000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)} Mbps`;
  }
  return `${kbps} kbps`;
}

/** New expiry when renewing: counts from the current expiry if still running, otherwise from now. */
export function renewedExpiry(
  currentExpiresAt: string | null,
  value: number,
  unit: string,
  now: number = Date.now(),
): string {
  const cur = currentExpiresAt ? new Date(currentExpiresAt).getTime() : NaN;
  const base = Number.isFinite(cur) && cur > now ? cur : now;
  return expiryFrom(value, unit, base);
}

export function isExpired(expiresAt: string | null, now: number = Date.now()): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() <= now;
}

export const PPPOE_BILLING_GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// RouterOS sync script
// ---------------------------------------------------------------------------

export interface SyncCustomer {
  pppoe_username: string | null;
  pppoe_password: string | null;
  expires_at: string | null;
  router_id: string | null;
  package_id: string | null;
  static_ip?: string | null;
  data_used_bytes?: number | string | null;
}

export interface SyncPackage {
  id: string;
  download_kbps: number | null;
  upload_kbps: number | null;
  data_limit_mb?: number | null;
  unlimited?: boolean | null;
  fup_download_kbps?: number | null;
  fup_upload_kbps?: number | null;
}

export function pppoeFupExceeded(
  usedBytes: number | string | null | undefined,
  pkg: Pick<SyncPackage, "data_limit_mb" | "unlimited">,
): boolean {
  if (pkg.unlimited || !pkg.data_limit_mb || pkg.data_limit_mb <= 0) return false;
  try {
    return BigInt(String(usedBytes ?? 0)) >= BigInt(pkg.data_limit_mb) * 1_048_576n;
  } catch {
    return false;
  }
}

/**
 * RouterOS lines that make the router's PPP secrets match the platform.
 *
 *  - Each package with a speed limit gets its own PPP profile (rate-limit), created or updated in
 *    place. Clients without a limited package use the shared default profile.
 *  - Secrets are rebuilt every sync. Expired / suspended / deleted clients simply stop being
 *    emitted, so they can no longer log in.
 *  - RouterOS does NOT drop a live session when its secret disappears, so before rebuilding we
 *    remember every netgrid secret (name, profile and remote address). Afterwards, any client that
 *    is gone or whose profile/address changed has its active session removed.
 */
export function buildPppoeSyncLines(opts: {
  routerId: string;
  customers: SyncCustomer[];
  packages: SyncPackage[];
  now?: number;
  gracePeriodMs?: number;
}): string[] {
  const now = opts.now ?? Date.now();
  const graceCutoff = now - Math.max(0, opts.gracePeriodMs ?? 0);
  const pkgById = new Map(opts.packages.map((p) => [p.id, p]));

  const secrets: {
    name: string;
    password: string;
    profile: string;
    remoteAddress: string | null;
  }[] = [];
  const profiles = new Map<string, string>(); // profile name -> rate-limit

  for (const c of opts.customers) {
    if (c.router_id && c.router_id !== opts.routerId) continue;
    if (isExpired(c.expires_at, graceCutoff)) continue;
    if (!c.pppoe_username || !c.pppoe_password) continue;
    if (!SAFE.test(c.pppoe_username) || !SAFE.test(c.pppoe_password)) continue;

    let profile = DEFAULT_PPPOE_PROFILE;
    const pkg = c.package_id ? pkgById.get(c.package_id) : undefined;
    if (pkg) {
      const name = pppoeProfileName(pkg.id);
      if (name !== DEFAULT_PPPOE_PROFILE) {
        const fupEnabled =
          pppoeFupExceeded(c.data_used_bytes, pkg) &&
          !!pkg.fup_download_kbps &&
          !!pkg.fup_upload_kbps &&
          (pkg.download_kbps == null ||
            pkg.download_kbps <= 0 ||
            pkg.fup_download_kbps < pkg.download_kbps) &&
          (pkg.upload_kbps == null ||
            pkg.upload_kbps <= 0 ||
            pkg.fup_upload_kbps < pkg.upload_kbps);
        const rateLimit = fupEnabled
          ? pppoeRateLimit(pkg.fup_download_kbps ?? null, pkg.fup_upload_kbps ?? null)
          : pppoeRateLimit(pkg.download_kbps, pkg.upload_kbps);
        if (rateLimit) {
          profile = fupEnabled ? `${name}-fup` : name;
          profiles.set(profile, rateLimit);
        }
      }
    }
    const staticIp = c.static_ip;
    const octets = staticIp?.split(".");
    const remoteAddress =
      staticIp &&
      octets?.length === 4 &&
      octets.every((octet) => /^(0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255)
        ? staticIp
        : null;
    secrets.push({ name: c.pppoe_username, password: c.pppoe_password, profile, remoteAddress });
  }

  const lines: string[] = [
    "# PPPoE: remember current netgrid secrets (name|profile|remote-address) to detect changes",
    ':global ngOld [:toarray ""]',
    ":do {",
    '  :foreach s in=[/ppp secret find comment="netgrid"] do={',
    '    :set ngOld ($ngOld, ([/ppp secret get $s name] . "|" . [/ppp secret get $s profile] . "|" . [/ppp secret get $s remote-address]))',
    "  }",
    "} on-error={}",
  ];

  for (const [name, limit] of profiles) {
    lines.push(
      `:do {`,
      `  :if ([:len [/ppp profile find name="${name}"]] = 0) do={`,
      `    /ppp profile add name="${name}" local-address=10.10.0.1 remote-address=netgrid-pppoe-pool dns-server=8.8.8.8,1.1.1.1 only-one=yes rate-limit="${limit}"`,
      `  } else={ /ppp profile set [find name="${name}"] rate-limit="${limit}" }`,
      `} on-error={ :log warning "NetGrid: could not set PPPoE profile ${name}" }`,
    );
  }

  lines.push("/ppp secret", ':do { remove [find comment="netgrid"] } on-error={}');
  for (const s of secrets) {
    lines.push(
      `:do { add name="${s.name}" password="${s.password}" service=pppoe profile=${s.profile} comment="netgrid" } on-error={}`,
    );
  }

  for (const s of secrets) {
    if (!s.remoteAddress) continue;
    lines.push(
      `:do { /ppp secret set [find name="${s.name}" comment="netgrid"] remote-address=${s.remoteAddress} } on-error={}`,
    );
  }

  lines.push(
    "# PPPoE: disconnect clients that were removed, expired or changed profile/address",
    ":do {",
    "  :foreach e in=$ngOld do={",
    '    :local sep [:find $e "|"]',
    "    :local nm [:pick $e 0 $sep]",
    "    :local pf [:pick $e ($sep + 1) [:len $e]]",
    '    :local cur [/ppp secret find name=$nm comment="netgrid"]',
    "    :if ([:len $cur] = 0) do={ /ppp active remove [find name=$nm] } else={",
    '      :local sep2 [:find $e "|" ($sep + 1)]',
    "      :local oldRemote [:pick $e ($sep2 + 1) [:len $e]]",
    "      :if (([/ppp secret get $cur profile] != $pf) || ([/ppp secret get $cur remote-address] != $oldRemote)) do={ /ppp active remove [find name=$nm] }",
    "    }",
    "  }",
    "} on-error={}",
    ":set ngOld",
  );

  return lines;
}
