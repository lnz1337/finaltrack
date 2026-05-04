export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ad_groups: {
        Row: {
          campaign_id: string
          cpc_bid_micros: number | null
          google_ad_group_id: string
          id: string
          last_synced_at: string | null
          name: string
          status: string | null
          type: string | null
        }
        Insert: {
          campaign_id: string
          cpc_bid_micros?: number | null
          google_ad_group_id: string
          id?: string
          last_synced_at?: string | null
          name: string
          status?: string | null
          type?: string | null
        }
        Update: {
          campaign_id?: string
          cpc_bid_micros?: number | null
          google_ad_group_id?: string
          id?: string
          last_synced_at?: string | null
          name?: string
          status?: string | null
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_groups_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      ads: {
        Row: {
          ad_group_id: string
          ad_type: string | null
          description: string | null
          final_url: string | null
          google_ad_id: string
          headline: string | null
          id: string
          last_synced_at: string | null
          name: string | null
          preview_url: string | null
          status: string | null
          video_id: string | null
        }
        Insert: {
          ad_group_id: string
          ad_type?: string | null
          description?: string | null
          final_url?: string | null
          google_ad_id: string
          headline?: string | null
          id?: string
          last_synced_at?: string | null
          name?: string | null
          preview_url?: string | null
          status?: string | null
          video_id?: string | null
        }
        Update: {
          ad_group_id?: string
          ad_type?: string | null
          description?: string | null
          final_url?: string | null
          google_ad_id?: string
          headline?: string | null
          id?: string
          last_synced_at?: string | null
          name?: string | null
          preview_url?: string | null
          status?: string | null
          video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ads_ad_group_id_fkey"
            columns: ["ad_group_id"]
            isOneToOne: false
            referencedRelation: "ad_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          bidding_strategy: string | null
          campaign_type: string | null
          daily_budget_micros: number | null
          end_date: string | null
          google_ads_account_id: string
          google_campaign_id: string
          id: string
          last_synced_at: string | null
          name: string
          start_date: string | null
          status: string | null
        }
        Insert: {
          bidding_strategy?: string | null
          campaign_type?: string | null
          daily_budget_micros?: number | null
          end_date?: string | null
          google_ads_account_id: string
          google_campaign_id: string
          id?: string
          last_synced_at?: string | null
          name: string
          start_date?: string | null
          status?: string | null
        }
        Update: {
          bidding_strategy?: string | null
          campaign_type?: string | null
          daily_budget_micros?: number | null
          end_date?: string | null
          google_ads_account_id?: string
          google_campaign_id?: string
          id?: string
          last_synced_at?: string | null
          name?: string
          start_date?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_google_ads_account_id_fkey"
            columns: ["google_ads_account_id"]
            isOneToOne: false
            referencedRelation: "google_ads_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      clicks: {
        Row: {
          ad_id_parsed: string | null
          ad_name_parsed: string | null
          adset_id_parsed: string | null
          adset_name_parsed: string | null
          browser: string | null
          campaign_id_parsed: string | null
          campaign_name_parsed: string | null
          city: string | null
          click_id: string
          clicked_at: string | null
          country: string | null
          device_type: string | null
          gad_campaignid: string | null
          gad_source: string | null
          gbraid: string | null
          gclid: string | null
          gclsrc: string | null
          google_ad_group_id: string | null
          google_ad_id: string | null
          google_campaign_id: string | null
          id: string
          ip: unknown
          landing_url: string
          os: string | null
          referrer: string | null
          region: string | null
          session_id: string | null
          user_agent: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          visitor_id: string
          wbraid: string | null
          workspace_id: string
        }
        Insert: {
          ad_id_parsed?: string | null
          ad_name_parsed?: string | null
          adset_id_parsed?: string | null
          adset_name_parsed?: string | null
          browser?: string | null
          campaign_id_parsed?: string | null
          campaign_name_parsed?: string | null
          city?: string | null
          click_id: string
          clicked_at?: string | null
          country?: string | null
          device_type?: string | null
          gad_campaignid?: string | null
          gad_source?: string | null
          gbraid?: string | null
          gclid?: string | null
          gclsrc?: string | null
          google_ad_group_id?: string | null
          google_ad_id?: string | null
          google_campaign_id?: string | null
          id?: string
          ip?: unknown
          landing_url: string
          os?: string | null
          referrer?: string | null
          region?: string | null
          session_id?: string | null
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          visitor_id: string
          wbraid?: string | null
          workspace_id: string
        }
        Update: {
          ad_id_parsed?: string | null
          ad_name_parsed?: string | null
          adset_id_parsed?: string | null
          adset_name_parsed?: string | null
          browser?: string | null
          campaign_id_parsed?: string | null
          campaign_name_parsed?: string | null
          city?: string | null
          click_id?: string
          clicked_at?: string | null
          country?: string | null
          device_type?: string | null
          gad_campaignid?: string | null
          gad_source?: string | null
          gbraid?: string | null
          gclid?: string | null
          gclsrc?: string | null
          google_ad_group_id?: string | null
          google_ad_id?: string | null
          google_campaign_id?: string | null
          id?: string
          ip?: unknown
          landing_url?: string
          os?: string | null
          referrer?: string | null
          region?: string | null
          session_id?: string | null
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          visitor_id?: string
          wbraid?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clicks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversion_uploads: {
        Row: {
          attempt_count: number | null
          attempted_at: string | null
          conversion_action_id: string | null
          conversion_id: string
          created_at: string | null
          google_ads_account_id: string
          google_response: Json | null
          id: string
          last_error: string | null
          status: string
          succeeded_at: string | null
        }
        Insert: {
          attempt_count?: number | null
          attempted_at?: string | null
          conversion_action_id?: string | null
          conversion_id: string
          created_at?: string | null
          google_ads_account_id: string
          google_response?: Json | null
          id?: string
          last_error?: string | null
          status?: string
          succeeded_at?: string | null
        }
        Update: {
          attempt_count?: number | null
          attempted_at?: string | null
          conversion_action_id?: string | null
          conversion_id?: string
          created_at?: string | null
          google_ads_account_id?: string
          google_response?: Json | null
          id?: string
          last_error?: string | null
          status?: string
          succeeded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversion_uploads_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_uploads_google_ads_account_id_fkey"
            columns: ["google_ads_account_id"]
            isOneToOne: false
            referencedRelation: "google_ads_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      conversions: {
        Row: {
          amount: number
          click_id: string | null
          conversion_type: string
          currency: string
          customer_email_hash: string | null
          customer_first_name_hash: string | null
          customer_last_name_hash: string | null
          customer_phone_hash: string | null
          external_order_id: string
          id: string
          match_method: string | null
          occurred_at: string | null
          offer_id: string | null
          raw_payload: Json | null
          workspace_id: string
        }
        Insert: {
          amount: number
          click_id?: string | null
          conversion_type: string
          currency?: string
          customer_email_hash?: string | null
          customer_first_name_hash?: string | null
          customer_last_name_hash?: string | null
          customer_phone_hash?: string | null
          external_order_id: string
          id?: string
          match_method?: string | null
          occurred_at?: string | null
          offer_id?: string | null
          raw_payload?: Json | null
          workspace_id: string
        }
        Update: {
          amount?: number
          click_id?: string | null
          conversion_type?: string
          currency?: string
          customer_email_hash?: string | null
          customer_first_name_hash?: string | null
          customer_last_name_hash?: string | null
          customer_phone_hash?: string | null
          external_order_id?: string
          id?: string
          match_method?: string | null
          occurred_at?: string | null
          offer_id?: string | null
          raw_payload?: Json | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversions_click_id_fkey"
            columns: ["click_id"]
            isOneToOne: false
            referencedRelation: "clicks"
            referencedColumns: ["click_id"]
          },
          {
            foreignKeyName: "conversions_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_data: {
        Row: {
          clicks: number | null
          conversion_value_reported_by_google: number | null
          conversions_reported_by_google: number | null
          cost_micros: number | null
          currency: string | null
          date: string
          google_ad_group_id: string | null
          google_ad_id: string | null
          google_ads_account_id: string
          google_campaign_id: string
          id: string
          impressions: number | null
          synced_at: string | null
          view_through_conversions: number | null
        }
        Insert: {
          clicks?: number | null
          conversion_value_reported_by_google?: number | null
          conversions_reported_by_google?: number | null
          cost_micros?: number | null
          currency?: string | null
          date: string
          google_ad_group_id?: string | null
          google_ad_id?: string | null
          google_ads_account_id: string
          google_campaign_id: string
          id?: string
          impressions?: number | null
          synced_at?: string | null
          view_through_conversions?: number | null
        }
        Update: {
          clicks?: number | null
          conversion_value_reported_by_google?: number | null
          conversions_reported_by_google?: number | null
          cost_micros?: number | null
          currency?: string | null
          date?: string
          google_ad_group_id?: string | null
          google_ad_id?: string | null
          google_ads_account_id?: string
          google_campaign_id?: string
          id?: string
          impressions?: number | null
          synced_at?: string | null
          view_through_conversions?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_data_google_ads_account_id_fkey"
            columns: ["google_ads_account_id"]
            isOneToOne: false
            referencedRelation: "google_ads_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_sync_log: {
        Row: {
          completed_at: string | null
          date_range_end: string
          date_range_start: string
          duration_ms: number | null
          error_message: string | null
          google_ads_account_id: string
          id: string
          rows_synced: number | null
          started_at: string | null
          status: string
          triggered_by: string | null
        }
        Insert: {
          completed_at?: string | null
          date_range_end: string
          date_range_start: string
          duration_ms?: number | null
          error_message?: string | null
          google_ads_account_id: string
          id?: string
          rows_synced?: number | null
          started_at?: string | null
          status: string
          triggered_by?: string | null
        }
        Update: {
          completed_at?: string | null
          date_range_end?: string
          date_range_start?: string
          duration_ms?: number | null
          error_message?: string | null
          google_ads_account_id?: string
          id?: string
          rows_synced?: number | null
          started_at?: string | null
          status?: string
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_sync_log_google_ads_account_id_fkey"
            columns: ["google_ads_account_id"]
            isOneToOne: false
            referencedRelation: "google_ads_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      google_ads_accounts: {
        Row: {
          account_name: string | null
          created_at: string | null
          currency: string | null
          customer_id: string
          id: string
          is_active: boolean | null
          last_synced_at: string | null
          manager_customer_id: string | null
          refresh_token_encrypted: string
          refresh_token_iv: string
          workspace_id: string
        }
        Insert: {
          account_name?: string | null
          created_at?: string | null
          currency?: string | null
          customer_id: string
          id?: string
          is_active?: boolean | null
          last_synced_at?: string | null
          manager_customer_id?: string | null
          refresh_token_encrypted: string
          refresh_token_iv: string
          workspace_id: string
        }
        Update: {
          account_name?: string | null
          created_at?: string | null
          currency?: string | null
          customer_id?: string
          id?: string
          is_active?: boolean | null
          last_synced_at?: string | null
          manager_customer_id?: string | null
          refresh_token_encrypted?: string
          refresh_token_iv?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_ads_accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          checkout_platform: string
          cogs_pct: number | null
          created_at: string | null
          default_currency: string | null
          external_product_id: string | null
          id: string
          is_active: boolean | null
          name: string
          workspace_id: string
        }
        Insert: {
          checkout_platform: string
          cogs_pct?: number | null
          created_at?: string | null
          default_currency?: string | null
          external_product_id?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          workspace_id: string
        }
        Update: {
          checkout_platform?: string
          cogs_pct?: number | null
          created_at?: string | null
          default_currency?: string | null
          external_product_id?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "offers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      video_events: {
        Row: {
          click_id: string
          event_type: string
          id: string
          occurred_at: string | null
          video_id: string | null
        }
        Insert: {
          click_id: string
          event_type: string
          id?: string
          occurred_at?: string | null
          video_id?: string | null
        }
        Update: {
          click_id?: string
          event_type?: string
          id?: string
          occurred_at?: string | null
          video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_events_click_id_fkey"
            columns: ["click_id"]
            isOneToOne: false
            referencedRelation: "clicks"
            referencedColumns: ["click_id"]
          },
        ]
      }
      webhook_secrets: {
        Row: {
          created_at: string | null
          endpoint_token: string
          id: string
          is_active: boolean | null
          platform: string
          secret_encrypted: string
          secret_iv: string
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          endpoint_token?: string
          id?: string
          is_active?: boolean | null
          platform: string
          secret_encrypted: string
          secret_iv: string
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          endpoint_token?: string
          id?: string
          is_active?: boolean | null
          platform?: string
          secret_encrypted?: string
          secret_iv?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_secrets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string | null
          default_currency: string | null
          id: string
          name: string
          owner_id: string
          slug: string
          timezone: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          default_currency?: string | null
          id?: string
          name: string
          owner_id: string
          slug: string
          timezone?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          default_currency?: string | null
          id?: string
          name?: string
          owner_id?: string
          slug?: string
          timezone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      creative_metrics: {
        Args: {
          p_end_date: string
          p_start_date: string
          p_workspace_id: string
        }
        Returns: {
          ad_id: string
          ad_name: string
          campaign_name: string
          clicks: number
          conversions: number
          cpa: number
          google_ad_id: string
          impressions: number
          revenue: number
          roas: number
          spend: number
        }[]
      }
      daily_metrics: {
        Args: {
          p_end_date: string
          p_start_date: string
          p_workspace_id: string
        }
        Returns: {
          clicks: number
          conversions: number
          date: string
          impressions: number
          revenue: number
          spend: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

