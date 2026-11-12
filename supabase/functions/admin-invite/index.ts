import { corsHeaders, errorResponse, isOptions, jsonResponse, readJson } from '../_shared/http.ts'
import { requireAdministrator } from '../_shared/supabase.ts'
import { validateEmail } from '../_shared/validation.ts'

Deno.serve(async (request) => {
  if (isOptions(request)) return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return errorResponse(new Error('Method not allowed.'), 405)
  try {
    const { service, user: administrator } = await requireAdministrator(request)
    const body = await readJson(request)
    const email = validateEmail(body.email)
    const { data, error } = await service.auth.admin.inviteUserByEmail(email, {
      data: { account_type: 'administrator' },
    })
    if (error) throw error
    if (!data.user) throw new Error('The administrator invitation could not be created.')

    const { error: roleError } = await service.rpc('admin_record_invitation', {
      p_target_id: data.user.id,
      p_actor_id: administrator.id,
    })
    if (roleError) {
      throw roleError
    }
    return jsonResponse({ invited: true })
  } catch (error) {
    console.error('Administrator invitation failed:', error instanceof Error ? error.message : error)
    const message = error instanceof Error ? error.message : ''
    return errorResponse(error, message === 'Authentication required.' ? 401 : message === 'Administrator access is required.' ? 403 : 400)
  }
})
