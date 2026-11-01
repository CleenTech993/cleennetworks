import { loadTenantServiceSecrets } from "@/lib/tenant-service-secrets.server";

// SMS credentials belong to the tenant and are decrypted only on the server.

export type SmsResult = { ok: true } | { ok: false; error: string; notConfigured?: boolean };

const E164 = /^\+?[0-9]{9,15}$/;
const MAX_LEN = 320; // two SMS segments

/** "254712345678" / "0712345678" / "+254712345678" -> "+254712345678"; null if it isn't a plausible number. */
export function toE164(input: string): string | null {
  if (!/^\+?[\d\s\-().]+$/.test(input.trim())) return null;
  const digits = input.replace(/[^\d+]/g, "");
  let d = digits.replace(/^\+/, "");
  if (d.startsWith("0")) d = `254${d.slice(1)}`;
  else if (/^[17]\d{8}$/.test(d)) d = `254${d}`;
  const out = `+${d}`;
  return E164.test(out) ? out : null;
}

export async function smsConfigured(tenantId: string): Promise<boolean> {
  const secrets = await loadTenantServiceSecrets(tenantId);
  return Boolean(secrets.AT_USERNAME && secrets.AT_API_KEY);
}

/** Builds the Africa's Talking request (pure, so it can be tested without the network). */
export function buildSmsRequest(
  cfg: { username: string; apiKey: string; senderId?: string; sandbox?: boolean },
  numbers: string[],
  message: string,
) {
  const base = cfg.sandbox
    ? "https://api.sandbox.africastalking.com"
    : "https://api.africastalking.com";
  const body = new URLSearchParams({
    username: cfg.username,
    to: numbers.join(","),
    message: message.slice(0, MAX_LEN),
  });
  if (cfg.senderId) body.set("from", cfg.senderId);
  return {
    url: `${base}/version1/messaging`,
    init: {
      method: "POST",
      headers: {
        apiKey: cfg.apiKey,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    },
  };
}

/** Success when at least one recipient was accepted (status codes 100-102 are "processed/sent/queued"). */
export function parseSmsResponse(json: unknown): SmsResult {
  const data = (
    json as {
      SMSMessageData?: {
        Message?: string;
        Recipients?: { statusCode?: number; status?: string }[];
      };
    }
  )?.SMSMessageData;
  const recipients = data?.Recipients ?? [];
  if (recipients.some((r) => r.statusCode === 100 || r.statusCode === 101 || r.statusCode === 102))
    return { ok: true };
  const reason = recipients[0]?.status ?? data?.Message ?? "SMS provider rejected the message";
  return { ok: false, error: String(reason).slice(0, 200) };
}

export async function sendSms(
  tenantId: string,
  numbers: string[],
  message: string,
): Promise<SmsResult> {
  const secrets = await loadTenantServiceSecrets(tenantId);
  const username = secrets.AT_USERNAME;
  const apiKey = secrets.AT_API_KEY;
  if (!username || !apiKey)
    return { ok: false, error: "SMS is not configured for this tenant", notConfigured: true };

  const to = [...new Set(numbers.map(toE164).filter((n): n is string => !!n))];
  if (to.length === 0) return { ok: false, error: "No valid phone numbers" };

  const req = buildSmsRequest(
    {
      username,
      apiKey,
      senderId: secrets.AT_SENDER_ID,
      sandbox: username === "sandbox",
    },
    to,
    message,
  );
  try {
    const res = await fetch(req.url, req.init);
    if (!res.ok) return { ok: false, error: `SMS provider returned ${res.status}` };
    return parseSmsResponse(await res.json());
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 200) : "SMS request failed",
    };
  }
}
