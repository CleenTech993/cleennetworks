import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, CheckCircle2, Tv } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildHotspotLoginRedirect } from "@/lib/hotspot-redirect";
import { PortalHeader } from "@/components/portal/header";
import { PlanOption } from "@/components/portal/plan-option";
import { PortalThemeFrame } from "@/components/portal/theme-frame";
import { PORTAL_THEMES, portalAccent, resolveThemeId, type PortalThemeDef } from "@/lib/portal-themes";

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
  portal: { logo_url: string | null; background_url: string | null; primary_color: string | null; welcome_text: string | null; terms_text: string | null; enable_voucher: boolean; enable_otp: boolean; theme?: string | null } | null;
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

  const brand = data?.portal?.primary_color ?? data?.tenant?.primary_color ?? "#0ea5e9";
  const themeId = resolveThemeId(data?.portal?.theme);
  const theme = PORTAL_THEMES[themeId];
  // Brand colour adjusted for this theme (e.g. lightened on a dark theme) so it stays legible.
  const primary = portalAccent(themeId, brand);

  if (isLoading) {
    return <div className="grid min-h-screen place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (error || !data) {
    return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Portal not found.</div>;
  }

  return (
    <PortalThemeFrame themeId={themeId} brand={brand} className="min-h-screen">
      <PortalHeader
        theme={theme}
        name={data.tenant.name}
        logoUrl={data.portal?.logo_url ?? data.tenant.logo_url}
        backgroundUrl={data.portal?.background_url}
        welcomeText={data.portal?.welcome_text ?? "Connect to Wi-Fi — buy, reconnect, or redeem a voucher."}
        accent={primary}
      />

      <div className={theme.sheet ? "pt-sheet pt-6" : undefined}>
      <div className="mx-auto max-w-md px-4 pb-12">
        <Tabs defaultValue="buy">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger className="px-1 text-xs sm:text-sm" value="buy">Buy</TabsTrigger>
            <TabsTrigger className="px-1 text-xs sm:text-sm" value="reconnect">Reconnect</TabsTrigger>
            <TabsTrigger className="px-1 text-xs sm:text-sm" value="status">Status</TabsTrigger>
            <TabsTrigger className="px-1 text-xs sm:text-sm" value="voucher" disabled={data.portal?.enable_voucher === false}>Voucher</TabsTrigger>
            <TabsTrigger className="px-1 text-xs sm:text-sm" value="tv">TV</TabsTrigger>
          </TabsList>
          <TabsContent value="buy" className="mt-4">
            <BuyFlow slug={slug} packages={data.packages} primary={primary} theme={theme} />
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
          <TabsContent value="tv" className="mt-4">
            <TvFlow slug={slug} packages={data.packages} primary={primary} theme={theme} />
          </TabsContent>
        </Tabs>

        {data.portal?.terms_text && (
          <p className="mt-6 text-center text-xs text-muted-foreground whitespace-pre-line">{data.portal.terms_text}</p>
        )}
      </div>
      </div>
    </PortalThemeFrame>
  );
}

function BuyFlow({ slug, packages, primary, theme }: { slug: string; packages: PortalData["packages"]; primary: string; theme: PortalThemeDef }) {
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
        {packages.map((p) => (
          <PlanOption key={p.id} theme={theme} plan={p} selected={picked === p.id} onSelect={() => setPicked(p.id)} accent={primary} />
        ))}
      </div>
      <div className="mt-5">
        <Label htmlFor="phone">M-Pesa phone</Label>
        <Input id="phone" inputMode="tel" placeholder="07XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1" />
      </div>
      <Button className="pt-btn mt-4 w-full" style={{ backgroundColor: primary }} disabled={!picked || !phone || submitting} onClick={pay}>
        {submitting ? "Sending prompt…" : "Pay with M-Pesa"}
      </Button>
    </div>
  );
}

function PaymentWaiting({ slug, paymentId, primary, tv = false }: { slug: string; paymentId: string; primary: string; tv?: boolean }) {
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

  if (status === "success" && tv) {
    return (
      <div className="pt-surface rounded-xl border bg-card p-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10" style={{ color: primary }} />
        <h2 className="mt-3 text-lg font-semibold">Payment received</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your TV will be allowed on the Wi-Fi within about 2 minutes. If it is already connected,
          switch the TV's Wi-Fi off and on again, then open an app.
        </p>
      </div>
    );
  }
  if (status === "success") {
    return (
      <div className="pt-surface rounded-xl border bg-card p-6 text-center">
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
      <div className="pt-surface rounded-xl border bg-card p-6 text-center">
        <p className="font-medium">Payment failed</p>
        <p className="mt-1 text-sm text-muted-foreground">Please try again.</p>
      </div>
    );
  }
  return (
    <div className="pt-surface rounded-xl border bg-card p-6 text-center">
      <Loader2 className="mx-auto h-8 w-8 animate-spin" style={{ color: primary }} />
      <p className="mt-3 font-medium">Waiting for M-Pesa…</p>
      <p className="mt-1 text-sm text-muted-foreground">Approve the prompt on your phone.</p>
    </div>
  );
}

interface TvStatus { registered: boolean; active: boolean; expires_at: string | null }

