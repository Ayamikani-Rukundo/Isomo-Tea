import { corsHeaders, errorResponse, isOptions, jsonResponse, readJson } from '../_shared/http.ts'
import { enforceRateLimit, RateLimitError } from '../_shared/rate-limit.ts'
import { publicAuthClient, serviceClient } from '../_shared/supabase.ts'
import { validateEmail, validatePassword } from '../_shared/validation.ts'

Deno.serve(async (request) => {
  if (isOptions(request)) return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return errorResponse(new Error('Method not allowed.'), 405)
  try {
    await enforceRateLimit(request, 'admin-login', 8)
    const body = await readJson(request)
    const email = validateEmail(body.email)
    const password = validatePassword(body.password)
    const { data: signedIn, error: signInError } = await publicAuthClient().auth.signInWithPassword({ email, password })
    if (signInError || !signedIn.user || !signedIn.session) {
      return errorResponse(new Error('Invalid administrator email or password.'), 401)
    }

    const { data: role, error: roleError } = await serviceClient()
      .from('administrators')
      .select('user_id')
      .eq('user_id', signedIn.user.id)
      .maybeSingle()
    if (roleError) throw roleError
    if (!role) return errorResponse(new Error('This account is not authorized for administrator access.'), 403)

    return jsonResponse({
      access_token: signedIn.session.access_token,
      refresh_token: signedIn.session.refresh_token,
      profile: {
        id: signedIn.user.id,
        username: signedIn.user.user_metadata.username ?? 'administrator',
        avatar_url: null,
      },
    })
  } catch (error) {
    if (error instanceof RateLimitError) return errorResponse(error, 429)
    console.error('Administrator login failed:', error instanceof Error ? error.message : error)
    return errorResponse(error, 400)
  }
})
