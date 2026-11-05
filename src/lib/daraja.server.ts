import { createHash } from "node:crypto";
import { normalizePhone } from "@/lib/mpesa.server";
import { loadTenantServiceSecrets } from "@/lib/tenant-service-secrets.server";

type DarajaConfig = {
  environment: "sandbox" | "production";
  shortcode: string;
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
};

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function configFrom(secrets: Awaited<ReturnType<typeof loadTenantServiceSecrets>>): DarajaConfig {
  const { MPESA_ENV, MPESA_SHORTCODE, MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_PASSKEY } =
    secrets;
  if (!MPESA_SHORTCODE || !MPESA_CONSUMER_KEY || !MPESA_CONSUMER_SECRET || !MPESA_PASSKEY) {
    throw new Error("Complete the tenant's M-Pesa Daraja credentials before accepting payments.");
  }
  if (MPESA_ENV !== "sandbox" && MPESA_ENV !== "production") {
    throw new Error("The tenant's M-Pesa environment is invalid.");
  }
  return {
    environment: MPESA_ENV,
    shortcode: MPESA_SHORTCODE,
    consumerKey: MPESA_CONSUMER_KEY,
    consumerSecret: MPESA_CONSUMER_SECRET,
    passkey: MPESA_PASSKEY,
  };
}

function baseUrl(environment: DarajaConfig["environment"]): string {
  return environment === "sandbox"
    ? "https://sandbox.safaricom.co.ke"
    : "https://api.safaricom.co.ke";
}

