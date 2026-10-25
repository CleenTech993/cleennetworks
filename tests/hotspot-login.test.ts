import { describe, expect, it } from "vitest";
import {
  buildLoginHtml,
  loginPageMarker,
  routerosHealLoginPage,
  routerosInstallLoginPage,
} from "../src/lib/hotspot-login.server";

const input = {
  portalUrl: "https://app.example.com/p/my-isp",
  routerId: "11111111-2222-3333-4444-555555555555",
};

describe("hotspot login page", () => {
  const html = buildLoginHtml(input);

  it("redirects to the portal tagged with the router id", () => {
    expect(html).toContain(`router=${input.routerId}`);
    expect(html).toContain("https://app.example.com/p/my-isp?router=");
  });

  it("leaves MikroTik hotspot variables for the router to substitute", () => {
    for (const v of ["$(mac)", "$(ip)", "$(link-login-only)"]) expect(html).toContain(v);
  });

  it("embeds the marker the router uses to detect stale/missing pages", () => {
    expect(html).toContain(`<meta name="generator" content="${loginPageMarker(input)}">`);
  });

  it("marker changes with router, portal URL, and is stable otherwise", () => {
    expect(loginPageMarker(input)).toBe(loginPageMarker({ ...input }));
    expect(loginPageMarker(input)).not.toBe(loginPageMarker({ ...input, routerId: "other" }));
    expect(loginPageMarker(input)).not.toBe(
      loginPageMarker({ ...input, portalUrl: "https://x.test/p/y" }),
    );
  });

  it("cannot be broken out of by a hostile portal URL", () => {
    const evil = buildLoginHtml({
      portalUrl: 'https://a.test/p/x"</script><script>alert(1)</script>',
      routerId: "r",
    });
    expect(evil).not.toContain("</script><script>alert(1)");
    expect(evil).not.toContain('x"</script>');
  });
});

describe("RouterOS snippets", () => {
  const a = {
    loginUrl: "https://app.example.com/api/public/provision/TOK/login.html",
    marker: loginPageMarker(input),
  };

  it("install: downloads, verifies by marker, retries, never uses /file add", () => {
    const s = routerosInstallLoginPage(a);
    expect(s).toContain(`/tool fetch url="${a.loginUrl}" dst-path=$ngFile mode=https`);
    expect(s).toContain(a.marker);
    expect(s).toContain("$ngTry < 3");
    expect(s).not.toContain("/file add");
  });

  it("heal: only fetches when the marker is missing, and restores the walled garden", () => {
    const s = routerosHealLoginPage({ ...a, portalHost: "app.example.com" });
    expect(s).toContain('[:typeof [:find $ngHave "' + a.marker + '"]] = "nil"');
    expect(s).toContain("html-directory");
    expect(s).toContain("walled-garden ip add action=accept dst-host=app.example.com");
  });
});
