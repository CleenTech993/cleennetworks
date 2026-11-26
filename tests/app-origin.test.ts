import { afterEach, describe, expect, it, vi } from "vitest";
import { appOrigin } from "../src/lib/app-origin";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("appOrigin", () => {
  it("uses the current Vercel host instead of a stale Cloudflare canonical host", () => {
    vi.stubEnv("VITE_APP_CANONICAL_HOST", "cleennetworks.ochiengclinton993.workers.dev");

    expect(appOrigin("https://cleennetworks.vercel.app")).toBe("https://cleennetworks.vercel.app");
  });

  it("keeps the configured canonical host for Cloudflare deployments", () => {
    vi.stubEnv("VITE_APP_CANONICAL_HOST", "cleennetworks.ochiengclinton993.workers.dev");

    expect(appOrigin("https://cleennetworks.ochiengclinton993.workers.dev")).toBe(
      "https://cleennetworks.ochiengclinton993.workers.dev",
    );
  });
});
