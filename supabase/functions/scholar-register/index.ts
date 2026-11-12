import { corsHeaders, errorResponse, isOptions, jsonResponse, readJson } from '../_shared/http.ts'
import { enforceRateLimit, RateLimitError } from '../_shared/rate-limit.ts'
import { publicAuthClient, serviceClient } from '../_shared/supabase.ts'
import { validateAccessCode, validatePassword, validateUsername } from '../_shared/validation.ts'

Deno.serve(async (request) => {
  if (isOptions(request)) return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return errorResponse(new Error('Method not allowed.'), 405)

  let createdUserId: string | null = null
  try {
    await enforceRateLimit(request, 'scholar-register', 6)
    const body = await readJson(request)
    const username = validateUsername(body.username)
    const password = validatePassword(body.password)
    const accessCode = validateAccessCode(body.accessCode)
    const service = serviceClient()

    const { data: available, error: availabilityError } = await service.rpc('username_is_available', {
      p_username: username,
    })
    if (availabilityError) throw availabilityError
    if (!available) return errorResponse(new Error('That username is already taken.'), 409)

    const internalEmail = `${crypto.randomUUID()}@members.isomotea.invalid`
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email: internalEmail,
      password,
      email_confirm: true,
      user_metadata: {},
      app_metadata: { account_type: 'scholar' },
    })
    if (createError) throw createError
    if (!created.user) throw new Error('Could not create the scholar account.')
    createdUserId = created.user.id

    const { data: profile, error: profileError } = await service
      .from('profiles')
      .update({ username })
      .eq('id', created.user.id)
      .select('id, username, avatar_url')
      .single()
    if (profileError?.code === '23505') throw new Error('That username is already taken.')
    if (profileError) throw profileError

    const { data: accepted, error: codeError } = await service.rpc('consume_access_code', {
      p_code: accessCode,
    })
    if (codeError) throw codeError
    if (!accepted) throw new Error('The Isomo access code is invalid or expired.')

    const auth = publicAuthClient()
    const { data: signedIn, error: signInError } = await auth.auth.signInWithPassword({
      email: internalEmail,
      password,
    })
    if (signInError || !signedIn.session) throw signInError ?? new Error('Could not start the new session.')
    return jsonResponse({
      access_token: signedIn.session.access_token,
      refresh_token: signedIn.session.refresh_token,
      profile,
    })
  } catch (error) {
    if (createdUserId) {
      const { error: cleanupError } = await serviceClient().auth.admin.deleteUser(createdUserId)
      if (cleanupError) console.error('Failed to clean up incomplete scholar registration:', cleanupError.message)
    }
    if (error instanceof RateLimitError) return errorResponse(error, 429)
    if (error instanceof Error && error.message === 'The Isomo access code is invalid or expired.') {
      return errorResponse(error, 403)
    }
    if (error instanceof Error && error.message === 'That username is already taken.') {
      return errorResponse(error, 409)
    }
    console.error('Scholar registration failed:', error instanceof Error ? error.message : error)
    return errorResponse(error, 400)
  }
})
