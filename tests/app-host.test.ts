import { afterEach, describe, expect, it, vi } from "vitest";
import { appHost } from "../src/lib/app-host.server";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("appHost", () => {
  it("uses the Vercel production host instead of a stale Cloudflare host", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("APP_CANONICAL_HOST", "cleennetworks.ochiengclinton993.workers.dev");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "cleennetworks.vercel.app");

    expect(appHost("localhost:3000")).toBe("cleennetworks.vercel.app");
  });

  it("keeps the configured Cloudflare host outside Vercel", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("APP_CANONICAL_HOST", "cleennetworks.ochiengclinton993.workers.dev");

    expect(appHost("localhost:3000")).toBe("cleennetworks.ochiengclinton993.workers.dev");
  });
});
