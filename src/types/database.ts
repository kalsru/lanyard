export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      attendees: {
        Row: {
          id: string
          user_id: string
          name: string
          title: string | null
          company: string | null
          location: string | null
          tags: string[]
          avatar_url: string | null
          linkedin_url: string | null
          company_url: string | null
          source: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          title?: string | null
          company?: string | null
          location?: string | null
          tags?: string[]
          avatar_url?: string | null
          linkedin_url?: string | null
          company_url?: string | null
          source?: string | null
          created_at?: string
        }
        Update: {
          name?: string
          title?: string | null
          company?: string | null
          location?: string | null
          tags?: string[]
          avatar_url?: string | null
          linkedin_url?: string | null
          company_url?: string | null
          source?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          email: string
          full_name: string | null
          avatar_url: string | null
          plan: 'free' | 'pro' | 'enterprise'
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          avatar_url?: string | null
          plan?: 'free' | 'pro' | 'enterprise'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string | null
          avatar_url?: string | null
          plan?: 'free' | 'pro' | 'enterprise'
          updated_at?: string
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

export type Profile = Database['public']['Tables']['profiles']['Row']
