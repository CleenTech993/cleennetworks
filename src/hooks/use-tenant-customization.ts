import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { DEFAULT_TENANT_LABELS, sanitizeTenantLabels } from "@/lib/tenant-customization";

export function useTenantLabels() {
  const { tenantId } = useAuth();
  const query = useQuery({
    queryKey: ["tenant-labels", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data: tenant, error } = await supabase
        .from("tenants")
        .select("ui_labels")
        .eq("id", tenantId!)
        .single();
      if (error) {
        console.error("Could not load tenant terminology preferences", error);
        throw error;
      }
      return sanitizeTenantLabels(tenant.ui_labels);
    },
  });
  return {
    labels: query.data ?? DEFAULT_TENANT_LABELS,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
