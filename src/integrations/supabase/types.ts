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
      ai_cache: {
        Row: {
          cache_key: string
          created_at: string
          expires_at: string
          response: string
          task: string
        }
        Insert: {
          cache_key: string
          created_at?: string
          expires_at?: string
          response: string
          task: string
        }
        Update: {
          cache_key?: string
          created_at?: string
          expires_at?: string
          response?: string
          task?: string
        }
        Relationships: []
      }
      campaigns: {
        Row: {
          created_at: string
          expansions: Json | null
          expansions_at: string | null
          icp: Json | null
          id: string
          last_run_at: string | null
          name: string
          query: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expansions?: Json | null
          expansions_at?: string | null
          icp?: Json | null
          id?: string
          last_run_at?: string | null
          name: string
          query: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expansions?: Json | null
          expansions_at?: string | null
          icp?: Json | null
          id?: string
          last_run_at?: string | null
          name?: string
          query?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      lead_research: {
        Row: {
          citations: Json | null
          created_at: string
          id: string
          lead_url: string
          overview: string | null
          pain_points: Json | null
          raw: Json | null
          recommended_angle: string | null
          updated_at: string
          user_id: string
          why_now: string | null
        }
        Insert: {
          citations?: Json | null
          created_at?: string
          id?: string
          lead_url: string
          overview?: string | null
          pain_points?: Json | null
          raw?: Json | null
          recommended_angle?: string | null
          updated_at?: string
          user_id: string
          why_now?: string | null
        }
        Update: {
          citations?: Json | null
          created_at?: string
          id?: string
          lead_url?: string
          overview?: string | null
          pain_points?: Json | null
          raw?: Json | null
          recommended_angle?: string | null
          updated_at?: string
          user_id?: string
          why_now?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          job_title: string | null
          location: string | null
          notify_email: boolean
          plan: string
          rate_range: string | null
          searches_reset_at: string
          searches_used: number
          skills: string[]
          slack_webhook: string | null
          updated_at: string
          work_preference: string | null
          years_experience: number | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          job_title?: string | null
          location?: string | null
          notify_email?: boolean
          plan?: string
          rate_range?: string | null
          searches_reset_at?: string
          searches_used?: number
          skills?: string[]
          slack_webhook?: string | null
          updated_at?: string
          work_preference?: string | null
          years_experience?: number | null
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          job_title?: string | null
          location?: string | null
          notify_email?: boolean
          plan?: string
          rate_range?: string | null
          searches_reset_at?: string
          searches_used?: number
          skills?: string[]
          slack_webhook?: string | null
          updated_at?: string
          work_preference?: string | null
          years_experience?: number | null
        }
        Relationships: []
      }
      saved_leads: {
        Row: {
          author: string | null
          author_url: string | null
          contact_company: string | null
          contact_email: string | null
          contact_meta: Json | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          engagement: number
          full_post_url: string
          id: string
          is_decision_maker: boolean | null
          notes: string | null
          outreach_call: string | null
          outreach_dm: string | null
          outreach_email_body: string | null
          outreach_email_subject: string | null
          platform: string | null
          posted_at: string | null
          score: number | null
          snippet: string | null
          source: string
          status: string
          tier: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          author?: string | null
          author_url?: string | null
          contact_company?: string | null
          contact_email?: string | null
          contact_meta?: Json | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          engagement?: number
          full_post_url: string
          id?: string
          is_decision_maker?: boolean | null
          notes?: string | null
          outreach_call?: string | null
          outreach_dm?: string | null
          outreach_email_body?: string | null
          outreach_email_subject?: string | null
          platform?: string | null
          posted_at?: string | null
          score?: number | null
          snippet?: string | null
          source: string
          status?: string
          tier?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          author?: string | null
          author_url?: string | null
          contact_company?: string | null
          contact_email?: string | null
          contact_meta?: Json | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          engagement?: number
          full_post_url?: string
          id?: string
          is_decision_maker?: boolean | null
          notes?: string | null
          outreach_call?: string | null
          outreach_dm?: string | null
          outreach_email_body?: string | null
          outreach_email_subject?: string | null
          platform?: string | null
          posted_at?: string | null
          score?: number | null
          snippet?: string | null
          source?: string
          status?: string
          tier?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      lead_activity: {
        Row: {
          created_at: string
          detail: string | null
          id: string
          kind: string
          lead_url: string | null
          metadata: Json | null
          saved_lead_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          id?: string
          kind: string
          lead_url?: string | null
          metadata?: Json | null
          saved_lead_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          id?: string
          kind?: string
          lead_url?: string | null
          metadata?: Json | null
          saved_lead_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      search_history: {
        Row: {
          created_at: string
          id: string
          query: string
          results_count: number
          sources_searched: string[]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          query: string
          results_count?: number
          sources_searched?: string[]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          query?: string
          results_count?: number
          sources_searched?: string[]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
