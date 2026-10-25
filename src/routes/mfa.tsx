import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { AuthLayout } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/mfa")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Verify sign-in — NetGrid" },
      { name: "description", content: "Two-step verification code." },
    ],
  }),
  component: MfaPage,
});

export async function destinationAfterAuth(): Promise<
  "/super-admin" | "/tenant" | "/pending" | "/login"
> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
      const { data: en, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `NetGrid ${Date.now()}`,
      });
      if (error || !en) {
        toast.error(error?.message ?? "Could not start setup");
        return;
      }
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
    if (error) {
      toast.error("Wrong or expired code. Try again.");
      return;
    }
    toast.success("Verified");
    navigate({ to: await destinationAfterAuth() });
  }

  return (
    <AuthLayout
      title="Two-step verification"
      icon={<ShieldCheck className="h-6 w-6 text-primary" />}
      description={
        mode === "verify" ? "Enter the 6-digit code from your authenticator app." : undefined
      }
    >
      {mode === "loading" && <p className="text-sm text-muted-foreground">Loading…</p>}
      {mode === "enroll" && (
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Scan this code with Google Authenticator, Microsoft Authenticator or Authy, then enter
            the 6-digit code it shows.
          </p>
          {qr && (
            <img
              src={qr}
              alt="Authenticator QR code"
              className="mx-auto h-44 w-44 rounded-lg border bg-white p-2"
            />
          )}
          <p className="break-all text-center font-mono text-xs text-muted-foreground">{secret}</p>
        </div>
      )}
      {mode !== "loading" && (
        <form onSubmit={submit} className="mt-5 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="otp">Code</Label>
            <Input
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="text-center font-mono text-lg tracking-[0.4em]"
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
            {busy ? "Verifying…" : "Verify"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/login" });
            }}
          >
            Use a different account
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
