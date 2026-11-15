import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAal2 } from "../src/lib/aal";

const mockAuth = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUser: vi.fn(),
  mfa: {
    listFactors: vi.fn(),
    getAuthenticatorAssuranceLevel: vi.fn(),
  },
}));
const mockFrom = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: mockAuth, from: mockFrom },
}));

import { requireConsole } from "@/lib/auth-guard";

describe("isAal2", () => {
  it("is true only for an aal2 token", () => {
    expect(isAal2({ aal: "aal2" })).toBe(true);
    expect(isAal2({ aal: "aal1" })).toBe(false);
    expect(isAal2({})).toBe(false);
    expect(isAal2(null)).toBe(false);
    expect(isAal2(undefined)).toBe(false);
    expect(isAal2({ aal: "AAL2" })).toBe(false);
  });
});

describe("requireConsole session handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps a valid stored session when network-backed getUser would fail", async () => {
    mockAuth.getSession.mockResolvedValue({
      data: {
        session: {
          user: { id: "user-1", app_metadata: {} },
        },
      },
      error: null,
    });
    mockAuth.getUser.mockRejectedValue(new Error("network unavailable"));
    mockFrom.mockReturnValue({
      select: () => ({
        eq: async () => ({ data: [{ role: "tenant_admin" }], error: null }),
      }),
    });
    mockAuth.mfa.listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
    mockAuth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: "aal1" },
      error: null,
    });

    await expect(requireConsole()).resolves.toEqual(["tenant_admin"]);
    expect(mockAuth.getUser).not.toHaveBeenCalled();
  });
});
