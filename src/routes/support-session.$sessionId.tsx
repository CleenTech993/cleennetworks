import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Activity, Clock3, Cpu, HardDrive, ShieldCheck, Thermometer, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SupportData {
  router: {
    name: string;
    status: "online" | "offline";
    lastSeenAt: string | null;
    cpuLoad: number | null;
    memoryUsedPct: number | null;
    uptimeSeconds: number | null;
    temperature: number | null;
    voltage: number | null;
  };
  expiresAt: string;
}

async function loadSupportData(sessionId: string): Promise<{
  data: SupportData | null;
  error: string | null;
  needsPassword: boolean;
}> {
  try {
    const response = await fetch(`/api/public/router-support-sessions/${sessionId}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      return {
        data: null,
        error: body.error ?? "This support session is unavailable.",
        needsPassword:
          response.status === 401 && body.error === "Sign in to this support session.",
      };
    }
    return { data: (await response.json()) as SupportData, error: null, needsPassword: false };
  } catch {
    return {
      data: null,
      error: "Could not load router diagnostics. Check your connection and retry.",
      needsPassword: false,
    };
  }
}

export const Route = createFileRoute("/support-session/$sessionId")({
  head: () => ({
    meta: [
      { title: "Router support session — NetGrid" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
  component: RouterSupportSessionPage,
});

function uptime(seconds: number | null): string {
  if (seconds == null) return "Unavailable";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function RouterSupportSessionPage() {
  const { sessionId } = Route.useParams();
  const [password, setPassword] = useState("");
  const [data, setData] = useState<SupportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);

  useEffect(() => {
    let active = true;
    void loadSupportData(sessionId).then((result) => {
      if (!active) return;
      setData(result.data);
      setError(result.error ?? "");
      setNeedsPassword(result.needsPassword);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!data) return;
    const remaining = Date.parse(data.expiresAt) - Date.now();
    if (remaining <= 0) {
      setData(null);
      setNeedsPassword(false);
      setError("This support session has expired.");
      return;
    }
    const timer = window.setTimeout(() => {
      setData(null);
      setNeedsPassword(false);
      setError("This support session has expired.");
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [data?.expiresAt]);

  async function refresh() {
    setLoading(true);
    const result = await loadSupportData(sessionId);
    setData(result.data);
    setError(result.error ?? "");
    setNeedsPassword(result.needsPassword);
    setLoading(false);
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/public/router-support-sessions/${sessionId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "Invalid or expired session credentials.");
        return;
      }
      setPassword("");
      await refresh();
    } catch {
      setError("Could not verify the session. Check your connection and retry.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-center justify-between border-b pb-4">
          <Brand />
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-emerald-600" /> Read-only session
          </span>
        </header>

        {loading && !data ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Checking session…</p>
        ) : !data && needsPassword ? (
          <form onSubmit={signIn} className="mx-auto max-w-sm space-y-4 rounded-lg border bg-card p-5">
            <div>
              <h1 className="text-lg font-semibold">Router support access</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Enter the one-time password provided by the tenant administrator.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="session-password">Password</Label>
              <Input
                id="session-password"
                type="password"
                autoComplete="off"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={submitting || password.length < 32}>
              {submitting ? "Verifying…" : "Open support session"}
            </Button>
          </form>
        ) : !data ? (
          <p role="alert" className="mx-auto max-w-sm rounded-lg border bg-card p-5 text-sm text-destructive">
            {error || "This support session has expired or was revoked."}
          </p>
        ) : (
          <section className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold">{data.router.name}</h1>
                <p className="mt-1 text-sm text-muted-foreground">Limited router diagnostics</p>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs">
                <span
                  className={`h-2 w-2 rounded-full ${data.router.status === "online" ? "bg-emerald-500" : "bg-muted-foreground"}`}
                />
                {data.router.status}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Metric icon={Cpu} label="CPU" value={data.router.cpuLoad == null ? "—" : `${data.router.cpuLoad}%`} />
              <Metric icon={HardDrive} label="Memory used" value={data.router.memoryUsedPct == null ? "—" : `${data.router.memoryUsedPct}%`} />
              <Metric icon={Clock3} label="Uptime" value={uptime(data.router.uptimeSeconds)} />
              <Metric icon={Thermometer} label="Temperature" value={data.router.temperature == null ? "—" : `${data.router.temperature}°C`} />
              <Metric icon={Zap} label="Voltage" value={data.router.voltage == null ? "—" : `${data.router.voltage} V`} />
              <Metric
                icon={Activity}
                label="Last heartbeat"
                value={data.router.lastSeenAt ? new Date(data.router.lastSeenAt).toLocaleString() : "Never"}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="text-xs text-muted-foreground">
                Expires {new Date(data.expiresAt).toLocaleString()}. This view cannot run commands or
                change router settings.
              </p>
              <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
                Refresh diagnostics
              </Button>
            </div>
          </section>
        )}
        {!needsPassword && error && <p role="alert" className="mx-auto mt-4 max-w-sm text-sm text-destructive">{error}</p>}
      </div>
    </main>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden="true" /> {label}
      </div>
      <p className="mt-3 font-mono text-lg font-semibold">{value}</p>
    </div>
  );
}