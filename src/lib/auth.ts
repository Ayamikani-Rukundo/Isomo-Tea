import type { Session } from '@supabase/supabase-js'
import { resolveProfileAvatarUrls } from './profileAvatars'
import { requireSupabase } from './supabase'
import { validateUsername } from './usernames'

export { validateUsername } from './usernames'

export type PublicProfile = {
  id: string
  username: string
  avatar_url: string | null
  avatarUrl?: string | null
}

type EdgeSession = {
  access_token: string
  refresh_token: string
  profile: PublicProfile
}

async function invokeSessionFunction(name: string, body: Record<string, string>) {
  const client = requireSupabase()
  const { data, error } = await client.functions.invoke<EdgeSession>(name, { body })
  if (error) {
    const context = error.context
    if (context instanceof Response) {
      const payload = await context.json().catch(() => null) as { error?: string } | null
      throw new Error(payload?.error ?? error.message)
    }
    throw new Error(error.message)
  }
  if (!data?.access_token || !data.refresh_token || !data.profile) {
    throw new Error('The authentication service returned an invalid session.')
  }
  const { error: sessionError } = await client.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  })
  if (sessionError) throw sessionError
  return data.profile
}

export async function registerScholar(username: string, password: string, accessCode: string) {
  return invokeSessionFunction('scholar-register', {
    username: validateUsername(username),
    password,
    accessCode,
  })
}

export async function signInScholar(username: string, password: string) {
  return invokeSessionFunction('scholar-login', {
    username: validateUsername(username),
    password,
  })
}

export async function signInAdministrator(email: string, password: string) {
  if (!email.trim() || !password) throw new Error('Enter your administrator email and password.')
  return invokeSessionFunction('admin-login', { email: email.trim(), password })
}

export async function usernameAvailable(username: string) {
  const candidate = validateUsername(username)
  const { data, error } = await requireSupabase().rpc('username_is_available', {
    p_username: candidate,
  })
  if (error) throw error
  return data
}

export async function availableUsernameSuggestions() {
  const suggestions = [
    'moonlit.mango', 'softchaos', 'littlecomet', 'mossy.mood', 'quietly.iconic',
    'peachy.static', 'tiny.afterglow', 'cloudberry.mp3', 'gentle.plot.twist',
    'midnight.mandazi', 'sunny.sidequest', 'velvet.rain',
  ]
  const available = await Promise.all(suggestions.map(async (username) => ({
    username,
    available: await usernameAvailable(username),
  })))
  return available.filter((item) => item.available).map((item) => item.username)
}

export async function loadProfile(userId: string): Promise<PublicProfile> {
  const { data, error } = await requireSupabase()
    .from('profiles')
    .select('id, username, avatar_url')
    .eq('id', userId)
    .single()
  if (error) throw error
  const avatarUrls = await resolveProfileAvatarUrls([data.avatar_url])
  return { ...data, avatarUrl: data.avatar_url ? avatarUrls.get(data.avatar_url) ?? null : null }
}

export async function changeUsername(username: string) {
  const { data, error } = await requireSupabase().rpc('set_my_username', {
    p_username: validateUsername(username),
  })
  if (error) throw error
  return data
}

export async function signOut() {
  const { error } = await requireSupabase().auth.signOut()
  if (error) throw error
}

export async function deleteOwnAccount(password: string) {
  const { data, error } = await requireSupabase().functions.invoke<{ deleted: boolean }>('account-delete', {
    body: { confirmation: 'DELETE MY ACCOUNT', password },
  })
  if (error) {
    if (error.context instanceof Response) {
      const payload = await error.context.json().catch(() => null) as { error?: string } | null
      throw new Error(payload?.error ?? error.message)
    }
    throw new Error(error.message)
  }
  if (!data?.deleted) throw new Error('The account deletion service returned an invalid response.')
}

export async function clearLocalSession() {
  const { error } = await requireSupabase().auth.signOut({ scope: 'local' })
  if (error) throw error
}

export type AuthState = {
  session: Session | null
  profile: PublicProfile | null
  loading: boolean
}
