import { describe, expect, it } from "vitest";
import { assertSupportedOmadaVersion } from "../src/lib/omada-controller.server";

describe("Omada Controller version gate", () => {
  it.each(["5.0.15", "5.11.0", "6.0.0", "6.2.0"])("accepts documented version %s", (version) => {
    expect(() => assertSupportedOmadaVersion(version)).not.toThrow();
  });

  it.each(["5.0.14", "4.9.9", "6.2.1", "6.2.10", "invalid"])(
    "rejects unsupported version %s",
    (version) => {
      expect(() => assertSupportedOmadaVersion(version)).toThrow();
    },
  );
});
