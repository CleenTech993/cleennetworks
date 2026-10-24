import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Wifi, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/p/$slug")({
  head: () => ({
    meta: [
      { title: "Wi-Fi access — connect" },
      { name: "description", content: "Buy internet access, redeem your voucher, or reconnect an active package." },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
    ],
  }),
  component: PortalPage,
});

interface PortalData {
  tenant: { id: string; name: string; slug: string; primary_color: string | null; logo_url: string | null };
  portal: { logo_url: string | null; background_url: string | null; primary_color: string | null; welcome_text: string | null; terms_text: string | null; enable_voucher: boolean; enable_otp: boolean } | null;
  packages: Array<{ id: string; name: string; description: string | null; price: number; duration_value: number | null; duration_unit: string | null; download_kbps: number | null; kind: string }>;
}

function PortalPage() {
  const { slug } = Route.useParams();
  const { data, isLoading, error } = useQuery<PortalData>({
    queryKey: ["portal", slug],
    queryFn: async () => {
      const res = await fetch(`/api/public/portal/${slug}`);
      if (!res.ok) throw new Error("Portal unavailable");
      return res.json();
    },
  });

  const primary = data?.portal?.primary_color ?? data?.tenant?.primary_color ?? "#0ea5e9";

  if (isLoading) {
    return <div className="grid min-h-screen place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (error || !data) {
    return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Portal not found.</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="px-4 py-10" style={{ background: `linear-gradient(160deg, ${primary}22, transparent 60%)` }}>
        <div className="mx-auto max-w-md text-center">
          {data.portal?.logo_url || data.tenant.logo_url ? (
            <img src={(data.portal?.logo_url ?? data.tenant.logo_url) as string} alt={data.tenant.name} className="mx-auto h-12" />
          ) : (
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-md" style={{ backgroundColor: `${primary}22`, color: primary }}>
              <Wifi className="h-6 w-6" />
            </div>
          )}
          <h1 className="mt-3 text-2xl font-bold">{data.tenant.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.portal?.welcome_text ?? "Connect to Wi-Fi — buy, reconnect, or redeem a voucher."}
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-md px-4 pb-12">
        <Tabs defaultValue="buy">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="buy">Buy</TabsTrigger>
            <TabsTrigger value="reconnect">Reconnect</TabsTrigger>
            <TabsTrigger value="status">Status</TabsTrigger>
            <TabsTrigger value="voucher" disabled={data.portal?.enable_voucher === false}>Voucher</TabsTrigger>
          </TabsList>
          <TabsContent value="buy" className="mt-4">
            <BuyFlow slug={slug} packages={data.packages} primary={primary} />
          </TabsContent>
          <TabsContent value="reconnect" className="mt-4">
            <ReconnectFlow slug={slug} primary={primary} />
          </TabsContent>
          <TabsContent value="status" className="mt-4">
            <StatusFlow slug={slug} primary={primary} />
          </TabsContent>
          <TabsContent value="voucher" className="mt-4">
            <VoucherFlow slug={slug} primary={primary} />
          </TabsContent>
        </Tabs>

        {data.portal?.terms_text && (
          <p className="mt-6 text-center text-xs text-muted-foreground whitespace-pre-line">{data.portal.terms_text}</p>
        )}
      </div>
    </div>
  );
}

function BuyFlow({ slug, packages, primary }: { slug: string; packages: PortalData["packages"]; primary: string }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function pay() {
    if (!picked || !phone) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/portal/${slug}/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packageId: picked, phone }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setPaymentId(json.paymentId);
      toast.success("Check your phone for the M-Pesa prompt");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (paymentId) return <PaymentWaiting slug={slug} paymentId={paymentId} primary={primary} />;

  return (
    <div>
      <div className="space-y-2">
        {packages.length === 0 && (
          <p className="text-sm text-muted-foreground">No packages available yet.</p>
        )}
        {packages.map((p) => {
          const active = picked === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setPicked(p.id)}
              className="block w-full rounded-xl border bg-card p-4 text-left transition"
              style={active ? { borderColor: primary, boxShadow: `0 0 0 2px ${primary}33` } : undefined}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.duration_value} {p.duration_unit}{p.download_kbps ? ` · ${Math.round(p.download_kbps/1024)}Mbps` : ""}
                  </p>
                </div>
                <p className="text-base font-semibold">KES {Number(p.price).toFixed(0)}</p>
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-5">
        <Label htmlFor="phone">M-Pesa phone</Label>
        <Input id="phone" inputMode="tel" placeholder="07XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1" />
      </div>
      <Button className="mt-4 w-full" style={{ backgroundColor: primary }} disabled={!picked || !phone || submitting} onClick={pay}>
        {submitting ? "Sending prompt…" : "Pay with M-Pesa"}
      </Button>
    </div>
  );
}

function PaymentWaiting({ slug, paymentId, primary }: { slug: string; paymentId: string; primary: string }) {
  const [status, setStatus] = useState<string>("pending");
  const [voucher, setVoucher] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const t = setInterval(async () => {
      const res = await fetch(`/api/public/portal/${slug}/payment-status?id=${paymentId}`);
      if (!res.ok) return;
      const json = await res.json();
      if (!active) return;
      setStatus(json.status);
      if (json.voucher_code) setVoucher(json.voucher_code);
      if (json.status === "success" || json.status === "failed") clearInterval(t);
    }, 3000);
    return () => { active = false; clearInterval(t); };
  }, [paymentId, slug]);

  if (status === "success") {
    return (
      <div className="rounded-xl border bg-card p-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10" style={{ color: primary }} />
        <h2 className="mt-3 text-lg font-semibold">You're online</h2>
        {voucher && (
          <>
            <p className="mt-1 text-sm text-muted-foreground">Use this voucher on the Wi-Fi page:</p>
            <p className="mt-3 inline-block rounded-md bg-muted px-4 py-2 font-mono text-lg tracking-widest">{voucher}</p>
          </>
        )}
      </div>
    );
  }
  if (status === "failed") {
    return (
      <div className="rounded-xl border bg-card p-6 text-center">
        <p className="font-medium">Payment failed</p>
        <p className="mt-1 text-sm text-muted-foreground">Please try again.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border bg-card p-6 text-center">
      <Loader2 className="mx-auto h-8 w-8 animate-spin" style={{ color: primary }} />
      <p className="mt-3 font-medium">Waiting for M-Pesa…</p>
      <p className="mt-1 text-sm text-muted-foreground">Approve the prompt on your phone.</p>
    </div>
  );
}

