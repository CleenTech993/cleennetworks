import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole =
  "super_admin" | "tenant_admin" | "technician" | "billing_agent" | "support_staff" | "end_user";

export interface AuthProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  tenant_id: string | null;
}

export interface AuthState {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: AuthProfile | null;
  roles: AppRole[];
  isSuperAdmin: boolean;
  tenantId: string | null;
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    loading: true,
    session: null,
    user: null,
    profile: null,
    roles: [],
    isSuperAdmin: false,
    tenantId: null,
  });

  useEffect(() => {
    let mounted = true;

    async function hydrate(session: Session | null) {
      if (!session) {
        if (mounted)
          setState({
            loading: false,
            session: null,
            user: null,
            profile: null,
            roles: [],
            isSuperAdmin: false,
            tenantId: null,
          });
        return;
      }
      const [{ data: profile }, { data: roleRows }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id,email,full_name,tenant_id")
          .eq("id", session.user.id)
          .maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", session.user.id),
      ]);
      const roles = (roleRows ?? []).map((r) => r.role as AppRole);
      if (!mounted) return;
      setState({
        loading: false,
        session,
        user: session.user,
        profile: (profile as AuthProfile) ?? null,
        roles,
        isSuperAdmin: roles.includes("super_admin"),
        tenantId: (profile as AuthProfile | null)?.tenant_id ?? null,
      });
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      // Defer to avoid deadlock
      setTimeout(() => hydrate(session), 0);
    });
    supabase.auth.getSession().then(({ data }) => hydrate(data.session));

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
