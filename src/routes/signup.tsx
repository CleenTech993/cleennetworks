import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Create your ISP — NetGrid" }] }),
  component: SignupPage,
});

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || `isp-${Date.now()}`;
}

function SignupPage() {
  const navigate = useNavigate();
  const [companyName, setCompanyName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const redirectUrl = `${window.location.origin}/tenant`;
      const { data: signup, error: signErr } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectUrl, data: { full_name: fullName } },
      });
      if (signErr) throw signErr;
      const user = signup.user;
      if (!user) throw new Error("Signup failed");

      // If email confirmation is on, session may be null — instruct and bail
      if (!signup.session) {
        toast.success("Check your email to confirm your account.");
        navigate({ to: "/login" });
        return;
      }

      // Create tenant + assign admin role + link profile
      const slug = `${slugify(companyName)}-${Math.random().toString(36).slice(2, 6)}`;
      const { data: tenant, error: tErr } = await supabase
        .from("tenants")
        .insert({ name: companyName, slug })
        .select("id")
        .single();
      if (tErr) throw tErr;

      const { error: pErr } = await supabase
        .from("profiles")
        .update({ tenant_id: tenant.id, full_name: fullName })
        .eq("id", user.id);
      if (pErr) throw pErr;

      const { error: rErr } = await supabase
        .from("user_roles")
        .insert({ user_id: user.id, role: "tenant_admin", tenant_id: tenant.id });
      if (rErr) throw rErr;

      toast.success("Welcome to NetGrid!");
      navigate({ to: "/tenant" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex justify-center"><Brand /></Link>
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h1 className="text-xl font-semibold">Launch your ISP</h1>
          <p className="mt-1 text-sm text-muted-foreground">Create a tenant workspace in seconds.</p>
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <Label htmlFor="company">Company / ISP name</Label>
              <Input id="company" required value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme WiFi Ltd" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="name">Your name</Label>
              <Input id="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1" />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>{loading ? "Creating…" : "Create workspace"}</Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Already have an account? <Link to="/login" className="text-primary hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
