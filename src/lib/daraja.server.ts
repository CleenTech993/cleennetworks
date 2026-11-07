import { createHash } from "node:crypto";
import { normalizePhone } from "@/lib/mpesa.server";
import { loadPlatformServiceSecrets } from "@/lib/platform-service-secrets.server";
import { loadTenantServiceSecrets } from "@/lib/tenant-service-secrets.server";

type DarajaConfig = {
  environment: "sandbox" | "production";
  merchantType: "paybill" | "buygoods";
  businessShortcode: string;
  merchantShortcode: string;
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
};

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function configFrom(secrets: Awaited<ReturnType<typeof loadTenantServiceSecrets>>): DarajaConfig {
  const {
    MPESA_ENV,
    MPESA_BUSINESS_SHORTCODE,
    MPESA_SHORTCODE,
    MPESA_CONSUMER_KEY,
    MPESA_CONSUMER_SECRET,
    MPESA_PASSKEY,
  } = secrets;
  const { MPESA_MERCHANT_TYPE } = secrets;
  if (!MPESA_SHORTCODE || !MPESA_CONSUMER_KEY || !MPESA_CONSUMER_SECRET || !MPESA_PASSKEY) {
    throw new Error("Complete the tenant's M-Pesa Daraja credentials before accepting payments.");
  }
  if (MPESA_ENV !== "sandbox" && MPESA_ENV !== "production") {
    throw new Error("The tenant's M-Pesa environment is invalid.");
  }
  return {
    environment: MPESA_ENV,
    merchantType: MPESA_MERCHANT_TYPE === "buygoods" ? "buygoods" : "paybill",
    businessShortcode: MPESA_BUSINESS_SHORTCODE?.trim() || MPESA_SHORTCODE,
    merchantShortcode: MPESA_SHORTCODE,
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
        config.businessShortcode,
        config.merchantShortcode,
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
    throw new Error("Could not connect to the M-Pesa account.");
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
  return btoa(`${config.businessShortcode}${config.passkey}${timestamp}`);
}

function safeResponseDescription(value: string | undefined): string | undefined {
  const description = value
    ?.replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\s+/g, " ")
    .replace(/\b(?:254)?[17]\d{8}\b/g, "[phone]")
    .slice(0, 160);
  return description || undefined;
}

async function loadConfig(tenantId: string): Promise<DarajaConfig> {
  return configFrom(await loadTenantServiceSecrets(tenantId));
}

async function startStkPush(
  config: DarajaConfig,
  input: {
    tenantId: string;
    amount: number;
    phone: string;
    paymentId: string;
    callbackUrl: string;
    description: string;
    accountReference?: string;
  },
): Promise<{ checkoutRequestId: string; merchantRequestId: string }> {
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
  const description = input.description
    .replace(/[^A-Za-z0-9 ._-]/g, " ")
    .trim()
    .slice(0, 30);
  const timestamp = darajaTimestamp();
  const token = await accessToken(config);
  const response = await fetch(`${baseUrl(config.environment)}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: config.businessShortcode,
      Password: password(config, timestamp),
      Timestamp: timestamp,
      TransactionType:
        config.merchantType === "buygoods" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: config.merchantShortcode,
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
    console.error("Daraja STK push failed", {
      environment: config.environment,
      tenantId: input.tenantId,
      paymentId: input.paymentId,
      httpStatus: response.status,
      responseCode: result?.ResponseCode,
      responseDescription: safeResponseDescription(result?.ResponseDescription),
    });
    throw new Error("Could not send the M-Pesa prompt. Check the Daraja setup and try again.");
  }
  console.info("Daraja STK request accepted", {
    environment: config.environment,
    merchantType: config.merchantType,
    tenantId: input.tenantId,
    paymentId: input.paymentId,
    checkoutRequestId: result.CheckoutRequestID,
  });
  return {
    checkoutRequestId: result.CheckoutRequestID,
    merchantRequestId: result.MerchantRequestID,
  };
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
  return startStkPush(await loadConfig(input.tenantId), input);
}

export async function startPlatformDarajaStkPush(input: {
  amount: number;
  phone: string;
  paymentId: string;
  callbackUrl: string;
  accountReference: string;
  tillShortcode: string;
}): Promise<{ checkoutRequestId: string; merchantRequestId: string }> {
  const secrets = await loadPlatformServiceSecrets();
  const environment = secrets.PLATFORM_MPESA_ENV;
  const consumerKey = secrets.PLATFORM_MPESA_CONSUMER_KEY?.trim();
  const consumerSecret = secrets.PLATFORM_MPESA_CONSUMER_SECRET?.trim();
  const businessShortcode = secrets.PLATFORM_MPESA_BUSINESS_SHORTCODE?.trim();
  const passkey = secrets.PLATFORM_MPESA_PASSKEY?.trim();
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error("The platform Daraja environment must be sandbox or production.");
  }
  if (!consumerKey || !consumerSecret || !businessShortcode || !passkey) {
    throw new Error("Complete the platform's Buy Goods STK shortcode and Daraja credentials.");
  }
  if (!/^\d{5,20}$/.test(businessShortcode) || !/^\d{5,20}$/.test(input.tillShortcode)) {
    throw new Error("Enter valid numeric Buy Goods and Lipa na M-Pesa Online shortcodes.");
  }
  return startStkPush(
    {
      environment,
      merchantType: "buygoods",
      businessShortcode,
      merchantShortcode: input.tillShortcode,
      consumerKey,
      consumerSecret,
      passkey,
    },
    {
      ...input,
      tenantId: "platform",
      description: "Platform invoice",
    },
  );
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
      BusinessShortCode: config.businessShortcode,
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

  const desc = result?.ResultDesc ?? result?.ResponseDescription ?? result?.errorMessage ?? "";

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
  await registerC2bUrl(config, input);
}

export async function registerPlatformDarajaC2bUrl(input: {
  shortcode: string;
  validationUrl: string;
  confirmationUrl: string;
}): Promise<void> {
  const secrets = await loadPlatformServiceSecrets();
  const environment = secrets.PLATFORM_MPESA_ENV;
  const consumerKey = secrets.PLATFORM_MPESA_CONSUMER_KEY?.trim();
  const consumerSecret = secrets.PLATFORM_MPESA_CONSUMER_SECRET?.trim();
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error("Set the platform Daraja environment to sandbox or production.");
  }
  if (!consumerKey || !consumerSecret) {
    throw new Error("Configure the platform's Daraja consumer key and secret.");
  }
  await registerC2bUrl(
    {
      environment,
      merchantType: "paybill",
      businessShortcode: input.shortcode,
      merchantShortcode: input.shortcode,
      consumerKey,
      consumerSecret,
      passkey: "",
    },
    input,
  );
}

async function registerC2bUrl(
  config: DarajaConfig,
  input: { shortcode: string; validationUrl: string; confirmationUrl: string },
): Promise<void> {
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
