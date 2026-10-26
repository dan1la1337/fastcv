// Сгенерировано из схемы Supabase (generate_typescript_types). Не править вручную:
// после изменения схемы обновить: npm run db:types (см. README, «Типы базы»).

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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      app_admins: {
        Row: {
          created_at: string
          email: string
        }
        Insert: {
          created_at?: string
          email: string
        }
        Update: {
          created_at?: string
          email?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      ai_usage: {
        Row: {
          created_at: string
          id: number
          kind: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: number
          kind: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: number
          kind?: string
          user_id?: string
        }
        Relationships: []
      }
      applications: {
        Row: {
          candidate_id: string | null
          cover_letter: string | null
          created_at: string | null
          hr_message: string | null
          hr_replied_at: string | null
          viewed_at: string | null
          id: string
          status: string | null
          vacancy_id: string | null
        }
        Insert: {
          candidate_id?: string | null
          cover_letter?: string | null
          created_at?: string | null
          hr_message?: string | null
          hr_replied_at?: string | null
          viewed_at?: string | null
          id?: string
          status?: string | null
          vacancy_id?: string | null
        }
        Update: {
          candidate_id?: string | null
          cover_letter?: string | null
          created_at?: string | null
          hr_message?: string | null
          hr_replied_at?: string | null
          viewed_at?: string | null
          id?: string
          status?: string | null
          vacancy_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "applications_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_vacancy_id_fkey"
            columns: ["vacancy_id"]
            isOneToOne: false
            referencedRelation: "vacancies"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          category: string | null
          excluded_at: string | null
          excluded_note: string | null
          failed_runs: number
          id: number
          is_active: boolean | null
          last_error: string | null
          last_parsed_at: string | null
          last_post_id: number | null
          username: string
        }
        Insert: {
          category?: string | null
          excluded_at?: string | null
          excluded_note?: string | null
          failed_runs?: number
          id?: number
          is_active?: boolean | null
          last_error?: string | null
          last_parsed_at?: string | null
          last_post_id?: number | null
          username: string
        }
        Update: {
          category?: string | null
          excluded_at?: string | null
          excluded_note?: string | null
          failed_runs?: number
          id?: number
          is_active?: boolean | null
          last_error?: string | null
          last_parsed_at?: string | null
          last_post_id?: number | null
          username?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          domain: string | null
          id: string
          is_claimed: boolean | null
          name: string
          owner_id: string | null
          trust_score: number | null
        }
        Insert: {
          domain?: string | null
          id?: string
          is_claimed?: boolean | null
          name: string
          owner_id?: string | null
          trust_score?: number | null
        }
        Update: {
          domain?: string | null
          id?: string
          is_claimed?: boolean | null
          name?: string
          owner_id?: string | null
          trust_score?: number | null
        }
        Relationships: []
      }
      cover_letters: {
        Row: {
          created_at: string
          id: string
          input_hash: string
          text: string
          user_id: string
          vacancy_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          input_hash: string
          text: string
          user_id: string
          vacancy_id: string
        }
        Update: {
          created_at?: string
          id?: string
          input_hash?: string
          text?: string
          user_id?: string
          vacancy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cover_letters_vacancy_id_fkey"
            columns: ["vacancy_id"]
            isOneToOne: false
            referencedRelation: "vacancies"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          pref_city: string | null
          pref_directions: string[]
          pref_format: string | null
          pref_formats: string[]
          experience_years: number | null
          pref_level: string | null
          pref_salary: number | null
          resume_path: string | null
          role: string
          skills: Json | null
          telegram_chat_id: number | null
          telegram_link_code: string | null
          company_domain: string | null
          company_verify_token: string | null
          company_verified_at: string | null
          company_checked_at: string | null
          telegram_notified_at: string | null
          telegram_notify: boolean
          trust_score: number | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          pref_city?: string | null
          pref_directions?: string[]
          pref_format?: string | null
          pref_formats?: string[]
          experience_years?: number | null
          pref_level?: string | null
          pref_salary?: number | null
          resume_path?: string | null
          role: string
          skills?: Json | null
          telegram_chat_id?: number | null
          telegram_link_code?: string | null
          company_domain?: string | null
          company_verify_token?: string | null
          company_verified_at?: string | null
          company_checked_at?: string | null
          telegram_notified_at?: string | null
          telegram_notify?: boolean
          trust_score?: number | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          pref_city?: string | null
          pref_directions?: string[]
          pref_format?: string | null
          pref_formats?: string[]
          experience_years?: number | null
          pref_level?: string | null
          pref_salary?: number | null
          resume_path?: string | null
          role?: string
          skills?: Json | null
          telegram_chat_id?: number | null
          telegram_link_code?: string | null
          company_domain?: string | null
          company_verify_token?: string | null
          company_verified_at?: string | null
          company_checked_at?: string | null
          telegram_notified_at?: string | null
          telegram_notify?: boolean
          trust_score?: number | null
        }
        Relationships: []
      }
      vacancy_marks: {
        Row: {
          created_at: string
          kind: string
          user_id: string
          vacancy_id: string
        }
        Insert: {
          created_at?: string
          kind: string
          user_id: string
          vacancy_id: string
        }
        Update: {
          created_at?: string
          kind?: string
          user_id?: string
          vacancy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vacancy_marks_vacancy_id_fkey"
            columns: ["vacancy_id"]
            isOneToOne: false
            referencedRelation: "vacancies"
            referencedColumns: ["id"]
          },
        ]
      }
      vacancies: {
        Row: {
          archived_at: string | null
          city: string | null
          company_id: string | null
          company_name: string | null
          country: string | null
          contact_type: string | null
          contact_value: string | null
          created_at: string | null
          description: string | null
          direction: string | null
          employer_id: string | null
          employer_verified: boolean
          employer_slow: boolean
          id: string
          is_remote: boolean | null
          level: string | null
          posted_at: string | null
          ranking_weight: number | null
          raw_hash: string | null
          salary_currency: string | null
          salary_max: number | null
          salary_min: number | null
          search_tsv: unknown
          source_post: string | null
          source_type: string | null
          source_url: string | null
          stack: Json
          text_fingerprint: string | null
          title: string
          title_key: string | null
          views_count: number
          work_format: string | null
          hiring_type: string | null
          first_seen_at: string | null
          channels_count: number
          scope_note: string | null
          source_kind: string | null
          experience_min: number | null
        }
        Insert: {
          archived_at?: string | null
          city?: string | null
          company_id?: string | null
          company_name?: string | null
          country?: string | null
          contact_type?: string | null
          contact_value?: string | null
          created_at?: string | null
          description?: string | null
          direction?: string | null
          employer_id?: string | null
          employer_verified?: boolean
          employer_slow?: boolean
          id?: string
          is_remote?: boolean | null
          level?: string | null
          posted_at?: string | null
          ranking_weight?: number | null
          raw_hash?: string | null
          salary_currency?: string | null
          salary_max?: number | null
          salary_min?: number | null
          search_tsv?: unknown
          source_post?: string | null
          source_type?: string | null
          source_url?: string | null
          stack?: Json
          text_fingerprint?: string | null
          title: string
          title_key?: string | null
          views_count?: number
          work_format?: string | null
          hiring_type?: string | null
          first_seen_at?: string | null
          channels_count?: number
          scope_note?: string | null
          source_kind?: string | null
          experience_min?: number | null
        }
        Update: {
          archived_at?: string | null
          city?: string | null
          company_id?: string | null
          company_name?: string | null
          country?: string | null
          contact_type?: string | null
          contact_value?: string | null
          created_at?: string | null
          description?: string | null
          direction?: string | null
          employer_id?: string | null
          employer_verified?: boolean
          employer_slow?: boolean
          id?: string
          is_remote?: boolean | null
          level?: string | null
          posted_at?: string | null
          ranking_weight?: number | null
          raw_hash?: string | null
          salary_currency?: string | null
          salary_max?: number | null
          salary_min?: number | null
          search_tsv?: unknown
          source_post?: string | null
          source_type?: string | null
          source_url?: string | null
          stack?: Json
          text_fingerprint?: string | null
          title?: string
          title_key?: string | null
          views_count?: number
          work_format?: string | null
          hiring_type?: string | null
          first_seen_at?: string | null
          channels_count?: number
          scope_note?: string | null
          source_kind?: string | null
          experience_min?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vacancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacancies_employer_id_fkey"
            columns: ["employer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      vacancy_cities: {
        Row: { city: string; country: string | null; vacancies: number }
        Relationships: []
      }
      vacancy_countries: {
        Row: { country: string; vacancies: number }
        Relationships: []
      }
      direction_counts: {
        Row: { direction: string; vacancies: number }
        Relationships: []
      }
      salary_benchmarks: {
        Row: {
          all_levels: boolean
          direction: string
          level: string | null
          p25: number
          p75: number
          sample: number
        }
        Relationships: []
      }
    }
    Functions: {
      admin_metrics: { Args: never; Returns: Json }
      app_user_role: { Args: never; Returns: string }
      archive_stale_vacancies: { Args: { days?: number }; Returns: number }
      is_app_admin: { Args: never; Returns: boolean }
      create_telegram_link_code: { Args: never; Returns: string }
      link_telegram_chat: { Args: { chat: number; code: string }; Returns: boolean }
      start_company_verification: { Args: { domain: string }; Returns: string }
      check_company_verification: { Args: never; Returns: boolean }
      set_telegram_bot: { Args: { username: string }; Returns: undefined }
      consume_ai_quota: {
        Args: { max_calls: number; quota_kind: string; window_seconds: number }
        Returns: Json
      }
      my_application_matches: {
        Args: never
        Returns: {
          application_id: string
          matched: Json
          missing: Json
          score: number
        }[]
      }
      my_vacancy_matches: {
        Args: { ids: string[] }
        Returns: {
          id: string
          matched: Json
          missing: Json
          score: number
        }[]
      }
      normalize_city: { Args: { city: string }; Returns: string }
      recommended_vacancies: {
        Args: { page?: number; page_size?: number }
        Returns: {
          id: string
          matched: Json
          missing: Json
          score: number
        }[]
      }
      register_vacancy_view: { Args: { vacancy: string }; Returns: undefined }
      telegram_digest: {
        Args: { min_score?: number }
        Returns: { chat_id: number; items: Json; user_id: string }[]
      }
      unlink_telegram: { Args: never; Returns: undefined }
      delete_my_account: { Args: never; Returns: undefined }
      live_stats: { Args: never; Returns: Json }
      exclude_channel: {
        Args: { p_note?: string; p_username: string }
        Returns: number
      }
      excluded_channels: {
        Args: never
        Returns: {
          excluded_at: string
          excluded_note: string | null
          username: string
        }[]
      }
      vacancy_direction: {
        Args: { stack?: Json; title: string }
        Returns: string
      }
      vacancy_level: {
        Args: { description?: string; title: string }
        Returns: string
      }
      vacancy_match: {
        Args: {
          p: Database["public"]["Tables"]["profiles"]["Row"]
          v: Database["public"]["Tables"]["vacancies"]["Row"]
        }
        Returns: Json
      }
      vacancy_work_format: {
        Args: {
          city: string
          description: string
          is_remote: boolean
          title: string
        }
        Returns: string
      }
    }
    Enums: {
      app_status: "pending" | "interview_scheduled" | "rejected" | "expired"
      user_role: "candidate" | "employer"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_status: ["pending", "interview_scheduled", "rejected", "expired"],
      user_role: ["candidate", "employer"],
    },
  },
} as const
