import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
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

export function ConfirmSignOut({ trigger }: { trigger: ReactNode }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function confirmSignOut() {
    setSigningOut(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        toast.error(`Could not sign out: ${error.message}`);
        return;
      }
      setOpen(false);
      await navigate({ to: "/login" });
    } catch (error) {
      toast.error(
        `Could not sign out: ${error instanceof Error ? error.message : "Unexpected error"}`,
      );
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => !signingOut && setOpen(nextOpen)}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sign out?</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to sign out of your NetGrid account?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={signingOut}>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={() => void confirmSignOut()} disabled={signingOut}>
            {signingOut ? "Signing out…" : "Sign out"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
