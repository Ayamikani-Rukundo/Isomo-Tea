import { corsHeaders, errorResponse, isOptions, jsonResponse, readJson } from '../_shared/http.ts'
import { enforceRateLimit, RateLimitError } from '../_shared/rate-limit.ts'
import { publicAuthClient, serviceClient } from '../_shared/supabase.ts'
import { validatePassword, validateUsername } from '../_shared/validation.ts'

Deno.serve(async (request) => {
  if (isOptions(request)) return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return errorResponse(new Error('Method not allowed.'), 405)
  try {
    await enforceRateLimit(request, 'scholar-login', 12)
    const body = await readJson(request)
    const username = validateUsername(body.username)
    const password = validatePassword(body.password)
    const service = serviceClient()
    const { data: profile, error: profileError } = await service
      .from('profiles')
      .select('id, username, avatar_url')
      .eq('username_normalized', username.toLowerCase())
      .maybeSingle()
    if (profileError) throw profileError
    if (!profile) return errorResponse(new Error('Invalid username or password.'), 401)

    const { data: authUser, error: authUserError } = await service.auth.admin.getUserById(profile.id)
    if (authUserError) throw authUserError
    const internalEmail = authUser.user.email
    if (!internalEmail?.endsWith('@members.isomotea.invalid')) {
      return errorResponse(new Error('Invalid username or password.'), 401)
    }

    const { data: signedIn, error: signInError } = await publicAuthClient().auth.signInWithPassword({
      email: internalEmail,
      password,
    })
    if (signInError || !signedIn.session) {
      return errorResponse(new Error('Invalid username or password.'), 401)
    }
    return jsonResponse({
      access_token: signedIn.session.access_token,
      refresh_token: signedIn.session.refresh_token,
      profile,
    })
  } catch (error) {
    if (error instanceof RateLimitError) return errorResponse(error, 429)
    console.error('Scholar login failed:', error instanceof Error ? error.message : error)
    return errorResponse(error, 400)
  }
})
