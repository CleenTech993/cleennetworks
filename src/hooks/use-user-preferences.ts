import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  DEFAULT_USER_PREFERENCES,
  sanitizeUserPreferences,
  type UserPreferences,
} from "@/lib/tenant-customization";
import type { Json } from "@/integrations/supabase/types";

export function applyUserPreferences(preferences: UserPreferences) {
  try {
    localStorage.setItem("user-preferences", JSON.stringify(preferences));
    localStorage.setItem("theme", preferences.theme);
  } catch (error) {
    console.error("Could not persist user preferences in browser storage", error);
  }
  document.documentElement.classList.toggle("dark", preferences.theme === "dark");
  window.dispatchEvent(new Event("netgrid:user-preferences-changed"));
}

export function useUserPreferences() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["user-preferences", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("preferences")
        .eq("id", user!.id)
        .single();
      if (error) {
        console.error("Could not load personal preferences", error);
        throw error;
      }
      return sanitizeUserPreferences(profile.preferences);
    },
  });
  const mutation = useMutation({
    mutationFn: async (preferences: UserPreferences) => {
      if (!user) throw new Error("Sign in to save preferences.");
      const savedPreferences: Json = {
        theme: preferences.theme,
        dateFormat: preferences.dateFormat,
        timeZone: preferences.timeZone,
        dashboardLayout: preferences.dashboardLayout,
      };
      const { error } = await supabase
        .from("profiles")
        .update({ preferences: savedPreferences })
        .eq("id", user.id);
      if (error) throw error;
      return preferences;
    },
    onSuccess: (preferences) => {
      applyUserPreferences(preferences);
      queryClient.setQueryData(["user-preferences", user?.id], preferences);
    },
  });

  useEffect(() => {
    if (query.data) applyUserPreferences(query.data);
  }, [query.data]);

  return {
    preferences: query.data ?? DEFAULT_USER_PREFERENCES,
    isLoading: query.isLoading,
    savePreferences: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}
