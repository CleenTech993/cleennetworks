export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      captive_portals: {
        Row: {
          background_url: string | null
          enable_otp: boolean | null
          enable_voucher: boolean | null
          id: string
          logo_url: string | null
          primary_color: string | null
          tenant_id: string
          terms_text: string | null
          updated_at: string
          welcome_text: string | null
        }
        Insert: {
          background_url?: string | null
          enable_otp?: boolean | null
          enable_voucher?: boolean | null
          id?: string
          logo_url?: string | null
          primary_color?: string | null
          tenant_id: string
          terms_text?: string | null
          updated_at?: string
          welcome_text?: string | null
        }
        Update: {
          background_url?: string | null
          enable_otp?: boolean | null
          enable_voucher?: boolean | null
          id?: string
          logo_url?: string | null
          primary_color?: string | null
          tenant_id?: string
          terms_text?: string | null
          updated_at?: string
          welcome_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "captive_portals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          customer_type: string
          email: string | null
          expires_at: string | null
          full_name: string | null
          id: string
          package_id: string | null
          phone: string | null
          pppoe_password: string | null
          pppoe_username: string | null
          router_id: string | null
          static_ip: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          customer_type?: string
          email?: string | null
          expires_at?: string | null
          full_name?: string | null
          id?: string
          package_id?: string | null
          phone?: string | null
          pppoe_password?: string | null
          pppoe_username?: string | null
          router_id?: string | null
          static_ip?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          customer_type?: string
          email?: string | null
          expires_at?: string | null
          full_name?: string | null
          id?: string
          package_id?: string | null
          phone?: string | null
          pppoe_password?: string | null
          pppoe_username?: string | null
          router_id?: string | null
          static_ip?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_router_id_fkey"
            columns: ["router_id"]
            isOneToOne: false
            referencedRelation: "routers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      packages: {
        Row: {
          active: boolean | null
          burst_kbps: number | null
          created_at: string
          data_limit_mb: number | null
          description: string | null
          device_limit: number | null
          download_kbps: number | null
          duration_unit: string | null
          duration_value: number | null
          id: string
          idle_timeout_sec: number | null
          kind: string
          mac_binding: boolean | null
          name: string
          price: number
          session_timeout_sec: number | null
          simultaneous_logins: number | null
          tenant_id: string
          unlimited: boolean | null
          upload_kbps: number | null
        }
        Insert: {
          active?: boolean | null
          burst_kbps?: number | null
          created_at?: string
          data_limit_mb?: number | null
          description?: string | null
          device_limit?: number | null
          download_kbps?: number | null
          duration_unit?: string | null
          duration_value?: number | null
          id?: string
          idle_timeout_sec?: number | null
          kind?: string
          mac_binding?: boolean | null
          name: string
          price?: number
          session_timeout_sec?: number | null
          simultaneous_logins?: number | null
          tenant_id: string
          unlimited?: boolean | null
          upload_kbps?: number | null
        }
        Update: {
          active?: boolean | null
          burst_kbps?: number | null
          created_at?: string
          data_limit_mb?: number | null
          description?: string | null
          device_limit?: number | null
          download_kbps?: number | null
          duration_unit?: string | null
          duration_value?: number | null
          id?: string
          idle_timeout_sec?: number | null
          kind?: string
          mac_binding?: boolean | null
          name?: string
          price?: number
          session_timeout_sec?: number | null
          simultaneous_logins?: number | null
          tenant_id?: string
          unlimited?: boolean | null
          upload_kbps?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "packages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          checkout_request_id: string | null
          created_at: string
          customer_id: string | null
          id: string
          merchant_request_id: string | null
          mpesa_receipt: string | null
          package_id: string | null
          phone: string | null
          raw_callback: Json | null
          status: string
          tenant_id: string
          voucher_code: string | null
        }
        Insert: {
          amount: number
          checkout_request_id?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          merchant_request_id?: string | null
          mpesa_receipt?: string | null
          package_id?: string | null
          phone?: string | null
          raw_callback?: Json | null
          status?: string
          tenant_id: string
          voucher_code?: string | null
        }
        Update: {
          amount?: number
          checkout_request_id?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          merchant_request_id?: string | null
          mpesa_receipt?: string | null
          package_id?: string | null
          phone?: string | null
          raw_callback?: Json | null
          status?: string
          tenant_id?: string
          voucher_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      routers: {
        Row: {
          cpu_usage: number | null
          created_at: string
          id: string
          last_seen_at: string | null
          mac_address: string | null
          model: string | null
          name: string
          provision_token: string | null
          provision_token_expires_at: string | null
          public_ip: string | null
          ram_usage: number | null
          routeros_version: string | null
          serial: string | null
          status: string
          tenant_id: string
          uptime_seconds: number | null
        }
        Insert: {
          cpu_usage?: number | null
          created_at?: string
          id?: string
          last_seen_at?: string | null
          mac_address?: string | null
          model?: string | null
          name: string
          provision_token?: string | null
          provision_token_expires_at?: string | null
          public_ip?: string | null
          ram_usage?: number | null
          routeros_version?: string | null
          serial?: string | null
          status?: string
          tenant_id: string
          uptime_seconds?: number | null
        }
        Update: {
          cpu_usage?: number | null
          created_at?: string
          id?: string
          last_seen_at?: string | null
          mac_address?: string | null
          model?: string | null
          name?: string
          provision_token?: string | null
          provision_token_expires_at?: string | null
          public_ip?: string | null
          ram_usage?: number | null
          routeros_version?: string | null
          serial?: string | null
          status?: string
          tenant_id?: string
          uptime_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "routers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          bytes_in: number | null
          bytes_out: number | null
          customer_id: string | null
          ended_at: string | null
          id: string
          ip_address: string | null
          mac_address: string | null
          router_id: string | null
          started_at: string
          status: string
          tenant_id: string
        }
        Insert: {
          bytes_in?: number | null
          bytes_out?: number | null
          customer_id?: string | null
          ended_at?: string | null
          id?: string
          ip_address?: string | null
          mac_address?: string | null
          router_id?: string | null
          started_at?: string
          status?: string
          tenant_id: string
        }
        Update: {
          bytes_in?: number | null
          bytes_out?: number | null
          customer_id?: string | null
          ended_at?: string | null
          id?: string
          ip_address?: string | null
          mac_address?: string | null
          router_id?: string | null
          started_at?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_router_id_fkey"
            columns: ["router_id"]
            isOneToOne: false
            referencedRelation: "routers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          body: string | null
          created_at: string
          customer_id: string | null
          id: string
          status: string
          subject: string
          tenant_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          status?: string
          subject: string
          tenant_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          status?: string
          subject?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          logo_url: string | null
          mpesa_consumer_key: string | null
          mpesa_consumer_secret: string | null
          mpesa_env: string
          mpesa_passkey: string | null
          mpesa_paybill: string | null
          mpesa_shortcode: string | null
          mpesa_till: string | null
          name: string
          primary_color: string | null
          slug: string
          status: string
          subdomain: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo_url?: string | null
          mpesa_consumer_key?: string | null
          mpesa_consumer_secret?: string | null
          mpesa_env?: string
          mpesa_passkey?: string | null
          mpesa_paybill?: string | null
          mpesa_shortcode?: string | null
          mpesa_till?: string | null
          name: string
          primary_color?: string | null
          slug: string
          status?: string
          subdomain?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          logo_url?: string | null
          mpesa_consumer_key?: string | null
          mpesa_consumer_secret?: string | null
          mpesa_env?: string
          mpesa_passkey?: string | null
          mpesa_paybill?: string | null
          mpesa_shortcode?: string | null
          mpesa_till?: string | null
          name?: string
          primary_color?: string | null
          slug?: string
          status?: string
          subdomain?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      vouchers: {
        Row: {
          code: string
          created_at: string
          expires_at: string | null
          id: string
          package_id: string | null
          payment_id: string | null
          status: string
          tenant_id: string
          used_at: string | null
          used_by_mac: string | null
        }
        Insert: {
          code: string
          created_at?: string
          expires_at?: string | null
          id?: string
          package_id?: string | null
          payment_id?: string | null
          status?: string
          tenant_id: string
          used_at?: string | null
          used_by_mac?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          package_id?: string | null
          payment_id?: string | null
          status?: string
          tenant_id?: string
          used_at?: string | null
          used_by_mac?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_approve_user: {
        Args: {
          p_new_tenant_name?: string
          p_new_tenant_slug?: string
          p_role: Database["public"]["Enums"]["app_role"]
          p_tenant_id?: string
          p_user_id: string
        }
        Returns: string
      }
      bootstrap_tenant: {
        Args: { p_full_name?: string; p_name: string; p_slug: string }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      user_tenant_id: { Args: { _user_id: string }; Returns: string }
    }
    Enums: {
      app_role:
        | "super_admin"
        | "tenant_admin"
        | "technician"
        | "billing_agent"
        | "support_staff"
        | "end_user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "super_admin",
        "tenant_admin",
        "technician",
        "billing_agent",
        "support_staff",
        "end_user",
      ],
    },
  },
} as const
