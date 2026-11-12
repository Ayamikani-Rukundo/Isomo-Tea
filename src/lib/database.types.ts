export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          username: string
          avatar_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          username: string
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          username?: string
          avatar_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      administrators: {
        Row: { user_id: string; created_at: string; created_by: string | null }
        Insert: { user_id: string; created_at?: string; created_by?: string | null }
        Update: never
        Relationships: []
      }
      access_codes: {
        Row: { id: string; code_hash: string; active: boolean; expires_at: string | null; max_uses: number | null; uses: number; created_at: string; created_by: string | null }
        Insert: never
        Update: never
        Relationships: []
      }
      conversations: {
        Row: { id: string; kind: 'general' | 'private'; title: string | null; avatar_path: string | null; created_by: string | null; participant_low: string | null; participant_high: string | null; created_at: string; updated_at: string }
        Insert: never
        Update: never
        Relationships: []
      }
      conversation_members: {
        Row: { conversation_id: string; user_id: string; joined_at: string; last_read_at: string | null; hidden_at: string | null }
        Insert: never
        Update: never
        Relationships: []
      }
      messages: {
        Row: { id: string; conversation_id: string; sender_id: string | null; body: string; system_event: 'username_changed' | null; reply_to_id: string | null; media_group_id: string | null; created_at: string; updated_at: string; deleted_at: string | null }
        Insert: { id?: string; conversation_id: string; sender_id: string; body: string; reply_to_id?: string | null; media_group_id?: string | null; created_at?: string; updated_at?: string; deleted_at?: string | null }
        Update: never
        Relationships: []
      }
      message_reactions: {
        Row: { conversation_id: string; message_id: string; user_id: string; emoji: string; created_at: string }
        Insert: { conversation_id: string; message_id: string; user_id: string; emoji: string; created_at?: string }
        Update: never
        Relationships: []
      }
      message_hidden_for_users: {
        Row: { message_id: string; user_id: string; hidden_at: string }
        Insert: never
        Update: never
        Relationships: []
      }
      message_media: {
        Row: {
          message_id: string
          conversation_id: string
          sender_id: string | null
          object_path: string
          media_kind: 'image' | 'audio' | 'video'
          mime_type: string
          byte_size: number
          view_once: boolean
          expires_at: string | null
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      view_once_recipients: {
        Row: { message_id: string; user_id: string; claim_id: string | null; claimed_at: string | null; consumed_at: string | null }
        Insert: never
        Update: never
        Relationships: []
      }
      message_polls: {
        Row: { message_id: string; conversation_id: string; created_by: string; question: string; closes_at: string | null; created_at: string }
        Insert: never
        Update: never
        Relationships: []
      }
      poll_options: {
        Row: { id: string; message_id: string; label: string; position: number }
        Insert: never
        Update: never
        Relationships: []
      }
      poll_votes: {
        Row: { message_id: string; conversation_id: string; user_id: string; option_id: string; cast_at: string }
        Insert: never
        Update: never
        Relationships: []
      }
      message_stickers: {
        Row: { message_id: string; conversation_id: string; sticker_code: string }
        Insert: never
        Update: never
        Relationships: []
      }
      message_mentions: {
        Row: { message_id: string; conversation_id: string; user_id: string; mentioned_by: string | null; created_at: string; read_at: string | null }
        Insert: never
        Update: never
        Relationships: []
      }
      admin_audit_log: {
        Row: { id: number; actor_id: string | null; action: string; target_user_id: string | null; target_message_id: string | null; details: Json; created_at: string }
        Insert: never
        Update: never
        Relationships: []
      }
      user_settings: {
        Row: { user_id: string; theme: 'dark' | 'light'; notifications_enabled: boolean; notifications_snoozed_until: string | null; created_at: string; updated_at: string }
        Insert: { user_id: string; theme?: 'dark' | 'light'; notifications_enabled?: boolean; notifications_snoozed_until?: string | null }
        Update: { theme?: 'dark' | 'light'; notifications_enabled?: boolean; notifications_snoozed_until?: string | null; updated_at?: string }
        Relationships: []
      }
      web_push_subscriptions: {
        Row: { id: string; user_id: string; endpoint: string; p256dh: string; auth: string; created_at: string; updated_at: string }
        Insert: { id?: string; user_id: string; endpoint: string; p256dh: string; auth: string; created_at?: string; updated_at?: string }
        Update: { endpoint?: string; p256dh?: string; auth?: string; updated_at?: string }
        Relationships: []
      }
      native_push_tokens: {
        Row: { id: string; user_id: string; token: string; platform: 'android' | 'ios'; created_at: string; updated_at: string }
        Insert: { id?: string; user_id: string; token: string; platform: 'android' | 'ios'; created_at?: string; updated_at?: string }
        Update: { token?: string; platform?: 'android' | 'ios'; updated_at?: string }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      username_is_available: { Args: { p_username: string }; Returns: boolean }
      set_my_username: { Args: { p_username: string }; Returns: string }
      consume_access_code: { Args: { p_code: string }; Returns: boolean }
      is_administrator: { Args: { p_user_id?: string }; Returns: boolean }
      get_or_create_private_conversation: { Args: { p_other_user_id: string }; Returns: string }
      get_private_conversation_list: {
        Args: Record<PropertyKey, never>
        Returns: Array<{
          conversation_id: string
          peer_id: string | null
          peer_username: string
          peer_avatar_url: string | null
          latest_message: string | null
          latest_message_at: string | null
          unread_count: number
          last_read_at: string | null
        }>
      }
      hide_private_conversation: { Args: { p_conversation_id: string }; Returns: string }
      open_private_conversation: { Args: { p_conversation_id: string }; Returns: string }
      mark_conversation_read: { Args: { p_conversation_id: string }; Returns: string }
      register_message_media: {
        Args: {
          p_message_id: string
          p_conversation_id: string
          p_body: string
          p_reply_to_id: string | null
          p_object_path: string
          p_media_kind: 'image' | 'audio' | 'video'
          p_mime_type: string
          p_byte_size: number
          p_view_once: boolean
        }
        Returns: string
      }
      register_grouped_message_media: {
        Args: {
          p_message_id: string
          p_conversation_id: string
          p_body: string
          p_reply_to_id: string | null
          p_object_path: string
          p_media_kind: 'image'
          p_mime_type: string
          p_byte_size: number
          p_view_once: boolean
          p_media_group_id: string
        }
        Returns: string
      }
      claim_view_once_media: { Args: { p_message_id: string; p_user_id: string }; Returns: Array<{ object_path: string; mime_type: string; claim_id: string }> }
      complete_view_once_media: { Args: { p_message_id: string; p_user_id: string; p_claim_id: string }; Returns: boolean }
      get_message_media_cleanup_candidates: { Args: { p_limit?: number }; Returns: Array<{ message_id: string; object_path: string }> }
      delete_cleaned_message_media: { Args: { p_message_ids: string[] }; Returns: number }
      create_message_poll: {
        Args: {
          p_message_id: string
          p_conversation_id: string
          p_question: string
          p_options: string[]
          p_reply_to_id?: string | null
          p_closes_at?: string | null
        }
        Returns: string
      }
      cast_poll_vote: { Args: { p_message_id: string; p_option_id: string }; Returns: undefined }
      get_poll_results: {
        Args: { p_conversation_id: string; p_message_ids: string[] }
        Returns: Array<{ message_id: string; option_id: string; vote_count: number; my_vote: boolean }>
      }
      create_sticker_message: {
        Args: { p_message_id: string; p_conversation_id: string; p_sticker_code: string; p_reply_to_id?: string | null }
        Returns: string
      }
      mark_mentions_read: { Args: { p_message_ids: string[] }; Returns: number }
      edit_message: { Args: { p_message_id: string; p_body: string }; Returns: string }
      delete_message_for_everyone: { Args: { p_message_id: string }; Returns: string }
      delete_message_for_me: { Args: { p_message_id: string }; Returns: string }
      purge_account_content: { Args: { p_user_id: string; p_request_id: string }; Returns: number }
      complete_account_deletion: { Args: { p_request_id: string }; Returns: undefined }
      admin_create_access_code: {
        Args: {
          p_code: string
          p_max_uses: number
          p_expires_at: string | null
          p_deactivate_id: string | null
          p_created_by: string
        }
        Returns: Json
      }
      admin_set_access_code_active: {
        Args: { p_id: string; p_active: boolean; p_changed_by: string }
        Returns: Json
      }
      admin_delete_message: { Args: { p_message_id: string; p_actor_id: string }; Returns: string }
      admin_clear_message_history: { Args: { p_start_at: string; p_end_at: string; p_actor_id: string }; Returns: number }
      admin_remove_administrator: { Args: { p_target_id: string; p_actor_id: string }; Returns: string }
      admin_record_invitation: { Args: { p_target_id: string; p_actor_id: string }; Returns: string }
      admin_update_general_conversation: { Args: { p_title: string; p_avatar_path: string | null; p_actor_id: string }; Returns: Json }
      admin_create_access_code_audited: {
        Args: { p_code: string; p_max_uses: number; p_expires_at: string | null; p_deactivate_id: string | null; p_created_by: string }
        Returns: Json
      }
      admin_set_access_code_active_audited: { Args: { p_id: string; p_active: boolean; p_changed_by: string }; Returns: Json }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
