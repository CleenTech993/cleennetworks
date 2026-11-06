import { describe, expect, it, vi } from "vitest";
import {
  capabilityStatus,
  classifyVendorFailure,
  executeWithOfficialFallback,
  resolveManagementMethod,
  withVendorRetry,
} from "@/lib/device-management";

describe("vendor management policy", () => {
  it("uses only configured, implemented, official methods in the per-vendor order", () => {
    const result = resolveManagementMethod({
      vendor: "ruijie_reyee",
      family: "RG-EAP",
      methods: [
        {
          method: "ruijie_cloud_api",
          officiallySupported: true,
          implemented: false,
          configured: true,
          reachable: true,
        },
        {
          method: "local_connector",
          officiallySupported: true,
          implemented: true,
          configured: true,
          reachable: true,
        },
        {
          method: "ruijie_local_api",
          officiallySupported: false,
          implemented: true,
          configured: true,
          reachable: true,
        },
      ],
      overrides: { "ruijie_reyee:rg-eap": ["ruijie_cloud_api", "local_connector", "ruijie_local_api"] },
    });

    expect(result).toEqual({ method: "local_connector", status: "online" });
  });

  it("does not fall back after an authentication failure", () => {
    const result = resolveManagementMethod({
      vendor: "tp_link_omada",
      family: "EAP",
      methods: [
        {
          method: "omada_controller_api",
          officiallySupported: true,
          implemented: true,
          configured: true,
          reachable: true,
          authenticated: false,
        },
        {
          method: "local_connector",
          officiallySupported: true,
          implemented: true,
          configured: true,
          reachable: true,
          authenticated: true,
        },
      ],
    });

    expect(result).toEqual({ method: "omada_controller_api", status: "authentication_failed" });
  });

  it.each([
    [{ status: 401 }, "authentication"],
    [{ status: 403 }, "authentication"],
    [{ status: 404 }, "fatal"],
    [{ status: 405 }, "unsupported"],
    [{ status: 429 }, "transient"],
    [{ status: 503 }, "transient"],
    [{ status: 404, code: "unsupported_endpoint" }, "unsupported"],
    [{ status: 400 }, "fatal"],
    [new TypeError("fetch failed"), "transient"],
    [new Error("unexpected serializer bug"), "fatal"],
  ] as const)("classifies vendor error %j", (error, expected) => {
    expect(classifyVendorFailure(error)).toBe(expected);
  });

  it("retries transient errors with exponential backoff and honors Retry-After", async () => {
    const sleep = vi.fn(async () => {});
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ status: 429, retryAfterMs: 700 })
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValue("connected");

    await expect(
      withVendorRetry(operation, {
        attempts: 4,
        baseDelayMs: 200,
        maxDelayMs: 1000,
        sleep,
        random: () => 0.5,
      }),
    ).resolves.toBe("connected");
    expect(sleep).toHaveBeenNthCalledWith(1, 700);
    expect(sleep).toHaveBeenNthCalledWith(2, 300);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("never retries invalid credentials or unsupported endpoints", async () => {
    const sleep = vi.fn(async () => {});
    const operation = vi.fn(async () => {
      throw { status: 401 };
    });

    await expect(withVendorRetry(operation, { sleep })).rejects.toMatchObject({ status: 401 });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("falls back from an unsupported official endpoint only to an official configured adapter", async () => {
    const localConnector = vi.fn(async () => "configured");
    const undocumented = vi.fn(async () => "must not run");
    const result = await executeWithOfficialFallback({
      order: ["ruijie_cloud_api", "local_connector", "ruijie_local_api"],
      adapters: [
        {
          method: "ruijie_cloud_api",
          officiallySupported: true,
          implemented: true,
          configured: true,
          reachable: true,
          execute: async () => {
            throw { status: 405 };
          },
        },
        {
          method: "local_connector",
          officiallySupported: true,
          implemented: true,
          configured: true,
          reachable: true,
          execute: localConnector,
        },
        {
          method: "ruijie_local_api",
          officiallySupported: false,
          implemented: true,
          configured: true,
          reachable: true,
          execute: undocumented,
        },
      ],
      retry: { attempts: 1 },
    });

    expect(result).toEqual({ method: "local_connector", value: "configured" });
    expect(localConnector).toHaveBeenCalledOnce();
    expect(undocumented).not.toHaveBeenCalled();
  });

  it("does not fall back after credentials are rejected", async () => {
    const fallback = vi.fn(async () => "should not run");
    await expect(
      executeWithOfficialFallback({
        order: ["omada_controller_api", "local_connector"],
        adapters: [
          {
            method: "omada_controller_api",
            officiallySupported: true,
            implemented: true,
            configured: true,
            reachable: true,
            execute: async () => {
              throw { status: 401 };
            },
          },
          {
            method: "local_connector",
            officiallySupported: true,
            implemented: true,
            configured: true,
            reachable: true,
            execute: fallback,
          },
        ],
        retry: { attempts: 1 },
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("marks partial capability sets explicitly", () => {
    expect(capabilityStatus(["ssid.configure", "guest-portal.configure"], ["ssid.configure"])).toBe(
      "partially_supported",
    );
    expect(capabilityStatus(["ssid.configure"], ["ssid.configure"])).toBe("online");
    expect(capabilityStatus(["ssid.configure"], ["ssid.configure"], true)).toBe(
      "successfully_provisioned",
    );
  });
});