export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      alert_settings: {
        Row: {
          down_after_minutes: number;
          notify_device_down: boolean;
          notify_low_stock: boolean;
          sms_numbers: string[];
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          down_after_minutes?: number;
          notify_device_down?: boolean;
          notify_low_stock?: boolean;
          sms_numbers?: string[];
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          down_after_minutes?: number;
          notify_device_down?: boolean;
          notify_low_stock?: boolean;
          sms_numbers?: string[];
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "alert_settings_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: true;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: {
        Row: {
          action: string;
          actor_email: string | null;
          actor_id: string | null;
          actor_role: string | null;
          created_at: string;
          description: string;
          id: string;
          metadata: Json | null;
          resource_id: string | null;
          resource_type: string;
          tenant_id: string | null;
        };
        Insert: {
          action: string;
          actor_email?: string | null;
          actor_id?: string | null;
          actor_role?: string | null;
          created_at?: string;
          description: string;
          id?: string;
          metadata?: Json | null;
          resource_id?: string | null;
          resource_type: string;
          tenant_id?: string | null;
        };
        Update: {
          action?: string;
          actor_email?: string | null;
          actor_id?: string | null;
          actor_role?: string | null;
          created_at?: string;
          description?: string;
          id?: string;
          metadata?: Json | null;
          resource_id?: string | null;
          resource_type?: string;
          tenant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      auth_login_attempts: {
        Row: {
          attempted_at: string;
          email_hash: string;
          id: number;
          ip_hash: string;
          succeeded: boolean;
        };
        Insert: {
          attempted_at?: string;
          email_hash: string;
          id?: number;
          ip_hash: string;
          succeeded: boolean;
        };
        Update: {
          attempted_at?: string;
          email_hash?: string;
          id?: number;
          ip_hash?: string;
          succeeded?: boolean;
        };
        Relationships: [];
      };
      captive_portals: {
        Row: {
          background_url: string | null;
          enable_otp: boolean | null;
          enable_voucher: boolean | null;
          id: string;
          logo_url: string | null;
          post_login_url: string | null;
          primary_color: string | null;
          tenant_id: string;
          terms_text: string | null;
          theme: string;
          updated_at: string;
          welcome_text: string | null;
        };
        Insert: {
          background_url?: string | null;
          enable_otp?: boolean | null;
          enable_voucher?: boolean | null;
          id?: string;
          logo_url?: string | null;
          post_login_url?: string | null;
          primary_color?: string | null;
          tenant_id: string;
          terms_text?: string | null;
          theme?: string;
          updated_at?: string;
          welcome_text?: string | null;
        };
        Update: {
          background_url?: string | null;
          enable_otp?: boolean | null;
          enable_voucher?: boolean | null;
          id?: string;
          logo_url?: string | null;
          post_login_url?: string | null;
          primary_color?: string | null;
          tenant_id?: string;
          terms_text?: string | null;
          theme?: string;
          updated_at?: string;
          welcome_text?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "captive_portals_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: true;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      customers: {
        Row: {
          created_at: string;
          customer_type: string;
          data_used_bytes: number;
          email: string | null;
          expires_at: string | null;
          full_name: string | null;
          id: string;
          last_ip: string | null;
          last_mac: string | null;
          last_router_id: string | null;
          last_seen_at: string | null;
          package_id: string | null;
          phone: string | null;
          pppoe_password: string | null;
          pppoe_username: string | null;
          router_id: string | null;
          static_ip: string | null;
          status: string;
          tenant_id: string;
          usage_bytes_in: number;
          usage_bytes_out: number;
          usage_session_id: string | null;
        };
        Insert: {
          created_at?: string;
          customer_type?: string;
          data_used_bytes?: number;
          email?: string | null;
          expires_at?: string | null;
          full_name?: string | null;
          id?: string;
          last_ip?: string | null;
          last_mac?: string | null;
          last_router_id?: string | null;
          last_seen_at?: string | null;
          package_id?: string | null;
          phone?: string | null;
          pppoe_password?: string | null;
          pppoe_username?: string | null;
          router_id?: string | null;
          static_ip?: string | null;
          status?: string;
          tenant_id: string;
          usage_bytes_in?: number;
          usage_bytes_out?: number;
          usage_session_id?: string | null;
        };
        Update: {
          created_at?: string;
          customer_type?: string;
          data_used_bytes?: number;
          email?: string | null;
          expires_at?: string | null;
          full_name?: string | null;
          id?: string;
          last_ip?: string | null;
          last_mac?: string | null;
          last_router_id?: string | null;
          last_seen_at?: string | null;
          package_id?: string | null;
          phone?: string | null;
          pppoe_password?: string | null;
          pppoe_username?: string | null;
          router_id?: string | null;
          static_ip?: string | null;
          status?: string;
          tenant_id?: string;
          usage_bytes_in?: number;
          usage_bytes_out?: number;
          usage_session_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "customers_last_router_id_fkey";
            columns: ["last_router_id"];
            isOneToOne: false;
            referencedRelation: "routers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customers_package_id_fkey";
            columns: ["package_id"];
            isOneToOne: false;
            referencedRelation: "packages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customers_router_id_fkey";
            columns: ["router_id"];
            isOneToOne: false;
            referencedRelation: "routers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customers_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_announcements: {
        Row: {
          active: boolean;
          body: string;
          created_at: string;
          created_by: string | null;
          customer_id: string | null;
          ends_at: string | null;
          id: string;
          starts_at: string;
          tenant_id: string | null;
          title: string;
        };
        Insert: {
          active?: boolean;
          body: string;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          ends_at?: string | null;
          id?: string;
          starts_at?: string;
          tenant_id?: string | null;
          title: string;
        };
        Update: {
          active?: boolean;
          body?: string;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          ends_at?: string | null;
          id?: string;
          starts_at?: string;
          tenant_id?: string | null;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_announcements_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_announcements_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_announcement_reads: {
        Row: {
          announcement_id: string;
          customer_id: string;
          read_at: string;
        };
        Insert: {
          announcement_id: string;
          customer_id: string;
          read_at?: string;
        };
        Update: {
          announcement_id?: string;
          customer_id?: string;
          read_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_announcement_reads_announcement_id_fkey";
            columns: ["announcement_id"];
            isOneToOne: false;
            referencedRelation: "customer_announcements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_announcement_reads_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      direct_mpesa_transactions: {
        Row: {
          amount: number;
          bill_ref_number: string | null;
          created_at: string;
          customer_id: string | null;
          first_name: string | null;
          id: string;
          last_name: string | null;
          middle_name: string | null;
          payment_id: string | null;
          phone: string | null;
          raw_payload: Json;
          reviewed_at: string | null;
          reviewed_by: string | null;
          shortcode: string;
          status: string;
          suggested_customer_id: string | null;
          tenant_id: string;
          transaction_id: string;
          transaction_time: string;
        };
        Insert: {
          amount: number;
          bill_ref_number?: string | null;
          created_at?: string;
          customer_id?: string | null;
          first_name?: string | null;
          id?: string;
          last_name?: string | null;
          middle_name?: string | null;
          payment_id?: string | null;
          phone?: string | null;
          raw_payload: Json;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          shortcode: string;
          status?: string;
          suggested_customer_id?: string | null;
          tenant_id: string;
          transaction_id: string;
          transaction_time: string;
        };
        Update: {
          amount?: number;
          bill_ref_number?: string | null;
          created_at?: string;
          customer_id?: string | null;
          first_name?: string | null;
          id?: string;
          last_name?: string | null;
          middle_name?: string | null;
          payment_id?: string | null;
          phone?: string | null;
          raw_payload?: Json;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          shortcode?: string;
          status?: string;
          suggested_customer_id?: string | null;
          tenant_id?: string;
          transaction_id?: string;
          transaction_time?: string;
        };
        Relationships: [
          {
            foreignKeyName: "direct_mpesa_transactions_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "direct_mpesa_transactions_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "direct_mpesa_transactions_suggested_customer_id_fkey";
            columns: ["suggested_customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "direct_mpesa_transactions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_alerts: {
        Row: {
          created_at: string;
          device_id: string | null;
          id: number;
          item_id: string | null;
          kind: string;
          message: string;
          sms_error: string | null;
          sms_sent_at: string | null;
          sms_status: string;
          tenant_id: string;
        };
        Insert: {
          created_at?: string;
          device_id?: string | null;
          id?: never;
          item_id?: string | null;
          kind: string;
          message: string;
          sms_error?: string | null;
          sms_sent_at?: string | null;
          sms_status?: string;
          tenant_id: string;
        };
        Update: {
          created_at?: string;
          device_id?: string | null;
          id?: never;
          item_id?: string | null;
          kind?: string;
          message?: string;
          sms_error?: string | null;
          sms_sent_at?: string | null;
          sms_status?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_alerts_device_id_fkey";
            columns: ["device_id"];
            isOneToOne: false;
            referencedRelation: "inventory_devices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_alerts_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_alerts_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_device_events: {
        Row: {
          at: string;
          device_id: string;
          event: string;
          id: number;
          tenant_id: string;
        };
        Insert: {
          at?: string;
          device_id: string;
          event: string;
          id?: never;
          tenant_id: string;
        };
        Update: {
          at?: string;
          device_id?: string;
          event?: string;
          id?: never;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_device_events_device_id_fkey";
            columns: ["device_id"];
            isOneToOne: false;
            referencedRelation: "inventory_devices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_device_events_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_devices: {
        Row: {
          alerted_at: string | null;
          brand: string | null;
          category: string;
          created_at: string;
          customer_id: string | null;
          id: string;
          ip_address: string | null;
          item_id: string | null;
          last_checked_at: string | null;
          last_seen_at: string | null;
          latency_ms: number | null;
          location: string | null;
          loss_pct: number | null;
          mac_address: string | null;
          model: string | null;
          monitor_enabled: boolean;
          monitor_router_id: string | null;
          name: string;
          notes: string | null;
          online: boolean | null;
          serial_number: string | null;
          status: string;
          status_changed_at: string | null;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          alerted_at?: string | null;
          brand?: string | null;
          category: string;
          created_at?: string;
          customer_id?: string | null;
          id?: string;
          ip_address?: string | null;
          item_id?: string | null;
          last_checked_at?: string | null;
          last_seen_at?: string | null;
          latency_ms?: number | null;
          location?: string | null;
          loss_pct?: number | null;
          mac_address?: string | null;
          model?: string | null;
          monitor_enabled?: boolean;
          monitor_router_id?: string | null;
          name: string;
          notes?: string | null;
          online?: boolean | null;
          serial_number?: string | null;
          status?: string;
          status_changed_at?: string | null;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          alerted_at?: string | null;
          brand?: string | null;
          category?: string;
          created_at?: string;
          customer_id?: string | null;
          id?: string;
          ip_address?: string | null;
          item_id?: string | null;
          last_checked_at?: string | null;
          last_seen_at?: string | null;
          latency_ms?: number | null;
          location?: string | null;
          loss_pct?: number | null;
          mac_address?: string | null;
          model?: string | null;
          monitor_enabled?: boolean;
          monitor_router_id?: string | null;
          name?: string;
          notes?: string | null;
          online?: boolean | null;
          serial_number?: string | null;
          status?: string;
          status_changed_at?: string | null;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_devices_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_devices_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_devices_monitor_router_id_fkey";
            columns: ["monitor_router_id"];
            isOneToOne: false;
            referencedRelation: "routers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_devices_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_items: {
        Row: {
          brand: string | null;
          category: string;
          created_at: string;
          id: string;
          model: string | null;
          name: string;
          notes: string | null;
          quantity: number;
          reorder_level: number;
          tenant_id: string;
          unit: string;
          unit_cost: number | null;
          updated_at: string;
        };
        Insert: {
          brand?: string | null;
          category: string;
          created_at?: string;
          id?: string;
          model?: string | null;
          name: string;
          notes?: string | null;
          quantity?: number;
          reorder_level?: number;
          tenant_id: string;
          unit?: string;
          unit_cost?: number | null;
          updated_at?: string;
        };
        Update: {
          brand?: string | null;
          category?: string;
          created_at?: string;
          id?: string;
          model?: string | null;
          name?: string;
          notes?: string | null;
          quantity?: number;
          reorder_level?: number;
          tenant_id?: string;
          unit?: string;
          unit_cost?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_items_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      packages: {
        Row: {
          active: boolean | null;
          burst_kbps: number | null;
          created_at: string;
          data_limit_mb: number | null;
          description: string | null;
          device_limit: number | null;
          download_kbps: number | null;
          duration_unit: string | null;
          duration_value: number | null;
          fup_download_kbps: number;
          fup_upload_kbps: number;
          id: string;
          idle_timeout_sec: number | null;
          kind: string;
          mac_binding: boolean | null;
          name: string;
          price: number;
          session_timeout_sec: number | null;
          simultaneous_logins: number | null;
          tenant_id: string;
          unlimited: boolean | null;
          upload_kbps: number | null;
        };
        Insert: {
          active?: boolean | null;
          burst_kbps?: number | null;
          created_at?: string;
          data_limit_mb?: number | null;
          description?: string | null;
          device_limit?: number | null;
          download_kbps?: number | null;
          duration_unit?: string | null;
          duration_value?: number | null;
          fup_download_kbps?: number;
          fup_upload_kbps?: number;
          id?: string;
          idle_timeout_sec?: number | null;
          kind?: string;
          mac_binding?: boolean | null;
          name: string;
          price?: number;
          session_timeout_sec?: number | null;
          simultaneous_logins?: number | null;
          tenant_id: string;
          unlimited?: boolean | null;
          upload_kbps?: number | null;
        };
        Update: {
          active?: boolean | null;
          burst_kbps?: number | null;
          created_at?: string;
          data_limit_mb?: number | null;
          description?: string | null;
          device_limit?: number | null;
          download_kbps?: number | null;
          duration_unit?: string | null;
          duration_value?: number | null;
          fup_download_kbps?: number;
          fup_upload_kbps?: number;
          id?: string;
          idle_timeout_sec?: number | null;
          kind?: string;
          mac_binding?: boolean | null;
          name?: string;
          price?: number;
          session_timeout_sec?: number | null;
          simultaneous_logins?: number | null;
          tenant_id?: string;
          unlimited?: boolean | null;
          upload_kbps?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "packages_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          amount: number;
          checkout_request_id: string | null;
          created_at: string;
          customer_id: string | null;
          expires_at: string | null;
          id: string;
          merchant_request_id: string | null;
          mpesa_receipt: string | null;
          package_id: string | null;
          phone: string | null;
          provider: string;
          raw_callback: Json | null;
          status: string;
          tenant_id: string;
          tv_device_id: string | null;
          voucher_code: string | null;
        };
        Insert: {
          amount: number;
          checkout_request_id?: string | null;
          created_at?: string;
          customer_id?: string | null;
          expires_at?: string | null;
          id?: string;
          merchant_request_id?: string | null;
          mpesa_receipt?: string | null;
          package_id?: string | null;
          phone?: string | null;
          provider?: string;
          raw_callback?: Json | null;
          status?: string;
          tenant_id: string;
          tv_device_id?: string | null;
          voucher_code?: string | null;
        };
        Update: {
          amount?: number;
          checkout_request_id?: string | null;
          created_at?: string;
          customer_id?: string | null;
          expires_at?: string | null;
          id?: string;
          merchant_request_id?: string | null;
          mpesa_receipt?: string | null;
          package_id?: string | null;
          phone?: string | null;
          provider?: string;
          raw_callback?: Json | null;
          status?: string;
          tenant_id?: string;
          tv_device_id?: string | null;
          voucher_code?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "payments_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_package_id_fkey";
            columns: ["package_id"];
            isOneToOne: false;
            referencedRelation: "packages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_tv_device_id_fkey";
            columns: ["tv_device_id"];
            isOneToOne: false;
            referencedRelation: "tv_devices";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_billing_config: {
        Row: {
          commission_tracking_starts_at: string;
          id: number;
        };
        Insert: {
          commission_tracking_starts_at?: string;
          id?: number;
        };
        Update: {
          commission_tracking_starts_at?: string;
          id?: number;
        };
        Relationships: [];
      };
      platform_commissions: {
        Row: {
          collected_at: string | null;
          commission_amount: number;
          commission_rate_pct: number | null;
          created_at: string;
          due_at: string | null;
          email_attempted_at: string | null;
          email_error: string | null;
          email_sent_at: string | null;
          email_status: string;
          gross_amount: number;
          hotspot_commission_amount: number | null;
          hotspot_commission_rate_pct: number | null;
          hotspot_gross_amount: number | null;
          id: string;
          invoice_number: string | null;
          issued_at: string | null;
          mpesa_receipt: string | null;
          payment_reference: string | null;
          period_end: string;
          period_start: string;
          pppoe_commission_amount: number | null;
          pppoe_commission_rate_pct: number | null;
          pppoe_gross_amount: number | null;
          status: string;
          tenant_id: string;
          tenant_mpesa_receipt: string | null;
        };
        Insert: {
          collected_at?: string | null;
          commission_amount?: number;
          commission_rate_pct?: number | null;
          created_at?: string;
          due_at?: string | null;
          email_attempted_at?: string | null;
          email_error?: string | null;
          email_sent_at?: string | null;
          email_status?: string;
          gross_amount?: number;
          hotspot_commission_amount?: number | null;
          hotspot_commission_rate_pct?: number | null;
          hotspot_gross_amount?: number | null;
          id?: string;
          invoice_number?: string | null;
          issued_at?: string | null;
          mpesa_receipt?: string | null;
          payment_reference?: string | null;
          period_end: string;
          period_start: string;
          pppoe_commission_amount?: number | null;
          pppoe_commission_rate_pct?: number | null;
          pppoe_gross_amount?: number | null;
          status?: string;
          tenant_id: string;
          tenant_mpesa_receipt?: string | null;
        };
        Update: {
          collected_at?: string | null;
          commission_amount?: number;
          commission_rate_pct?: number | null;
          created_at?: string;
          due_at?: string | null;
          email_attempted_at?: string | null;
          email_error?: string | null;
          email_sent_at?: string | null;
          email_status?: string;
          gross_amount?: number;
          hotspot_commission_amount?: number | null;
          hotspot_commission_rate_pct?: number | null;
          hotspot_gross_amount?: number | null;
          id?: string;
          invoice_number?: string | null;
          issued_at?: string | null;
          mpesa_receipt?: string | null;
          payment_reference?: string | null;
          period_end?: string;
          period_start?: string;
          pppoe_commission_amount?: number | null;
          pppoe_commission_rate_pct?: number | null;
          pppoe_gross_amount?: number | null;
          status?: string;
          tenant_id?: string;
          tenant_mpesa_receipt?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "platform_commissions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_mpesa_config: {
        Row: {
          callback_base_url: string | null;
          c2b_callback_token: string | null;
          c2b_registered_at: string | null;
          confirmation_url: string | null;
          consumer_key: string | null;
          consumer_secret: string | null;
          id: number;
          mpesa_env: string;
          passkey: string | null;
          shortcode: string | null;
          updated_at: string;
          validation_url: string | null;
        };
        Insert: {
          callback_base_url?: string | null;
          c2b_callback_token?: string | null;
          c2b_registered_at?: string | null;
          confirmation_url?: string | null;
          consumer_key?: string | null;
          consumer_secret?: string | null;
          id?: number;
          mpesa_env?: string;
          passkey?: string | null;
          shortcode?: string | null;
          updated_at?: string;
          validation_url?: string | null;
        };
        Update: {
          callback_base_url?: string | null;
          c2b_callback_token?: string | null;
          c2b_registered_at?: string | null;
          confirmation_url?: string | null;
          consumer_key?: string | null;
          consumer_secret?: string | null;
          id?: number;
          mpesa_env?: string;
          passkey?: string | null;
          shortcode?: string | null;
          updated_at?: string;
          validation_url?: string | null;
        };
        Relationships: [];
      };
      platform_mpesa_transactions: {
        Row: {
          amount: number;
          bill_ref_number: string | null;
          commission_id: string | null;
          created_at: string;
          first_name: string | null;
          id: string;
          last_name: string | null;
          middle_name: string | null;
          payment_method: string;
          shortcode: string;
          status: string;
          transaction_id: string;
          transaction_time: string;
        };
        Insert: {
          amount: number;
          bill_ref_number?: string | null;
          commission_id?: string | null;
          created_at?: string;
          first_name?: string | null;
          id?: string;
          last_name?: string | null;
          middle_name?: string | null;
          payment_method?: string;
          shortcode: string;
          status?: string;
          transaction_id: string;
          transaction_time: string;
        };
        Update: {
          amount?: number;
          bill_ref_number?: string | null;
          commission_id?: string | null;
          created_at?: string;
          first_name?: string | null;
          id?: string;
          last_name?: string | null;
          middle_name?: string | null;
          payment_method?: string;
          shortcode?: string;
          status?: string;
          transaction_id?: string;
          transaction_time?: string;
        };
        Relationships: [
          {
            foreignKeyName: "platform_mpesa_transactions_commission_id_fkey";
            columns: ["commission_id"];
            isOneToOne: false;
            referencedRelation: "platform_commissions";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_stk_payments: {
        Row: {
          amount: number;
          checkout_request_id: string | null;
          created_at: string;
          id: string;
          invoice_id: string;
          merchant_request_id: string | null;
          phone: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          amount: number;
          checkout_request_id?: string | null;
          created_at?: string;
          id?: string;
          invoice_id: string;
          merchant_request_id?: string | null;
          phone: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          checkout_request_id?: string | null;
          created_at?: string;
          id?: string;
          invoice_id?: string;
          merchant_request_id?: string | null;
          phone?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "platform_stk_payments_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "platform_commissions";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_service_secrets: {
        Row: {
          ciphertext: string;
          last4: string | null;
          name: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          ciphertext: string;
          last4?: string | null;
          name: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          ciphertext?: string;
          last4?: string | null;
          name?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          email: string | null;
          first_name: string | null;
          full_name: string | null;
          id: string;
          last_name: string | null;
          phone: string | null;
          tenant_id: string | null;
        };
        Insert: {
          created_at?: string;
          email?: string | null;
          first_name?: string | null;
          full_name?: string | null;
          id: string;
          last_name?: string | null;
          phone?: string | null;
          tenant_id?: string | null;
        };
        Update: {
          created_at?: string;
          email?: string | null;
          first_name?: string | null;
          full_name?: string | null;
          id?: string;
          last_name?: string | null;
          phone?: string | null;
          tenant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      router_credentials: {
        Row: {
          created_at: string;
          router_id: string;
          token_hash: string;
        };
        Insert: {
          created_at?: string;
          router_id: string;
          token_hash: string;
        };
        Update: {
          created_at?: string;
          router_id?: string;
          token_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "router_credentials_router_id_fkey";
            columns: ["router_id"];
            isOneToOne: true;
            referencedRelation: "routers";
            referencedColumns: ["id"];
          },
        ];
      };
      router_devices: {
        Row: {
          authorized: boolean;
          blocked: boolean;
          first_seen_at: string;
          hostname: string | null;
          id: string;
          ip: string | null;
          last_seen_at: string;
          mac: string;
          registered_kind: string | null;
          router_id: string;
          tenant_id: string;
          tether_suspected: boolean;
          voucher_code: string | null;
        };
        Insert: {
          authorized?: boolean;
          blocked?: boolean;
          first_seen_at?: string;
          hostname?: string | null;
          id?: string;
          ip?: string | null;
          last_seen_at?: string;
          mac: string;
          registered_kind?: string | null;
          router_id: string;
          tenant_id: string;
          tether_suspected?: boolean;
          voucher_code?: string | null;
        };
        Update: {
          authorized?: boolean;
          blocked?: boolean;
          first_seen_at?: string;
          hostname?: string | null;
          id?: string;
          ip?: string | null;
          last_seen_at?: string;
          mac?: string;
          registered_kind?: string | null;
          router_id?: string;
          tenant_id?: string;
          tether_suspected?: boolean;
          voucher_code?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "router_devices_router_id_fkey";
            columns: ["router_id"];
            isOneToOne: false;
            referencedRelation: "routers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "router_devices_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      router_hotspot_sessions: {
        Row: {
          created_at: string;
          duration_seconds: number | null;
          ended_at: string | null;
          hostname: string | null;
          id: string;
          last_seen_at: string;
          mac: string;
          router_id: string;
          session_uptime_seconds: number;
          started_at: string;
          tenant_id: string;
          voucher_code: string;
        };
        Insert: {
          created_at?: string;
          duration_seconds?: number | null;
          ended_at?: string | null;
          hostname?: string | null;
          id?: string;
          last_seen_at: string;
          mac: string;
          router_id: string;
          session_uptime_seconds: number;
          started_at: string;
          tenant_id: string;
          voucher_code: string;
        };
        Update: {
          created_at?: string;
          duration_seconds?: number | null;
          ended_at?: string | null;
          hostname?: string | null;
          id?: string;
          last_seen_at?: string;
          mac?: string;
          router_id?: string;
          session_uptime_seconds?: number;
          started_at?: string;
          tenant_id?: string;
          voucher_code?: string;
        };
        Relationships: [
          {
            foreignKeyName: "router_hotspot_sessions_router_id_fkey";
            columns: ["router_id"];
            isOneToOne: false;
            referencedRelation: "routers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "router_hotspot_sessions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      router_interfaces: {
        Row: {
          disabled: boolean;
          id: string;
          name: string;
          router_id: string;
          running: boolean;
          rx_bps: number;
          rx_bytes: number;
          rx_drops: number;
          rx_errors: number;
          tenant_id: string;
          tx_bps: number;
          tx_bytes: number;
          tx_drops: number;
          tx_errors: number;
          updated_at: string;
        };
        Insert: {
          disabled?: boolean;
          id?: string;
          name: string;
          router_id: string;
          running?: boolean;
          rx_bps?: number;
          rx_bytes?: number;
          rx_drops?: number;
          rx_errors?: number;
          tenant_id: string;
          tx_bps?: number;
          tx_bytes?: number;
          tx_drops?: number;
          tx_errors?: number;
          updated_at?: string;
        };
        Update: {
          disabled?: boolean;
          id?: string;
          name?: string;
          router_id?: string;
          running?: boolean;
          rx_bps?: number;
          rx_bytes?: number;
          rx_drops?: number;
          rx_errors?: number;
          tenant_id?: string;
          tx_bps?: number;
          tx_bytes?: number;
          tx_drops?: number;
          tx_errors?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "router_interfaces_router_id_fkey";
            columns: ["router_id"];
            isOneToOne: false;
            referencedRelation: "routers";
            referencedColumns: ["id"];
          },
        ];
      };
      router_metrics: {
        Row: {
          cpu_pct: number | null;
          dns_ok: boolean | null;
          id: number;
          mem_pct: number | null;
          router_id: string;
          rx_bps: number | null;
          temp: number | null;
          tenant_id: string;
          ts: string;
          tx_bps: number | null;
          wan_jitter_ms: number | null;
          wan_latency_ms: number | null;
          wan_loss_pct: number | null;
        };
        Insert: {
          cpu_pct?: number | null;
          dns_ok?: boolean | null;
          id?: number;
          mem_pct?: number | null;
          router_id: string;
          rx_bps?: number | null;
          temp?: number | null;
          tenant_id: string;
          ts?: string;
          tx_bps?: number | null;
          wan_jitter_ms?: number | null;
          wan_latency_ms?: number | null;
          wan_loss_pct?: number | null;
        };
        Update: {
          cpu_pct?: number | null;
          dns_ok?: boolean | null;
          id?: number;
          mem_pct?: number | null;
          router_id?: string;
          rx_bps?: number | null;
          temp?: number | null;
          tenant_id?: string;
          ts?: string;
          tx_bps?: number | null;
          wan_jitter_ms?: number | null;
          wan_latency_ms?: number | null;
          wan_loss_pct?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "router_metrics_router_id_fkey";
            columns: ["router_id"];
            isOneToOne: false;
            referencedRelation: "routers";
            referencedColumns: ["id"];
          },
        ];
      };
      router_metrics_daily: {
        Row: {
          avg_cpu: number | null;
          avg_mem: number | null;
          avg_temp: number | null;
          day: string;
          max_cpu: number | null;
          max_mem: number | null;
          router_id: string;
          samples: number;
          tenant_id: string;
        };
        Insert: {
          avg_cpu?: number | null;
          avg_mem?: number | null;
          avg_temp?: number | null;
          day: string;
          max_cpu?: number | null;
          max_mem?: number | null;
          router_id: string;
          samples?: number;
          tenant_id: string;
        };
        Update: {
          avg_cpu?: number | null;
          avg_mem?: number | null;
          avg_temp?: number | null;
          day?: string;
          max_cpu?: number | null;
          max_mem?: number | null;
          router_id?: string;
          samples?: number;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "router_metrics_daily_router_id_fkey";
            columns: ["router_id"];
            isOneToOne: false;
            referencedRelation: "routers";
            referencedColumns: ["id"];
          },
        ];
      };
      router_support_sessions: {
        Row: {
          access_count: number;
          created_at: string;
          created_by: string | null;
          expires_at: string;
          id: string;
          last_accessed_at: string | null;
          password_hash: string;
          revoked_at: string | null;
          router_id: string;
          tenant_id: string;
        };
        Insert: {
          access_count?: number;
          created_at?: string;
          created_by?: string | null;
          expires_at: string;
          id?: string;
          last_accessed_at?: string | null;
          password_hash: string;
          revoked_at?: string | null;
          router_id: string;
          tenant_id: string;
        };
        Update: {
          access_count?: number;
          created_at?: string;
          created_by?: string | null;
          expires_at?: string;
          id?: string;
          last_accessed_at?: string | null;
          password_hash?: string;
          revoked_at?: string | null;
          router_id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "router_support_sessions_router_id_fkey";
            columns: ["router_id"];
            isOneToOne: false;
            referencedRelation: "routers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "router_support_sessions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      router_uptime_events: {
        Row: {
          ended_at: string | null;
          id: string;
          kind: string;
          router_id: string;
          started_at: string;
          tenant_id: string;
        };
        Insert: {
          ended_at?: string | null;
          id?: string;
          kind?: string;
          router_id: string;
          started_at?: string;
          tenant_id: string;
        };
        Update: {
          ended_at?: string | null;
          id?: string;
          kind?: string;
          router_id?: string;
          started_at?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "router_uptime_events_router_id_fkey";
            columns: ["router_id"];
            isOneToOne: false;
            referencedRelation: "routers";
            referencedColumns: ["id"];
          },
        ];
      };
      omada_integrations: {
        Row: {
          controller_host: string;
          controller_id: string;
          controller_port: number;
          controller_version: string;
          enabled: boolean;
          operator_password_ciphertext: string;
          operator_username: string;
          router_id: string;
          site_name: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          controller_host: string;
          controller_id: string;
          controller_port: number;
          controller_version: string;
          enabled?: boolean;
          operator_password_ciphertext: string;
          operator_username: string;
          router_id: string;
          site_name: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          controller_host?: string;
          controller_id?: string;
          controller_port?: number;
          controller_version?: string;
          enabled?: boolean;
          operator_password_ciphertext?: string;
          operator_username?: string;
          router_id?: string;
          site_name?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "omada_integrations_router_id_fkey";
            columns: ["router_id"];
            isOneToOne: true;
            referencedRelation: "routers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "omada_integrations_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      routers: {
        Row: {
          architecture: string | null;
          block_tethering: boolean;
          board_name: string | null;
          capabilities: Json;
          controller_version: string | null;
          cpu_load: number | null;
          cpu_usage: number | null;
          created_at: string;
          device_family: string | null;
          firmware_version: string | null;
          free_memory_mb: number | null;
          hdd_free_mb: number | null;
          id: string;
          lan_ip: string | null;
          last_heartbeat_at: string | null;
          last_seen_at: string | null;
          last_sync_at: string | null;
          legacy_token_auth: boolean;
          management_method: string | null;
          management_status: string;
          mac_address: string | null;
          management_method: string | null;
          management_status: string;
          model: string | null;
          name: string;
          provision_token: string | null;
          provision_token_expires_at: string | null;
          public_ip: string | null;
          ram_usage: number | null;
          routeros_version: string | null;
          serial: string | null;
          status: string;
          tags: string[] | null;
          temperature: number | null;
          tenant_id: string;
          total_memory_mb: number | null;
          uptime_seconds: number | null;
          vendor: string;
          voltage: number | null;
          wan_ip: string | null;
          wg_last_handshake_at: string | null;
          wg_public_key: string | null;
          wg_tunnel_ip: string | null;
        };
        Insert: {
          architecture?: string | null;
          block_tethering?: boolean;
          board_name?: string | null;
          capabilities?: Json;
          controller_version?: string | null;
          cpu_load?: number | null;
          cpu_usage?: number | null;
          created_at?: string;
          device_family?: string | null;
          firmware_version?: string | null;
          free_memory_mb?: number | null;
          hdd_free_mb?: number | null;
          id?: string;
          lan_ip?: string | null;
          last_heartbeat_at?: string | null;
          last_seen_at?: string | null;
          last_sync_at?: string | null;
          legacy_token_auth?: boolean;
          management_method?: string | null;
          management_status?: string;
          mac_address?: string | null;
          management_method?: string | null;
          management_status?: string;
          model?: string | null;
          name: string;
          provision_token?: string | null;
          provision_token_expires_at?: string | null;
          public_ip?: string | null;
          ram_usage?: number | null;
          routeros_version?: string | null;
          serial?: string | null;
          status?: string;
          tags?: string[] | null;
          temperature?: number | null;
          tenant_id: string;
          total_memory_mb?: number | null;
          uptime_seconds?: number | null;
          vendor?: string;
          voltage?: number | null;
          wan_ip?: string | null;
          wg_last_handshake_at?: string | null;
          wg_public_key?: string | null;
          wg_tunnel_ip?: string | null;
        };
        Update: {
          architecture?: string | null;
          block_tethering?: boolean;
          board_name?: string | null;
          capabilities?: Json;
          controller_version?: string | null;
          cpu_load?: number | null;
          cpu_usage?: number | null;
          created_at?: string;
          device_family?: string | null;
          firmware_version?: string | null;
          free_memory_mb?: number | null;
          hdd_free_mb?: number | null;
          id?: string;
          lan_ip?: string | null;
          last_heartbeat_at?: string | null;
          last_seen_at?: string | null;
          last_sync_at?: string | null;
          legacy_token_auth?: boolean;
          management_method?: string | null;
          management_status?: string;
          mac_address?: string | null;
          management_method?: string | null;
          management_status?: string;
          model?: string | null;
          name?: string;
          provision_token?: string | null;
          provision_token_expires_at?: string | null;
          public_ip?: string | null;
          ram_usage?: number | null;
          routeros_version?: string | null;
          serial?: string | null;
          status?: string;
          tags?: string[] | null;
          temperature?: number | null;
          tenant_id?: string;
          total_memory_mb?: number | null;
          uptime_seconds?: number | null;
          vendor?: string;
          voltage?: number | null;
          wan_ip?: string | null;
          wg_last_handshake_at?: string | null;
          wg_public_key?: string | null;
          wg_tunnel_ip?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "routers_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      service_maintenance_windows: {
        Row: {
          active: boolean;
          body: string;
          created_at: string;
          created_by: string | null;
          ends_at: string | null;
          id: string;
          mode: string;
          router_id: string | null;
          starts_at: string;
          tenant_id: string | null;
          title: string;
        };
        Insert: {
          active?: boolean;
          body: string;
          created_at?: string;
          created_by?: string | null;
          ends_at?: string | null;
          id?: string;
          mode: string;
          router_id?: string | null;
          starts_at?: string;
          tenant_id?: string | null;
          title: string;
        };
        Update: {
          active?: boolean;
          body?: string;
          created_at?: string;
          created_by?: string | null;
          ends_at?: string | null;
          id?: string;
          mode?: string;
          router_id?: string | null;
          starts_at?: string;
          tenant_id?: string | null;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_maintenance_windows_router_id_fkey";
            columns: ["router_id"];
            isOneToOne: false;
            referencedRelation: "routers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_maintenance_windows_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      sessions: {
        Row: {
          bytes_in: number | null;
          bytes_out: number | null;
          customer_id: string | null;
          ended_at: string | null;
          id: string;
          ip_address: string | null;
          mac_address: string | null;
          router_id: string | null;
          started_at: string;
          status: string;
          tenant_id: string;
        };
        Insert: {
          bytes_in?: number | null;
          bytes_out?: number | null;
          customer_id?: string | null;
          ended_at?: string | null;
          id?: string;
          ip_address?: string | null;
          mac_address?: string | null;
          router_id?: string | null;
          started_at?: string;
          status?: string;
          tenant_id: string;
        };
        Update: {
          bytes_in?: number | null;
          bytes_out?: number | null;
          customer_id?: string | null;
          ended_at?: string | null;
          id?: string;
          ip_address?: string | null;
          mac_address?: string | null;
          router_id?: string | null;
          started_at?: string;
          status?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sessions_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sessions_router_id_fkey";
            columns: ["router_id"];
            isOneToOne: false;
            referencedRelation: "routers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sessions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      settlements: {
        Row: {
          commission_amount: number;
          created_at: string;
          gross_amount: number;
          id: string;
          net_amount: number;
          notes: string | null;
          paid_at: string | null;
          payment_method: string;
          period_end: string;
          period_start: string;
          status: string;
          tenant_id: string;
        };
        Insert: {
          commission_amount?: number;
          created_at?: string;
          gross_amount?: number;
          id?: string;
          net_amount?: number;
          notes?: string | null;
          paid_at?: string | null;
          payment_method?: string;
          period_end: string;
          period_start: string;
          status?: string;
          tenant_id: string;
        };
        Update: {
          commission_amount?: number;
          created_at?: string;
          gross_amount?: number;
          id?: string;
          net_amount?: number;
          notes?: string | null;
          paid_at?: string | null;
          payment_method?: string;
          period_end?: string;
          period_start?: string;
          status?: string;
          tenant_id?: string;
        };
        Relationships: [];
      };
      stock_movements: {
        Row: {
          change: number;
          created_at: string;
          created_by: string | null;
          customer_id: string | null;
          id: string;
          item_id: string;
          note: string | null;
          reason: string;
          tenant_id: string;
        };
        Insert: {
          change: number;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          id?: string;
          item_id: string;
          note?: string | null;
          reason: string;
          tenant_id: string;
        };
        Update: {
          change?: number;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          id?: string;
          item_id?: string;
          note?: string | null;
          reason?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_movements_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      support_tickets: {
        Row: {
          body: string | null;
          created_at: string;
          customer_id: string | null;
          id: string;
          status: string;
          subject: string;
          tenant_id: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          customer_id?: string | null;
          id?: string;
          status?: string;
          subject: string;
          tenant_id: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          customer_id?: string | null;
          id?: string;
          status?: string;
          subject?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_tickets_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_tickets_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      tenant_service_secrets: {
        Row: {
          ciphertext: string;
          last4: string | null;
          name: string;
          tenant_id: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          ciphertext: string;
          last4?: string | null;
          name: string;
          tenant_id: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          ciphertext?: string;
          last4?: string | null;
          name?: string;
          tenant_id?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tenant_service_secrets_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      tenants: {
        Row: {
          bank_account_name: string | null;
          bank_account_number: string | null;
          bank_branch: string | null;
          bank_name: string | null;
          billing_suspended_at: string | null;
          created_at: string;
          id: string;
          logo_url: string | null;
          mpesa_consumer_key: string | null;
          mpesa_consumer_secret: string | null;
          mpesa_env: string;
          mpesa_passkey: string | null;
          mpesa_paybill: string | null;
          mpesa_shortcode: string | null;
          mpesa_till: string | null;
          name: string;
          payment_instructions: string | null;
          platform_commission_pct: number;
          primary_color: string | null;
          slug: string;
          status: string;
          subdomain: string | null;
          support_email: string | null;
          support_phone: string | null;
          updated_at: string;
        };
        Insert: {
          bank_account_name?: string | null;
          bank_account_number?: string | null;
          bank_branch?: string | null;
          bank_name?: string | null;
          billing_suspended_at?: string | null;
          created_at?: string;
          id?: string;
          logo_url?: string | null;
          mpesa_consumer_key?: string | null;
          mpesa_consumer_secret?: string | null;
          mpesa_env?: string;
          mpesa_passkey?: string | null;
          mpesa_paybill?: string | null;
          mpesa_shortcode?: string | null;
          mpesa_till?: string | null;
          name: string;
          payment_instructions?: string | null;
          platform_commission_pct?: number;
          primary_color?: string | null;
          slug: string;
          status?: string;
          subdomain?: string | null;
          support_email?: string | null;
          support_phone?: string | null;
          updated_at?: string;
        };
        Update: {
          bank_account_name?: string | null;
          bank_account_number?: string | null;
          bank_branch?: string | null;
          bank_name?: string | null;
          billing_suspended_at?: string | null;
          created_at?: string;
          id?: string;
          logo_url?: string | null;
          mpesa_consumer_key?: string | null;
          mpesa_consumer_secret?: string | null;
          mpesa_env?: string;
          mpesa_passkey?: string | null;
          mpesa_paybill?: string | null;
          mpesa_shortcode?: string | null;
          mpesa_till?: string | null;
          name?: string;
          payment_instructions?: string | null;
          platform_commission_pct?: number;
          primary_color?: string | null;
          slug?: string;
          status?: string;
          subdomain?: string | null;
          support_email?: string | null;
          support_phone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      tv_devices: {
        Row: {
          created_at: string;
          expires_at: string | null;
          id: string;
          mac_address: string;
          name: string | null;
          package_id: string | null;
          phone: string | null;
          status: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          mac_address: string;
          name?: string | null;
          package_id?: string | null;
          phone?: string | null;
          status?: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          mac_address?: string;
          name?: string | null;
          package_id?: string | null;
          phone?: string | null;
          status?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tv_devices_package_id_fkey";
            columns: ["package_id"];
            isOneToOne: false;
            referencedRelation: "packages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tv_devices_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          tenant_id: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          tenant_id?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          tenant_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      vouchers: {
        Row: {
          bound_mac: string | null;
          code: string;
          created_at: string;
          expires_at: string | null;
          id: string;
          package_id: string | null;
          payment_id: string | null;
          status: string;
          tenant_id: string;
          used_at: string | null;
          used_by_mac: string | null;
        };
        Insert: {
          bound_mac?: string | null;
          code: string;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          package_id?: string | null;
          payment_id?: string | null;
          status?: string;
          tenant_id: string;
          used_at?: string | null;
          used_by_mac?: string | null;
        };
        Update: {
          bound_mac?: string | null;
          code?: string;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          package_id?: string | null;
          payment_id?: string | null;
          status?: string;
          tenant_id?: string;
          used_at?: string | null;
          used_by_mac?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      admin_approve_user: {
        Args: {
          p_new_tenant_name?: string;
          p_new_tenant_slug?: string;
          p_role: Database["public"]["Enums"]["app_role"];
          p_tenant_id?: string;
          p_user_id: string;
        };
        Returns: string;
      };
      approve_direct_mpesa_transaction: {
        Args: {
          p_customer_id: string;
          p_expires_at: string;
          p_package_id: string;
          p_reviewed_by: string;
          p_tenant_id: string;
          p_transaction_id: string;
        };
        Returns: string;
      };
      bootstrap_tenant: {
        Args: { p_full_name?: string; p_name: string; p_slug: string };
        Returns: string;
      };
      check_auth_login_throttle: {
        Args: { p_email_hash: string; p_ip_hash: string };
        Returns: {
          blocked: boolean;
          retry_after_seconds: number;
        }[];
      };
      check_router_liveness: { Args: { p_stale?: string }; Returns: number };
      claim_platform_invoice_emails: {
        Args: { p_limit?: number; p_now?: string };
        Returns: {
          collected_at: string | null;
          commission_amount: number;
          commission_rate_pct: number | null;
          created_at: string;
          due_at: string | null;
          email_attempted_at: string | null;
          email_error: string | null;
          email_sent_at: string | null;
          email_status: string;
          gross_amount: number;
          hotspot_commission_amount: number | null;
          hotspot_commission_rate_pct: number | null;
          hotspot_gross_amount: number | null;
          id: string;
          invoice_number: string | null;
          issued_at: string | null;
          mpesa_receipt: string | null;
          payment_reference: string | null;
          period_end: string;
          period_start: string;
          pppoe_commission_amount: number | null;
          pppoe_commission_rate_pct: number | null;
          pppoe_gross_amount: number | null;
          status: string;
          tenant_id: string;
          tenant_mpesa_receipt: string | null;
        }[];
        SetofOptions: {
          from: "*";
          to: "platform_commissions";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      expire_stale_stk_payments: { Args: never; Returns: number };
      generate_monthly_platform_commission_invoices: {
        Args: { p_now?: string };
        Returns: number;
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      has_tenant_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][];
          _tenant_id: string;
          _user_id: string;
        };
        Returns: boolean;
      };
      is_aal2: { Args: never; Returns: boolean };
      is_super_admin: { Args: { _user_id: string }; Returns: boolean };
      provision_isp_tenant: {
        Args: { p_business_name: string; p_full_name: string; p_phone: string };
        Returns: string;
      };
      record_auth_login_attempt: {
        Args: { p_email_hash: string; p_ip_hash: string; p_succeeded: boolean };
        Returns: {
          attempt_count: number;
          event_type: string;
          should_alert: boolean;
        }[];
      };
      record_platform_c2b_transaction: {
        Args: {
          p_amount: number;
          p_bill_ref_number: string;
          p_first_name?: string | null;
          p_last_name?: string | null;
          p_middle_name?: string | null;
          p_shortcode: string;
          p_transaction_id: string;
          p_transaction_time: string;
        };
        Returns: string;
      };
      record_platform_stk_transaction: {
        Args: {
          p_amount: number;
          p_checkout_request_id: string;
          p_shortcode: string;
          p_transaction_id: string;
          p_transaction_time: string;
        };
        Returns: string;
      };
      fail_platform_stk_payment: {
        Args: { p_checkout_request_id: string };
        Returns: boolean;
      };
      record_pppoe_sessions: {
        Args: { p_router_id: string; p_sessions: Json; p_tenant_id: string };
        Returns: number;
      };
      refresh_overdue_tenant_billing: {
        Args: { p_now?: string };
        Returns: number;
      };
      remove_tenant_member: {
        Args: { p_actor_id: string; p_user_id: string };
        Returns: undefined;
      };
      rollup_router_metrics: { Args: never; Returns: undefined };
      remove_tenant_member: {
        Args: { p_actor_id: string; p_user_id: string };
        Returns: undefined;
      };
      rotate_router_token: {
        Args: { p_revoke_device?: boolean; p_router_id: string };
        Returns: string;
      };
      tenants_with_role: {
        Args: { _roles: Database["public"]["Enums"]["app_role"][] };
        Returns: string[];
      };
      update_tenant_member_roles: {
        Args: {
          p_actor_id: string;
          p_roles: Database["public"]["Enums"]["app_role"][];
          p_user_id: string;
        };
        Returns: undefined;
      };
      user_tenant_id: { Args: { _user_id: string }; Returns: string };
    };
    Enums: {
      app_role:
        | "super_admin"
        | "tenant_admin"
        | "technician"
        | "billing_agent"
        | "support_staff"
        | "end_user";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

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
} as const;
