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
      captive_portals: {
        Row: {
          background_url: string | null;
          enable_otp: boolean | null;
          enable_voucher: boolean | null;
          id: string;
          logo_url: string | null;
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
          last_ip: string | null;
          last_mac: string | null;
          last_router_id: string | null;
          last_seen_at: string | null;
          created_at: string;
          customer_type: string;
          email: string | null;
          expires_at: string | null;
          full_name: string | null;
          id: string;
          package_id: string | null;
          phone: string | null;
          pppoe_password: string | null;
          pppoe_username: string | null;
          router_id: string | null;
          static_ip: string | null;
          status: string;
          tenant_id: string;
        };
        Insert: {
          last_ip?: string | null;
          last_mac?: string | null;
          last_router_id?: string | null;
          last_seen_at?: string | null;
          created_at?: string;
          customer_type?: string;
          email?: string | null;
          expires_at?: string | null;
          full_name?: string | null;
          id?: string;
          package_id?: string | null;
          phone?: string | null;
          pppoe_password?: string | null;
          pppoe_username?: string | null;
          router_id?: string | null;
          static_ip?: string | null;
          status?: string;
          tenant_id: string;
        };
        Update: {
          last_ip?: string | null;
          last_mac?: string | null;
          last_router_id?: string | null;
          last_seen_at?: string | null;
          created_at?: string;
          customer_type?: string;
          email?: string | null;
          expires_at?: string | null;
          full_name?: string | null;
          id?: string;
          package_id?: string | null;
          phone?: string | null;
          pppoe_password?: string | null;
          pppoe_username?: string | null;
          router_id?: string | null;
          static_ip?: string | null;
          status?: string;
          tenant_id?: string;
        };
        Relationships: [
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
          provider: string;
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
          raw_callback: Json | null;
          status: string;
          tenant_id: string;
          tv_device_id: string | null;
          voucher_code: string | null;
        };
        Insert: {
          provider?: string;
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
          raw_callback?: Json | null;
          status?: string;
          tenant_id: string;
          tv_device_id?: string | null;
          voucher_code?: string | null;
        };
        Update: {
          provider?: string;
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
            foreignKeyName: "payments_tv_device_id_fkey";
            columns: ["tv_device_id"];
            isOneToOne: false;
            referencedRelation: "tv_devices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_gateway_secrets: {
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
      platform_mpesa_config: {
        Row: {
          active_provider: string;
          callback_base_url: string | null;
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
          active_provider?: string;
          callback_base_url?: string | null;
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
          active_provider?: string;
          callback_base_url?: string | null;
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
      profiles: {
        Row: {
          created_at: string;
          email: string | null;
          full_name: string | null;
          id: string;
          phone: string | null;
          tenant_id: string | null;
        };
        Insert: {
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id: string;
          phone?: string | null;
          tenant_id?: string | null;
        };
        Update: {
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id?: string;
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
      routers: {
        Row: {
          architecture: string | null;
          block_tethering: boolean;
          board_name: string | null;
          cpu_load: number | null;
          cpu_usage: number | null;
          created_at: string;
          firmware_version: string | null;
          free_memory_mb: number | null;
          hdd_free_mb: number | null;
          id: string;
          lan_ip: string | null;
          last_heartbeat_at: string | null;
          last_seen_at: string | null;
          last_sync_at: string | null;
          mac_address: string | null;
          model: string | null;
          name: string;
          provision_token: string | null;
          provision_token_expires_at: string | null;
          legacy_token_auth: boolean;
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
          cpu_load?: number | null;
          cpu_usage?: number | null;
          created_at?: string;
          firmware_version?: string | null;
          free_memory_mb?: number | null;
          hdd_free_mb?: number | null;
          id?: string;
          lan_ip?: string | null;
          last_heartbeat_at?: string | null;
          last_seen_at?: string | null;
          last_sync_at?: string | null;
          mac_address?: string | null;
          model?: string | null;
          name: string;
          provision_token?: string | null;
          provision_token_expires_at?: string | null;
          legacy_token_auth?: boolean;
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
          cpu_load?: number | null;
          cpu_usage?: number | null;
          created_at?: string;
          firmware_version?: string | null;
          free_memory_mb?: number | null;
          hdd_free_mb?: number | null;
          id?: string;
          lan_ip?: string | null;
          last_heartbeat_at?: string | null;
          last_seen_at?: string | null;
          last_sync_at?: string | null;
          mac_address?: string | null;
          model?: string | null;
          name?: string;
          provision_token?: string | null;
          provision_token_expires_at?: string | null;
          legacy_token_auth?: boolean;
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
      tenants: {
        Row: {
          bank_account_name: string | null;
          bank_account_number: string | null;
          bank_branch: string | null;
          bank_name: string | null;
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
      bootstrap_tenant: {
        Args: { p_full_name?: string; p_name: string; p_slug: string };
        Returns: string;
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      is_super_admin: { Args: { _user_id: string }; Returns: boolean };
      rollup_router_metrics: { Args: never; Returns: undefined };
      record_pppoe_sessions: {
        Args: { p_router_id: string; p_sessions: Json; p_tenant_id: string };
        Returns: number;
      };
      rotate_router_token: {
        Args: { p_revoke_device?: boolean; p_router_id: string };
        Returns: string;
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
