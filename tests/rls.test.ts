/**
 * Tenant isolation tests.
 *
 * Verifies that RLS prevents one tenant_admin from reading or writing
 * another tenant's rows across every tenant-scoped table.
 *
 * Requires env:
 *   VITE_SUPABASE_URL (or SUPABASE_URL)
 *   VITE_SUPABASE_PUBLISHABLE_KEY (or SUPABASE_PUBLISHABLE_KEY)
 *   TEST_SUPABASE_SERVICE_ROLE_KEY
 *
 * Run with:  bunx vitest run tests/rls.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const ANON =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
const SERVICE = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!URL || !ANON || !SERVICE) {
  throw new Error(
    "Missing env: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, TEST_SUPABASE_SERVICE_ROLE_KEY",
  );
}

const admin = createClient(URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface Ctx {
  email: string;
  password: string;
  userId: string;
  tenantId: string;
  client: SupabaseClient;
  ids: Record<string, string>;
}

async function makeUser(label: string): Promise<Ctx> {
  const stamp = Date.now() + Math.floor(Math.random() * 10000);
  const email = `rls-${label}-${stamp}@test.local`;
  const password = "Test-Password-1234!";

  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (cErr || !created.user) throw cErr ?? new Error("createUser failed");
  const userId = created.user.id;

  // Wait for handle_new_user trigger / sign in to ensure profile row exists.
  const client = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: sErr } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (sErr) throw sErr;

  // Ensure profile row exists (trigger might not have fired in some envs).
  await admin.from("profiles").upsert({ id: userId, email }, { onConflict: "id" });

  const slug = `t-${label}-${stamp}`.toLowerCase().slice(0, 60);
  const { data: tenantId, error: bErr } = await client.rpc("bootstrap_tenant", {
    p_name: `Tenant ${label}`,
    p_slug: slug,
    p_full_name: `User ${label}`,
  });
  if (bErr) throw bErr;

  return {
    email,
    password,
    userId,
    tenantId: tenantId as string,
    client,
    ids: {},
  };
}

async function seed(ctx: Ctx) {
  const t = ctx.tenantId;
  const c = ctx.client;

  const pkg = await c
    .from("packages")
    .insert({ tenant_id: t, name: "P", price: 10, kind: "hotspot" })
    .select("id")
    .single();
  if (pkg.error) throw new Error(`packages insert: ${pkg.error.message}`);
  ctx.ids.package = pkg.data.id;

  const cust = await c
    .from("customers")
    .insert({ tenant_id: t, full_name: "C", customer_type: "hotspot" })
    .select("id")
    .single();
  if (cust.error) throw new Error(`customers insert: ${cust.error.message}`);
  ctx.ids.customer = cust.data.id;

  const router = await c.from("routers").insert({ tenant_id: t, name: "R" }).select("id").single();
  if (router.error) throw new Error(`routers insert: ${router.error.message}`);
  ctx.ids.router = router.data.id;

  const pay = await c
    .from("payments")
    .insert({ tenant_id: t, amount: 10, status: "pending" })
    .select("id")
    .single();
  if (pay.error) throw new Error(`payments insert: ${pay.error.message}`);
  ctx.ids.payment = pay.data.id;

  const sess = await c
    .from("sessions")
    .insert({ tenant_id: t, status: "active" })
    .select("id")
    .single();
  if (sess.error) throw new Error(`sessions insert: ${sess.error.message}`);
  ctx.ids.session = sess.data.id;

  const v = await c
    .from("vouchers")
    .insert({
      tenant_id: t,
      code: `V-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase(),
    })
    .select("id")
    .single();
  if (v.error) throw new Error(`vouchers insert: ${v.error.message}`);
  ctx.ids.voucher = v.data.id;

  const tk = await c
    .from("support_tickets")
    .insert({ tenant_id: t, subject: "S" })
    .select("id")
    .single();
  if (tk.error) throw new Error(`support_tickets insert: ${tk.error.message}`);
  ctx.ids.ticket = tk.data.id;

  const cp = await c
    .from("captive_portals")
    .insert({ tenant_id: t, welcome_text: "hi" })
    .select("id")
    .single();
  if (cp.error) throw new Error(`captive_portals insert: ${cp.error.message}`);
  ctx.ids.portal = cp.data.id;
}

const TENANT_TABLES = [
  "packages",
  "customers",
  "routers",
  "payments",
  "sessions",
  "vouchers",
  "support_tickets",
  "captive_portals",
] as const;

const KEY: Record<(typeof TENANT_TABLES)[number], keyof Ctx["ids"]> = {
  packages: "package",
  customers: "customer",
  routers: "router",
  payments: "payment",
  sessions: "session",
  vouchers: "voucher",
  support_tickets: "ticket",
  captive_portals: "portal",
};

async function cleanup(ctx: Ctx) {
  try {
    for (const t of TENANT_TABLES) {
      await admin.from(t).delete().eq("tenant_id", ctx.tenantId);
    }
    await admin.from("user_roles").delete().eq("user_id", ctx.userId);
    await admin.from("profiles").delete().eq("id", ctx.userId);
    await admin.from("tenants").delete().eq("id", ctx.tenantId);
    await admin.auth.admin.deleteUser(ctx.userId);
  } catch {
    /* best-effort */
  }
}

