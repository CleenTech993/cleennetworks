import { describe, expect, it } from "vitest";
import { readOmadaPortalContext } from "../src/lib/omada-portal";
import { buildOmadaAuthorizationPayload } from "../src/lib/omada-controller.server";

describe("Omada external-portal parameters", () => {
  it("parses EAP connection details and a safe landing page", () => {
    const query = new URLSearchParams({
      clientMac: "aa-bb-cc-dd-ee-02",
      apMac: "aa-bb-cc-dd-ee-04",
      ssidName: "Guest Wi-Fi",
      radioId: "1",
      site: "Main Site",
      t: "1783570000000000",
      redirectUrl: "https://example.com/welcome",
    });

    expect(readOmadaPortalContext(`?${query}`)).toEqual({
      kind: "eap",
      clientMac: "AA:BB:CC:DD:EE:02",
      apMac: "AA:BB:CC:DD:EE:04",
      ssidName: "Guest Wi-Fi",
      radioId: "1",
      siteName: "Main Site",
      redirectUrl: "https://example.com/welcome",
    });
  });

  it("parses wired gateway context and rejects an invalid VLAN", () => {
    const valid = new URLSearchParams({
      clientMac: "02:00:00:00:00:02",
      gatewayMac: "02:00:00:00:00:04",
      vid: "4094",
      site: "Wired",
    });
    const invalid = new URLSearchParams({ ...Object.fromEntries(valid), vid: "4095" });

    expect(readOmadaPortalContext(`?${valid}`)).toMatchObject({
      kind: "gateway",
      clientMac: "02:00:00:00:00:02",
      gatewayMac: "02:00:00:00:00:04",
      vlanId: "4094",
      siteName: "Wired",
    });
    expect(readOmadaPortalContext(`?${invalid}`)).toBeNull();
  });

  it("does not accept malformed EAP context or unsafe landing URLs", () => {
    const badRadio = new URLSearchParams({
      clientMac: "02:00:00:00:00:02",
      apMac: "02:00:00:00:00:04",
      ssidName: "Guest",
      radioId: "2",
      site: "Main",
    });
    const unsafeRedirect = new URLSearchParams({
      clientMac: "02:00:00:00:00:02",
      apMac: "02:00:00:00:00:04",
      ssidName: "Guest",
      radioId: "0",
      site: "Main",
      redirectUrl: "javascript:alert(1)",
    });

    expect(readOmadaPortalContext(`?${badRadio}`)).toBeNull();
    expect(readOmadaPortalContext(`?${unsafeRedirect}`)?.redirectUrl).toBeNull();
  });
});

describe("Omada authorization request payload", () => {
  it("uses the documented EAP fields and expiration microseconds", () => {
    expect(
      buildOmadaAuthorizationPayload(
        {
          kind: "eap",
          clientMac: "02:00:00:00:00:02",
          apMac: "02:00:00:00:00:04",
          ssidName: "Guest",
          radioId: "0",
          siteName: "Main",
        },
        3_600_000_000,
      ),
    ).toEqual({
      clientMac: "02:00:00:00:00:02",
      apMac: "02:00:00:00:00:04",
      ssidName: "Guest",
      radioId: "0",
      site: "Main",
      time: 3_600_000_000,
      authType: 4,
    });
  });

  it("uses the documented Gateway fields", () => {
    expect(
      buildOmadaAuthorizationPayload(
        {
          kind: "gateway",
          clientMac: "02:00:00:00:00:02",
          gatewayMac: "02:00:00:00:00:04",
          vlanId: "32",
          siteName: "Wired",
        },
        90_000_000,
      ),
    ).toEqual({
      clientMac: "02:00:00:00:00:02",
      gatewayMac: "02:00:00:00:00:04",
      vid: "32",
      site: "Wired",
      time: 90_000_000,
      authType: 4,
    });
  });
});
