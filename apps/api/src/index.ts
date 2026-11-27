import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  isIpv4,
  parseStaticIpAssignment,
  type StaticIpCustomer,
} from "@cleennetworks/api-contracts/static-ips";
import { cors } from "hono/cors";
import { Hono } from "hono";

type ApiEnvironment = {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  FRONTEND_ORIGINS?: string;
};

type ApiVariables = {
  supabase: SupabaseClient;
  tenantId: string | null;
  scopes: string[];
};

const CUSTOMER_FIELDS = "id,full_name,phone,pppoe_username,status,static_ip";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const app = new Hono<{ Bindings: ApiEnvironment; Variables: ApiVariables }>();

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

app.use(
  "/v1/*",
  cors({
    origin: (origin, context) =>
      (context.env.FRONTEND_ORIGINS ?? "")
        .split(",")
        .map((item: string) => item.trim())
        .filter(Boolean)
        .includes(origin)
        ? origin
        : "",
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "PUT", "OPTIONS"],
    maxAge: 600,
  }),
);

app.get("/health", (context) => context.json({ status: "ok" }));

app.use("/v1/*", async (context, next) => {
  const authorization = context.req.header("Authorization");
  const token = authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!token) return context.json({ error: "Authentication required." }, 401);

  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = context.env;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    console.error("API is missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY.");
    return context.json({ error: "API authentication is not configured." }, 500);
  }

  if (token.startsWith("ng_")) {
    const { SUPABASE_SERVICE_ROLE_KEY } = context.env;
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      console.error("API is missing SUPABASE_SERVICE_ROLE_KEY.");
      return context.json({ error: "API key authentication is not configured." }, 500);
    }
    const keyHash = await sha256(token);
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const now = new Date().toISOString();
    const { data: apiKey, error: apiKeyError } = await supabaseAdmin
      .from("tenant_api_keys")
      .select("id,tenant_id,scopes,expires_at,revoked_at")
      .eq("key_hash", keyHash)
      .is("revoked_at", null)
      .maybeSingle();
    if (apiKeyError) {
      console.error("Could not validate tenant API key.", apiKeyError);
      return context.json({ error: "API authentication service is unavailable." }, 503);
    }
    if (!apiKey) return context.json({ error: "API key is invalid or revoked." }, 401);
    if (apiKey.expires_at && apiKey.expires_at <= now) {
      return context.json({ error: "API key has expired." }, 401);
    }
    await supabaseAdmin
      .from("tenant_api_keys")
      .update({ last_used_at: now })
      .eq("id", apiKey.id)
      .eq("tenant_id", apiKey.tenant_id);
    context.set("supabase", supabaseAdmin);
    context.set("tenantId", apiKey.tenant_id);
    context.set("scopes", apiKey.scopes ?? []);
    await next();
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    if (error && error.status !== 400 && error.status !== 401) {
      console.error("API could not validate the Supabase session.", error);
      return context.json({ error: "Authentication service is unavailable." }, 503);
    }
    return context.json({ error: "Your session is invalid or expired." }, 401);
  }

  context.set("supabase", supabase);
  context.set("tenantId", null);
  context.set("scopes", []);
  await next();
});

app.get("/v1/tenant/static-ips", async (context) => {
  if (!context.get("tenantId") && !context.get("scopes").length) {
    // Session bearer requests are governed by RLS and do not require an API-key scope.
  } else if (!context.get("scopes").includes("static_ips:read")) {
    return context.json({ error: "API key lacks the static_ips:read scope." }, 403);
  }

  let query = context
    .get("supabase")
    .from("customers")
    .select(CUSTOMER_FIELDS)
    .eq("customer_type", "pppoe");
  if (context.get("tenantId")) {
    query = query.eq("tenant_id", context.get("tenantId")!);
  }
  const { data, error } = await query.order("full_name");

  if (error) {
    console.error("Could not load PPPoE static IP assignments.", error);
    return context.json({ error: "Could not load static IP assignments." }, 500);
  }

  return context.json(data as StaticIpCustomer[], 200, { "Cache-Control": "no-store" });
});

app.put("/v1/tenant/static-ips/:customerId", async (context) => {
  if (context.get("tenantId") && !context.get("scopes").includes("static_ips:write")) {
    return context.json({ error: "API key lacks the static_ips:write scope." }, 403);
  }
  const { customerId } = context.req.param();
  if (!UUID_PATTERN.test(customerId)) {
    return context.json({ error: "Invalid customer ID." }, 400);
  }

  let input: unknown;
  try {
    input = await context.req.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return context.json({ error: "Request body must be valid JSON." }, 400);
    }
    throw error;
  }

  const assignment = parseStaticIpAssignment(input);
  if (!assignment) {
    return context.json({ error: "Provide a valid IPv4 address or null to remove it." }, 400);
  }

  const supabase = context.get("supabase");
  if (assignment.staticIp) {
    if (!isIpv4(assignment.staticIp)) {
      return context.json({ error: "Enter a valid IPv4 address." }, 400);
    }
    const tenantId = context.get("tenantId");
    let conflictQuery = supabase
      .from("customers")
      .select("id")
      .eq("customer_type", "pppoe")
      .eq("static_ip", assignment.staticIp)
      .neq("id", customerId)
      .limit(1);
    if (tenantId) conflictQuery = conflictQuery.eq("tenant_id", tenantId);
    const { data: conflicts, error: conflictError } = await conflictQuery;
    if (conflictError) {
      console.error("Could not check static IP uniqueness.", conflictError);
      return context.json({ error: "Could not check the IP address assignment." }, 500);
    }
    if (conflicts?.length) {
      return context.json({ error: "That IP address is already assigned." }, 409);
    }
  }

  let updateQuery = supabase
    .from("customers")
    .update({ static_ip: assignment.staticIp })
    .eq("id", customerId)
    .eq("customer_type", "pppoe")
    .select(CUSTOMER_FIELDS);
  if (context.get("tenantId")) {
    updateQuery = updateQuery.eq("tenant_id", context.get("tenantId")!);
  }
  const { data, error } = await updateQuery.maybeSingle();

  if (error) {
    console.error("Could not update a PPPoE static IP assignment.", error);
    return context.json({ error: "Could not update the static IP assignment." }, 500);
  }
  if (!data) return context.json({ error: "PPPoE customer not found." }, 404);

  return context.json(data as StaticIpCustomer, 200, { "Cache-Control": "no-store" });
});

app.notFound((context) => context.json({ error: "Not found." }, 404));
app.onError((error, context) => {
  console.error("Unhandled API error.", error);
  return context.json({ error: "Unexpected API error." }, 500);
});

export default app;
