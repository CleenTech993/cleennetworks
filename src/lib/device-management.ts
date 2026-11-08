export type DeviceVendor = "mikrotik" | "ruijie_reyee" | "tp_link_omada";
export type ManagementMethod =
  | "routeros_agent"
  | "routeros_rest"
  | "routeros_ssh"
  | "ruijie_cloud_api"
  | "ruijie_local_api"
  | "omada_controller_api"
  | "omada_cloud_api"
  | "local_connector";
export type ManagementStatus =
  | "online"
  | "offline"
  | "partially_supported"
  | "api_unavailable"
  | "authentication_failed"
  | "successfully_provisioned";

export const DEFAULT_METHOD_ORDER: Record<DeviceVendor, readonly ManagementMethod[]> = {
  mikrotik: ["routeros_agent", "routeros_rest", "routeros_ssh", "local_connector"],
  ruijie_reyee: ["ruijie_cloud_api", "ruijie_local_api", "local_connector"],
  tp_link_omada: ["omada_controller_api", "omada_cloud_api", "local_connector"],
};

export const MIKROTIK_AGENT_CAPABILITIES = [
  "health.read",
  "interfaces.read",
  "pppoe.configure",
  "guest_portal.voucher_sync",
  "devices.monitor",
  "inventory.monitor",
] as const;

export type MethodAvailability = {
  method: ManagementMethod;
  officiallySupported: boolean;
  implemented: boolean;
  configured: boolean;
  reachable: boolean;
  authenticated?: boolean;
};

export type ManagementAdapter<T> = MethodAvailability & {
  execute: () => Promise<T>;
};

export type FallbackPolicyOverrides = Readonly<Record<string, readonly ManagementMethod[]>>;

export function buildOmadaPortalUrl(input: {
  origin: string;
  tenantSlug: string;
  routerId: string;
}): string | null {
  if (!input.tenantSlug.trim() || !/^[0-9a-f-]{36}$/i.test(input.routerId)) return null;
  try {
    const origin = new URL(input.origin);
    const localHttp =
      origin.protocol === "http:" &&
      (origin.hostname === "localhost" || origin.hostname === "127.0.0.1");
    if ((origin.protocol !== "https:" && !localHttp) || origin.username || origin.password)
      return null;

    const portal = new URL(`/p/${encodeURIComponent(input.tenantSlug)}`, origin.origin);
    portal.searchParams.set("router", input.routerId);
    return portal.toString();
  } catch {
    return null;
  }
}

export function methodOrder(
  vendor: DeviceVendor,
  family: string | null,
  overrides: FallbackPolicyOverrides = {},
): readonly ManagementMethod[] {
  const normalizedFamily = family?.trim().toLowerCase();
  if (normalizedFamily) {
    const familyOrder = overrides[`${vendor}:${normalizedFamily}`];
    if (familyOrder) return familyOrder;
  }
  return overrides[`${vendor}:*`] ?? DEFAULT_METHOD_ORDER[vendor];
}

export function resolveManagementMethod(input: {
  vendor: DeviceVendor;
  family: string | null;
  methods: readonly MethodAvailability[];
  overrides?: FallbackPolicyOverrides;
}): { method: ManagementMethod | null; status: ManagementStatus } {
  const byMethod = new Map(input.methods.map((item) => [item.method, item]));
  for (const method of methodOrder(input.vendor, input.family, input.overrides)) {
    const candidate = byMethod.get(method);
    if (
      !candidate ||
      !candidate.officiallySupported ||
      !candidate.implemented ||
      !candidate.configured
    )
      continue;
    if (candidate.authenticated === false) return { method, status: "authentication_failed" };
    if (candidate.reachable && candidate.authenticated !== false)
      return { method, status: "online" };
  }
  return { method: null, status: "api_unavailable" };
}

export type VendorFailureKind = "authentication" | "unsupported" | "transient" | "fatal";

export function classifyVendorFailure(error: unknown): VendorFailureKind {
  const candidate = error as {
    status?: unknown;
    code?: unknown;
    name?: unknown;
    message?: unknown;
  } | null;
  const status = typeof candidate?.status === "number" ? candidate.status : undefined;
  const code = typeof candidate?.code === "string" ? candidate.code.toLowerCase() : "";
  const message = typeof candidate?.message === "string" ? candidate.message.toLowerCase() : "";
  if (status === 401 || status === 403 || /invalid.?credential|unauthori[sz]ed/.test(code))
    return "authentication";
  if (
    status === 405 ||
    status === 501 ||
    /unsupported.?endpoint/.test(code) ||
    /unsupported endpoint|endpoint not supported/.test(message)
  )
    return "unsupported";
  if (status === 408 || status === 425 || status === 429 || (status !== undefined && status >= 500))
    return "transient";
  const name = typeof candidate?.name === "string" ? candidate.name : "";
  if (
    status === undefined &&
    (name === "AbortError" ||
      name === "TimeoutError" ||
      /econnreset|econnrefused|ehostunreach|enetwork|etimedout|eai_again/.test(code) ||
      /fetch failed|network error|timed? out|connection reset/.test(message))
  )
    return "transient";
  return "fatal";
}

export type RetryOptions = {
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
};

export async function withVendorRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 4);
  const baseDelayMs = Math.max(1, options.baseDelayMs ?? 250);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 5_000);
  const sleep =
    options.sleep ??
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const random = options.random ?? Math.random;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      const failure = classifyVendorFailure(error);
      if (failure !== "transient" || attempt + 1 >= attempts) throw error;

      const retryAfter = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs;
      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const jittered = Math.round(exponential * (0.5 + Math.min(1, Math.max(0, random())) * 0.5));
      const delay =
        typeof retryAfter === "number" && Number.isFinite(retryAfter)
          ? Math.min(maxDelayMs, Math.max(0, retryAfter))
          : jittered;
      await sleep(delay);
    }
  }
  throw new Error("Unreachable retry state");
}

export async function executeWithOfficialFallback<T>(input: {
  order: readonly ManagementMethod[];
  adapters: readonly ManagementAdapter<T>[];
  retry?: RetryOptions;
}): Promise<{ method: ManagementMethod; value: T }> {
  const byMethod = new Map(input.adapters.map((adapter) => [adapter.method, adapter]));
  let lastFallbackError: unknown;

  for (const method of input.order) {
    const adapter = byMethod.get(method);
    if (
      !adapter ||
      !adapter.officiallySupported ||
      !adapter.implemented ||
      !adapter.configured ||
      adapter.reachable === false
    )
      continue;
    if (adapter.authenticated === false) {
      throw Object.assign(new Error("Management credentials were rejected."), {
        code: "invalid_credentials",
      });
    }
    try {
      return { method, value: await withVendorRetry(adapter.execute, input.retry) };
    } catch (error) {
      const failure = classifyVendorFailure(error);
      if (failure === "authentication" || failure === "fatal") throw error;
      lastFallbackError = error;
    }
  }

  if (lastFallbackError) throw lastFallbackError;
  throw Object.assign(new Error("No officially supported management method is configured."), {
    code: "management_method_unavailable",
  });
}

export function capabilityStatus(
  required: readonly string[],
  available: readonly string[],
  operationSucceeded = false,
): ManagementStatus {
  if (!available.length) return "api_unavailable";
  if (!required.every((capability) => available.includes(capability))) return "partially_supported";
  return operationSucceeded ? "successfully_provisioned" : "online";
}