interface ReconnectResult {
  active: boolean;
  reason?: string;
  package?: { name: string; duration_value: number | null; duration_unit: string | null } | null;
  expires_at?: string;
  remaining_minutes?: number;
  voucher_code?: string | null;
  mpesa_receipt?: string | null;
}

function ReconnectFlow({ slug, primary }: { slug: string; primary: string }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReconnectResult | null>(null);

  async function go() {
    setBusy(true);
    try {
      const res = await fetch(`/api/public/portal/${slug}/reconnect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: phone || undefined, mpesaCode: code }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setResult(json);
      if (!json.active) toast.error(json.reason ?? "No active package");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (result?.active) {
    return (
      <div className="rounded-xl border bg-card p-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10" style={{ color: primary }} />
        <h2 className="mt-3 text-lg font-semibold">You're online</h2>
        {result.package && <p className="mt-1 text-sm">{result.package.name}</p>}
        <p className="mt-1 text-xs text-muted-foreground">
          Expires {result.expires_at ? new Date(result.expires_at).toLocaleString() : "—"}
          {typeof result.remaining_minutes === "number" && ` · ${result.remaining_minutes} min left`}
        </p>
        {result.voucher_code && (
          <p className="mt-3 inline-block rounded-md bg-muted px-4 py-2 font-mono text-sm tracking-widest">{result.voucher_code}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Enter the M-Pesa transaction code from your payment confirmation SMS. Adding your phone number is optional.</p>
      <div>
        <Label htmlFor="rphone">Phone number</Label>
        <Input id="rphone" inputMode="tel" placeholder="07XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1" />
      </div>
      <div>
        <Label htmlFor="rcode">M-Pesa code</Label>
        <Input id="rcode" autoCapitalize="characters" placeholder="e.g. SFE1A2B3CD" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="mt-1 font-mono tracking-widest" />
      </div>
      <Button className="w-full" style={{ backgroundColor: primary }} disabled={busy || code.trim().length < 6} onClick={go}>
        {busy ? "Checking…" : "Reconnect"}
      </Button>
    </div>
  );
}

interface StatusResp {
  active: { amount: number; expires_at: string; mpesa_receipt: string | null } | null;
  history: Array<{ amount: number; status: string; created_at: string; mpesa_receipt: string | null }>;
}

function StatusFlow({ slug, primary }: { slug: string; primary: string }) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<StatusResp | null>(null);

  async function check() {
    if (!phone) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/public/portal/${slug}/status?phone=${encodeURIComponent(phone)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setData(json);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="sphone">Phone number</Label>
        <Input id="sphone" inputMode="tel" placeholder="07XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1" />
      </div>
      <Button className="w-full" style={{ backgroundColor: primary }} disabled={busy || !phone} onClick={check}>
        {busy ? "Checking…" : "Check status"}
      </Button>

      {data && (
        <div className="mt-2 rounded-xl border bg-card p-4">
          {data.active ? (
            <div>
              <p className="font-medium">Active package</p>
              <p className="text-xs text-muted-foreground mt-1">Expires {new Date(data.active.expires_at).toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Receipt {data.active.mpesa_receipt ?? "—"}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No active package on this number.</p>
          )}
          {data.history.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-muted-foreground mb-2">Recent transactions</p>
              <ul className="space-y-1.5 text-xs">
                {data.history.slice(0, 5).map((h, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{new Date(h.created_at).toLocaleString()}</span>
                    <span>KES {Number(h.amount).toFixed(0)}</span>
                    <span className="capitalize">{h.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function VoucherFlow({ slug, primary }: { slug: string; primary: string }) {
  const [code, setCode] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function redeem() {
    setBusy(true);
    try {
      const res = await fetch(`/api/public/portal/${slug}/voucher`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setDone(true);
      toast.success("Voucher redeemed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border bg-card p-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10" style={{ color: primary }} />
        <p className="mt-3 font-medium">You're online</p>
      </div>
    );
  }
  return (
    <div>
      <Label htmlFor="vcode">Voucher code</Label>
      <Input id="vcode" autoCapitalize="characters" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCD1234" className="mt-1 font-mono tracking-widest" />
      <Button className="mt-4 w-full" style={{ backgroundColor: primary }} disabled={!code || busy} onClick={redeem}>
        {busy ? "Checking…" : "Redeem voucher"}
      </Button>
    </div>
  );
}
