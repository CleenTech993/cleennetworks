import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Copy,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  Tv,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildHotspotLoginRedirect,
  LOGIN_RETRY_DELAY_MS,
  recallVoucher,
  rememberVoucher,
  routerLoginFailed,
  routerParams,
} from "@/lib/hotspot-redirect";
import { normalizeMac } from "@/lib/devices";
import { PortalHeader } from "@/components/portal/header";
import { PlanOption } from "@/components/portal/plan-option";
import { PortalThemeFrame } from "@/components/portal/theme-frame";
import {
  PORTAL_THEMES,
  portalAccent,
  resolveThemeId,
  type PortalThemeDef,
} from "@/lib/portal-themes";

export const Route = createFileRoute("/p/$slug")({
  head: () => ({
    meta: [
      { title: "Wi-Fi access — connect" },
      {
        name: "description",
        content: "Buy internet access, redeem your voucher, or reconnect an active package.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
    ],
  }),
  component: PortalPage,
});

interface PortalData {
  tenant: {
    id: string;
    name: string;
    slug: string;
    primary_color: string | null;
    logo_url: string | null;
    support_phone: string | null;
    support_email: string | null;
  };
  portal: {
    logo_url: string | null;
    background_url: string | null;
    primary_color: string | null;
    welcome_text: string | null;
    terms_text: string | null;
    post_login_url: string | null;
    enable_voucher: boolean;
    enable_otp: boolean;
    theme?: string | null;
  } | null;
  packages: Array<{
    id: string;
    name: string;
    description: string | null;
    price: number;
    duration_value: number | null;
    duration_unit: string | null;
    download_kbps: number | null;
    kind: string;
  }>;
  announcements: Array<{
    id: string;
    title: string;
    body: string;
    starts_at: string;
    ends_at: string | null;
  }>;
  maintenance: Array<{
    id: string;
    title: string;
    body: string;
    mode: "notice" | "block_new" | "block_all";
    starts_at: string;
    ends_at: string | null;
  }>;
}

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

async function copyVoucher(code: string) {
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code);
      copied = true;
    }
  } catch {
    // Some captive-portal browsers expose the API but reject clipboard writes.
  }
  if (!copied) {
    const input = document.createElement("textarea");
    input.value = code;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    try {
      input.select();
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    } finally {
      input.remove();
    }
  }
  if (copied) toast.success("Voucher copied");
  else toast.error("Could not copy the voucher. Please select and copy it manually.");
}

function VoucherCopyButton({ code }: { code: string }) {
  return (
    <Button variant="outline" className="mx-auto mt-3 flex" onClick={() => void copyVoucher(code)}>
      <Copy aria-hidden="true" />
      Copy voucher
    </Button>
  );
}

