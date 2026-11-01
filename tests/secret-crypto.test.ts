import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto.server";

const KEY = "tenant-secret-test-value";
const IKM = "test-key-material-aaaaaaaaaaaaaaaa";

describe("encrypted service credentials", () => {
  it("round-trips ciphertext without storing the plaintext", async () => {
    const stored = await encryptSecret("tenant:tenant-id:MPESA_PASSKEY", KEY, IKM);
    expect(stored).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(stored).not.toContain(KEY);
    await expect(decryptSecret("tenant:tenant-id:MPESA_PASSKEY", stored, IKM)).resolves.toBe(KEY);
  });

  it("uses a fresh IV for each encryption", async () => {
    const first = await encryptSecret("tenant:tenant-id:MPESA_PASSKEY", KEY, IKM);
    const second = await encryptSecret("tenant:tenant-id:MPESA_PASSKEY", KEY, IKM);
    expect(first).not.toBe(second);
  });

  it("authenticates the credential name and tenant context", async () => {
    const stored = await encryptSecret("tenant:tenant-id:MPESA_PASSKEY", KEY, IKM);
    await expect(
      decryptSecret("tenant:another-tenant:MPESA_PASSKEY", stored, IKM),
    ).rejects.toThrow();
    await expect(
      decryptSecret("tenant:tenant-id:MPESA_CONSUMER_SECRET", stored, IKM),
    ).rejects.toThrow();
  });

  it("rejects tampered values, unsupported versions, and a different key", async () => {
    const stored = await encryptSecret("tenant:tenant-id:MPESA_PASSKEY", KEY, IKM);
    const [version, iv, ciphertext] = stored.split(".");
    const changedSuffix = ciphertext.endsWith("AA") ? "AB" : "AA";
    const modified = `${version}.${iv}.${ciphertext.slice(0, -2)}${changedSuffix}`;
    await expect(decryptSecret("tenant:tenant-id:MPESA_PASSKEY", modified, IKM)).rejects.toThrow();
    await expect(decryptSecret("tenant:tenant-id:MPESA_PASSKEY", "v2.a.b", IKM)).rejects.toThrow();
    await expect(
      decryptSecret("tenant:tenant-id:MPESA_PASSKEY", stored, "different-key-material"),
    ).rejects.toThrow();
  });
});
