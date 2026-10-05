import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/mfa")({
  ssr: false,
  head: () => ({ meta: [{ title: "Verify sign-in — NetGrid" }, { name: "description", content: "Two-step verification code." }] }),
  component: MfaPage,
});

export async function destinationAfterAuth(): Promise<"/super-admin" | "/tenant" | "/pending" | "/login"> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "/login";
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  if (!roles?.length) return "/pending";
  return roles.some((r) => r.role === "super_admin") ? "/super-admin" : "/tenant";
}

function MfaPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"loading" | "enroll" | "verify">("loading");
  const [factorId, setFactorId] = useState("");
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return navigate({ to: "/login" });
      const { data } = await supabase.auth.mfa.listFactors();
      const verified = data?.totp?.[0];
      if (verified) {
        setFactorId(verified.id);
        setMode("verify");
        return;
      }
      // Clean up half-finished enrolments, then start a new one
      for (const f of data?.all ?? []) {
        if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data: en, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `NetGrid ${Date.now()}` });
      if (error || !en) { toast.error(error?.message ?? "Could not start setup"); return; }
      setFactorId(en.id);
      setQr(en.totp.qr_code);
      setSecret(en.totp.secret);
      setMode("enroll");
    })();
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setBusy(false);
    if (error) { toast.error("Wrong or expired code. Try again."); return; }
    toast.success("Verified");
    navigate({ to: await destinationAfterAuth() });
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center"><Brand /></div>
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold">Two-step verification</h1>
          </div>
          {mode === "loading" && <p className="mt-4 text-sm text-muted-foreground">Loading…</p>}
          {mode === "enroll" && (
            <div className="mt-3 space-y-3 text-sm">
              <p className="text-muted-foreground">
                Scan this code with Google Authenticator, Microsoft Authenticator or Authy, then enter the 6-digit code it shows.
              </p>
              {qr && <img src={qr} alt="Authenticator QR code" className="mx-auto h-44 w-44 rounded bg-card" />}
              <p className="break-all text-center font-mono text-xs text-muted-foreground">{secret}</p>
            </div>
          )}
          {mode === "verify" && (
            <p className="mt-3 text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app.</p>
          )}
          {mode !== "loading" && (
            <form onSubmit={submit} className="mt-4 space-y-3">
              <div>
                <Label htmlFor="otp">Code</Label>
                <Input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="mt-1 text-center font-mono text-lg tracking-widest" />
              </div>
              <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>{busy ? "Verifying…" : "Verify"}</Button>
              <Button type="button" variant="ghost" className="w-full" onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/login" }); }}>
                Use a different account
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
