import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AuthLayout } from "@/components/auth-layout";
import { ConfirmSignOut } from "@/components/confirm-sign-out";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/pending")({
  head: () => ({
    meta: [
      { title: "Finish ISP setup — NetGrid" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PendingPage,
});

function PendingPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    async function check() {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) {
        if (alive) {
          setError(userError.message);
          setLoading(false);
        }
        return;
      }
      if (!user) {
        navigate({ to: "/login" });
        return;
      }

      const metadata = user.user_metadata;
      const name =
        typeof metadata["full_name"] === "string"
          ? metadata["full_name"]
          : typeof metadata["name"] === "string"
            ? metadata["name"]
            : "";
      const org = typeof metadata["business_name"] === "string" ? metadata["business_name"] : "";
      const contact =
        typeof metadata["business_phone"] === "string" ? metadata["business_phone"] : "";
      if (alive) {
        setEmail(user.email ?? null);
        setFullName(name);
        setBusinessName(org);
        setPhone(contact);
      }

      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      if (rolesError) {
        if (alive) {
          setError(rolesError.message);
          setLoading(false);
        }
        return;
      }
      if (roles?.length) {
        const isSuperAdmin = roles.some((role) => role.role === "super_admin");
        const { data: aal, error: aalError } =
          await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aalError) {
          if (alive) {
            setError(aalError.message);
            setLoading(false);
          }
          return;
        }
        if (aal?.nextLevel === "aal2") {
          navigate({ to: "/mfa" });
          return;
        }
        navigate({ to: isSuperAdmin ? "/super-admin" : "/tenant" });
        return;
      }

      if (org && contact && name) {
        const { error: provisioningError } = await supabase.rpc("provision_isp_tenant", {
          p_business_name: org,
          p_phone: contact,
          p_full_name: name,
        });
        if (!provisioningError) {
          navigate({ to: "/tenant" });
          return;
        }
        if (alive) setError(provisioningError.message);
      }
      if (alive) setLoading(false);
    }

    void check();
    return () => {
      alive = false;
    };
  }, [navigate]);

  async function createWorkspace(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { error: profileError } = await supabase.auth.updateUser({
        data: {
          full_name: fullName.trim(),
          business_name: businessName.trim(),
          business_phone: phone.trim(),
        },
      });
      if (profileError) throw profileError;

      const { error: provisioningError } = await supabase.rpc("provision_isp_tenant", {
        p_business_name: businessName.trim(),
        p_phone: phone.trim(),
        p_full_name: fullName.trim(),
      });
      if (provisioningError) throw provisioningError;
      await navigate({ to: "/tenant" });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not create workspace.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <AuthLayout title="Setting up your ISP" description="Creating your secure workspace…">
        <p className="text-sm text-muted-foreground">This usually takes just a moment.</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Finish your ISP setup"
      description={`Create your workspace${email ? ` for ${email}` : ""}. No admin approval is required.`}
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={createWorkspace} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="onboarding-name">Contact person name</Label>
          <Input
            id="onboarding-name"
            autoComplete="name"
            minLength={2}
            maxLength={100}
            required
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="onboarding-business">Business / ISP name</Label>
          <Input
            id="onboarding-business"
            autoComplete="organization"
            minLength={2}
            maxLength={120}
            required
            value={businessName}
            onChange={(event) => setBusinessName(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="onboarding-phone">Business contact phone</Label>
          <Input
            id="onboarding-phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            placeholder="+254 7xx xxx xxx"
            pattern="\+?[0-9][0-9 ()-]{6,19}"
            title="Enter a valid phone number"
            required
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "Creating workspace…" : "Create ISP workspace"}
        </Button>
        <ConfirmSignOut
          trigger={
            <Button type="button" variant="ghost" className="w-full">
              Sign out
            </Button>
          }
        />
      </form>
    </AuthLayout>
  );
}
