import { requireSupabase } from './supabase'

export type AdminMember = {
  id: string
  username: string
  created_at: string
  suspended: boolean
}

export type AdminRole = {
  user_id: string
  username: string
  created_at: string
  created_by: string | null
}

export type AdminAuditEntry = {
  id: number
  actor_id: string | null
  action: string
  target_user_id: string | null
  target_message_id: string | null
  details: Record<string, unknown>
  created_at: string
}

export type AdminOverviewData = {
  members: number
  administrators: number
  messages: number
  activeCodes: number
  recentMembers: number
}

async function invokeFunction<T>(name: string, body: Record<string, unknown>) {
  const { data, error } = await requireSupabase().functions.invoke<T>(name, { body })
  if (error) {
    if (error.context instanceof Response) {
      const payload = await error.context.json().catch(() => null) as { error?: string } | null
      throw new Error(payload?.error ?? error.message)
    }
    throw new Error(error.message)
  }
  if (!data) throw new Error('The administrator service returned an empty response.')
  return data
}

export function adminConsoleAction<T>(body: Record<string, unknown>) {
  return invokeFunction<T>('admin-console', body)
}

export async function inviteAdministrator(email: string) {
  await invokeFunction<{ invited: boolean }>('admin-invite', { email })
}
