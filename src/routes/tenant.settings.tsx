import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { MfaSecurityCard } from "@/components/mfa-security-card";
import { TenantServiceSettings } from "@/components/tenant-service-settings";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/tenant/settings")({ component: Settings });

const empty = {
  name: "",
  primary_color: "",
  mpesa_paybill: "",
  mpesa_till: "",
  bank_name: "",
  bank_account_name: "",
  bank_account_number: "",
  bank_branch: "",
  payment_instructions: "",
  support_phone: "",
  support_email: "",
};

function Settings() {
  const qc = useQueryClient();
  const { tenantId, user, loading } = useAuth();
  const [verified, setVerified] = useState(false);
  const [password, setPassword] = useState("");
  const [verifying, setVerifying] = useState(false);
  const { data: tenant } = useQuery({
    queryKey: ["tenant", tenantId],
    enabled: !!tenantId && verified,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("*")
        .eq("id", tenantId!)
        .single();
      if (error) throw error;
      return data;
    },
  });
  const [form, setForm] = useState(empty);
  useEffect(() => {
    if (tenant) {
      const t = tenant as unknown as Record<string, string | null>;
      setForm({
        name: t.name ?? "",
        primary_color: t.primary_color ?? "",
        mpesa_paybill: t.mpesa_paybill ?? "",
        mpesa_till: t.mpesa_till ?? "",
        bank_name: t.bank_name ?? "",
        bank_account_name: t.bank_account_name ?? "",
        bank_account_number: t.bank_account_number ?? "",
        bank_branch: t.bank_branch ?? "",
        payment_instructions: t.payment_instructions ?? "",
        support_phone: t.support_phone ?? "",
        support_email: t.support_email ?? "",
      });
    }
  }, [tenant]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("tenants").update(form).eq("id", tenantId!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["tenant"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function verifyPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user?.email || !password) {
      toast.error("Enter your account password to continue.");
      return;
    }
    setVerifying(true);
    try {
      const url = import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
      const key =
        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
      if (!url || !key) throw new Error("Password verification is not configured.");

      const authStorage = new Map<string, string>();
      const verifier = createClient<Database>(url, key, {
        auth: {
          storageKey: `settings-password-check-${crypto.randomUUID()}`,
          storage: {
            getItem: (storageKey) => authStorage.get(storageKey) ?? null,
            setItem: (storageKey, value) => void authStorage.set(storageKey, value),
            removeItem: (storageKey) => void authStorage.delete(storageKey),
          },
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
      const { data, error } = await verifier.auth.signInWithPassword({
        email: user.email,
        password,
      });
      if (error || data.user?.id !== user.id)
        throw new Error("The password is incorrect. Please try again.");
      setVerified(true);
      setPassword("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not verify your password.");
    } finally {
      setVerifying(false);
    }
  }

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading settings…</div>;
  if (!verified) {
    return (
      <div>
        <PageHeader
          title="Settings"
          description="Confirm your account password to access tenant settings and sensitive credentials."
        />
        <form className="mx-auto max-w-md rounded-xl border bg-card p-5" onSubmit={verifyPassword}>
          <Label htmlFor="settings-password">Account password</Label>
          <Input
            id="settings-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1"
            required
            autoFocus
          />
          <Button className="mt-4 w-full" type="submit" disabled={verifying || !password}>
            {verifying ? "Verifying…" : "Unlock settings"}
          </Button>
        </form>
      </div>
    );
  }

  const slug = (tenant as { slug?: string } | undefined)?.slug;
  const portalUrl =
    slug && typeof window !== "undefined" ? `${window.location.origin}/p/${slug}` : "";

  function field<K extends keyof typeof form>(k: K, label: string, placeholder?: string) {
    return (
      <div>
        <Label>{label}</Label>
        <Input
          value={form[k]}
          placeholder={placeholder}
          onChange={(e) => setForm({ ...form, [k]: e.target.value })}
          className="mt-1"
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Branding, receiving details, customer support, and service credentials."
      />
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border bg-card p-5">
          <h3 className="font-semibold mb-4">Branding</h3>
          <div className="space-y-3">
            {field("name", "ISP name")}
            {field("primary_color", "Primary color", "#0ea5e9")}
            {portalUrl && (
              <div className="rounded-md bg-muted p-3 text-xs">
                <p className="text-muted-foreground">Public captive portal</p>
                <a
                  href={portalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-primary break-all"
                >
                  {portalUrl}
                </a>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <h3 className="font-semibold mb-1">Receiving details</h3>
          <p className="text-xs text-muted-foreground mb-4">
            New online payments are sent directly to your M-Pesa account using the Daraja
            credentials configured below. These details are for customer instructions and records;
            they are not API credentials.
          </p>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {field("mpesa_paybill", "M-Pesa PayBill")}
              {field("mpesa_till", "M-Pesa Till / Buy Goods")}
            </div>
            {field("bank_name", "Bank name")}
            <div className="grid grid-cols-2 gap-3">
              {field("bank_account_name", "Account name")}
              {field("bank_account_number", "Account number")}
            </div>
            {field("bank_branch", "Branch")}
            <div>
              <Label>Payment instructions</Label>
              <Textarea
                value={form.payment_instructions}
                onChange={(e) => setForm({ ...form, payment_instructions: e.target.value })}
                placeholder="e.g. Use your phone number as the account reference."
                className="mt-1"
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5 md:col-span-2">
          <h3 className="font-semibold mb-4">Customer support</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {field("support_phone", "Support phone / WhatsApp")}
            {field("support_email", "Support email")}
          </div>
        </div>
      </div>
      <div className="mt-6">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          Save changes
        </Button>
      </div>

      <div className="mt-8">
        <h3 className="text-lg font-semibold mb-3">Security &amp; Authentication</h3>
        <MfaSecurityCard />
      </div>
      <TenantServiceSettings />
    </div>
  );
}
