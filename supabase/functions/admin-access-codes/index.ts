import { corsHeaders, isOptions } from '../_shared/http.ts'
import { requireAdministrator } from '../_shared/supabase.ts'

type AccessCodeRecord = {
  id: string
  active: boolean
  expires_at: string | null
  max_uses: number | null
  uses: number
  created_at: string
}

function publicAccessCode(code: AccessCodeRecord) {
  return {
    ...code,
    safeId: code.id.slice(0, 8).toUpperCase(),
    remaining: code.max_uses === null ? null : Math.max(code.max_uses - code.uses, 0),
    expired: Boolean(code.expires_at && new Date(code.expires_at).getTime() <= Date.now()),
  }
}

function hasControlCharacters(value: string) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function failure(status: number, message: string) {
  return secureJsonResponse({ error: message }, status)
}

function secureJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
  })
}

function reportFailure(operation: string, error: { code?: string } | unknown) {
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : 'unknown'
  console.error('Access-code management failed.', { operation, code })
}

function databaseFailure(error: { code?: string }) {
  switch (error.code) {
    case '22023':
      return failure(400, 'Check the code, registration limit, and expiration date.')
    case '23505':
      return failure(409, 'That access code already exists.')
    case 'P0002':
      return failure(404, 'The selected access code was not found or is no longer active.')
    case 'P0001':
      return failure(409, 'Expired or fully used codes cannot be activated.')
    case '42501':
      return failure(403, 'Administrator access is required.')
    default:
      return failure(500, 'The access-code request could not be completed.')
  }
}

function validateCreateInput(body: Record<string, unknown>) {
  const code = body.code
  const maxUses = body.maxUses
  const expiresAt = body.expiresAt
  const deactivateId = body.deactivateId

  if (
    typeof code !== 'string'
    || code.length < 8
    || code.length > 128
    || code.trim() !== code
    || hasControlCharacters(code)
  ) {
    throw new Error('Choose an access code between 8 and 128 characters, without surrounding spaces.')
  }
  if (typeof maxUses !== 'number' || !Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > 2_147_483_647) {
    throw new Error('Maximum registrations must be a whole number greater than zero.')
  }

  let expiresAtIso: string | null = null
  if (expiresAt !== null) {
    if (typeof expiresAt !== 'string' || !expiresAt.trim()) {
      throw new Error('Choose an expiration date or select no expiration.')
    }
    const parsedDate = new Date(expiresAt)
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.getTime() <= Date.now()) {
      throw new Error('Expiration must be a valid future date and time.')
    }
    expiresAtIso = parsedDate.toISOString()
  }

  let selectedCodeToDeactivate: string | null = null
  if (deactivateId !== null) {
    if (
      typeof deactivateId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deactivateId)
    ) {
      throw new Error('Choose a valid active code to replace.')
    }
    selectedCodeToDeactivate = deactivateId
  }

  return { code, maxUses, expiresAt: expiresAtIso, deactivateId: selectedCodeToDeactivate }
}

Deno.serve(async (request) => {
  if (isOptions(request)) return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return failure(405, 'Method not allowed.')

  let operation = 'authorize'
  try {
    const { service, user } = await requireAdministrator(request)
    const contentLength = Number(request.headers.get('content-length') ?? '0')
    if (contentLength > 4096) return failure(413, 'Request is too large.')
    const rawBody = await request.text()
    if (rawBody.length > 4096) return failure(413, 'Request is too large.')

    let body: unknown
    try {
      body = JSON.parse(rawBody)
    } catch {
      return failure(400, 'Request body must be valid JSON.')
    }
    if (!isRecord(body) || typeof body.action !== 'string') {
      return failure(400, 'Choose a valid access-code action.')
    }
    operation = body.action

    if (operation === 'list') {
      const { data, error } = await service
        .from('access_codes')
        .select('id, active, expires_at, max_uses, uses, created_at')
        .order('created_at', { ascending: false })
      if (error) {
        reportFailure(operation, error)
        return failure(500, 'Access codes could not be loaded.')
      }
      return secureJsonResponse({
        accessCodes: (data ?? []).map((code: AccessCodeRecord) => publicAccessCode(code)),
      })
    }

    if (operation === 'create') {
      let input: ReturnType<typeof validateCreateInput>
      try {
        input = validateCreateInput(body)
      } catch (error) {
        return failure(400, error instanceof Error ? error.message : 'Check the access-code details.')
      }

      const { data, error } = await service.rpc('admin_create_access_code_audited', {
        p_code: input.code,
        p_max_uses: input.maxUses,
        p_expires_at: input.expiresAt,
        p_deactivate_id: input.deactivateId,
        p_created_by: user.id,
      })
      if (error) {
        reportFailure(operation, error)
        return databaseFailure(error)
      }
      const codeRecord = data as AccessCodeRecord
      return secureJsonResponse({
        accessCode: publicAccessCode(codeRecord),
        code: input.code,
      }, 201)
    }

    if (operation === 'set-active') {
      if (
        typeof body.id !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.id)
        || typeof body.active !== 'boolean'
      ) {
        return failure(400, 'Choose a valid code and status.')
      }
      const { data, error } = await service.rpc('admin_set_access_code_active_audited', {
        p_id: body.id,
        p_active: body.active,
        p_changed_by: user.id,
      })
      if (error) {
        reportFailure(operation, error)
        return databaseFailure(error)
      }
      return secureJsonResponse({ accessCode: publicAccessCode(data as AccessCodeRecord) })
    }

    return failure(400, 'Choose a valid access-code action.')
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'Authentication required.') return failure(401, message)
    if (message === 'Administrator access is required.') return failure(403, message)
    reportFailure(operation, error)
    return failure(500, 'The access-code request could not be completed.')
  }
})
