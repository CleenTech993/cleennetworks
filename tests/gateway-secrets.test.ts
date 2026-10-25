// IntaSend credentials entered on the Super admin dashboard: stored encrypted, readable by the server only,
// dashboard value wins over the environment, and the app keeps working if the store misbehaves.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-supabase";
import { h } from "./helpers/setup";

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return h.db;
  },
}));

import {
  decryptSecret,
  deleteGatewaySecret,
  encryptSecret,
  gatewaySecret,
  gatewaySecretStatus,
  loadGatewaySecrets,
  resetGatewaySecretCache,
  saveGatewaySecret,
} from "@/lib/gateway-secrets.server";

const KEY = "ISSecretKey_test_0123456789abcdef";
const CHAL = "a-long-shared-challenge-123";
const USER = "99999999-0000-0000-0000-000000000001";
const IKM = "test-key-material-aaaaaaaaaaaaaaaa";

const rows = () => h.db.rows("platform_gateway_secrets");

beforeEach(() => {
  h.db = new FakeDb().seed("platform_gateway_secrets", []);
  resetGatewaySecretCache();
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = IKM;
  delete process.env["PLATFORM_SECRETS_KEY"];
  delete process.env["INTASEND_SECRET_KEY"];
  delete process.env["INTASEND_WEBHOOK_CHALLENGE"];
});
afterEach(() => vi.restoreAllMocks());

describe("encryption", () => {
  it("round-trips and never contains the plaintext", async () => {
    const stored = await encryptSecret("INTASEND_SECRET_KEY", KEY, IKM);
    expect(stored).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(stored).not.toContain(KEY);
    expect(stored).not.toContain("0123456789abcdef");
    expect(await decryptSecret("INTASEND_SECRET_KEY", stored, IKM)).toBe(KEY);
  });

  it("uses a fresh IV every time", async () => {
    const a = await encryptSecret("INTASEND_SECRET_KEY", KEY, IKM);
    const b = await encryptSecret("INTASEND_SECRET_KEY", KEY, IKM);
    expect(a).not.toBe(b);
  });

  it("fails with the wrong key material", async () => {
    const stored = await encryptSecret("INTASEND_SECRET_KEY", KEY, IKM);
    await expect(
      decryptSecret("INTASEND_SECRET_KEY", stored, "some-other-key-material-bbbbbbbb"),
    ).rejects.toThrow();
  });

  it("cannot be moved onto another row (name is authenticated)", async () => {
    const stored = await encryptSecret("INTASEND_SECRET_KEY", KEY, IKM);
    await expect(decryptSecret("INTASEND_WEBHOOK_CHALLENGE", stored, IKM)).rejects.toThrow();
  });

  it("detects tampering and bad formats", async () => {
    const stored = await encryptSecret("INTASEND_SECRET_KEY", KEY, IKM);
    const [v, iv, ct] = stored.split(".");
    const flipped = ct.slice(0, -2) + (ct.endsWith("AA") ? "BB" : "AA");
    await expect(
      decryptSecret("INTASEND_SECRET_KEY", `${v}.${iv}.${flipped}`, IKM),
    ).rejects.toThrow();
    await expect(decryptSecret("INTASEND_SECRET_KEY", "garbage", IKM)).rejects.toThrow();
    await expect(decryptSecret("INTASEND_SECRET_KEY", "v2.a.b", IKM)).rejects.toThrow();
  });
});

describe("saving and loading", () => {
  it("stores only ciphertext and the last 4 characters", async () => {
    await saveGatewaySecret("INTASEND_SECRET_KEY", KEY, USER);
    expect(rows()).toHaveLength(1);
    const row = rows()[0];
    expect(row.name).toBe("INTASEND_SECRET_KEY");
    expect(row.last4).toBe("cdef");
    expect(row.updated_by).toBe(USER);
    expect(JSON.stringify(row)).not.toContain(KEY);
    expect(JSON.stringify(h.db.tables)).not.toContain("0123456789abcdef");
  });

  it("makes the saved value available to the server", async () => {
    await saveGatewaySecret("INTASEND_SECRET_KEY", KEY, USER);
    expect(gatewaySecret("INTASEND_SECRET_KEY")).toBe(KEY);
    expect(gatewaySecretStatus("INTASEND_SECRET_KEY")).toMatchObject({
      set: true,
      source: "dashboard",
      last4: "cdef",
      needsReentry: false,
    });
  });

  it("saving again replaces the value instead of adding a row", async () => {
    await saveGatewaySecret("INTASEND_WEBHOOK_CHALLENGE", CHAL, USER);
    await saveGatewaySecret("INTASEND_WEBHOOK_CHALLENGE", "second-challenge-value-9", USER);
    expect(rows()).toHaveLength(1);
    expect(gatewaySecret("INTASEND_WEBHOOK_CHALLENGE")).toBe("second-challenge-value-9");
  });

  it("is picked up by another server instance after a reload", async () => {
    await saveGatewaySecret("INTASEND_SECRET_KEY", KEY, USER);
    resetGatewaySecretCache(); // a different instance with a cold cache
    expect(gatewaySecret("INTASEND_SECRET_KEY")).toBeUndefined();
    await loadGatewaySecrets();
    expect(gatewaySecret("INTASEND_SECRET_KEY")).toBe(KEY);
  });
});

