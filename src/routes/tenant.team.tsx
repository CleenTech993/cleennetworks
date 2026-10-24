import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, Trash2, UserPlus } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { addTeamMember, listTeam, removeTeamMember, updateTeamMemberRole } from "@/lib/team.functions";
import type { TeamMember, TeamRole } from "@/lib/team.functions";

export const Route = createFileRoute("/tenant/team")({ component: TeamPage });

const ROLE_LABEL: Record<TeamRole, string> = {
  tenant_admin: "Admin",
  technician: "Technician",
  billing_agent: "Billing agent",
  support_staff: "Support staff",
};
const ROLES = Object.keys(ROLE_LABEL) as TeamRole[];

function generatePassword(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join("");
}

function TeamPage() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<TeamMember | null>(null);

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
  });

  const { data, isLoading } = useQuery({ queryKey: ["team"], queryFn: () => listTeam() });

  const refresh = () => qc.invalidateQueries({ queryKey: ["team"] });

  const changeRole = useMutation({
    mutationFn: (v: { userId: string; role: TeamRole }) => updateTeamMemberRole({ data: v }),
    onSuccess: (r) => {
      if (r.ok) toast.success("Role updated");
      else toast.error(r.error);
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update role"),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => removeTeamMember({ data: { userId } }),
    onSuccess: (r) => {
      if (r.ok) toast.success("Member removed");
      else toast.error(r.error);
      setRemoving(null);
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not remove member"),
  });

  return (
    <div>
      <PageHeader
        title="Team"
        description="Add your technicians and staff. They sign in with the email and password you set, then set up their authenticator app."
        action={
          data?.ok ? (
            <Button onClick={() => setAdding(true)}>
              <UserPlus className="h-4 w-4" /> Add member
            </Button>
          ) : undefined
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data?.ok ? (
        <EmptyState title="Admins only" description={data?.error ?? "Only tenant admins can manage the team."} />
      ) : data.members.length === 0 ? (
        <EmptyState title="No team members yet" description="Add your first technician or staff member." />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => {
                const self = m.id === me;
                return (
                  <tr key={m.id} className="border-t">
                    <td className="px-4 py-2">
                      {m.full_name ?? "—"} {self && <Badge variant="secondary" className="ml-1">You</Badge>}
                    </td>
                    <td className="px-4 py-2">{m.email ?? "—"}</td>
                    <td className="px-4 py-2">
                      {self ? (
                        <Badge>{ROLE_LABEL[m.roles[0]] ?? m.roles[0]}</Badge>
                      ) : (
                        <Select
                          value={m.roles[0]}
                          onValueChange={(v) => changeRole.mutate({ userId: m.id, role: v as TeamRole })}
                        >
                          <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {!self && (
                        <Button size="sm" variant="ghost" onClick={() => setRemoving(m)} aria-label="Remove member">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AddMemberDialog open={adding} onClose={() => setAdding(false)} onAdded={refresh} />

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.full_name ?? removing?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              They lose access to your account immediately. You can add them again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => removing && remove.mutate(removing.id)}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AddMemberDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("technician");
  const [password, setPassword] = useState(() => generatePassword());
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  function reset() {
    setFullName("");
    setEmail("");
    setRole("technician");
    setPassword(generatePassword());
    setCreated(null);
  }
  function close() {
    reset();
    onClose();
  }

  async function submit() {
    setBusy(true);
    try {
      const res = await addTeamMember({ data: { fullName, email, role, password } });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onAdded();
      if (res.existing) {
        toast.success("Added. They already had an account, so they sign in with their own password.");
        close();
      } else {
        setCreated({ email: email.trim().toLowerCase(), password });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add member");
    } finally {
      setBusy(false);
    }
  }

  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast.success("Copied"));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Member added</DialogTitle>
              <DialogDescription>
                Share these sign-in details with them now. The password is not shown again.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 rounded-md border bg-muted/40 p-3 font-mono text-sm">
              <div>Email: {created.email}</div>
              <div>Password: {created.password}</div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => copy(`Email: ${created.email}\nPassword: ${created.password}`)}>
                <Copy className="h-4 w-4" /> Copy details
              </Button>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add team member</DialogTitle>
              <DialogDescription>
                They can sign in right away. On first login they'll set up an authenticator app.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="tm-name">Full name</Label>
                <Input id="tm-name" className="mt-1" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="tm-email">Email</Label>
                <Input id="tm-email" type="email" className="mt-1" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <Label>Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as TeamRole)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="tm-pass">Temporary password</Label>
                <div className="mt-1 flex gap-2">
                  <Input id="tm-pass" className="font-mono" value={password} onChange={(e) => setPassword(e.target.value)} />
                  <Button type="button" variant="outline" onClick={() => setPassword(generatePassword())}>Generate</Button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">At least 8 characters.</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={close}>Cancel</Button>
              <Button onClick={submit} disabled={busy || !fullName.trim() || !email.trim() || password.length < 8}>
                {busy ? "Adding…" : "Add member"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
