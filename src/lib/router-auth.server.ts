// Authentication for the MikroTik-facing endpoints. Server-only.
//
// Two credentials, deliberately separate:
//   * bootstrap token  routers.provision_token (24h). Pasted into a terminal; can ONLY fetch router.rsc.
//   * device token     random, minted when router.rsc is fetched and baked into the router's scheduled
//                      URLs (heartbeat / sync / interfaces / login page). Stored hashed in
//                      router_credentials, which clients cannot read.
// Routers provisioned before this existed carry the bootstrap token in their schedulers; they keep
// working while routers.legacy_token_auth is true and switch over when they are re-provisioned.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { clientIp, rateLimit, rateLimitExceeded } from "./rate-limit.server";

// Old tokens were 32 hex chars; new ones are longer. Anything else cannot be valid, so skip the DB.
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;
/** Failed lookups allowed per IP per minute before we stop answering (best effort, per instance). */
export const TOKEN_MISS_LIMIT = 30;
const TOKEN_MISS_WINDOW_MS = 60_000;

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 256 bits from the CSPRNG, base64url (43 chars). */
export function mintDeviceToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * True when a database error says a table or column does not exist, i.e. the code was deployed
 * before the migration that creates it. Used to fall back to the previous behaviour instead of
 * locking every router out.
 */
export function isMissingSchema(message: string | null | undefined): boolean {
  return /schema cache|does not exist|could not find the .*(table|column)/i.test(message ?? "");
}

export interface AuthedRouter {
  id: string;
  tenant_id: string;
  name: string;
  last_heartbeat_at: string | null;
  last_seen_at: string | null;
  via: "device" | "legacy";
}
export type RouterAuth = { ok: true; router: AuthedRouter } | { ok: false; blocked: boolean };

const ROUTER_COLS = "id,tenant_id,name,last_heartbeat_at,last_seen_at";

/** Device endpoints: heartbeat, sync, interfaces, login.html. */
export async function authenticateRouter(request: Request, token: string): Promise<RouterAuth> {
  const missKey = `rtoken-miss:${clientIp(request)}`;
  if (rateLimitExceeded(missKey, TOKEN_MISS_LIMIT)) return { ok: false, blocked: true };
  const miss = (): RouterAuth => {
    rateLimit(missKey, TOKEN_MISS_LIMIT, TOKEN_MISS_WINDOW_MS);
    return { ok: false, blocked: false };
  };
  if (!TOKEN_RE.test(token)) return miss();

  const { data: cred } = await supabaseAdmin
    .from("router_credentials")
    .select("router_id")
    .eq("token_hash", await sha256Hex(token))
    .maybeSingle();
  if (cred) {
    const { data: router } = await supabaseAdmin
      .from("routers")
      .select(ROUTER_COLS)
      .eq("id", cred.router_id)
      .maybeSingle();
    if (router) return { ok: true, router: { ...router, via: "device" } };
  }

  let { data: legacy, error: legacyError } = await supabaseAdmin
    .from("routers")
    .select(ROUTER_COLS)
    .eq("provision_token", token)
    .eq("legacy_token_auth", true)
    .maybeSingle();
  if (legacyError && isMissingSchema(legacyError.message)) {
    // The router_credentials migration is not applied yet, so routers.legacy_token_auth does not
    // exist. Routers set up before it still carry provision_token in their schedulers: keep them
    // working (exactly as they did before the migration) rather than answering 404 to all of them.
    console.error(`router auth: ${legacyError.message}; apply migration 20261025010000_router_credentials.sql`);
    ({ data: legacy } = await supabaseAdmin
      .from("routers")
      .select(ROUTER_COLS)
      .eq("provision_token", token)
      .maybeSingle());
  }
  if (legacy) {
    console.warn(`router ${legacy.id} authenticated with a legacy token; it needs re-provisioning`);
    return { ok: true, router: { ...legacy, via: "legacy" } };
  }
  return miss();
}

export type BootstrapAuth =
  | { ok: true; router: { id: string; name: string; tenant_id: string } }
  | { ok: false; blocked: boolean; expired: boolean };

/** router.rsc: the 24h bootstrap token. */
export async function authenticateBootstrap(
  request: Request,
  token: string,
): Promise<BootstrapAuth> {
  const missKey = `rtoken-miss:${clientIp(request)}`;
  if (rateLimitExceeded(missKey, TOKEN_MISS_LIMIT))
    return { ok: false, blocked: true, expired: false };
  const miss = (): BootstrapAuth => {
    rateLimit(missKey, TOKEN_MISS_LIMIT, TOKEN_MISS_WINDOW_MS);
    return { ok: false, blocked: false, expired: false };
  };
  if (!TOKEN_RE.test(token)) return miss();

  const { data: router } = await supabaseAdmin
    .from("routers")
    .select("id,name,tenant_id,provision_token_expires_at")
    .eq("provision_token", token)
    .maybeSingle();
  if (!router) return miss();
  if (
    router.provision_token_expires_at &&
    new Date(router.provision_token_expires_at).getTime() <= Date.now()
  ) {
    return { ok: false, blocked: false, expired: true };
  }
  return { ok: true, router: { id: router.id, name: router.name, tenant_id: router.tenant_id } };
}

/**
 * Mint a fresh device token for a router, replacing any previous one (which stops working at once),
 * and retire legacy auth for it. Returns the plaintext token, which exists nowhere else.
 */
export async function issueDeviceToken(routerId: string): Promise<string> {
  const token = mintDeviceToken();
  const { error } = await supabaseAdmin.from("router_credentials").upsert(
    {
      router_id: routerId,
      token_hash: await sha256Hex(token),
      created_at: new Date().toISOString(),
    },
    { onConflict: "router_id" },
  );
  if (error) throw new Error(`could not store device credential: ${error.message}`);
  const { error: legacyErr } = await supabaseAdmin
    .from("routers")
    .update({ legacy_token_auth: false })
    .eq("id", routerId);
  if (legacyErr) throw new Error(`could not retire legacy auth: ${legacyErr.message}`);
  return token;
}