function PortalPage() {
  const { slug } = Route.useParams();
  const [tab, setTab] = useState("buy");
  const [routerId, setRouterId] = useState<string | null | undefined>(undefined);
  const [deviceMac, setDeviceMac] = useState<string | null>(null);
  const [autoReconnectStatus, setAutoReconnectStatus] = useState<"checking" | "unavailable" | null>(
    null,
  );
  const autoReconnectAttempted = useRef(false);
  useEffect(() => {
    const store = sessionStore();
    const search = window.location.search;
    const query = new URLSearchParams(search);
    const params = routerParams(search, store, slug);
    setRouterId(params.routerId);
    const mac = normalizeMac(query.get("mac") ?? "");
    setDeviceMac(mac);
    // The router refused a voucher login and sent the customer back: show the voucher tab, which
    // keeps retrying (see VoucherFlow), instead of the purchase screen.
    if (routerLoginFailed(search) && recallVoucher(store, slug)) setTab("voucher");

    const saved = recallVoucher(store, slug);
    if (
      routerLoginFailed(search) ||
      autoReconnectAttempted.current ||
      !saved ||
      !mac ||
      !query.get("login") ||
      !query.get("router") ||
      params.routerId !== query.get("router")
    )
      return;

    autoReconnectAttempted.current = true;
    setAutoReconnectStatus("checking");
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/public/portal/${slug}/voucher`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code: saved.code,
            mac,
            routerId: params.routerId ?? undefined,
          }),
        });
        const result = await response.json();
        if (
          !response.ok ||
          typeof result.code !== "string" ||
          !/^[A-Za-z0-9._@-]{1,64}$/.test(result.code)
        )
          throw new Error(result.error ?? "Saved Wi-Fi session is unavailable.");
        if (cancelled) return;
        const target = buildHotspotLoginRedirect(
          query.get("login"),
          result.code,
          params.destination,
        );
        if (!target) throw new Error("Wi-Fi login link is unavailable.");
        rememberVoucher(store, result.code, slug);
        window.location.replace(target);
      } catch {
        if (!cancelled) setAutoReconnectStatus("unavailable");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug]);
  const { data, isLoading, error } = useQuery<PortalData>({
    queryKey: ["portal", slug, routerId],
    enabled: routerId !== undefined,
    queryFn: async () => {
      const site = routerId ? `?router=${encodeURIComponent(routerId)}` : "";
      const res = await fetch(`/api/public/portal/${slug}${site}`);
      if (!res.ok) {
        let message = "Portal unavailable.";
        try {
          const json = await res.json();
          if (typeof json.error === "string") message = json.error;
        } catch {
          // Use the generic message when the server does not return JSON.
        }
        throw new Error(message);
      }
      return res.json();
    },
  });

  const brand = data?.portal?.primary_color ?? data?.tenant?.primary_color ?? "#0ea5e9";
  const themeId = resolveThemeId(data?.portal?.theme);
  const theme = PORTAL_THEMES[themeId];
  // Brand colour adjusted for this theme (e.g. lightened on a dark theme) so it stays legible.
  const primary = portalAccent(themeId, brand);

  if (isLoading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        {error instanceof Error ? error.message : "Portal not found."}
      </div>
    );
  }

  return (
    <PortalThemeFrame
      themeId={themeId}
      brand={brand}
      backgroundUrl={data.portal?.background_url}
      className="min-h-screen"
    >
      <PortalHeader
        theme={theme}
        name={data.tenant.name}
        logoUrl={data.portal?.logo_url ?? data.tenant.logo_url}
        backgroundUrl={data.portal?.background_url}
        welcomeText={
          data.portal?.welcome_text ?? "Connect to Wi-Fi — buy, reconnect, or redeem a voucher."
        }
        accent={primary}
      />

      <div className={theme.sheet ? "pt-sheet pt-6" : undefined}>
        <div className="mx-auto max-w-md px-4 pb-12">
          {data.maintenance.map((maintenance) => (
            <section
              key={maintenance.id}
              role="status"
              className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                <div>
                  <p className="font-semibold">{maintenance.title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {maintenance.body}
                  </p>
                  {maintenance.mode !== "notice" && (
                    <p className="mt-2 text-xs font-medium text-amber-700">
                      {maintenance.mode === "block_all"
                        ? "Connections are paused while this work is in progress."
                        : "New connections are paused while this work is in progress."}
                    </p>
                  )}
                  {maintenance.ends_at && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Expected end: {new Date(maintenance.ends_at).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
            </section>
          ))}
          {data.announcements.map((announcement) => (
            <section
              key={announcement.id}
              className="mb-3 rounded-xl border border-primary/30 bg-primary/5 p-4"
            >
              <div className="flex items-start gap-3">
                <Bell className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                  <p className="font-semibold">{announcement.title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {announcement.body}
                  </p>
                </div>
              </div>
            </section>
          ))}
          <section className="pt-surface mb-4 rounded-xl border bg-card p-4">
            <h2 className="font-semibold">Getting online</h2>
            <div className="mt-2 rounded-lg bg-muted/60 px-3 py-2 text-sm">
              <span className="text-muted-foreground">This device’s Wi-Fi MAC address: </span>
              {deviceMac ? (
                <span className="font-mono font-medium">{deviceMac}</span>
              ) : (
                <span className="text-muted-foreground">Unavailable</span>
              )}
            </div>
            {autoReconnectStatus === "checking" && (
              <p role="status" className="mt-2 text-sm text-muted-foreground">
                Checking your saved Wi-Fi session and reconnecting if it’s still valid…
              </p>
            )}
            {autoReconnectStatus === "unavailable" && (
              <p role="status" className="mt-2 text-sm text-muted-foreground">
                No valid saved session was found. Use Reconnect or Voucher below to restore access.
              </p>
            )}
            <ol className="mt-2 list-inside list-decimal space-y-2 text-sm text-muted-foreground">
              <li>
                Connect your device to this Wi-Fi. If the sign-in page doesn’t open, tap the Wi-Fi
                sign-in notification or open your browser.
              </li>
              <li>
                Choose <span className="font-medium text-foreground">Buy</span> for a new package
                {data.portal?.enable_voucher !== false && (
                  <>
                    {" "}
                    or <span className="font-medium text-foreground">Voucher</span> to enter your
                    code
                  </>
                )}
                . Follow the prompts to connect.
              </li>
              <li>
                If you disconnect, reopen this page. We’ll reconnect automatically when this device
                has a saved, valid session. Otherwise, for a paid package choose{" "}
                <span className="font-medium text-foreground">Reconnect</span> and enter the M-Pesa
                receipt code from your SMS.
                {data.portal?.enable_voucher !== false && (
                  <>
                    {" "}
                    For a voucher, enter the same code again under{" "}
                    <span className="font-medium text-foreground">Voucher</span>.
                  </>
                )}
              </li>
            </ol>
          </section>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger className="px-1 text-xs sm:text-sm" value="buy">
                Buy
              </TabsTrigger>
              <TabsTrigger className="px-1 text-xs sm:text-sm" value="reconnect">
                Reconnect
              </TabsTrigger>
              <TabsTrigger className="px-1 text-xs sm:text-sm" value="status">
                Status
              </TabsTrigger>
              <TabsTrigger
                className="px-1 text-xs sm:text-sm"
                value="voucher"
                disabled={data.portal?.enable_voucher === false}
              >
                Voucher
              </TabsTrigger>
              <TabsTrigger className="px-1 text-xs sm:text-sm" value="tv">
                TV
              </TabsTrigger>
            </TabsList>
            <TabsContent value="buy" className="mt-4">
              <BuyFlow
                slug={slug}
                packages={data.packages}
                primary={primary}
                theme={theme}
                payeeName={data.tenant.name}
                postLoginUrl={data.portal?.post_login_url}
              />
            </TabsContent>
            <TabsContent value="reconnect" className="mt-4">
              <ReconnectFlow slug={slug} primary={primary} />
            </TabsContent>
            <TabsContent value="status" className="mt-4">
              <StatusFlow slug={slug} primary={primary} />
            </TabsContent>
            <TabsContent value="voucher" className="mt-4">
              <VoucherFlow
                slug={slug}
                primary={primary}
                postLoginUrl={data.portal?.post_login_url}
              />
            </TabsContent>
            <TabsContent value="tv" className="mt-4">
              <TvFlow
                slug={slug}
                packages={data.packages}
                primary={primary}
                theme={theme}
                payeeName={data.tenant.name}
                postLoginUrl={data.portal?.post_login_url}
              />
            </TabsContent>
          </Tabs>

          {data.portal?.terms_text && (
            <p className="mt-6 text-center text-xs text-muted-foreground whitespace-pre-line">
              {data.portal.terms_text}
            </p>
          )}
          <PortalSupport phone={data.tenant.support_phone} email={data.tenant.support_email} />
        </div>
      </div>
    </PortalThemeFrame>
  );
}

function PortalSupport({ phone, email }: { phone: string | null; email: string | null }) {
  const supportPhone = phone?.trim() ?? "";
  const phoneDigits = supportPhone.replace(/\D/g, "");
  const canCall = phoneDigits.length >= 8 && phoneDigits.length <= 15;
  const whatsappNumber = supportPhone.startsWith("+")
    ? canCall
      ? phoneDigits
      : null
    : /^0[17]\d{8}$/.test(phoneDigits)
      ? `254${phoneDigits.slice(1)}`
      : /^254[17]\d{8}$/.test(phoneDigits)
        ? phoneDigits
        : null;
  const supportEmail = email?.trim() ?? "";

  return (
    <section className="pt-surface mt-6 rounded-xl border bg-card p-4">
      <h2 className="font-semibold">Need help connecting?</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Contact{" "}
        {supportPhone || supportEmail
          ? "your Wi-Fi provider"
          : "the Wi-Fi provider or staff at this location"}{" "}
        for help.
      </p>
      {(canCall || supportEmail || whatsappNumber) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {canCall && (
            <Button asChild size="sm" variant="outline">
              <a href={`tel:${supportPhone.startsWith("+") ? `+${phoneDigits}` : phoneDigits}`}>
                <Phone aria-hidden="true" />
                Call {supportPhone}
              </a>
            </Button>
          )}
          {whatsappNumber && (
            <Button asChild size="sm" variant="outline">
              <a href={`https://wa.me/${whatsappNumber}`} target="_blank" rel="noopener noreferrer">
                <MessageCircle aria-hidden="true" />
                WhatsApp
              </a>
            </Button>
          )}
          {supportEmail && (
            <Button asChild size="sm" variant="outline">
              <a href={`mailto:${encodeURIComponent(supportEmail)}`}>
                <Mail aria-hidden="true" />
                Email support
              </a>
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function BuyFlow({
  slug,
  packages,
  primary,
  theme,
  payeeName,
  postLoginUrl,
}: {
  slug: string;
  packages: PortalData["packages"];
  primary: string;
  theme: PortalThemeDef;
  payeeName: string;
  postLoginUrl?: string | null;
}) {
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
        body: JSON.stringify({
          packageId: picked,
          phone,
          routerId:
            routerParams(window.location.search, sessionStore(), slug).routerId ?? undefined,
        }),
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

  if (paymentId)
    return (
      <PaymentWaiting
        key={paymentId}
        slug={slug}
        paymentId={paymentId}
        primary={primary}
        payeeName={payeeName}
        postLoginUrl={postLoginUrl}
        retrying={submitting}
        onTryAgain={() => void pay()}
        onChangePhone={() => setPaymentId(null)}
      />
    );

  return (
    <div>
      <div className="space-y-2">
        {packages.length === 0 && (
          <p className="text-sm text-muted-foreground">No packages available yet.</p>
        )}
        {packages.map((p) => (
          <PlanOption
            key={p.id}
            theme={theme}
            plan={p}
            selected={picked === p.id}
            onSelect={() => setPicked(p.id)}
            accent={primary}
          />
        ))}
      </div>
      <div className="mt-5">
        <Label htmlFor="phone">M-Pesa phone</Label>
        <Input
          id="phone"
          inputMode="tel"
          placeholder="07XXXXXXXX"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="mt-1"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          M-Pesa payment to <span className="font-medium text-foreground">{payeeName}</span>. The
          prompt uses the official business name registered to its PayBill.
        </p>
      </div>
      <Button
        className="pt-btn mt-4 w-full"
        style={{ backgroundColor: primary }}
        disabled={!picked || !phone || submitting}
        onClick={pay}
      >
        {submitting ? "Sending prompt…" : "Pay with M-Pesa"}
      </Button>
    </div>
  );
}

function PaymentWaiting({
  slug,
  paymentId,
  primary,
  payeeName,
  postLoginUrl,
  tv = false,
  retrying = false,
  onTryAgain,
  onChangePhone,
}: {
  slug: string;
  paymentId: string;
  primary: string;
  payeeName: string;
  postLoginUrl?: string | null;
  tv?: boolean;
  retrying?: boolean;
  onTryAgain?: () => void;
  onChangePhone?: () => void;
}) {
  const [status, setStatus] = useState<string>("pending");
  const [voucher, setVoucher] = useState<string | null>(null);
  const [autoConnecting, setAutoConnecting] = useState(false);
  const autoConnectAttempted = useRef(false);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    const poll = async () => {
      controller = new AbortController();
      try {
        const res = await fetch(`/api/public/portal/${slug}/payment-status?id=${paymentId}`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const json = await res.json();
          if (!active) return;
          setStatus(json.status);
          if (json.voucher_code) setVoucher(json.voucher_code);
          if (json.status === "success" || json.status === "failed") return;
        }
      } catch (error) {
        if (!active) return;
        console.warn("Payment status check failed; it will be retried.", error);
      }
      if (active) timer = window.setTimeout(() => void poll(), 3000);
    };
    void poll();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
      controller?.abort();
    };
  }, [paymentId, slug]);

  useEffect(() => {
    if (tv || status !== "success" || !voucher || autoConnectAttempted.current) return;
    const store = sessionStore();
    const params = routerParams(window.location.search, store, slug);
    const target = buildHotspotLoginRedirect(
      params.login || "http://10.5.50.1/login",
      voucher,
      postLoginUrl || params.destination,
    );
    if (!target) return;
    autoConnectAttempted.current = true;
    setAutoConnecting(true);
    rememberVoucher(store, voucher, slug);
    window.location.assign(target);
  }, [status, tv, voucher, postLoginUrl, slug]);

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
        <h2 className="mt-3 text-lg font-semibold">Payment received</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {autoConnecting
            ? "Connecting you to Wi-Fi…"
            : "Your voucher is ready. Use it on the Wi-Fi login page."}
        </p>
        {voucher && (
          <>
            <p className="mt-3 inline-block rounded-md bg-muted px-4 py-2 font-mono text-lg tracking-widest">
              {voucher}
            </p>
            <VoucherCopyButton code={voucher} />
            <Button
              className="pt-btn mt-4 w-full"
              style={{ backgroundColor: primary }}
              onClick={() => {
                const store = sessionStore();
                const params = routerParams(window.location.search, store, slug);
                const target = buildHotspotLoginRedirect(
                  params.login || "http://10.5.50.1/login",
                  voucher,
                  postLoginUrl || params.destination,
                );
                if (target) {
                  rememberVoucher(store, voucher, slug);
                  window.location.assign(target);
                }
              }}
            >
              Connect to Wi-Fi now
            </Button>
          </>
        )}
      </div>
    );
  }
  if (status === "failed") {
    return (
      <div className="pt-surface rounded-xl border bg-card p-6 text-center">
        <p className="font-medium">Payment failed</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The M-Pesa payment to {payeeName} was not completed. Check the phone number and try again.
        </p>
        {onChangePhone && (
          <Button className="mt-4 w-full" variant="outline" onClick={onChangePhone}>
            Change phone number
          </Button>
        )}
        {onTryAgain && (
          <Button
            className="pt-btn mt-3 w-full"
            style={{ backgroundColor: primary }}
            disabled={retrying}
            onClick={onTryAgain}
          >
            {retrying ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Sending prompt…
              </>
            ) : (
              "Try again"
            )}
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="pt-surface rounded-xl border bg-card p-6 text-center">
      <Loader2 className="mx-auto h-8 w-8 animate-spin" style={{ color: primary }} />
      <p className="mt-3 font-medium">Waiting for M-Pesa…</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Approve the prompt on your phone. We’ll keep checking until M-Pesa confirms payment or
        reports the request cancelled or failed.
      </p>
    </div>
  );
}

interface TvStatus {
  registered: boolean;
  active: boolean;
  expires_at: string | null;
}

function TvFlow({
  slug,
  packages,
  primary,
  theme,
  payeeName,
  postLoginUrl,
}: {
  slug: string;
  packages: PortalData["packages"];
  primary: string;
  theme: PortalThemeDef;
  payeeName: string;
  postLoginUrl?: string | null;
}) {
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
    if (!mac || !phone) return;
    setChecking(true);
    try {
      const res = await fetch(
        `/api/public/portal/${slug}/tv?mac=${encodeURIComponent(mac)}&phone=${encodeURIComponent(phone)}`,
      );
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
        body: JSON.stringify({
          mac,
          name: name || undefined,
          packageId: picked,
          phone,
          routerId:
            routerParams(window.location.search, sessionStore(), slug).routerId ?? undefined,
        }),
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
        <PaymentWaiting
          key={paymentId}
          slug={slug}
          paymentId={paymentId}
          primary={primary}
          payeeName={payeeName}
          postLoginUrl={postLoginUrl}
          tv
          retrying={submitting}
          onTryAgain={() => void pay()}
          onChangePhone={() => setPaymentId(null)}
        />
        {randomized && (
          <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
            This looks like a private (randomised) Wi-Fi address. Make sure it is the address your
            TV shows for this Wi-Fi network, otherwise the TV will not connect.
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
          Smart TVs can't open the login page. Enter your TV's Wi-Fi MAC address, pick a plan and
          pay — the TV is then allowed on the network automatically. Find the address in the TV's
          Settings &rarr; Network (or About / Status).
        </p>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <Label htmlFor="tv-mac">TV MAC address</Label>
          <Input
            id="tv-mac"
            placeholder="AA:BB:CC:DD:EE:FF"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            value={mac}
            onChange={(e) => {
              setMac(e.target.value);
              setStatus(null);
            }}
            className="mt-1 font-mono"
          />
        </div>
        <div>
          <Label htmlFor="tv-name">TV name (optional)</Label>
          <Input
            id="tv-name"
            placeholder="Living room TV"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="tv-phone">M-Pesa phone used for this TV</Label>
          <Input
            id="tv-phone"
            inputMode="tel"
            placeholder="07XXXXXXXX"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-1"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            M-Pesa payment to <span className="font-medium text-foreground">{payeeName}</span>.
          </p>
        </div>
      </div>

      {status && (
        <p className="mt-3 rounded-md bg-muted p-3 text-sm">
          {status.active
            ? `This TV is active until ${new Date(status.expires_at as string).toLocaleString()}. You can buy more time below.`
            : status.registered
              ? "This TV is registered but has no active plan."
              : "No TV found for that address and phone number."}
        </p>
      )}
      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        disabled={!mac || !phone || checking}
        onClick={checkStatus}
      >
        {checking ? "Checking…" : "Check TV status"}
      </Button>

      <div className="mt-5 space-y-2">
        {packages.length === 0 && (
          <p className="text-sm text-muted-foreground">No packages available yet.</p>
        )}
        {packages.map((p) => (
          <PlanOption
            key={p.id}
            theme={theme}
            plan={p}
            selected={picked === p.id}
            onSelect={() => setPicked(p.id)}
            accent={primary}
          />
        ))}
      </div>

      <Button
        className="pt-btn mt-4 w-full"
        style={{ backgroundColor: primary }}
        disabled={!picked || !phone || !mac || submitting}
        onClick={pay}
      >
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
        body: JSON.stringify({
          phone: phone || undefined,
          mpesaCode: code,
          routerId:
            routerParams(window.location.search, sessionStore(), slug).routerId ?? undefined,
        }),
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
          {typeof result.remaining_minutes === "number" &&
            ` · ${result.remaining_minutes} min left`}
        </p>
        {result.voucher_code && (
          <>
            <p className="mt-3 inline-block rounded-md bg-muted px-4 py-2 font-mono text-sm tracking-widest">
              {result.voucher_code}
            </p>
            <VoucherCopyButton code={result.voucher_code} />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Enter the M-Pesa transaction code from your payment confirmation SMS. Adding your phone
        number is optional.
      </p>
      <div>
        <Label htmlFor="rphone">Phone number</Label>
        <Input
          id="rphone"
          inputMode="tel"
          placeholder="07XXXXXXXX"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="rcode">M-Pesa message or transaction code</Label>
        <Textarea
          id="rcode"
          autoCapitalize="characters"
          placeholder="Paste the full M-Pesa confirmation SMS or just its receipt code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="mt-1 min-h-24 font-mono text-sm"
        />
      </div>
      <Button
        className="pt-btn w-full"
        style={{ backgroundColor: primary }}
        disabled={busy || code.trim().length < 6}
        onClick={go}
      >
        {busy ? "Checking…" : "Reconnect"}
      </Button>
    </div>
  );
}

interface StatusResp {
  active: { expires_at: string } | null;
}

function StatusFlow({ slug, primary }: { slug: string; primary: string }) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<StatusResp | null>(null);

  async function check() {
    if (!phone) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/public/portal/${slug}/status?phone=${encodeURIComponent(phone)}`,
      );
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
        <Input
          id="sphone"
          inputMode="tel"
          placeholder="07XXXXXXXX"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="mt-1"
        />
      </div>
      <Button
        className="pt-btn w-full"
        style={{ backgroundColor: primary }}
        disabled={busy || !phone}
        onClick={check}
      >
        {busy ? "Checking…" : "Check status"}
      </Button>

      {data && (
        <div className="mt-2 pt-surface rounded-xl border bg-card p-4">
          {data.active ? (
            <div>
              <p className="font-medium">Active package</p>
              <p className="text-xs text-muted-foreground mt-1">
                Expires {new Date(data.active.expires_at).toLocaleString()}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No active package on this number.</p>
          )}
        </div>
      )}
    </div>
  );
}

function VoucherFlow({
  slug,
  primary,
  postLoginUrl,
}: {
  slug: string;
  primary: string;
  postLoginUrl?: string | null;
}) {
  const [code, setCode] = useState("");
  const [done, setDone] = useState<"connecting" | "activating" | "stalled" | "accepted" | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  // The router sent the customer back because it refused the login. That is expected for a minute
  // or two after redeeming: the router only learns about the voucher on its next sync. Keep trying
  // the router login (the voucher is already redeemed) until it is accepted, then give up politely.
  useEffect(() => {
    if (!routerLoginFailed(window.location.search)) return;
    const store = sessionStore();
    const saved = recallVoucher(store, slug);
    if (!saved) return;
    const target = buildHotspotLoginRedirect(
      routerParams(window.location.search, store, slug).login || "http://10.5.50.1/login",
      saved.code,
      postLoginUrl || routerParams(window.location.search, store, slug).destination,
    );
    if (!target) return;
    if (!saved.retry) {
      setDone("stalled");
      return;
    }
    setDone("activating");
    const t = setTimeout(() => {
      window.location.href = target;
    }, LOGIN_RETRY_DELAY_MS);
    return () => clearTimeout(t);
  }, [postLoginUrl, slug]);

  function tryAgain() {
    const store = sessionStore();
    const saved = recallVoucher(store, slug);
    const target = saved
      ? buildHotspotLoginRedirect(
          routerParams(window.location.search, store, slug).login || "http://10.5.50.1/login",
          saved.code,
          postLoginUrl || routerParams(window.location.search, store, slug).destination,
        )
      : null;
    if (!saved || !target) return setDone(null);
    rememberVoucher(store, saved.code, slug); // restart the retry window
    setDone("connecting");
    window.location.href = target;
  }

  async function redeem() {
    setBusy(true);
    try {
      // The router's login page sends the customer here with ?mac=…&ip=…&login=<hotspot login URL>.
      const store = sessionStore();
      const params = routerParams(window.location.search, store, slug);
      const res = await fetch(`/api/public/portal/${slug}/voucher`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code,
          mac: params.mac || undefined,
          routerId: params.routerId ?? undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      toast.success(json.resumed ? "Voucher found — reconnecting you" : "Voucher redeemed");
      const redeemed: string = json.code ?? code;
      rememberVoucher(store, redeemed, slug);
      // Hand the browser to the router so the device is actually logged in.
      const target = buildHotspotLoginRedirect(
        params.login || "http://10.5.50.1/login",
        redeemed,
        postLoginUrl || params.destination,
      );
      if (target) {
        setDone("connecting");
        setTimeout(() => {
          window.location.href = target;
        }, 300);
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
        {done === "activating" || done === "connecting" ? (
          <Loader2 className="mx-auto h-10 w-10 animate-spin" style={{ color: primary }} />
        ) : (
          <CheckCircle2 className="mx-auto h-10 w-10" style={{ color: primary }} />
        )}
        <p className="mt-3 font-medium">
          {done === "connecting" && "Connecting you to the internet…"}
          {done === "activating" && "Activating your voucher on the Wi-Fi…"}
          {done === "stalled" && "We couldn't connect you yet"}
          {done === "accepted" && "Voucher accepted"}
        </p>
        {done === "activating" && (
          <p className="mt-1 text-sm text-muted-foreground">
            This can take several minutes while the Wi-Fi syncs your voucher. Please keep this page
            open; it retries automatically.
          </p>
        )}
        {done === "stalled" && (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              Your voucher is valid, but the Wi-Fi hasn't accepted it yet. Wait a minute and try
              again. If it keeps failing, contact the provider.
            </p>
            <Button
              className="pt-btn mt-4 w-full"
              style={{ backgroundColor: primary }}
              onClick={tryAgain}
            >
              Try again
            </Button>
          </>
        )}
        {done === "accepted" && (
          <p className="mt-1 text-sm text-muted-foreground">
            Open this page from the Wi-Fi network's sign-in screen to connect, or reconnect to the
            Wi-Fi.
          </p>
        )}
      </div>
    );
  }
  return (
    <div>
      <Label htmlFor="vcode">Voucher code</Label>
      <Input
        id="vcode"
        autoCapitalize="characters"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="ABCD1234"
        className="mt-1 font-mono tracking-widest"
      />
      <Button
        className="pt-btn mt-4 w-full"
        style={{ backgroundColor: primary }}
        disabled={!code || busy}
        onClick={redeem}
      >
        {busy ? "Checking…" : "Redeem voucher"}
      </Button>
    </div>
  );
}
