import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const LoginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(1024),
});

type LoginSession = {
  access_token: string;
  refresh_token: string;
};

async function hashIdentifier(value: string): Promise<string> {
  const secret = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!secret) throw new Error("Server login protection is not configured.");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function logSecurityEvent({
  type,
  emailHash,
  ipHash,
  userId,
  email,
}: {
  type: string;
  emailHash: string;
  ipHash: string;
  userId?: string;
  email?: string;
}) {
  const { error } = await supabaseAdmin.from("audit_logs").insert({
    actor_id: userId ?? null,
    actor_email: email ?? null,
    actor_role: "system",
    action: type,
    resource_type: "auth",
    resource_id: userId ?? null,
    description:
      type === "new_login_location"
        ? "Successful sign-in from a new network location"
        : "Repeated failed sign-in attempts triggered a security alert",
    metadata: {
      email_fingerprint: emailHash.slice(0, 16),
      ip_fingerprint: ipHash.slice(0, 16),
    },
  });
  if (error) console.error("Could not write login security alert:", error);
}

export const signInWithPassword = createServerFn({ method: "POST" })
  .validator((input: z.input<typeof LoginSchema>) => LoginSchema.parse(input))
  .handler(async ({ data }) => {
    const request = getRequest();
    if (!request?.headers) throw new Error("Sign-in request headers are unavailable.");

    const normalizedEmail = data.email.toLowerCase();
    const clientIp =
      request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip") ?? "unknown";
    const [emailHash, ipHash] = await Promise.all([
      hashIdentifier(`email:${normalizedEmail}`),
      hashIdentifier(`ip:${clientIp}`),
    ]);

    const supabaseUrl = process.env["SUPABASE_URL"];
    const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (!supabaseUrl || !publishableKey) {
      throw new Error("Sign-in service is not configured.");
    }

    let response: Response;
    try {
      response = await fetch(
        `${supabaseUrl.replace(/\/+$/, "")}/auth/v1/token?grant_type=password`,
        {
          method: "POST",
          headers: {
            apikey: publishableKey,
            "content-type": "application/json",
          },
          body: JSON.stringify({ email: normalizedEmail, password: data.password }),
        },
      );
    } catch (error) {
      console.error("Sign-in provider request failed:", error);
      throw new Error("Sign-in service is temporarily unavailable. Please try again.");
    }

    if (!response.ok) {
      if (response.status === 429) {
        return {
          ok: false as const,
          error: "Too many sign-in requests. Please wait and try again.",
          retryAfterSeconds: 60,
        };
      }
      if (response.status >= 500) {
        console.error(`Sign-in provider returned HTTP ${response.status}.`);
        throw new Error("Sign-in service is temporarily unavailable. Please try again.");
      }

      const { data: recordRows, error: recordError } = await supabaseAdmin.rpc(
        "record_auth_login_attempt",
        { p_email_hash: emailHash, p_ip_hash: ipHash, p_succeeded: false },
      );
      if (recordError) throw new Error("Unable to record the failed sign-in attempt.");
      const record = recordRows?.[0];
      if (record?.should_alert && record.event_type) {
        await logSecurityEvent({ type: record.event_type, emailHash, ipHash });
      }
      return {
        ok: false as const,
        error: "Email or password is incorrect.",
        retryAfterSeconds: null,
      };
    }

    const session = (await response.json()) as Partial<LoginSession> & {
      user?: { id?: string; email?: string };
    };
    if (!session.access_token || !session.refresh_token || !session.user?.id) {
      throw new Error("Sign-in provider returned an incomplete session.");
    }

    const { data: recordRows, error: recordError } = await supabaseAdmin.rpc(
      "record_auth_login_attempt",
      { p_email_hash: emailHash, p_ip_hash: ipHash, p_succeeded: true },
    );
    if (recordError) throw new Error("Unable to record the successful sign-in.");
    const record = recordRows?.[0];
    if (record?.should_alert && record.event_type) {
      await logSecurityEvent({
        type: record.event_type,
        emailHash,
        ipHash,
        userId: session.user.id,
        email: session.user.email,
      });
    }

    return {
      ok: true as const,
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      },
    };
  });
