import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck, ShieldAlert, Copy, Check, QrCode, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";

export function MfaSecurityCard() {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [factors, setFactors] = useState<{ id: string; status: string }[]>([]);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  // Enrollment state
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [disabling, setDisabling] = useState(false);

  async function loadFactors() {
    setLoading(true);
    try {
      const { data } = await supabase.auth.mfa.listFactors();
      setFactors(data?.totp ?? []);
    } catch (e: unknown) {
      console.error("Error loading MFA factors", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadFactors();
  }, []);

  const isMfaActive = factors.some((f) => f.status === "verified");

  async function startEnrollment() {
    setEnrolling(true);
    setCode("");
    try {
      // Clean up any unverified factors first
      const { data: current } = await supabase.auth.mfa.listFactors();
      for (const f of current?.all ?? []) {
        if (f.status === "unverified") {
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
      }

      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `NetGrid Admin (${new Date().toLocaleDateString()})`,
      });

      if (error || !data) {
        toast.error(error?.message ?? "Could not initiate MFA setup");
        return;
      }

      setFactorId(data.id);
      setQr(data.totp.qr_code);
      setSecret(data.totp.secret);
      setEnrollOpen(true);
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? "MFA setup failed");
    } finally {
      setEnrolling(false);
    }
  }

  async function verifyAndActivate(e: React.FormEvent) {
    e.preventDefault();
    if (code.trim().length !== 6) return;
    setVerifying(true);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: code.trim(),
      });

      if (error) {
        toast.error("Invalid or expired 6-digit code. Check your authenticator app and try again.");
        return;
      }

      toast.success("Two-step verification (MFA) activated successfully!");
      void logAudit({ action: "enable_mfa", resource: "auth", details: { method: "totp" } });
      setEnrollOpen(false);
      await loadFactors();
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? "Verification failed");
    } finally {
      setVerifying(false);
    }
  }

  async function handleDisableMfa() {
    setDisabling(true);
    try {
      const { data } = await supabase.auth.mfa.listFactors();
      for (const f of data?.all ?? []) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      toast.success("Two-step verification has been disabled");
      void logAudit({ action: "disable_mfa", resource: "auth", details: { method: "totp" } });
      setDisableOpen(false);
      await loadFactors();
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? "Failed to disable MFA");
    } finally {
      setDisabling(false);
    }
  }

  function copySecret() {
    if (!secret) return;
    navigator.clipboard.writeText(secret);
    setCopied(true);
    toast.success("Secret key copied");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-xl border bg-card p-5 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-lg border ${
              isMfaActive
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
            }`}
          >
            {isMfaActive ? <ShieldCheck className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-base">Two-Step Verification (MFA)</h3>
              {loading ? (
                <span className="text-xs text-muted-foreground">Checking…</span>
              ) : isMfaActive ? (
                <Badge
                  variant="default"
                  className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                >
                  Activated
                </Badge>
              ) : (
                <Badge variant="outline" className="border-amber-500/30 text-amber-600 dark:text-amber-400">
                  Disabled
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              {isMfaActive
                ? "Your admin account is protected with an Authenticator App (TOTP). A 6-digit verification code is required when signing into this portal."
                : "Two-step verification is currently disabled for this account. You can activate it at any time to require an authenticator code on sign-in."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
          {loading ? (
            <Button size="sm" variant="ghost" disabled>
              <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Loading
            </Button>
          ) : isMfaActive ? (
            <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10 border-destructive/30">
                  Disable MFA
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Disable Two-Step Verification?</DialogTitle>
                  <DialogDescription>
                    Turning off two-step verification means your portal will only be protected by your password. Are you sure you want to disable it?
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter className="mt-4 gap-2">
                  <Button variant="ghost" onClick={() => setDisableOpen(false)} disabled={disabling}>
                    Cancel
                  </Button>
                  <Button variant="destructive" onClick={handleDisableMfa} disabled={disabling}>
                    {disabling ? "Disabling…" : "Yes, Disable MFA"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : (
            <Button size="sm" onClick={startEnrollment} disabled={enrolling} className="gap-2">
              <QrCode className="h-4 w-4" />
              {enrolling ? "Starting setup…" : "Activate MFA"}
            </Button>
          )}
        </div>
      </div>

      {/* Enrollment Dialog */}
      <Dialog open={enrollOpen} onOpenChange={setEnrollOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set Up Two-Step Verification</DialogTitle>
            <DialogDescription>
              Scan the QR code with your authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, or Authy).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {qr && (
              <div className="flex justify-center p-3 rounded-lg border bg-white">
                <img src={qr} alt="MFA QR Code" className="h-44 w-44 object-contain" />
              </div>
            )}

            {secret && (
              <div>
                <Label className="text-xs text-muted-foreground">Or enter key manually:</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input value={secret} readOnly className="font-mono text-xs bg-muted" />
                  <Button size="sm" variant="outline" onClick={copySecret} type="button">
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            )}

            <form onSubmit={verifyAndActivate} className="space-y-3 pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="enroll-code">Enter 6-digit code from app</Label>
                <Input
                  id="enroll-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  className="text-center font-mono text-lg tracking-[0.3em]"
                  required
                />
              </div>

              <DialogFooter className="mt-4 gap-2">
                <Button type="button" variant="ghost" onClick={() => setEnrollOpen(false)} disabled={verifying}>
                  Cancel
                </Button>
                <Button type="submit" disabled={verifying || code.trim().length !== 6}>
                  {verifying ? "Verifying…" : "Verify & Activate"}
                </Button>
              </DialogFooter>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function MfaSecurityDialog({
  trigger,
}: {
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="sm" className="gap-2 justify-start">
            <ShieldCheck className="h-4 w-4" /> Two-Step Verification
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Security &amp; Authentication</DialogTitle>
          <DialogDescription>
            Manage two-step verification (MFA) for your administrator account.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <MfaSecurityCard />
        </div>
      </DialogContent>
    </Dialog>
  );
}
