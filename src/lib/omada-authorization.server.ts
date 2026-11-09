import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptSecret } from "@/lib/secret-crypto.server";
import {
  assertSupportedOmadaVersion,
  authorizeOmadaClient,
  type OmadaAuthorizationContext,
} from "@/lib/omada-controller.server";

const MAX_ATTEMPTS = 6;
const PROCESSING_LEASE_MS = 60_000;

type AuthorizationJob = {
  id: string;
  payment_id: string;
  tenant_id: string;
  router_id: string;
  context_kind: string;
  client_mac: string;
  ap_mac: string | null;
  gateway_mac: string | null;
  ssid_name: string | null;
  radio_id: string | null;
  vlan_id: string | null;
  site_name: string;
  redirect_url: string | null;
  status: string;
  attempts: number;
  next_attempt_at: string;
  updated_at: string;
  last_error: string | null;
  authorized_at: string | null;
};

export type OmadaAuthorizationStatus =
  | { status: "not_required" }
  | { status: "pending" | "processing" | "failed" }
  | { status: "authorized"; redirectUrl: string | null };

function throwDatabaseError(message: string, error: { message: string }): never {
  console.error(message, error.message);
  throw new Error(message);
}

function authorizationContext(job: AuthorizationJob): OmadaAuthorizationContext {
  if (
    job.context_kind === "eap" &&
    job.ap_mac &&
    job.ssid_name &&
    (job.radio_id === "0" || job.radio_id === "1")
  ) {
    return {
      kind: "eap",
      clientMac: job.client_mac,
      apMac: job.ap_mac,
      ssidName: job.ssid_name,
      radioId: job.radio_id,
      siteName: job.site_name,
    };
  }
  if (job.context_kind === "gateway" && job.gateway_mac && job.vlan_id) {
    return {
      kind: "gateway",
      clientMac: job.client_mac,
      gatewayMac: job.gateway_mac,
      vlanId: job.vlan_id,
      siteName: job.site_name,
    };
  }
  throw new Error("Saved Omada client context is invalid.");
}

async function readJob(
  paymentId: string,
  tenantId: string,
): Promise<AuthorizationJob | null> {
  const { data, error } = await supabaseAdmin
    .from("omada_authorization_jobs")
    .select(
      "id,payment_id,tenant_id,router_id,context_kind,client_mac,ap_mac,gateway_mac,ssid_name,radio_id,vlan_id,site_name,redirect_url,status,attempts,next_attempt_at,updated_at,last_error,authorized_at",
    )
    .eq("payment_id", paymentId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throwDatabaseError("Could not load Omada authorization job.", error);
  return data as AuthorizationJob | null;
}

function statusOf(job: AuthorizationJob): OmadaAuthorizationStatus {
  if (job.status === "authorized")
    return { status: "authorized", redirectUrl: job.redirect_url };
  if (job.status === "failed") return { status: "failed" };
  if (job.status === "processing") return { status: "processing" };
  return { status: "pending" };
}

async function updateJob(
  jobId: string,
  values: {
    status: string;
    attempts?: number;
    next_attempt_at?: string;
    last_error?: string | null;
    authorized_at?: string | null;
    updated_at: string;
  },
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("omada_authorization_jobs")
    .update(values)
    .eq("id", jobId);
  if (error) throwDatabaseError("Could not update Omada authorization status.", error);
}

export async function processOmadaAuthorization(
  paymentId: string,
  tenantId: string,
): Promise<OmadaAuthorizationStatus> {
  const job = await readJob(paymentId, tenantId);
  if (!job) return { status: "not_required" };
  if (job.status === "authorized" || job.status === "failed") return statusOf(job);

  const nowMs = Date.now();
  if (job.status === "processing") {
    if (nowMs - Date.parse(job.updated_at) < PROCESSING_LEASE_MS) return statusOf(job);
    await updateJob(job.id, {
      status: "pending",
      updated_at: new Date(nowMs).toISOString(),
    });
  } else if (Date.parse(job.next_attempt_at) > nowMs) {
    return statusOf(job);
  }

  const attempt = job.attempts + 1;
  if (attempt > MAX_ATTEMPTS) {
    await updateJob(job.id, {
      status: "failed",
      updated_at: new Date(nowMs).toISOString(),
      last_error: "Maximum retry attempts reached.",
    });
    return { status: "failed" };
  }

  const claimedAt = new Date(nowMs).toISOString();
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("omada_authorization_jobs")
    .update({ status: "processing", attempts: attempt, updated_at: claimedAt })
    .eq("id", job.id)
    .eq("status", "pending")
    .lte("next_attempt_at", claimedAt)
    .select("id")
    .maybeSingle();
  if (claimError) throwDatabaseError("Could not claim Omada authorization job.", claimError);
  if (!claimed) {
    const current = await readJob(paymentId, tenantId);
    return current ? statusOf(current) : { status: "not_required" };
  }

  try {
    const { data: payment, error: paymentError } = await supabaseAdmin
      .from("payments")
      .select("status,expires_at,package_id")
      .eq("id", paymentId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment || payment.status !== "success") {
      throw new Error("Payment is not confirmed.");
    }

    const { data: integration, error: integrationError } = await supabaseAdmin
      .from("omada_integrations")
      .select(
        "controller_host,controller_port,controller_id,controller_version,site_name,operator_username,operator_password_ciphertext,enabled",
      )
      .eq("router_id", job.router_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (integrationError) throw integrationError;
    if (!integration || !integration.enabled || integration.site_name !== job.site_name) {
      throw new Error("Omada integration is unavailable or its site does not match.");
    }
    assertSupportedOmadaVersion(integration.controller_version);
    if (!payment.expires_at) {
      throw new Error("The purchased package has no configured expiration time.");
    }
    const remainingMs = Date.parse(payment.expires_at) - Date.now();
    const timeMicroseconds = Math.floor(remainingMs * 1000);
    if (!Number.isSafeInteger(timeMicroseconds) || timeMicroseconds < 1) {
      throw new Error("The purchased session has already expired.");
    }

    const password = await decryptSecret(
      `omada:${job.router_id}:operator_password`,
      integration.operator_password_ciphertext,
    );
    await authorizeOmadaClient({
      target: {
        host: integration.controller_host,
        port: integration.controller_port,
        controllerId: integration.controller_id,
      },
      credentials: { username: integration.operator_username, password },
      context: authorizationContext(job),
      timeMicroseconds,
    });
    const authorizedAt = new Date().toISOString();
    await updateJob(job.id, {
      status: "authorized",
      updated_at: authorizedAt,
      authorized_at: authorizedAt,
      last_error: null,
    });
    return { status: "authorized", redirectUrl: job.redirect_url };
  } catch (error) {
    console.error("Omada client authorization attempt failed", error);
    const failed = attempt >= MAX_ATTEMPTS;
    const delayMs = Math.min(5 * 60_000, 5_000 * 2 ** (attempt - 1));
    await updateJob(job.id, {
      status: failed ? "failed" : "pending",
      updated_at: new Date().toISOString(),
      next_attempt_at: new Date(Date.now() + delayMs).toISOString(),
      last_error: error instanceof Error ? error.message.slice(0, 300) : "Controller request failed.",
    });
    return { status: failed ? "failed" : "pending" };
  }
}
