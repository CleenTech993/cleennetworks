import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AuthLayout } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/pending")({
  head: () => ({ meta: [{ title: "Pending approval — NetGrid" }] }),
  component: PendingPage,
});

function PendingPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function check() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        navigate({ to: "/login" });
        return;
      }
      if (alive) setEmail(user.email ?? null);
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      if (!alive) return;
      if (roles && roles.length > 0) {
        const isSuper = roles.some((r) => r.role === "super_admin");
        navigate({ to: isSuper ? "/super-admin" : "/tenant" });
      }
    }
    check();
    const id = setInterval(check, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [navigate]);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  }

  return (
    <AuthLayout
      title="Awaiting approval"
      description={`Your account${email ? ` (${email})` : ""} is waiting for a super admin to review it. You'll be taken to your console automatically once access is granted.`}
    >
      <Button variant="outline" onClick={signOut}>
        Sign out
      </Button>
    </AuthLayout>
  );
}
