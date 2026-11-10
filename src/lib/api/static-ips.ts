import type { StaticIpAssignment, StaticIpCustomer } from "@cleennetworks/api-contracts/static-ips";
import { supabase } from "@/integrations/supabase/client";

function apiBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (import.meta.env.DEV) return "http://localhost:8787";
  throw new Error("VITE_API_BASE_URL is required to connect to the backend API.");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session?.access_token)
    throw new Error("Your session has expired. Please sign in again.");

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${data.session.access_token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json()) as T | { error?: string };
  if (!response.ok) {
    const message = "error" in payload && payload.error ? payload.error : response.statusText;
    throw new Error(message || `Backend request failed (${response.status}).`);
  }
  return payload as T;
}

export function listStaticIpCustomers(): Promise<StaticIpCustomer[]> {
  return request("/v1/tenant/static-ips");
}

export function saveStaticIpAssignment(
  customerId: string,
  assignment: StaticIpAssignment,
): Promise<StaticIpCustomer> {
  return request(`/v1/tenant/static-ips/${encodeURIComponent(customerId)}`, {
    method: "PUT",
    body: JSON.stringify(assignment),
  });
}
