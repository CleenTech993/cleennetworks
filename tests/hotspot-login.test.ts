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

  it("never lets the no-script fallback race the script (it dropped the router's login link)", () => {
    const html = buildLoginHtml(input);
    // the meta refresh exists only inside <noscript>, so it cannot fire when scripting works
    const refreshes = html.match(/<meta http-equiv="refresh"/g) ?? [];
    expect(refreshes).toHaveLength(1);
    expect(html).toMatch(/<noscript><meta http-equiv="refresh"[^>]*><\/noscript>/);
    // every path into the portal carries the router's login URL
    const links = html.match(/url=[^"]*|href="[^"]*"/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toContain("login=$(link-login-only)");
    expect(html).toContain('"&login=" + encodeURIComponent("$(link-login-only)")');
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

  it("tells the portal when the router refused a login, without reflecting any error text", () => {
    // $(if error)…$(endif) is evaluated by the router; only a fixed flag follows.
    expect(html).toContain("$(if error)&failed=1$(endif)");
    expect(html).not.toContain("$(error)");
    const links = html.match(/url=[^"]*|href="[^"]*"/g) ?? [];
    // inside an HTML attribute "&" is written "&amp;"; the browser decodes it back
    for (const l of links)
      expect(l.replace(/&amp;/g, "&")).toContain("$(if error)&failed=1$(endif)");
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

  it("install: downloads to a plain file, copies it in with /file add|set, verifies by marker, retries", () => {
    const s = routerosInstallLoginPage(a);
    expect(s).toContain(`/tool fetch url="${a.loginUrl}" dst-path=$ngTmp mode=https`);
    expect(s).toContain("/file add name=$ngFile contents=$ngBody");
    expect(s).toContain("/file set [/file find name=$ngFile] contents=$ngBody");
    expect(s).toContain(a.marker);
    expect(s).toContain("$ngTry < 3");
    expect(s).not.toContain("reset-html");
    expect(s).not.toContain("flash");
  });

  it("heal: only fetches when the marker is missing, and restores the walled garden", () => {
    const s = routerosHealLoginPage({ ...a, portalHost: "app.example.com" });
    expect(s).toContain('[:typeof [:find $ngHave "' + a.marker + '"]] = "nil"');
    expect(s).toContain("html-directory");
    expect(s).toContain("walled-garden ip add action=accept dst-host=app.example.com");
  });
});
