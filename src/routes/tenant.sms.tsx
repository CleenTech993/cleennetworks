import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-shell";
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
  removeTenantServiceCredentials,
  saveTenantServiceCredentials,
} from "@/lib/tenant-service.functions";

export const Route = createFileRoute("/tenant/sms")({ component: ServiceSettings });

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

function ServiceSettings() {
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
    <div>
      <PageHeader
        title="Notifications & Payments"
        description="Connect your own M-Pesa and SMS accounts. Credentials are encrypted and never returned to the browser."
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">M-Pesa Daraja</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                New portal purchases go directly to your PayBill account through your Daraja app.
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
        </section>

        <section className="rounded-xl border bg-card p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">SMS (Africa&apos;s Talking)</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Use your account to send tenant alerts. Your account is charged for its messages.
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
        </section>

        <section className="rounded-xl border bg-card p-5 lg:col-span-2">
          <h2 className="font-semibold">Business email</h2>
          {status?.emailAddress ? (
            <p className="mt-2 text-sm">
              Tenant address: <span className="font-mono">{status.emailAddress}</span>
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              A system email domain has not been configured yet. The platform owner must set{" "}
              <code>TENANT_EMAIL_DOMAIN</code> and configure SMTP/domain routing before tenant
              addresses can be issued.
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Email delivery is platform-managed; tenants do not enter SMTP credentials. An address
            alias requires the platform email provider to accept and route mail for the configured
            domain.
          </p>
        </section>
      </div>

      <Button className="mt-5" onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save credentials"}
      </Button>
      <Button
        className="ml-2 mt-5"
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
  );
}
