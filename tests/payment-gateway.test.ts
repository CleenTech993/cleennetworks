// Which gateway checkouts use: IntaSend is the default, with a fallback to whichever is configured.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => ({}) } }));

import { resolveProvider } from "../src/lib/payment-gateway.server";

const INTASEND = { INTASEND_SECRET_KEY: "ISSecretKey_test_abc" };
const PAYHERO = { PAYHERO_API_USERNAME: "u", PAYHERO_API_PASSWORD: "p", PAYHERO_CHANNEL_ID: "42" };
const KEYS = [...Object.keys(INTASEND), ...Object.keys(PAYHERO)];

const configure = (...sets: Record<string, string>[]) => Object.assign(process.env, ...sets);

beforeEach(() => {
  for (const k of KEYS) delete process.env[k];
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("resolveProvider", () => {
  it("uses IntaSend by default (no setting, unknown setting, or IntaSend selected)", () => {
    configure(INTASEND, PAYHERO);
    for (const active_provider of [undefined, null, "", "intasend", "something-else"]) {
      expect(resolveProvider({ active_provider: active_provider as string })).toBe("intasend");
    }
  });

  it("uses PayHero only when it is explicitly selected", () => {
    configure(INTASEND, PAYHERO);
    expect(resolveProvider({ active_provider: "payhero" })).toBe("payhero");
  });

  it("falls back to PayHero while IntaSend has no secret key yet, so checkouts keep working", () => {
    configure(PAYHERO);
    expect(resolveProvider({ active_provider: "intasend" })).toBe("payhero");
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it("falls back to IntaSend if PayHero is selected but has no secrets", () => {
    configure(INTASEND);
    expect(resolveProvider({ active_provider: "payhero" })).toBe("intasend");
  });

  it("does not warn when the selected gateway is configured", () => {
    configure(INTASEND);
    resolveProvider({ active_provider: "intasend" });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("fails only when neither gateway is configured", () => {
    expect(() => resolveProvider({ active_provider: "intasend" })).toThrow(
      "Payment gateway is not configured.",
    );
    configure({ PAYHERO_API_USERNAME: "u" }); // incomplete PayHero secrets do not count
    expect(() => resolveProvider({ active_provider: "payhero" })).toThrow(
      "Payment gateway is not configured.",
    );
  });
});
