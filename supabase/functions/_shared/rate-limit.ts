import { serviceClient } from './supabase.ts'
import { sha256 } from './http.ts'

export async function enforceRateLimit(request: Request, action: string, limit: number) {
  const pepper = Deno.env.get('AUTH_RATE_LIMIT_PEPPER')
  if (!pepper) throw new Error('Authentication rate limiting is not configured.')
  const forwardedFor = request.headers.get('x-forwarded-for')
  const clientAddress = forwardedFor?.split(',')[0]?.trim() || 'unknown-client'
  const identifierHash = await sha256(`${pepper}:${clientAddress}`)
  const { data, error } = await serviceClient().rpc('consume_auth_rate_limit', {
    p_identifier_hash: identifierHash,
    p_action: action,
    p_window_seconds: 600,
    p_max_attempts: limit,
  })
  if (error) throw error
  if (!data) throw new RateLimitError()
}

export class RateLimitError extends Error {
  constructor() {
    super('Too many attempts. Wait a few minutes and try again.')
  }
}