function TvFlow({ slug, packages, primary, theme }: { slug: string; packages: PortalData["packages"]; primary: string; theme: PortalThemeDef }) {
  const [mac, setMac] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [randomized, setRandomized] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<TvStatus | null>(null);

  async function checkStatus() {
    if (!mac) return;
    setChecking(true);
    try {
      const res = await fetch(`/api/public/portal/${slug}/tv?mac=${encodeURIComponent(mac)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setStatus(json);
    } catch (e) {
      setStatus(null);
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setChecking(false);
    }
  }

  async function pay() {
    if (!picked || !phone || !mac) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/portal/${slug}/tv`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mac, name: name || undefined, packageId: picked, phone }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setRandomized(!!json.randomizedMac);
      setPaymentId(json.paymentId);
      toast.success("Check your phone for the M-Pesa prompt");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (paymentId) {
    return (
      <div className="space-y-3">
        <PaymentWaiting slug={slug} paymentId={paymentId} primary={primary} tv />
        {randomized && (
          <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
            This looks like a private (randomised) Wi-Fi address. Make sure it is the address your TV shows
            for this Wi-Fi network, otherwise the TV will not connect.
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start gap-3 pt-surface rounded-xl border bg-card p-4">
        <Tv className="mt-0.5 h-5 w-5 shrink-0" style={{ color: primary }} />
        <p className="text-sm text-muted-foreground">
          Smart TVs can't open the login page. Enter your TV's Wi-Fi MAC address, pick a plan and pay —
          the TV is then allowed on the network automatically. Find the address in the TV's
          Settings &rarr; Network (or About / Status).
        </p>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <Label htmlFor="tv-mac">TV MAC address</Label>
          <Input id="tv-mac" placeholder="AA:BB:CC:DD:EE:FF" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
            value={mac} onChange={(e) => { setMac(e.target.value); setStatus(null); }} className="mt-1 font-mono" />
        </div>
        <div>
          <Label htmlFor="tv-name">TV name (optional)</Label>
          <Input id="tv-name" placeholder="Living room TV" value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
        </div>
      </div>

      {status && (
        <p className="mt-3 rounded-md bg-muted p-3 text-sm">
          {status.active
            ? `This TV is active until ${new Date(status.expires_at as string).toLocaleString()}. You can buy more time below.`
            : status.registered
              ? "This TV is registered but has no active plan."
              : "This TV isn't registered yet."}
        </p>
      )}
      <Button variant="outline" size="sm" className="mt-3" disabled={!mac || checking} onClick={checkStatus}>
        {checking ? "Checking…" : "Check TV status"}
      </Button>

      <div className="mt-5 space-y-2">
        {packages.length === 0 && <p className="text-sm text-muted-foreground">No packages available yet.</p>}
        {packages.map((p) => (
          <PlanOption key={p.id} theme={theme} plan={p} selected={picked === p.id} onSelect={() => setPicked(p.id)} accent={primary} />
        ))}
      </div>

      <div className="mt-5">
        <Label htmlFor="tv-phone">M-Pesa phone</Label>
        <Input id="tv-phone" inputMode="tel" placeholder="07XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1" />
      </div>
      <Button className="pt-btn mt-4 w-full" style={{ backgroundColor: primary }} disabled={!picked || !phone || !mac || submitting} onClick={pay}>
        {submitting ? "Sending prompt…" : "Pay with M-Pesa"}
      </Button>
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
      <div className="pt-surface rounded-xl border bg-card p-6 text-center">
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
      <Button className="pt-btn w-full" style={{ backgroundColor: primary }} disabled={busy || code.trim().length < 6} onClick={go}>
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
      <Button className="pt-btn w-full" style={{ backgroundColor: primary }} disabled={busy || !phone} onClick={check}>
        {busy ? "Checking…" : "Check status"}
      </Button>

      {data && (
        <div className="mt-2 pt-surface rounded-xl border bg-card p-4">
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
  const [done, setDone] = useState<"connecting" | "accepted" | null>(null);
  const [busy, setBusy] = useState(false);

  async function redeem() {
    setBusy(true);
    try {
      // The router's login page sends the customer here with ?mac=…&ip=…&login=<hotspot login URL>.
      const params = new URLSearchParams(window.location.search);
      const res = await fetch(`/api/public/portal/${slug}/voucher`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, mac: params.get("mac") || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      toast.success("Voucher redeemed");
      // Hand the browser to the router so the device is actually logged in.
      const target = buildHotspotLoginRedirect(params.get("login"), json.code ?? code);
      if (target) {
        setDone("connecting");
        window.location.href = target;
      } else {
        setDone("accepted");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="pt-surface rounded-xl border bg-card p-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10" style={{ color: primary }} />
        <p className="mt-3 font-medium">{done === "connecting" ? "Connecting you to the internet…" : "Voucher accepted"}</p>
        {done === "accepted" && (
          <p className="mt-1 text-sm text-muted-foreground">
            Open this page from the Wi-Fi network's sign-in screen to connect, or reconnect to the Wi-Fi.
          </p>
        )}
      </div>
    );
  }
  return (
    <div>
      <Label htmlFor="vcode">Voucher code</Label>
      <Input id="vcode" autoCapitalize="characters" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCD1234" className="mt-1 font-mono tracking-widest" />
      <Button className="pt-btn mt-4 w-full" style={{ backgroundColor: primary }} disabled={!code || busy} onClick={redeem}>
        {busy ? "Checking…" : "Redeem voucher"}
      </Button>
    </div>
  );
}
