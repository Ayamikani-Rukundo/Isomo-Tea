import { requireSupabase } from './supabase'

export type AccountSettings = {
  theme: 'dark' | 'light'
  notifications_enabled: boolean
  notifications_snoozed_until: string | null
}

export async function loadUserSettings(userId: string) {
  const { data, error } = await requireSupabase()
    .from('user_settings')
    .select('theme, notifications_enabled, notifications_snoozed_until')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function saveUserSettings(userId: string, settings: Partial<AccountSettings>) {
  const { error } = await requireSupabase()
    .from('user_settings')
    .upsert({ user_id: userId, ...settings }, { onConflict: 'user_id' })
  if (error) throw error
}
