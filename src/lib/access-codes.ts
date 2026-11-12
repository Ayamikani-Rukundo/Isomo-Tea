import { requireSupabase } from './supabase'

export type AccessCode = {
  id: string
  safeId: string
  active: boolean
  expired: boolean
  expires_at: string | null
  max_uses: number | null
  uses: number
  remaining: number | null
  created_at: string
}

type AccessCodeResponse = {
  accessCode: AccessCode
  code?: string
}

async function invokeAccessCodeAction<T>(body: Record<string, string | number | boolean | null>) {
  const { data, error } = await requireSupabase()
    .functions.invoke<T>('admin-access-codes', { body })
  if (error) {
    if (error.context instanceof Response) {
      const payload = await error.context.json().catch(() => null) as { error?: string } | null
      throw new Error(payload?.error ?? error.message)
    }
    throw new Error(error.message)
  }
  if (!data) throw new Error('The access-code service returned an empty response.')
  return data
}

export async function listAccessCodes() {
  const data = await invokeAccessCodeAction<{ accessCodes: AccessCode[] }>({ action: 'list' })
  if (!Array.isArray(data.accessCodes)) throw new Error('The access-code service returned an invalid list.')
  return data.accessCodes
}

export async function createAccessCode(input: {
  code: string
  maxUses: number
  expiresAt: string | null
  deactivateId: string | null
}) {
  const data = await invokeAccessCodeAction<AccessCodeResponse>({
    action: 'create',
    code: input.code,
    maxUses: input.maxUses,
    expiresAt: input.expiresAt,
    deactivateId: input.deactivateId,
  })
  if (!data.accessCode?.id || typeof data.code !== 'string') {
    throw new Error('The access-code service returned an invalid creation response.')
  }
  return { accessCode: data.accessCode, code: data.code }
}

export async function setAccessCodeActive(id: string, active: boolean) {
  const data = await invokeAccessCodeAction<{ accessCode: AccessCode }>({
    action: 'set-active',
    id,
    active,
  })
  if (!data.accessCode?.id) throw new Error('The access-code service returned an invalid status response.')
  return data.accessCode
}
