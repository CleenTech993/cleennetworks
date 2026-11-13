import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AuthLayout } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { signInWithGoogle } from "@/lib/google-auth";
import {
  isStrongPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_REQUIREMENTS,
} from "@/lib/password-policy";

export const Route = createFileRoute("/signup")({
  validateSearch: (search: Record<string, unknown>) => ({
    demo: search["demo"] === "true",
  }),
  head: () => ({
    meta: [
      { title: "Create ISP account — NetGrid" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const { demo } = Route.useSearch();
  const [fullName, setFullName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [demoWorkspace, setDemoWorkspace] = useState(demo);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isStrongPassword(password)) {
      toast.error(PASSWORD_REQUIREMENTS);
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const redirectUrl = `${window.location.origin}/pending${demoWorkspace ? "?demo=true" : ""}`;
      const { data: signup, error: signErr } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            full_name: fullName.trim(),
            business_name: businessName.trim(),
            business_phone: phone.trim(),
            demo_workspace: demoWorkspace,
          },
        },
      });
      if (signErr) throw signErr;
      if (!signup.user) throw new Error("Signup failed");

      if (!signup.session) {
        toast.success("Check your email to verify your account and create your ISP workspace.");
        navigate({ to: "/login" });
        return;
      }

      const { error: onboardingError } = await supabase.rpc("provision_isp_tenant", {
        p_business_name: businessName.trim(),
        p_phone: phone.trim(),
        p_full_name: fullName.trim(),
      });
      if (onboardingError) {
        toast.error(onboardingError.message);
        navigate({ to: "/pending" });
        return;
      }

      if (demoWorkspace) {
        const { error: demoError } = await supabase.rpc("seed_demo_workspace");
        if (demoError) {
          toast.error(
            `Workspace created, but sample data could not be loaded: ${demoError.message}`,
          );
          navigate({ to: "/pending" });
          return;
        }
      }

      toast.success(
        demoWorkspace
          ? "Your demo workspace is ready with sample data."
          : "ISP workspace created. You can start setting up your network.",
      );
      navigate({ to: "/pending" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    try {
      await signInWithGoogle(
        `${window.location.origin}/pending${demoWorkspace ? "?demo=true" : ""}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not continue with Google.");
      setGoogleLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Create your ISP workspace"
      description="Enter your ISP and contact details. Verify your email if prompted, then start setup—no admin approval required."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleGoogleSignIn}
          disabled={loading || googleLoading}
        >
          {googleLoading ? "Connecting to Google…" : "Continue with Google"}
        </Button>
        <label className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-primary"
            checked={demoWorkspace}
            onChange={(event) => setDemoWorkspace(event.target.checked)}
          />
          <span>
            <span className="font-medium">Start with sample demo data</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              Creates an isolated workspace with fictional network and customer records. No real
              routers or payments are connected.
            </span>
          </span>
        </label>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          <span>or create an account with email</span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="name">Contact person name</Label>
          <Input
            id="name"
            autoComplete="name"
            required
            minLength={2}
            maxLength={100}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="business-name">Business / ISP name</Label>
          <Input
            id="business-name"
            autoComplete="organization"
            required
            minLength={2}
            maxLength={120}
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Business contact phone</Label>
          <Input
            id="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            placeholder="+254 7xx xxx xxx"
            pattern="\+?[0-9][0-9\s\(\)\-]{6,19}"
            title="Enter a valid phone number"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{PASSWORD_REQUIREMENTS}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-password">Confirm password</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
        <Button type="submit" className="w-full" disabled={loading || googleLoading}>
          {loading ? "Creating workspace…" : "Create ISP workspace"}
        </Button>
      </form>
    </AuthLayout>
  );
}
