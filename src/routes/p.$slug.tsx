import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Activity,
  Bell,
  CheckCircle2,
  ChevronDown,
  Copy,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  RefreshCw,
  ShoppingBag,
  Ticket,
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
import { readOmadaPortalContext } from "@/lib/omada-portal";
import { parseHotspotDestinationUrl } from "@/lib/hotspot-redirect";
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

async function copyAccessCode(code: string) {
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
  if (copied) toast.success("Access code copied");
  else toast.error("Could not copy the access code. Please select and copy it manually.");
}

function AccessCodeCopyButton({ code }: { code: string }) {
  return (
    <Button
      variant="outline"
      className="mx-auto mt-3 flex"
      onClick={() => void copyAccessCode(code)}
    >
      <Copy aria-hidden="true" />
      Copy access code
    </Button>
  );
}

function PortalPage() {
  const { slug } = Route.useParams();
  const [tab, setTab] = useState("buy");
  const [routerId, setRouterId] = useState<string | null | undefined>(undefined);
  const [deviceMac, setDeviceMac] = useState<string | null>(null);
  const [autoReconnectStatus, setAutoReconnectStatus] = useState<
    "checking" | "connected" | "reconnecting" | "disconnected" | "unavailable" | null
  >(null);
  const autoReconnectAttempted = useRef<string | null>(null);
  useEffect(() => {
    const store = sessionStore();
    const search = window.location.search;
    const query = new URLSearchParams(search);
    const params = routerParams(search, store, slug);
    setRouterId(params.routerId);
    const mac = normalizeMac(query.get("mac") ?? "");
    setDeviceMac(mac);
    // The router refused an access-code login and sent the customer back: show its recovery path.
    if (routerLoginFailed(search) && recallVoucher(store, slug)) setTab("voucher");

    const saved = recallVoucher(store, slug);
    if (
      routerLoginFailed(search) ||
      autoReconnectAttempted.current === slug ||
      !mac ||
      !query.get("login") ||
      !query.get("router") ||
      params.routerId !== query.get("router")
    )
      return;

    autoReconnectAttempted.current = slug;
    setAutoReconnectStatus("checking");
    let cancelled = false;
    void (async () => {
      try {
        const sessionUrl = new URLSearchParams({ mac, routerId: params.routerId! });
        const sessionResponse = await fetch(
          `/api/public/portal/${slug}/session?${sessionUrl.toString()}`,
          { cache: "no-store" },
        );
        const session = await sessionResponse.json();
        if (!sessionResponse.ok || typeof session.active !== "boolean")
          throw new Error(session.error ?? "Could not check the router session.");
        if (cancelled) return;
        if (session.active) {
          setAutoReconnectStatus("connected");
          return;
        }
        if (!saved) {
          setAutoReconnectStatus("disconnected");
          return;
        }

        setAutoReconnectStatus("reconnecting");
        const receiptResponse = await fetch(`/api/public/portal/${slug}/reconnect`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mpesaCode: saved.code,
            mac,
            routerId: params.routerId ?? undefined,
          }),
        });
        const receipt = await receiptResponse.json();
        if (!receiptResponse.ok)
          throw new Error(receipt.error ?? "Saved Wi-Fi session is unavailable.");
        let accessCode =
          receipt.active && typeof receipt.access_code === "string" ? receipt.access_code : null;
        if (!accessCode) {
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
          accessCode = result.code;
        }
        if (cancelled) return;
        const target = buildHotspotLoginRedirect(
          query.get("login"),
          accessCode,
          params.destination,
        );
        if (!target) throw new Error("Wi-Fi login link is unavailable.");
        rememberVoucher(store, accessCode, slug);
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
          data.portal?.welcome_text ??
          "Connect to Wi-Fi — buy with M-Pesa, reconnect with your transaction code, or use an existing voucher."
        }
        accent={primary}
      />

      <div className={theme.sheet ? "pt-sheet pt-6" : undefined}>
        <div className="mx-auto max-w-5xl px-4 pb-12">
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
          <div className="grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-start">
            <section className="pt-surface rounded-2xl border bg-card p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <div
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl"
                  style={{ backgroundColor: `${primary}20`, color: primary }}
                >
                  {autoReconnectStatus === "checking" || autoReconnectStatus === "reconnecting" ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  ) : autoReconnectStatus === "connected" ? (
                    <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                  ) : (
                    <Wifi className="h-5 w-5" aria-hidden="true" />
                  )}
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Your Wi-Fi connection</h2>
                  <p className="text-sm text-muted-foreground">
                    {autoReconnectStatus === "checking"
                      ? "Checking your connection…"
                      : autoReconnectStatus === "connected"
                        ? "You’re connected"
                        : autoReconnectStatus === "reconnecting"
                          ? "Reconnecting your device…"
                          : autoReconnectStatus === "unavailable"
                            ? "Connection check unavailable"
                            : "Choose an option to get online"}
                  </p>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                <div
                  role="status"
                  aria-live="polite"
                  className={`rounded-xl border p-3 text-sm ${
                    autoReconnectStatus === "connected"
                      ? "border-emerald-500/30 bg-emerald-500/10"
                      : autoReconnectStatus === "unavailable"
                        ? "border-amber-500/30 bg-amber-500/10"
                        : "border-border bg-muted/40"
                  }`}
                >
                  {autoReconnectStatus === "checking" && "Checking whether this device is online."}
                  {autoReconnectStatus === "connected" &&
                    "This device has an active Wi-Fi session."}
                  {autoReconnectStatus === "reconnecting" &&
                    "Your saved session is active. Reconnecting now…"}
                  {autoReconnectStatus === "disconnected" &&
                    "No active session found. Pick an option to connect."}
                  {autoReconnectStatus === "unavailable" &&
                    "We couldn’t verify your session. Try Reconnect or contact support."}
                  {!autoReconnectStatus &&
                    "Buy a plan with M-Pesa, reconnect with your transaction code, or use an existing voucher."}
                </div>
                <div className="rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
                  <span className="text-muted-foreground">This device</span>
                  <span className="ml-2 font-mono font-medium">
                    {deviceMac ?? "Wi-Fi address unavailable"}
                  </span>
                </div>
                <details className="group rounded-xl border px-3 py-2.5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                    How to connect or reconnect
                    <ChevronDown
                      className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <ol className="mt-3 space-y-2 border-t pt-3 text-sm text-muted-foreground">
                    <li>1. Connect to this Wi-Fi and open the sign-in page.</li>
                    <li>
                      2. Buy a plan, enter your M-Pesa transaction code, or use an existing voucher.
                    </li>
                    <li>
                      3. If disconnected, reopen this page. We’ll check your session and try to
                      reconnect automatically.
                    </li>
                  </ol>
                </details>
              </div>
            </section>

            <section className="pt-surface rounded-2xl border bg-card p-4 sm:p-5">
              <div className="mb-4">
                <h2 className="text-lg font-semibold">Choose what you need</h2>
                <p className="text-sm text-muted-foreground">Pick an option below to continue.</p>
              </div>
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-transparent p-0 sm:grid-cols-3 lg:grid-cols-3">
                  <TabsTrigger
                    className="h-auto min-h-14 justify-start gap-2 rounded-xl border bg-background px-3 py-2.5 text-left data-[state=active]:border-primary data-[state=active]:bg-primary/10 data-[state=active]:text-foreground data-[state=active]:shadow-none"
                    value="buy"
                  >
                    <ShoppingBag className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block font-semibold">Buy Wi-Fi</span>
                      <span className="block text-xs font-normal text-muted-foreground">
                        New plan
                      </span>
                    </span>
                  </TabsTrigger>
                  <TabsTrigger
                    className="h-auto min-h-14 justify-start gap-2 rounded-xl border bg-background px-3 py-2.5 text-left data-[state=active]:border-primary data-[state=active]:bg-primary/10 data-[state=active]:text-foreground data-[state=active]:shadow-none"
                    value="reconnect"
                  >
                    <RefreshCw className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block font-semibold">Reconnect</span>
                      <span className="block text-xs font-normal text-muted-foreground">
                        Paid access
                      </span>
                    </span>
                  </TabsTrigger>
                  <TabsTrigger
                    className="h-auto min-h-14 justify-start gap-2 rounded-xl border bg-background px-3 py-2.5 text-left data-[state=active]:border-primary data-[state=active]:bg-primary/10 data-[state=active]:text-foreground data-[state=active]:shadow-none"
                    value="status"
                  >
                    <Activity className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block font-semibold">Check status</span>
                      <span className="block text-xs font-normal text-muted-foreground">
                        Active plan
                      </span>
                    </span>
                  </TabsTrigger>
                  <TabsTrigger
                    className="h-auto min-h-14 justify-start gap-2 rounded-xl border bg-background px-3 py-2.5 text-left data-[state=active]:border-primary data-[state=active]:bg-primary/10 data-[state=active]:text-foreground data-[state=active]:shadow-none"
                    value="voucher"
                    disabled={data.portal?.enable_voucher === false}
                  >
                    <Ticket className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block font-semibold">Access code</span>
                      <span className="block text-xs font-normal text-muted-foreground">
                        M-Pesa receipt or old voucher
                      </span>
                    </span>
                  </TabsTrigger>
                  <TabsTrigger
                    className="h-auto min-h-14 justify-start gap-2 rounded-xl border bg-background px-3 py-2.5 text-left data-[state=active]:border-primary data-[state=active]:bg-primary/10 data-[state=active]:text-foreground data-[state=active]:shadow-none"
                    value="tv"
                  >
                    <Tv className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block font-semibold">TV access</span>
                      <span className="block text-xs font-normal text-muted-foreground">
                        Register a TV
                      </span>
                    </span>
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="buy" className="mt-5">
                  <BuyFlow
                    slug={slug}
                    packages={data.packages.filter((plan) => plan.kind !== "pppoe")}
                    primary={primary}
                    theme={theme}
                    payeeName={data.tenant.name}
                    postLoginUrl={data.portal?.post_login_url}
                  />
                </TabsContent>
                <TabsContent value="reconnect" className="mt-5">
                  <ReconnectFlow slug={slug} primary={primary} />
                </TabsContent>
                <TabsContent value="status" className="mt-5">
                  <StatusFlow slug={slug} primary={primary} />
                </TabsContent>
                <TabsContent value="voucher" className="mt-5">
                  <VoucherFlow
                    slug={slug}
                    primary={primary}
                    postLoginUrl={data.portal?.post_login_url}
                  />
                </TabsContent>
                <TabsContent value="tv" className="mt-5">
                  <TvFlow
                    slug={slug}
                    packages={data.packages.filter(
                      (plan) => plan.kind !== "hotspot_tv" && plan.kind !== "pppoe",
                    )}
                    primary={primary}
                    theme={theme}
                    payeeName={data.tenant.name}
                    postLoginUrl={data.portal?.post_login_url}
                  />
                </TabsContent>
              </Tabs>
            </section>
          </div>

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
  const [tvMac, setTvMac] = useState("");
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [omadaPortal, setOmadaPortal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const selectedPlan = packages.find((plan) => plan.id === picked);

  async function pay() {
    if (!picked || !phone) return;
    setSubmitting(true);
    try {
      const omadaContext = readOmadaPortalContext(window.location.search);
      const res = await fetch(`/api/public/portal/${slug}/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          packageId: picked,
          phone,
          ...(selectedPlan?.kind === "hotspot_tv" ? { tvMac } : {}),
          routerId:
            routerParams(window.location.search, sessionStore(), slug).routerId ?? undefined,
          ...(omadaContext ? { omadaContext } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setPaymentId(json.paymentId);
      setOmadaPortal(Boolean(omadaContext));
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
        omadaPortal={omadaPortal}
        tvIncluded={selectedPlan?.kind === "hotspot_tv"}
        retrying={submitting}
        onTryAgain={() => void pay()}
        onChangePhone={() => {
          setPaymentId(null);
          setOmadaPortal(false);
        }}
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
        {selectedPlan?.kind === "hotspot_tv" && (
          <div className="mb-4">
            <Label htmlFor="phone-tv-mac">TV Wi-Fi MAC address</Label>
            <Input
              id="phone-tv-mac"
              placeholder="AA:BB:CC:DD:EE:FF"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              value={tvMac}
              onChange={(e) => setTvMac(e.target.value)}
              className="mt-1 font-mono"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Find this in the TV's Settings → Network. The phone and TV share this package's
              expiry.
            </p>
          </div>
        )}
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
        disabled={
          !picked ||
          !phone ||
          (selectedPlan?.kind === "hotspot_tv" && !normalizeMac(tvMac)) ||
          submitting
        }
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
  omadaPortal = false,
  tv = false,
  tvIncluded = false,
  retrying = false,
  onTryAgain,
  onChangePhone,
}: {
  slug: string;
  paymentId: string;
  primary: string;
  payeeName: string;
  postLoginUrl?: string | null;
  omadaPortal?: boolean;
  tv?: boolean;
  tvIncluded?: boolean;
  retrying?: boolean;
  onTryAgain?: () => void;
  onChangePhone?: () => void;
}) {
  const [status, setStatus] = useState<string>("pending");
  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [receiptCode, setReceiptCode] = useState(false);
  const [receiptPending, setReceiptPending] = useState(false);
  const [autoConnecting, setAutoConnecting] = useState(false);
  const [omadaAuthorization, setOmadaAuthorization] = useState<
    "not_required" | "pending" | "processing" | "authorized" | "failed"
  >("not_required");
  const [omadaRedirectUrl, setOmadaRedirectUrl] = useState<string | null>(null);
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
          setReceiptPending(json.receipt_pending === true);
          if (json.mpesa_receipt || json.voucher_code) {
            setAccessCode(json.mpesa_receipt ?? json.voucher_code);
            setReceiptCode(Boolean(json.mpesa_receipt));
          }
          const authorization = json.omadaAuthorization;
          if (
            authorization &&
            ["pending", "processing", "authorized", "failed", "not_required"].includes(
              authorization.status,
            )
          ) {
            setOmadaAuthorization(
              omadaPortal && authorization.status === "not_required"
                ? "failed"
                : authorization.status,
            );
            setOmadaRedirectUrl(
              typeof authorization.redirectUrl === "string" ? authorization.redirectUrl : null,
            );
          } else if (omadaPortal && json.status === "success") {
            setOmadaAuthorization("failed");
          }
          if (
            json.status === "failed" ||
            (json.status === "success" &&
              (tv ||
                (omadaPortal &&
                  ["authorized", "failed", "not_required"].includes(
                    authorization?.status ?? "not_required",
                  )) ||
                Boolean(json.mpesa_receipt || json.voucher_code)))
          )
            return;
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
  }, [paymentId, slug, omadaPortal, tv]);

  useEffect(() => {
    if (omadaPortal) {
      if (tv || status !== "success" || omadaAuthorization !== "authorized") return;
      if (autoConnectAttempted.current) return;
      const destination = parseHotspotDestinationUrl(omadaRedirectUrl);
      if (destination) {
        autoConnectAttempted.current = true;
        setAutoConnecting(true);
        window.location.assign(destination);
      }
      return;
    }
    if (tv || status !== "success" || !accessCode || autoConnectAttempted.current) return;
    const store = sessionStore();
    const params = routerParams(window.location.search, store, slug);
    if (receiptCode && !params.mac) return;
    autoConnectAttempted.current = true;
    setAutoConnecting(true);
    void (async () => {
      try {
        let code = accessCode;
        if (receiptCode) {
          const response = await fetch(`/api/public/portal/${slug}/reconnect`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              mpesaCode: accessCode,
              mac: params.mac ?? undefined,
              routerId: params.routerId ?? undefined,
            }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? "Could not verify the M-Pesa code.");
          if (result.active && typeof result.access_code === "string") code = result.access_code;
          else throw new Error(result.reason ?? "Could not secure this device for Wi-Fi access.");
        }
        const target = buildHotspotLoginRedirect(
          params.login || "http://10.5.50.1/login",
          code,
          postLoginUrl || params.destination,
        );
        if (!target) throw new Error("The hotspot login address is unavailable.");
        rememberVoucher(store, code, slug);
        window.location.assign(target);
      } catch (error) {
        setAutoConnecting(false);
        toast.error(error instanceof Error ? error.message : "Could not connect to Wi-Fi.");
      }
    })();
  }, [
    status,
    tv,
    accessCode,
    receiptCode,
    postLoginUrl,
    slug,
    omadaPortal,
    omadaAuthorization,
    omadaRedirectUrl,
  ]);

  if (status === "success" && omadaPortal && omadaAuthorization !== "authorized") {
    return (
      <div className="pt-surface rounded-xl border bg-card p-6 text-center">
        {omadaAuthorization === "failed" ? (
          <>
            <AlertTriangle className="mx-auto h-8 w-8 text-destructive" />
            <h2 className="mt-3 text-lg font-semibold">Payment received</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              We could not finish connecting this device. Contact your Wi-Fi provider and share your
              payment confirmation.
            </p>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin" style={{ color: primary }} />
            <h2 className="mt-3 text-lg font-semibold">Payment received</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {omadaAuthorization === "processing"
                ? "Connecting your device to Wi-Fi…"
                : "Authorizing your device with the Wi-Fi controller…"}
            </p>
          </>
        )}
      </div>
    );
  }
  if (status === "success" && omadaPortal) {
    return (
      <div className="pt-surface rounded-xl border bg-card p-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10" style={{ color: primary }} />
        <h2 className="mt-3 text-lg font-semibold">Connected to Wi-Fi</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your payment is confirmed and this device is authorized.
          {autoConnecting ? " Returning you to your requested page…" : ""}
        </p>
      </div>
    );
  }

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
            : accessCode
              ? "Your M-Pesa transaction code is your Wi-Fi access code."
              : "Payment confirmed. Waiting for the M-Pesa receipt code…"}
        </p>
        {tvIncluded && (
          <p className="mt-2 text-sm text-muted-foreground">
            Your TV will be allowed on Wi-Fi within about 2 minutes using the MAC address you
            provided.
          </p>
        )}
        {accessCode && (
          <>
            <p className="mt-3 inline-block rounded-md bg-muted px-4 py-2 font-mono text-lg tracking-widest">
              {accessCode}
            </p>
            <AccessCodeCopyButton code={accessCode} />
            <Button
              className="pt-btn mt-4 w-full"
              style={{ backgroundColor: primary }}
              onClick={() => {
                const store = sessionStore();
                const params = routerParams(window.location.search, store, slug);
                setAutoConnecting(true);
                void (async () => {
                  try {
                    let code = accessCode;
                    if (receiptCode) {
                      const response = await fetch(`/api/public/portal/${slug}/reconnect`, {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                          mpesaCode: accessCode,
                          mac: params.mac ?? undefined,
                          routerId: params.routerId ?? undefined,
                        }),
                      });
                      const result = await response.json();
                      if (!response.ok)
                        throw new Error(result.error ?? "Could not verify the M-Pesa code.");
                      if (result.active && typeof result.access_code === "string")
                        code = result.access_code;
                      else throw new Error(result.reason ?? "Could not secure this device.");
                    }
                    const target = buildHotspotLoginRedirect(
                      params.login || "http://10.5.50.1/login",
                      code,
                      postLoginUrl || params.destination,
                    );
                    if (!target) throw new Error("The hotspot login address is unavailable.");
                    rememberVoucher(store, code, slug);
                    window.location.assign(target);
                  } catch (error) {
                    setAutoConnecting(false);
                    toast.error(
                      error instanceof Error ? error.message : "Could not connect to Wi-Fi.",
                    );
                  }
                })();
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
        {receiptPending
          ? "M-Pesa confirms the payment. We’re waiting for the verified transaction code before enabling Wi-Fi access."
          : "Approve the prompt on your phone. We’ll keep checking until M-Pesa confirms payment or reports the request cancelled or failed."}
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
  access_code?: string | null;
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
      const store = sessionStore();
      const params = routerParams(window.location.search, store, slug);
      const res = await fetch(`/api/public/portal/${slug}/reconnect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phone: phone || undefined,
          mpesaCode: code,
          routerId: params.routerId ?? undefined,
          mac: params.mac ?? undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setResult(json);
      if (!json.active) toast.error(json.reason ?? "No active package");
      else if (typeof json.access_code === "string") {
        if (params.login) {
          const target = buildHotspotLoginRedirect(
            params.login,
            json.access_code,
            params.destination,
          );
          if (!target) throw new Error("The hotspot login address is unavailable.");
          rememberVoucher(store, json.access_code, slug);
          window.location.assign(target);
        }
      }
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
        <h2 className="mt-3 text-lg font-semibold">M-Pesa transaction verified</h2>
        {result.package && <p className="mt-1 text-sm">{result.package.name}</p>}
        <p className="mt-1 text-xs text-muted-foreground">
          Expires {result.expires_at ? new Date(result.expires_at).toLocaleString() : "—"}
          {typeof result.remaining_minutes === "number" &&
            ` · ${result.remaining_minutes} min left`}
        </p>
        {!routerParams(window.location.search, sessionStore(), slug).login && (
          <p className="mt-3 text-xs text-muted-foreground">
            Connect to the hotspot and enter this transaction code on its sign-in page.
          </p>
        )}
        {result.access_code && (
          <>
            <p className="mt-3 inline-block rounded-md bg-muted px-4 py-2 font-mono text-sm tracking-widest">
              {result.access_code}
            </p>
            <AccessCodeCopyButton code={result.access_code} />
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
        <Label htmlFor="rcode">M-Pesa transaction code</Label>
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

  // The router sent the customer back because it refused the login. Retry the saved code while the
  // next router sync installs it, then give up politely.
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
      const receiptResponse = await fetch(`/api/public/portal/${slug}/reconnect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mpesaCode: code,
          mac: params.mac ?? undefined,
          routerId: params.routerId ?? undefined,
        }),
      });
      const receipt = await receiptResponse.json();
      if (!receiptResponse.ok) throw new Error(receipt.error ?? "Failed");
      let accessCode =
        receipt.active && typeof receipt.access_code === "string" ? receipt.access_code : null;
      if (!accessCode) {
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
        if (!res.ok) throw new Error(json.error ?? "No active M-Pesa purchase or voucher found.");
        accessCode = json.code ?? code;
        toast.success(json.resumed ? "Voucher found — reconnecting you" : "Voucher redeemed");
      } else {
        toast.success("M-Pesa transaction verified — reconnecting you");
      }
      rememberVoucher(store, accessCode, slug);
      // Hand the browser to the router so the device is actually logged in.
      const target = buildHotspotLoginRedirect(
        params.login || "http://10.5.50.1/login",
        accessCode,
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
      <Label htmlFor="vcode">M-Pesa receipt or existing voucher code</Label>
      <Input
        id="vcode"
        autoCapitalize="characters"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="Transaction code or voucher"
        className="mt-1 font-mono tracking-widest"
      />
      <Button
        className="pt-btn mt-4 w-full"
        style={{ backgroundColor: primary }}
        disabled={!code || busy}
        onClick={redeem}
      >
        {busy ? "Checking…" : "Connect"}
      </Button>
    </div>
  );
}
