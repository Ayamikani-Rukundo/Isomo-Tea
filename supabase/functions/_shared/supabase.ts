import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

function requiredEnv(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing Edge Function secret: ${name}`)
  return value
}

export function serviceClient(): SupabaseClient {
  return createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export function publicAuthClient(): SupabaseClient {
  return createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_ANON_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export function accessToken(request: Request) {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) throw new Error('Authentication required.')
  return authorization.slice('Bearer '.length)
}

export async function requireAdministrator(request: Request) {
  const service = serviceClient()
  const token = accessToken(request)
  const { data: { user }, error } = await service.auth.getUser(token)
  if (error || !user) throw new Error('Authentication required.')
  const { data: administrator, error: roleError } = await service
    .from('administrators')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (roleError) throw roleError
  if (!administrator) throw new Error('Administrator access is required.')
  return { service, user }
}
