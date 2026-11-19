import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { h } from "./helpers/setup";

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));

import {
  loadPlatformServiceSecrets,
  savePlatformServiceSecret,
} from "@/lib/platform-service-secrets.server";

const SECRET = "daraja-consumer-secret-value";

beforeEach(() => {
  h.db = new FakeDb();
  vi.stubEnv("PLATFORM_SECRETS_KEY", "platform-secret-test-key-material");
});

afterEach(() => vi.unstubAllEnvs());

describe("platform service credentials", () => {
  it("stores encrypted values and only decrypts them server-side", async () => {
    await savePlatformServiceSecret("PLATFORM_MPESA_CONSUMER_SECRET", SECRET, "admin-id");

    const stored = h.db.rows("platform_service_secrets")[0];
    expect(stored.ciphertext).not.toContain(SECRET);
    expect(stored.last4).toBe("alue");
    expect(stored.updated_by).toBe("admin-id");
    await expect(loadPlatformServiceSecrets()).resolves.toEqual({
      PLATFORM_MPESA_CONSUMER_SECRET: SECRET,
    });
  });
});
