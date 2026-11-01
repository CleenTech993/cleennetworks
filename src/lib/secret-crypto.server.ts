const SALT = new TextEncoder().encode("netgrid/platform-secrets/v1");

const b64u = {
  enc(bytes: Uint8Array): string {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  dec(s: string): Uint8Array {
    const pad = "=".repeat((4 - (s.length % 4)) % 4);
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
};

async function deriveKey(name: string, ikm: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(ikm), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: SALT, info: new TextEncoder().encode(name) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function keyMaterial(): string {
  const material = process.env["PLATFORM_SECRETS_KEY"] || process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!material) throw new Error("No encryption key material available on the server.");
  return material;
}

/** "v1.<iv>.<ciphertext+tag>", all base64url. `ikm` is only passed by tests. */
export async function encryptSecret(
  name: string,
  plaintext: string,
  ikm = keyMaterial(),
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(name) },
    await deriveKey(name, ikm),
    new TextEncoder().encode(plaintext),
  );
  return `v1.${b64u.enc(iv)}.${b64u.enc(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(
  name: string,
  stored: string,
  ikm = keyMaterial(),
): Promise<string> {
  const [version, iv, ciphertext] = stored.split(".");
  if (version !== "v1" || !iv || !ciphertext) throw new Error("Unrecognised secret format.");
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: b64u.dec(iv) as BufferSource,
      additionalData: new TextEncoder().encode(name),
    },
    await deriveKey(name, ikm),
    b64u.dec(ciphertext) as BufferSource,
  );
  return new TextDecoder().decode(plaintext);
}