describe("dashboard vs environment", () => {
  it("falls back to the environment variable when nothing is saved", async () => {
    process.env["INTASEND_SECRET_KEY"] = "ISSecretKey_live_fromenvironment99";
    await loadGatewaySecrets({ force: true });
    expect(gatewaySecret("INTASEND_SECRET_KEY")).toBe("ISSecretKey_live_fromenvironment99");
    expect(gatewaySecretStatus("INTASEND_SECRET_KEY")).toMatchObject({
      set: true,
      source: "environment",
      last4: "nt99",
    });
  });

  it("a saved dashboard value wins over the environment", async () => {
    process.env["INTASEND_SECRET_KEY"] = "ISSecretKey_live_fromenvironment99";
    await saveGatewaySecret("INTASEND_SECRET_KEY", KEY, USER);
    expect(gatewaySecret("INTASEND_SECRET_KEY")).toBe(KEY);
    expect(gatewaySecretStatus("INTASEND_SECRET_KEY").source).toBe("dashboard");
  });

  it("removing the dashboard value hands back to the environment", async () => {
    process.env["INTASEND_SECRET_KEY"] = "ISSecretKey_live_fromenvironment99";
    await saveGatewaySecret("INTASEND_SECRET_KEY", KEY, USER);
    await deleteGatewaySecret("INTASEND_SECRET_KEY");
    expect(rows()).toHaveLength(0);
    expect(gatewaySecret("INTASEND_SECRET_KEY")).toBe("ISSecretKey_live_fromenvironment99");
    expect(gatewaySecretStatus("INTASEND_SECRET_KEY").source).toBe("environment");
  });

  it("reports not set when neither exists", async () => {
    await loadGatewaySecrets({ force: true });
    expect(gatewaySecret("INTASEND_SECRET_KEY")).toBeUndefined();
    expect(gatewaySecretStatus("INTASEND_SECRET_KEY")).toMatchObject({
      set: false,
      source: null,
      last4: null,
    });
  });

  it("PLATFORM_SECRETS_KEY takes precedence as key material", async () => {
    process.env["PLATFORM_SECRETS_KEY"] = "dedicated-key-material-cccccccccccc";
    await saveGatewaySecret("INTASEND_SECRET_KEY", KEY, USER);
    expect(
      await decryptSecret(
        "INTASEND_SECRET_KEY",
        rows()[0].ciphertext as string,
        "dedicated-key-material-cccccccccccc",
      ),
    ).toBe(KEY);
    await expect(
      decryptSecret("INTASEND_SECRET_KEY", rows()[0].ciphertext as string, IKM),
    ).rejects.toThrow();
  });
});

describe("failure handling", () => {
  it("never throws if the store is unavailable, and keeps using the environment", async () => {
    process.env["INTASEND_SECRET_KEY"] = "ISSecretKey_live_fromenvironment99";
    h.db = {
      from() {
        throw new Error("relation does not exist");
      },
    } as unknown as FakeDb;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(loadGatewaySecrets({ force: true })).resolves.toBeUndefined();
    expect(gatewaySecret("INTASEND_SECRET_KEY")).toBe("ISSecretKey_live_fromenvironment99");
  });

  it("flags an unreadable value for re-entry and falls back to the environment", async () => {
    process.env["INTASEND_SECRET_KEY"] = "ISSecretKey_live_fromenvironment99";
    await saveGatewaySecret("INTASEND_SECRET_KEY", KEY, USER);
    process.env["SUPABASE_SERVICE_ROLE_KEY"] = "rotated-service-key-dddddddddddddddd"; // key material changed
    vi.spyOn(console, "error").mockImplementation(() => {});
    await loadGatewaySecrets({ force: true });
    expect(gatewaySecret("INTASEND_SECRET_KEY")).toBe("ISSecretKey_live_fromenvironment99");
    expect(gatewaySecretStatus("INTASEND_SECRET_KEY")).toMatchObject({
      needsReentry: true,
      source: "environment",
    });
  });

  it("ignores rows with an unknown name", async () => {
    h.db = new FakeDb().seed("platform_gateway_secrets", [
      {
        name: "SOMETHING_ELSE",
        ciphertext: "v1.a.b",
        last4: "xxxx",
        updated_at: new Date().toISOString(),
      },
    ]);
    await loadGatewaySecrets({ force: true });
    expect(gatewaySecret("INTASEND_SECRET_KEY")).toBeUndefined();
  });
});
