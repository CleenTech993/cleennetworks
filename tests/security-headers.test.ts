import { describe, expect, it } from "vitest";
import { withSecurityHeaders } from "../src/lib/security-headers";

describe("withSecurityHeaders", () => {
  it("adds baseline browser security headers and preserves response content", async () => {
    const response = withSecurityHeaders(
      new Response("Not found", {
        status: 404,
        headers: { "content-type": "text/plain", "cache-control": "no-store" },
      }),
      "https://netgrid.example/missing",
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("text/plain");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("permissions-policy")).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000");
    await expect(response.text()).resolves.toBe("Not found");
  });

  it("does not enable HSTS for an HTTP request", () => {
    const response = withSecurityHeaders(new Response("OK"), "http://localhost:3000/");
    expect(response.headers.get("strict-transport-security")).toBeNull();
  });

  it("preserves existing response headers", () => {
    const response = withSecurityHeaders(
      new Response(null, { headers: { "set-cookie": "session=abc; HttpOnly; Secure" } }),
      "https://netgrid.example/",
    );
    expect(response.headers.get("set-cookie")).toContain("session=abc");
  });
});
