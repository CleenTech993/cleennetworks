import { describe, expect, it } from "vitest";
import { expiryFrom } from "../src/lib/duration";
import {
  buildHotspotLoginRedirect,
  LOGIN_RETRY_WINDOW_MS,
  parseHotspotLoginUrl,
  recallVoucher,
  rememberVoucher,
  routerLoginFailed,
  routerParams,
} from "../src/lib/hotspot-redirect";

describe("expiryFrom", () => {
  const t0 = Date.UTC(2026, 9, 24, 12, 0, 0);
  const hoursAhead = (value: number, unit: string) =>
    (new Date(expiryFrom(value, unit, t0)).getTime() - t0) / 3_600_000;

  it("understands the plural units the package form saves", () => {
    expect(hoursAhead(30, "minutes")).toBe(0.5);
    expect(hoursAhead(1, "hours")).toBe(1);
    expect(hoursAhead(2, "days")).toBe(48);
    expect(hoursAhead(1, "weeks")).toBe(168);
    expect(hoursAhead(1, "months")).toBe(720);
  });

  it("still accepts singular units and is case/space tolerant", () => {
    expect(hoursAhead(1, "hour")).toBe(1);
    expect(hoursAhead(1, " Hours ")).toBe(1);
  });

  it("falls back to days for an unknown unit (previous behaviour)", () => {
    expect(hoursAhead(1, "fortnights")).toBe(24);
  });
});

describe("hotspot login redirect", () => {
  it("accepts the router's login URL by IP or hotspot DNS name", () => {
    expect(parseHotspotLoginUrl("http://10.5.50.1/login")).not.toBeNull();
    expect(parseHotspotLoginUrl("http://hotspot.netgrid/login")).not.toBeNull();
    expect(parseHotspotLoginUrl("http://192.168.88.1/login")).not.toBeNull();
    expect(parseHotspotLoginUrl("http://172.20.0.1/login")).not.toBeNull();
  });

  it("rejects anything that could send the voucher code off the local network", () => {
    for (const bad of [
      "http://evil.example/login",
      "https://10.5.50.1/login",
      "http://10.5.50.1@evil.example/login",
      "http://user:pw@10.5.50.1/login",
      "http://8.8.8.8/login",
      "http://172.32.0.1/login",
      "http://10.5.50.1/other",
      "javascript:alert(1)",
      "not a url",
      "",
      null,
      undefined,
    ]) {
      expect(parseHotspotLoginUrl(bad as string | null | undefined)).toBeNull();
    }
  });

  it("builds a login URL using the code as username and password", () => {
    const url = new URL(buildHotspotLoginRedirect("http://10.5.50.1/login?stale=1", "ABCD234567")!);
    expect(url.origin).toBe("http://10.5.50.1");
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("username")).toBe("ABCD234567");
    expect(url.searchParams.get("password")).toBe("ABCD234567");
    expect(url.searchParams.has("stale")).toBe(false);
  });

  it("returns null when there is no safe login link", () => {
    expect(buildHotspotLoginRedirect("http://evil.example/login", "X")).toBeNull();
    expect(buildHotspotLoginRedirect(null, "X")).toBeNull();
  });
});

describe("routerParams", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
  };
  const q =
    "?router=r1&mac=AA%3ABB%3ACC%3ADD%3AEE%3A02&ip=10.5.50.20&login=http%3A%2F%2Fhotspot.netgrid%2Flogin";

  it("reads the router's parameters from the URL", () => {
    expect(routerParams(q, memory())).toEqual({
      login: "http://hotspot.netgrid/login",
      mac: "AA:BB:CC:DD:EE:02",
    });
  });

  it("still has them after the address bar loses its query string", () => {
    const store = memory();
    routerParams(q, store); // page load
    expect(routerParams("", store)).toEqual({
      login: "http://hotspot.netgrid/login",
      mac: "AA:BB:CC:DD:EE:02",
    });
  });

  it("works without storage, and when storage throws", () => {
    expect(routerParams(q, null).login).toBe("http://hotspot.netgrid/login");
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(routerParams(q, broken).login).toBe("http://hotspot.netgrid/login");
    expect(routerParams("", broken)).toEqual({ login: null, mac: null });
  });

  it("a remembered link is still validated before anything is sent to it", () => {
    const store = memory();
    routerParams("?login=http%3A%2F%2Fevil.example%2Flogin", store);
    expect(buildHotspotLoginRedirect(routerParams("", store).login, "CODE")).toBeNull();
  });
});

describe("router login retry", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
  };

  it("knows when the router sent the customer back after refusing a login", () => {
    expect(routerLoginFailed("?router=r1&login=x&failed=1")).toBe(true);
    expect(routerLoginFailed("?router=r1&login=x")).toBe(false);
    expect(routerLoginFailed("?failed=0")).toBe(false);
    expect(routerLoginFailed("")).toBe(false);
  });

  it("remembers the redeemed code, and keeps retrying only within the sync window", () => {
    const store = memory();
    rememberVoucher(store, "ABCD2345", 1_000);
    expect(recallVoucher(store, 1_000 + 60_000)).toEqual({ code: "ABCD2345", retry: true });
    expect(recallVoucher(store, 1_000 + LOGIN_RETRY_WINDOW_MS + 1)).toEqual({
      code: "ABCD2345",
      retry: false,
    });
  });

  it("forgets nothing it was never given, and ignores unsafe or broken storage", () => {
    expect(recallVoucher(memory())).toBeNull();
    expect(recallVoucher(null)).toBeNull();
    const store = memory();
    rememberVoucher(store, 'bad"code');
    expect(recallVoucher(store)).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => rememberVoucher(broken, "ABCD2345")).not.toThrow();
    expect(recallVoucher(broken)).toBeNull();
  });
});
