import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Activity, Clock3, LogOut, Mail, Phone, RefreshCw, Wifi } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/pppoe/$slug")({
  head: () => ({
    meta: [
      { title: "PPPoE account portal" },
      { name: "description", content: "Manage your PPPoE internet account and renew your plan." },
      { name: "robots", content: "noindex, nofollow" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
    ],
  }),
  component: PppoePortalPage,
});

type Package = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  duration_value: number | null;
  duration_unit: string | null;
  download_kbps: number | null;
  upload_kbps: number | null;
};

type PortalAccount = {
  customer: {
    full_name: string | null;
    pppoe_username: string;
    status: string;
    expires_at: string | null;
    last_ip: string | null;
    last_seen_at: string | null;
    usage_bytes_in: number;
    usage_bytes_out: number;
  };
  tenant: {
    name: string;
    primary_color: string | null;
    logo_url: string | null;
    support_phone: string | null;
    support_email: string | null;
  };
  currentPackage: Package | null;
  packages: Package[];
  payments: Array<{
    id: string;
    amount: number;
    status: string;
    mpesa_receipt: string | null;
    created_at: string;
    package_name: string | null;
  }>;
  invoices: Array<{
    id: string;
    invoice_number: string;
    package_id: string;
    package_name: string;
    amount: number;
    status: string;
    service_period_start: string;
    service_period_end: string;
    issued_at: string;
    due_at: string;
    paid_at: string | null;
  }>;
};

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

