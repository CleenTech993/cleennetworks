import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { LogOut, MonitorSmartphone } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export function SessionManagementCard() {
  const navigate = useNavigate();
  const [action, setAction] = useState<"others" | "all" | null>(null);
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);

  async function writeAudit(actionName: string, description: string) {
    const { data: userResult, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!userResult.user) throw new Error("You must be signed in to manage sessions.");

    const { data: roleRows, error: rolesError } = await supabase
      .from("user_roles")
      .select("role,tenant_id")
      .eq("user_id", userResult.user.id);
    if (rolesError) throw rolesError;
    const actorRole =
      roleRows.find((row) => row.role === "super_admin")?.role ??
      roleRows.find((row) => row.role === "tenant_admin")?.role ??
      roleRows[0]?.role ??
      "system";
    const tenantId =
      actorRole === "super_admin"
        ? null
        : (roleRows.find((row) => row.role === "tenant_admin")?.tenant_id ?? null);
    const { error } = await supabase.from("audit_logs").insert({
      tenant_id: tenantId,
      actor_id: userResult.user.id,
      actor_email: userResult.user.email ?? null,
      actor_role: actorRole,
      action: actionName,
      resource_type: "auth_session",
      resource_id: null,
      description,
      metadata: {},
    });
    if (error) throw error;
  }

  async function signOutOthers() {
    setAction("others");
    try {
      await writeAudit("sign_out_other_sessions", "User signed out other active sessions");
      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) throw error;
      toast.success("Other active sessions have been signed out.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sign out other sessions.");
    } finally {
      setAction(null);
    }
  }

  async function signOutEverywhere() {
    setAction("all");
    try {
      await writeAudit("sign_out_all_sessions", "User signed out all active sessions");
      const { error } = await supabase.auth.signOut({ scope: "global" });
      if (error) throw error;
      await navigate({ to: "/login" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sign out all sessions.");
    } finally {
      setAction(null);
    }
  }

  return (
    <section className="mt-8 rounded-xl border bg-card p-5">
      <div className="flex items-start gap-3">
        <MonitorSmartphone className="mt-0.5 h-5 w-5 text-primary" />
        <div>
          <h2 className="font-semibold">Sessions &amp; devices</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Remotely sign out your account on other browsers and devices, or end every active
            session including this one. You can sign back in with your password and authenticator.
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" onClick={signOutOthers} disabled={action !== null}>
          <MonitorSmartphone className="mr-2 h-4 w-4" />
          {action === "others" ? "Signing out…" : "Sign out other sessions"}
        </Button>
        <AlertDialog
          open={confirmAllOpen}
          onOpenChange={(open) => action === null && setConfirmAllOpen(open)}
        >
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={action !== null}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign out all devices
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sign out on all devices?</AlertDialogTitle>
              <AlertDialogDescription>
                This will end every active session, including this one. You will need to sign in
                again to continue.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={action !== null}>Cancel</AlertDialogCancel>
              <Button
                variant="destructive"
                onClick={() => void signOutEverywhere()}
                disabled={action !== null}
              >
                {action === "all" ? "Signing out…" : "Sign out all devices"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
  );
}