describe("RLS tenant isolation", () => {
  let A: Ctx;
  let B: Ctx;

  beforeAll(async () => {
    [A, B] = await Promise.all([makeUser("a"), makeUser("b")]);
    expect(A.tenantId).not.toEqual(B.tenantId);
    await seed(A);
    await seed(B);
  }, 60_000);

  afterAll(async () => {
    await Promise.all([cleanup(A), cleanup(B)]);
  }, 60_000);

  for (const table of TENANT_TABLES) {
    describe(table, () => {
      it("only returns rows from caller's tenant on SELECT *", async () => {
        const { data, error } = await A.client.from(table).select("tenant_id");
        expect(error).toBeNull();
        expect(data && data.length).toBeGreaterThan(0);
        for (const row of data!) {
          expect(row.tenant_id).toBe(A.tenantId);
        }
      });

      it("cannot SELECT a specific row owned by another tenant by id", async () => {
        const otherId = B.ids[KEY[table]];
        expect(otherId).toBeTruthy();
        const { data } = await A.client.from(table).select("id").eq("id", otherId).maybeSingle();
        expect(data).toBeNull();
      });

      it("cannot UPDATE another tenant's row", async () => {
        const otherId = B.ids[KEY[table]];
        const { data } = await A.client
          .from(table)
          .update({ tenant_id: A.tenantId })
          .eq("id", otherId)
          .select("id");
        expect(data ?? []).toHaveLength(0);

        // Confirm still owned by B via service role.
        const { data: still } = await admin
          .from(table)
          .select("tenant_id")
          .eq("id", otherId)
          .maybeSingle();
        expect(still?.tenant_id).toBe(B.tenantId);
      });

      it("cannot DELETE another tenant's row", async () => {
        const otherId = B.ids[KEY[table]];
        const { data } = await A.client.from(table).delete().eq("id", otherId).select("id");
        expect(data ?? []).toHaveLength(0);

        const { data: still } = await admin
          .from(table)
          .select("id")
          .eq("id", otherId)
          .maybeSingle();
        expect(still?.id).toBe(otherId);
      });

      it("cannot INSERT a row with another tenant's tenant_id", async () => {
        const payload: Record<string, unknown> = { tenant_id: B.tenantId };
        // Provide minimum required fields per table.
        if (table === "packages") Object.assign(payload, { name: "X", price: 1, kind: "hotspot" });
        if (table === "customers")
          Object.assign(payload, { full_name: "X", customer_type: "hotspot" });
        if (table === "routers") Object.assign(payload, { name: "X" });
        if (table === "payments") Object.assign(payload, { amount: 1, status: "pending" });
        if (table === "sessions") Object.assign(payload, { status: "active" });
        if (table === "vouchers")
          Object.assign(payload, {
            code: `X-${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
          });
        if (table === "support_tickets") Object.assign(payload, { subject: "X" });
        if (table === "captive_portals") Object.assign(payload, { welcome_text: "x" });

        const { error } = await A.client.from(table).insert(payload).select("id").single();
        expect(error).not.toBeNull();
      });
    });
  }

  describe("tenants table", () => {
    it("user A cannot read tenant B", async () => {
      const { data } = await A.client
        .from("tenants")
        .select("id")
        .eq("id", B.tenantId)
        .maybeSingle();
      expect(data).toBeNull();
    });

    it("user A cannot update tenant B", async () => {
      const { data } = await A.client
        .from("tenants")
        .update({ name: "hijacked" })
        .eq("id", B.tenantId)
        .select("id");
      expect(data ?? []).toHaveLength(0);
    });
  });

  describe("user_roles table", () => {
    it("user A cannot read user B's role rows", async () => {
      const { data } = await A.client.from("user_roles").select("user_id").eq("user_id", B.userId);
      expect(data ?? []).toHaveLength(0);
    });

    it("user A cannot insert a role (non-super-admin)", async () => {
      const { error } = await A.client
        .from("user_roles")
        .insert({ user_id: A.userId, role: "super_admin" });
      expect(error).not.toBeNull();
    });
  });

  describe("profiles table", () => {
    it("user A cannot change their own tenant_id (cross-tenant takeover)", async () => {
      await A.client.from("profiles").update({ tenant_id: B.tenantId }).eq("id", A.userId);
      const { data } = await admin.from("profiles").select("tenant_id").eq("id", A.userId).single();
      expect(data?.tenant_id).toBe(A.tenantId);
      // ...and therefore still cannot see tenant B's rows
      const { data: rows } = await A.client
        .from("routers")
        .select("id")
        .eq("tenant_id", B.tenantId);
      expect(rows ?? []).toHaveLength(0);
    });

    it("user A can still update their own full_name", async () => {
      const { error } = await A.client
        .from("profiles")
        .update({ full_name: "Renamed A" })
        .eq("id", A.userId);
      expect(error).toBeNull();
    });

    it("user A cannot insert a profile row for another user", async () => {
      const { error } = await A.client
        .from("profiles")
        .insert({ id: crypto.randomUUID(), tenant_id: B.tenantId });
      expect(error).not.toBeNull();
    });
    it("user A cannot read user B's profile", async () => {
      const { data } = await A.client
        .from("profiles")
        .select("id")
        .eq("id", B.userId)
        .maybeSingle();
      expect(data).toBeNull();
    });
  });
});