function PppoePortalPage() {
  const { slug } = Route.useParams();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [lastPaymentId, setLastPaymentId] = useState<string | null>(null);

  const accountQuery = useQuery({
    queryKey: ["pppoe-portal-account", slug],
    queryFn: async () => {
      const response = await fetch(`/api/public/pppoe-portal/${encodeURIComponent(slug)}/account`, {
        credentials: "same-origin",
      });
      if (response.status === 401) return null;
      const result = await responseJson(response);
      if (!response.ok) throw new Error(String(result.error ?? "Could not load your account."));
      return result as unknown as PortalAccount;
    },
    refetchInterval: (query) =>
      query.state.data
        ? query.state.data.payments.some((payment) => payment.status === "pending")
          ? 5000
          : 30000
        : false,
  });

  const login = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/public/pppoe-portal/${encodeURIComponent(slug)}/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username, password }),
      });
      const result = await responseJson(response);
      if (!response.ok) throw new Error(String(result.error ?? "Could not sign in."));
    },
    onSuccess: async () => {
      setPassword("");
      await queryClient.invalidateQueries({ queryKey: ["pppoe-portal-account", slug] });
    },
    onError: (error) => toast.error(error.message),
  });

  const logout = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/public/pppoe-portal/${encodeURIComponent(slug)}/logout`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Could not sign out.");
    },
    onSuccess: async () => {
      setLastPaymentId(null);
      queryClient.setQueryData(["pppoe-portal-account", slug], null);
      await queryClient.invalidateQueries({ queryKey: ["pppoe-portal-account", slug] });
    },
    onError: (error) => toast.error(error.message),
  });

  const checkout = useMutation({
    mutationFn: async (packageId: string) => {
      const response = await fetch(
        `/api/public/pppoe-portal/${encodeURIComponent(slug)}/checkout`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ packageId }),
        },
      );
      const result = await responseJson(response);
      if (!response.ok) throw new Error(String(result.error ?? "Could not start payment."));
      if (typeof result.paymentId !== "string")
        throw new Error("Could not verify the payment request.");
      return result.paymentId;
    },
    onSuccess: async (paymentId) => {
      setLastPaymentId(paymentId);
      toast.success("Check your registered phone for the M-Pesa prompt.");
      await queryClient.invalidateQueries({ queryKey: ["pppoe-portal-account", slug] });
    },
    onError: (error) => toast.error(error.message),
  });

  const account = accountQuery.data;
  const payment = account?.payments.find((item) => item.id === lastPaymentId);
  const outstandingInvoice = account?.invoices.find((invoice) =>
    ["pending", "overdue"].includes(invoice.status),
  );
  const usage = account
    ? Number(account.customer.usage_bytes_in ?? 0) + Number(account.customer.usage_bytes_out ?? 0)
    : 0;

  function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    login.mutate();
  }

  if (accountQuery.isPending) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center p-6">
        Loading your account…
      </main>
    );
  }

  if (accountQuery.isError) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center p-6">
        <h1 className="text-xl font-semibold">Account unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">{accountQuery.error.message}</p>
        <Button
          className="mt-4 self-start"
          variant="outline"
          onClick={() => void accountQuery.refetch()}
        >
          <RefreshCw className="mr-2 h-4 w-4" /> Try again
        </Button>
      </main>
    );
  }

  if (!account) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <section className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          <p className="text-sm font-medium text-primary">PPPoE customer portal</p>
          <h1 className="mt-2 text-2xl font-semibold">Sign in to your account</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Use the PPPoE username and password provided by your internet provider.
          </p>
          <form className="mt-6 space-y-4" onSubmit={submitLogin}>
            <div className="space-y-2">
              <Label htmlFor="pppoe-portal-username">PPPoE username</Label>
              <Input
                id="pppoe-portal-username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                required
                minLength={3}
                maxLength={64}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pppoe-portal-password">PPPoE password</Label>
              <Input
                id="pppoe-portal-password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <Button className="w-full" disabled={login.isPending}>
              {login.isPending ? "Signing in…" : "Sign in"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Forgot your login? Contact your internet provider to reset your PPPoE credentials.
            </p>
          </form>
        </section>
      </main>
    );
  }

  const brandColor = account.tenant.primary_color ?? "#0ea5e9";
  const pendingStatus = payment?.status === "pending" || payment?.status === "processing";

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-5 sm:p-6">
          <div className="flex items-center gap-3">
            {account.tenant.logo_url ? (
              <img
                src={account.tenant.logo_url}
                alt=""
                className="h-12 w-12 rounded-lg object-contain"
              />
            ) : (
              <div
                className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10"
                style={{ color: brandColor }}
              >
                <Wifi className="h-6 w-6" />
              </div>
            )}
            <div>
              <p className="text-sm text-muted-foreground">{account.tenant.name}</p>
              <h1 className="text-xl font-semibold">PPPoE account</h1>
            </div>
          </div>
          <Button variant="outline" onClick={() => logout.mutate()} disabled={logout.isPending}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </header>

        <section className="rounded-2xl border bg-card p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">
                Hello{account.customer.full_name ? `, ${account.customer.full_name}` : ""}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Username:{" "}
                <span className="font-medium text-foreground">
                  {account.customer.pppoe_username}
                </span>
              </p>
            </div>
            <Badge variant={account.customer.status === "active" ? "default" : "secondary"}>
              {account.customer.status}
            </Badge>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <InfoCard
              icon={Wifi}
              label="Current plan"
              value={account.currentPackage?.name ?? "No plan"}
            />
            <InfoCard
              icon={Clock3}
              label="Service expiry"
              value={
                account.customer.expires_at
                  ? new Date(account.customer.expires_at).toLocaleDateString()
                  : "Not set"
              }
            />
            <InfoCard icon={Activity} label="Reported usage" value={formatBytes(usage)} />
            <InfoCard
              icon={Activity}
              label="Last reported IP"
              value={account.customer.last_ip ?? "Not connected"}
            />
          </div>
        </section>

        {lastPaymentId && (
          <section className="rounded-xl border bg-card p-4" aria-live="polite">
            <p className="font-medium">
              {pendingStatus
                ? "M-Pesa prompt sent"
                : payment?.status === "success"
                  ? "Payment confirmed"
                  : payment?.status === "failed"
                    ? "Payment not completed"
                    : "Checking payment status"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {pendingStatus
                ? "Complete the prompt on your registered phone. This page will refresh when payment is confirmed."
                : payment?.status === "success"
                  ? "Your broadband plan has been renewed. Your router will apply the updated service shortly."
                  : payment?.status === "failed"
                    ? "You can choose a package below and try again."
                    : "Refreshing payment status…"}
            </p>
          </section>
        )}

        {account.invoices.length > 0 && (
          <section className="rounded-2xl border bg-card p-5 sm:p-6">
            <h2 className="text-lg font-semibold">Invoices</h2>
            <div className="mt-3 divide-y">
              {account.invoices.map((invoice) => {
                const outstanding = ["pending", "overdue"].includes(invoice.status);
                return (
                  <div
                    key={invoice.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">
                        {invoice.invoice_number} · {invoice.package_name}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {invoice.service_period_start
                          ? `Service period starts ${new Date(invoice.service_period_start).toLocaleDateString()} · `
                          : ""}
                        {outstanding
                          ? `Due ${new Date(invoice.due_at).toLocaleDateString()}`
                          : invoice.paid_at
                            ? `Paid ${new Date(invoice.paid_at).toLocaleDateString()}`
                            : invoice.status}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={invoice.status === "paid" ? "default" : "secondary"}>
                        {invoice.status}
                      </Badge>
                      <span className="font-semibold">
                        KES {Number(invoice.amount).toLocaleString()}
                      </span>
                      {outstanding && (
                        <Button
                          style={{ backgroundColor: brandColor }}
                          disabled={checkout.isPending || pendingStatus}
                          onClick={() => checkout.mutate(invoice.package_id)}
                        >
                          {checkout.isPending ? "Starting…" : "Pay with M-Pesa"}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {outstandingInvoice && (
              <p className="mt-2 text-xs text-muted-foreground">
                Your current renewal invoice must be paid before another plan can be selected.
              </p>
            )}
          </section>
        )}

        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Renew your broadband</h2>
            <p className="text-sm text-muted-foreground">
              Select a PPPoE plan. M-Pesa will send a prompt to your registered phone.
            </p>
          </div>
          {account.packages.length === 0 ? (
            <div className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
              No renewal packages are currently available.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {account.packages.map((pkg) => (
                <article key={pkg.id} className="rounded-2xl border bg-card p-5">
                  <h3 className="font-semibold">{pkg.name}</h3>
                  {pkg.description && (
                    <p className="mt-1 text-sm text-muted-foreground">{pkg.description}</p>
                  )}
                  <p className="mt-4 text-2xl font-bold" style={{ color: brandColor }}>
                    KES {Number(pkg.price).toLocaleString()}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Speed: {pkg.download_kbps ?? "—"}/{pkg.upload_kbps ?? "—"} kbps
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Duration: {pkg.duration_value ?? "—"} {pkg.duration_unit ?? ""}
                  </p>
                  <Button
                    className="mt-4 w-full"
                    style={{ backgroundColor: brandColor }}
                    disabled={
                      checkout.isPending ||
                      pendingStatus ||
                      Boolean(outstandingInvoice && outstandingInvoice.package_id !== pkg.id)
                    }
                    onClick={() => checkout.mutate(pkg.id)}
                  >
                    {checkout.isPending
                      ? "Starting payment…"
                      : outstandingInvoice
                        ? outstandingInvoice.package_id === pkg.id
                          ? "Pay invoice with M-Pesa"
                          : "Invoice due"
                        : "Renew with M-Pesa"}
                  </Button>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border bg-card p-5 sm:p-6">
          <h2 className="text-lg font-semibold">Recent payments</h2>
          {account.payments.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No payments found for this account.
            </p>
          ) : (
            <div className="mt-3 divide-y">
              {account.payments.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {item.package_name ?? "PPPoE payment"} · KES{" "}
                      {Number(item.amount).toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(item.created_at).toLocaleString()}
                    </p>
                    {item.mpesa_receipt && (
                      <p className="text-xs text-muted-foreground">
                        M-Pesa receipt: {item.mpesa_receipt}
                      </p>
                    )}
                  </div>
                  <Badge variant={item.status === "success" ? "default" : "secondary"}>
                    {item.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </section>

        {(account.tenant.support_phone || account.tenant.support_email) && (
          <footer className="flex flex-wrap gap-4 rounded-2xl border bg-card p-5 text-sm">
            <span className="font-medium">Need help?</span>
            {account.tenant.support_phone && (
              <a
                className="inline-flex items-center gap-2 text-primary"
                href={`tel:${account.tenant.support_phone}`}
              >
                <Phone className="h-4 w-4" /> Call support
              </a>
            )}
            {account.tenant.support_email && (
              <a
                className="inline-flex items-center gap-2 text-primary"
                href={`mailto:${account.tenant.support_email}`}
              >
                <Mail className="h-4 w-4" /> Email support
              </a>
            )}
          </footer>
        )}
      </div>
    </main>
  );
}

function InfoCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Wifi;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border bg-muted/30 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-4 w-4" /> {label}
      </div>
      <p className="mt-2 font-semibold">{value}</p>
    </div>
  );
}
