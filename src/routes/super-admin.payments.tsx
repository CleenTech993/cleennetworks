import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/super-admin/payments")({ component: PlatformPayments });

function PlatformPayments() {
  const queryClient = useQueryClient();
  const [shortcode, setShortcode] = useState("");
  const { data: config, isLoading } = useQuery({
    queryKey: ["platform-c2b"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_mpesa_config")
        .select("shortcode")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => setShortcode(config?.shortcode ?? ""), [config]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("platform_mpesa_config")
        .update({ shortcode: shortcode.trim() || null, updated_at: new Date().toISOString() })
        .eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Platform C2B receiving shortcode saved.");
      queryClient.invalidateQueries({ queryKey: ["platform-c2b"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div>
      <PageHeader
        title="Platform C2B"
        description="New customer purchases use each tenant's own Daraja account. The platform only receives commission payments initiated by tenants."
      />
      <section className="max-w-2xl rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Commission receiving shortcode</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Tenants pay their commission due to this platform PayBill/Till through a separate M-Pesa
          C2B transaction. The platform does not initiate a deduction from tenant earnings here.
        </p>
        <div className="mt-4 max-w-sm">
          <Label htmlFor="platform-shortcode">Platform PayBill or Till</Label>
          <Input
            id="platform-shortcode"
            value={shortcode}
            onChange={(event) => setShortcode(event.target.value)}
            placeholder={isLoading ? "Loading…" : "Enter platform shortcode"}
            className="mt-1"
          />
        </div>
        <Button className="mt-4" onClick={() => save.mutate()} disabled={save.isPending}>
          Save shortcode
        </Button>
      </section>
    </div>
  );
}
