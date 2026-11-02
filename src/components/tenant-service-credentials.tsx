import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getTenantServiceStatus,
  registerTenantC2bCallbacks,
  removeTenantServiceCredentials,
  saveTenantServiceCredentials,
} from "@/lib/tenant-service.functions";

const initialForm = {
  mpesaEnvironment: "sandbox" as "sandbox" | "production",
  mpesaShortcode: "",
  mpesaConsumerKey: "",
  mpesaConsumerSecret: "",
  mpesaPasskey: "",
  smsUsername: "",
  smsApiKey: "",
  smsSenderId: "",
};

export function TenantServiceCredentials() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initialForm);
  const {
    data: status,
    isError: statusError,
    isLoading,
  } = useQuery({
    queryKey: ["tenant-service-status"],
    queryFn: () => getTenantServiceStatus(),
  });

  useEffect(() => {
    if (status) {
      setForm((current) => ({ ...current, mpesaEnvironment: status.mpesaEnvironment }));
    }
  }, [status]);

  const save = useMutation({
    mutationFn: () => {
      const credentialsEntered = Object.entries(form).some(
        ([field, value]) => field !== "mpesaEnvironment" && Boolean(value),
      );
      return saveTenantServiceCredentials({
        data: {
          ...form,
          ...(!credentialsEntered && status?.mpesaEnvironment === form.mpesaEnvironment
            ? { mpesaEnvironment: undefined }
            : {}),
        },
      });
    },
    onSuccess: (nextStatus) => {
      setForm({ ...initialForm, mpesaEnvironment: nextStatus.mpesaEnvironment });
      queryClient.setQueryData(["tenant-service-status"], nextStatus);
      toast.success("Service credentials saved securely.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: () => removeTenantServiceCredentials(),
    onSuccess: (nextStatus) => {
      setForm({ ...initialForm, mpesaEnvironment: nextStatus.mpesaEnvironment });
      queryClient.setQueryData(["tenant-service-status"], nextStatus);
      toast.success("Saved service credentials removed.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const registerC2b = useMutation({
    mutationFn: () => registerTenantC2bCallbacks(),
    onSuccess: ({ results }) => {
      const registered = results.filter((result) => result.registered);
      const failed = results.filter((result) => !result.registered);
      if (registered.length) {
        toast.success(
          `C2B callbacks registered for: ${registered.map((item) => item.shortcode).join(", ")}`,
        );
      }
      if (failed.length) {
        toast.error(
          `Safaricom did not register callbacks for: ${failed.map((item) => item.shortcode).join(", ")}. Check shortcode eligibility with Safaricom.`,
        );
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function field(
    key: keyof typeof initialForm,
    label: string,
    placeholder: string,
    secret = false,
  ) {
    return (
      <div>
        <Label htmlFor={key}>{label}</Label>
        <Input
          id={key}
          type={secret ? "password" : "text"}
          autoComplete="new-password"
          value={form[key]}
          placeholder={placeholder}
          onChange={(event) => setForm({ ...form, [key]: event.target.value })}
          className="mt-1"
        />
      </div>
    );
  }

  return (
    <section className="mt-8 rounded-xl border bg-card p-5">
      <div className="mb-5">
        <h2 className="text-lg font-semibold">API &amp; service credentials</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure your M-Pesa Daraja and SMS accounts here. Credentials are encrypted and never
          returned to the browser. Re-enter a value only when replacing it.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-lg border p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">M-Pesa Daraja</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                New portal purchases are sent directly to your PayBill account.
              </p>
            </div>
            <Badge variant={status?.mpesaConfigured ? "default" : "secondary"}>
              {isLoading
                ? "Checking"
                : statusError
                  ? "Status unavailable"
                  : status?.mpesaConfigured
                    ? "Connected"
                    : "Not configured"}
            </Badge>
          </div>
          {status?.shortcodeLast4 && (
            <p className="mb-3 text-xs text-muted-foreground">
              Saved shortcode ending in {status.shortcodeLast4}
            </p>
          )}
          <div className="space-y-3">
            <div>
              <Label>M-Pesa environment</Label>
              <Select
                value={form.mpesaEnvironment}
                disabled={isLoading}
                onValueChange={(value: "sandbox" | "production") =>
                  setForm({ ...form, mpesaEnvironment: value })
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sandbox">Sandbox</SelectItem>
                  <SelectItem value="production">Production</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {field("mpesaShortcode", "PayBill shortcode", "Your Daraja Business Shortcode")}
            {field("mpesaConsumerKey", "Consumer key", "Enter to replace the saved key", true)}
            {field(
              "mpesaConsumerSecret",
              "Consumer secret",
              "Enter to replace the saved secret",
              true,
            )}
            {field(
              "mpesaPasskey",
              "Lipa na M-Pesa passkey",
              "Enter to replace the saved passkey",
              true,
            )}
          </div>
        </div>

        <div className="rounded-lg border p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">SMS (Africa&apos;s Talking)</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Your account is charged for its messages.
              </p>
            </div>
            <Badge variant={status?.smsConfigured ? "default" : "secondary"}>
              {isLoading
                ? "Checking"
                : statusError
                  ? "Status unavailable"
                  : status?.smsConfigured
                    ? "Connected"
                    : "Not configured"}
            </Badge>
          </div>
          <div className="space-y-3">
            {field("smsUsername", "Username", "Africa's Talking username")}
            {field("smsApiKey", "API key", "Enter to replace the saved key", true)}
            {field("smsSenderId", "Sender ID (optional)", "Approved sender ID")}
          </div>
        </div>
      </div>

      {status?.emailAddress && (
        <div className="mt-5 rounded-lg border bg-muted/30 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold text-sm">Tenant System Outgoing Email</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Invoices and system notices to customers originate from this address:
              </p>
            </div>
            <Badge variant="outline" className="font-mono text-xs bg-background px-2.5 py-1">
              {status.emailAddress}
            </Badge>
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save credentials"}
        </Button>
        <Button
          variant="outline"
          onClick={() => registerC2b.mutate()}
          disabled={!status?.mpesaConfigured || registerC2b.isPending}
        >
          {registerC2b.isPending ? "Registering callbacks…" : "Register direct-payment callbacks"}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            if (window.confirm("Remove all saved M-Pesa and SMS credentials for this tenant?")) {
              remove.mutate();
            }
          }}
          disabled={remove.isPending}
        >
          {remove.isPending ? "Removing…" : "Remove saved credentials"}
        </Button>
      </div>
      <p className="mt-3 max-w-3xl text-xs text-muted-foreground">
        Register callbacks after entering PayBill and Till details in Receiving details. Incoming
        payments are recorded for staff review and do not renew service until approved. Direct Till
        callback availability depends on Safaricom supporting C2B URL registration for that
        shortcode.
      </p>
    </section>
  );
}