async function accessToken(config: DarajaConfig): Promise<string> {
  const cacheKey = createHash("sha256")
    .update(
      [
        config.environment,
        config.shortcode,
        config.consumerKey,
        config.consumerSecret,
      ].join("\0"),
    )
    .digest("hex");
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const response = await fetch(
    `${baseUrl(config.environment)}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: {
        Authorization: `Basic ${btoa(`${config.consumerKey}:${config.consumerSecret}`)}`,
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  const result = (await response.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: string | number;
  } | null;
  if (!response.ok || !result?.access_token) {
    console.error(`Daraja OAuth failed [${response.status}]`);
    throw new Error("Could not connect to the tenant's M-Pesa account.");
  }
  const expiresIn = Number(result.expires_in);
  if (Number.isFinite(expiresIn) && expiresIn > 60) {
    const now = Date.now();
    for (const [key, value] of tokenCache) {
      if (value.expiresAt <= now) tokenCache.delete(key);
    }
    tokenCache.set(cacheKey, {
      token: result.access_token,
      expiresAt: now + (expiresIn - 60) * 1000,
    });
  }
  return result.access_token;
}

function darajaTimestamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}${part("month")}${part("day")}${part("hour")}${part("minute")}${part("second")}`;
}

function password(config: DarajaConfig, timestamp: string): string {
  return btoa(`${config.shortcode}${config.passkey}${timestamp}`);
}

async function loadConfig(tenantId: string): Promise<DarajaConfig> {
  return configFrom(await loadTenantServiceSecrets(tenantId));
}

export async function startDarajaStkPush(input: {
  tenantId: string;
  amount: number;
  phone: string;
  paymentId: string;
  callbackUrl: string;
  description: string;
  accountReference?: string;
}): Promise<{ checkoutRequestId: string; merchantRequestId: string }> {
  const config = await loadConfig(input.tenantId);
  const phone = normalizePhone(input.phone);
  const amount = Math.ceil(input.amount);
  if (!/^254[17]\d{8}$/.test(phone)) throw new Error("Enter a valid Kenyan M-Pesa number.");
  if (!Number.isSafeInteger(amount) || amount < 1)
    throw new Error("The payment amount must be a positive whole number.");
  if (new URL(input.callbackUrl).protocol !== "https:")
    throw new Error("M-Pesa callbacks require a public HTTPS URL.");
  const accountReference =
    (input.accountReference ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 12) ||
    input.paymentId.replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
  const description = input.description.replace(/[^A-Za-z0-9 ._-]/g, " ").trim().slice(0, 30);
  const timestamp = darajaTimestamp();
  const token = await accessToken(config);
  const response = await fetch(`${baseUrl(config.environment)}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: config.shortcode,
      Password: password(config, timestamp),
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: config.shortcode,
      PhoneNumber: phone,
      CallBackURL: input.callbackUrl,
      AccountReference: accountReference,
      TransactionDesc: description || "Internet",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const result = (await response.json().catch(() => null)) as {
    ResponseCode?: string;
    ResponseDescription?: string;
    CheckoutRequestID?: string;
    MerchantRequestID?: string;
  } | null;
  if (
    !response.ok ||
    !result ||
    String(result.ResponseCode) !== "0" ||
    !result.CheckoutRequestID ||
    !result.MerchantRequestID
  ) {
    console.error(`Daraja STK push failed [${response.status}]`);
    throw new Error(
      "Could not send the M-Pesa prompt. Check the tenant's Daraja setup and try again.",
    );
  }
  return {
    checkoutRequestId: result.CheckoutRequestID,
    merchantRequestId: result.MerchantRequestID,
  };
}

export async function queryDarajaStkPush(
  tenantId: string,
  checkoutRequestId: string,
): Promise<{ resultCode: string | null; resultDescription: string }> {
  const config = await loadConfig(tenantId);
  const timestamp = darajaTimestamp();
  const token = await accessToken(config);
  const response = await fetch(`${baseUrl(config.environment)}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: config.shortcode,
      Password: password(config, timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const result = (await response.json().catch(() => null)) as {
    ResultCode?: string | number;
    ResultDesc?: string;
    ResponseCode?: string | number;
    ResponseDescription?: string;
    errorMessage?: string;
    errorCode?: string;
  } | null;

  const desc =
    result?.ResultDesc ??
    result?.ResponseDescription ??
    result?.errorMessage ??
    "";

  // Safaricom returns "The transaction is being processed" while prompt is waiting for user PIN
  const isProcessing =
    desc.toLowerCase().includes("processing") ||
    desc.toLowerCase().includes("in process") ||
    desc.toLowerCase().includes("unable to lock");

  if (isProcessing) {
    return {
      resultCode: null,
      resultDescription: desc || "The transaction is being processed",
    };
  }

  const resultCode = result?.ResultCode;
  const responseCode = result?.ResponseCode;
  if (
    (!response.ok && resultCode === undefined) ||
    (responseCode !== undefined && String(responseCode) !== "0" && resultCode === undefined) ||
    (resultCode === undefined && responseCode === undefined)
  ) {
    console.error(`Daraja STK query failed [${response.status}]`, desc);
    throw new Error("Could not verify the M-Pesa payment.");
  }
  return {
    resultCode: resultCode === undefined ? null : String(resultCode),
    resultDescription: desc,
  };
}

export async function registerDarajaC2bUrl(input: {
  tenantId: string;
  shortcode: string;
  validationUrl: string;
  confirmationUrl: string;
}): Promise<void> {
  const config = await loadConfig(input.tenantId);
  for (const callbackUrl of [input.validationUrl, input.confirmationUrl]) {
    if (new URL(callbackUrl).protocol !== "https:")
      throw new Error("M-Pesa callbacks require a public HTTPS URL.");
  }
  const token = await accessToken(config);
  const response = await fetch(`${baseUrl(config.environment)}/mpesa/c2b/v2/registerurl`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ShortCode: input.shortcode,
      ResponseType: "Completed",
      ConfirmationURL: input.confirmationUrl,
      ValidationURL: input.validationUrl,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const result = (await response.json().catch(() => null)) as {
    ResponseCode?: string | number;
  } | null;
  if (!response.ok || !["0", "00000000"].includes(String(result?.ResponseCode))) {
    console.error(`Daraja C2B URL registration failed [${response.status}]`);
    throw new Error("Safaricom did not register the C2B callback for this shortcode.");
  }
}
