import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Brand } from "@/components/brand";
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate({ to: "/login" }); return; }
      if (alive) setEmail(user.email ?? null);
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      if (!alive) return;
      if (roles && roles.length > 0) {
        const isSuper = roles.some((r) => r.role === "super_admin");
        navigate({ to: isSuper ? "/super-admin" : "/tenant" });
      }
    }
    check();
    const id = setInterval(check, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [navigate]);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-md text-center">
        <div className="mb-6 flex justify-center"><Brand /></div>
        <div className="rounded-lg border bg-card p-8 shadow-sm">
          <h1 className="text-xl font-semibold">Awaiting approval</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your account {email && <span className="font-medium text-foreground">({email})</span>} is pending review by a super admin.
            You'll be routed to your console automatically once access is granted.
          </p>
          <Button variant="outline" onClick={signOut} className="mt-6">Sign out</Button>
        </div>
      </div>
    </div>
  );
}
