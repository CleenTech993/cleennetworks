import { useMutation } from "@tanstack/react-query";
import { Copy, LifeBuoy, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createRouterSupportSession,
  revokeRouterSupportSession,
} from "@/lib/router-support.functions";

type Session = { sessionId: string; password: string; expiresAt: string };

export function RouterSupportSessionButton({ routerId }: { routerId: string }) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const create = useMutation({
    mutationFn: () => createRouterSupportSession({ data: { routerId } }),
    onSuccess: setSession,
    onError: (error: Error) => toast.error(error.message),
  });
  const revoke = useMutation({
    mutationFn: () => revokeRouterSupportSession({ data: { sessionId: session!.sessionId } }),
    onSuccess: () => {
      setSession(null);
      toast.success("Support session revoked.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function copyCredentials() {
    if (!session) return;
    const url = new URL(`/support-session/${session.sessionId}`, window.location.origin).href;
    try {
      await navigator.clipboard.writeText(
        `Link: ${url}\nUsername: ${session.sessionId}\nPassword: ${session.password}`,
      );
      toast.success("Support session details copied.");
    } catch {
      toast.error("Could not copy session details. Copy them from the fields below.");
    }
  }

  const sessionUrl = session
    ? new URL(`/support-session/${session.sessionId}`, window.location.origin).href
    : "";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <LifeBuoy aria-hidden="true" /> Share support session
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Read-only router support</DialogTitle>
          <DialogDescription>
            Create a one-time password for an external technician. This session expires in 15 minutes
            and cannot run commands or expose router credentials or addresses.
          </DialogDescription>
        </DialogHeader>
        {session ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <p>Copy these credentials now. The password is shown only once.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="support-link">Session link</Label>
              <Input id="support-link" readOnly value={sessionUrl} />
              <Label htmlFor="support-username">Username</Label>
              <Input id="support-username" readOnly value={session.sessionId} />
              <Label htmlFor="support-password">One-time password</Label>
              <Input id="support-password" readOnly value={session.password} />
            </div>
            <p className="text-xs text-muted-foreground">
              Expires {new Date(session.expiresAt).toLocaleString()}. Closing this dialog hides the
              password; create another session to replace or revoke this one.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => void copyCredentials()}>
                <Copy aria-hidden="true" /> Copy details
              </Button>
              <Button
                variant="destructive"
                onClick={() => revoke.mutate()}
                disabled={revoke.isPending}
              >
                {revoke.isPending ? "Revoking…" : "Revoke session"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? "Creating session…" : "Create 15-minute session"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}