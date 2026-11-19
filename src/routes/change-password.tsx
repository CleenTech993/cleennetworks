import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AuthLayout } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { changeTemporaryPassword } from "@/lib/team.functions";
import {
  isStrongPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_REQUIREMENTS,
} from "@/lib/password-policy";

export const Route = createFileRoute("/change-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Change temporary password — NetGrid" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ChangePasswordPage,
});

function ChangePasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [checking, setChecking] = useState(true);
  const [required, setRequired] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.auth
      .getUser()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          toast.error(error.message);
          void navigate({ to: "/login" });
          return;
        }
        if (!data.user) {
          void navigate({ to: "/login" });
          return;
        }
        if (data.user.app_metadata["must_change_password"] !== true) {
          void navigate({ to: "/login" });
          return;
        }
        setRequired(true);
        setChecking(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        toast.error(error instanceof Error ? error.message : "Could not verify your account.");
        void navigate({ to: "/login" });
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!isStrongPassword(password)) {
      toast.error(PASSWORD_REQUIREMENTS);
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const result = await changeTemporaryPassword({ data: { password } });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      toast.success("Password updated. Sign in with your new password.");
      await navigate({ to: "/login" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update your password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Change your temporary password"
      description="Choose a new password to continue to your account."
    >
      {checking ? (
        <p className="text-sm text-muted-foreground">Verifying your account…</p>
      ) : required ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Confirm new password</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Updating…" : "Set new password"}
          </Button>
        </form>
      ) : null}
    </AuthLayout>
  );
}
