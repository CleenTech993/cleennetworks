import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Trash2, UserPlus } from "lucide-react";
import { ResetUserMfaButton } from "@/components/reset-user-mfa-button";
import { PageHeader, EmptyState } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import {
  addTeamMember,
  listTeam,
  removeTeamMember,
  updateTeamMemberRole,
} from "@/lib/team.functions";
import type { TeamMember, TeamRole } from "@/lib/team.functions";

export const Route = createFileRoute("/tenant/team")({ component: TeamPage });

const ROLE_LABEL: Record<TeamRole, string> = {
  tenant_admin: "Admin",
  technician: "Technician",
  billing_agent: "Billing agent",
  support_staff: "Support staff",
};
const ROLES = Object.keys(ROLE_LABEL) as TeamRole[];

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
    mutationFn: (v: { userId: string; roles: TeamRole[] }) => updateTeamMemberRole({ data: v }),
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
        <EmptyState
          title="Admins only"
          description={data?.error ?? "Only tenant admins can manage the team."}
        />
      ) : data.members.length === 0 ? (
        <EmptyState
          title="No team members yet"
          description="Add your first technician or staff member."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Phone</th>
                <th className="px-4 py-2">Roles</th>
                <th className="px-4 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => {
                const self = m.id === me;
                return (
                  <tr key={m.id} className="border-t">
                    <td className="px-4 py-2">
                      {[m.first_name, m.last_name].filter(Boolean).join(" ") || m.full_name || "—"}{" "}
                      {self && (
                        <Badge variant="secondary" className="ml-1">
                          You
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2">{m.email ?? "—"}</td>
                    <td className="px-4 py-2">{m.phone ?? "—"}</td>
                    <td className="px-4 py-2">
                      {self ? (
                        <div className="flex flex-wrap gap-1">
                          {m.roles.map((role) => (
                            <Badge key={role}>{ROLE_LABEL[role]}</Badge>
                          ))}
                        </div>
                      ) : (
                        <div className="grid gap-1.5 sm:grid-cols-2">
                          {ROLES.map((role) => (
                            <label key={role} className="flex items-center gap-2 text-xs">
                              <Checkbox
                                checked={m.roles.includes(role)}
                                disabled={
                                  changeRole.isPending ||
                                  (m.roles.length === 1 && m.roles.includes(role))
                                }
                                onCheckedChange={(checked) => {
                                  if (!checked && m.roles.length === 1) return;
                                  changeRole.mutate({
                                    userId: m.id,
                                    roles: checked
                                      ? [...m.roles, role]
                                      : m.roles.filter((assigned) => assigned !== role),
                                  });
                                }}
                              />
                              {ROLE_LABEL[role]}
                            </label>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {!self && (
                        <div className="flex justify-end gap-2">
                          <ResetUserMfaButton
                            userId={m.id}
                            userLabel={m.full_name ?? m.email ?? "this member"}
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setRemoving(m)}
                            aria-label="Remove member"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
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
            <AlertDialogAction onClick={() => removing && remove.mutate(removing.id)}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AddMemberDialog({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [roles, setRoles] = useState<TeamRole[]>(["technician"]);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);

  function reset() {
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setRoles(["technician"]);
    setCreated(false);
  }
  function close() {
    reset();
    onClose();
  }

  async function submit() {
    setBusy(true);
    try {
      const res = await addTeamMember({ data: { firstName, lastName, email, phone, roles } });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onAdded();
      setCreated(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add member");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Member added</DialogTitle>
              <DialogDescription>
                Sign-in details and a temporary password were sent to the team member’s email. They
                must set a new password the first time they sign in.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add team member</DialogTitle>
              <DialogDescription>
                Enter their details and privileges. We’ll email their sign-in and temporary
                password.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="tm-first-name">First name</Label>
                  <Input
                    id="tm-first-name"
                    className="mt-1"
                    autoComplete="given-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="tm-last-name">Last name</Label>
                  <Input
                    id="tm-last-name"
                    className="mt-1"
                    autoComplete="family-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="tm-email">Team email</Label>
                <Input
                  id="tm-email"
                  type="email"
                  className="mt-1"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="tm-phone">Phone number</Label>
                <Input
                  id="tm-phone"
                  type="tel"
                  className="mt-1"
                  autoComplete="tel"
                  placeholder="+254 7XX XXX XXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Privileges</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {ROLES.map((roleOption) => (
                    <label key={roleOption} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={roles.includes(roleOption)}
                        onCheckedChange={(checked) =>
                          setRoles((current) =>
                            checked
                              ? [...current, roleOption]
                              : current.filter((role) => role !== roleOption),
                          )
                        }
                      />
                      {ROLE_LABEL[roleOption]}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button
                onClick={submit}
                disabled={
                  busy ||
                  !firstName.trim() ||
                  !lastName.trim() ||
                  !email.trim() ||
                  !phone.trim() ||
                  roles.length === 0
                }
              >
                {busy ? "Creating account…" : "Create account & email login"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
