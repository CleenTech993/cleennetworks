import { z } from "zod";

const COOKIE_NAME = "cleen_pppoe_portal";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const SESSION_PATH = "/api/public/pppoe-portal/";
const SessionSchema = z.object({
  customerId: z.string().uuid(),
  tenantId: z.string().uuid(),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  expiresAt: z.number().int(),
});

export type PppoePortalSession = z.infer<typeof SessionSchema>;

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecodeBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function base64UrlEncode(value: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlDecode(value: string): string {
  return new TextDecoder().decode(base64UrlDecodeBytes(value));
}

async function signingKey(): Promise<CryptoKey> {
  const secret = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!secret) throw new Error("PPPoE portal sessions are not configured.");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function cookiePath(slug: string): string {
  return `${SESSION_PATH}${encodeURIComponent(slug)}/`;
}

export async function createPppoePortalCookie(
  customerId: string,
  tenantId: string,
  slug: string,
): Promise<string> {
  const session: PppoePortalSession = {
    customerId,
    tenantId,
    slug,
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const payload = base64UrlEncode(JSON.stringify(session));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(),
    new TextEncoder().encode(payload),
  );
  const token = `${payload}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
  return `${COOKIE_NAME}=${token}; Path=${cookiePath(slug)}; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearPppoePortalCookie(slug: string): string {
  return `${COOKIE_NAME}=; Path=${cookiePath(slug)}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export async function readPppoePortalSession(
  request: Request,
  slug: string,
): Promise<PppoePortalSession | null> {
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);
  if (!cookie) return null;

  const separator = cookie.lastIndexOf(".");
  if (separator <= 0) return null;
  const payload = cookie.slice(0, separator);
  let signature: Uint8Array;
  let session: unknown;
  try {
    signature = base64UrlDecodeBytes(cookie.slice(separator + 1));
    session = JSON.parse(base64UrlDecode(payload));
  } catch {
    return null;
  }
  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(),
    signature,
    new TextEncoder().encode(payload),
  );
  if (!valid) return null;

  const parsed = SessionSchema.safeParse(session);
  if (
    !parsed.success ||
    parsed.data.slug !== slug ||
    parsed.data.expiresAt <= Math.floor(Date.now() / 1000)
  ) {
    return null;
  }
  return parsed.data;
}

export async function passwordMatches(
  supplied: string,
  stored: string | null | undefined,
): Promise<boolean> {
  const [suppliedDigest, storedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(supplied)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(stored ?? "invalid-pppoe-password")),
  ]);
  const suppliedBytes = new Uint8Array(suppliedDigest);
  const storedBytes = new Uint8Array(storedDigest);
  let difference = stored ? 0 : 1;
  for (let i = 0; i < suppliedBytes.length; i++) difference |= suppliedBytes[i] ^ storedBytes[i];
  return difference === 0;
}

export async function pppoePortalUsernameHash(username: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(username.trim().toLowerCase()),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
