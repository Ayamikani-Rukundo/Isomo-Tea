import { corsHeaders, errorResponse, isOptions, jsonResponse, readJson } from '../_shared/http.ts'
import { enforceRateLimit, RateLimitError } from '../_shared/rate-limit.ts'
import { accessToken, publicAuthClient, serviceClient } from '../_shared/supabase.ts'
import { validatePassword } from '../_shared/validation.ts'

const confirmationPhrase = 'DELETE MY ACCOUNT'
const mediaPageSize = 500
const avatarPageSize = 500
const storageBatchSize = 100

Deno.serve(async (request) => {
  if (isOptions(request)) return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return errorResponse(new Error('Method not allowed.'), 405)

  let deletionRequestId: string | null = null
  let contentPurged = false
  try {
    await enforceRateLimit(request, 'account-delete', 5)
    const body = await readJson(request)
    if (body.confirmation !== confirmationPhrase) {
      return errorResponse(new Error(`Type ${confirmationPhrase} to confirm account deletion.`), 400)
    }
    const password = validatePassword(body.password)
    const service = serviceClient()
    const token = accessToken(request)
    const { data: { user }, error: authError } = await service.auth.getUser(token)
    if (authError || !user) return errorResponse(new Error('Sign in again before deleting your account.'), 401)

    const { data: administrator, error: roleError } = await service
      .from('administrators')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle()
    if (roleError) throw roleError
    if (administrator) {
      return errorResponse(new Error('Administrator accounts cannot be deleted from scholar account settings.'), 403)
    }
    if (!user.email) return errorResponse(new Error('This account cannot be reauthenticated.'), 401)

    const { error: passwordError } = await publicAuthClient().auth.signInWithPassword({
      email: user.email,
      password,
    })
    if (passwordError) return errorResponse(new Error('The current password could not be verified.'), 401)

    const objectPaths: string[] = []
    for (let offset = 0; ; offset += mediaPageSize) {
      const { data: media, error: mediaError } = await service
        .from('message_media')
        .select('object_path')
        .eq('sender_id', user.id)
        .range(offset, offset + mediaPageSize - 1)
      if (mediaError) throw mediaError
      objectPaths.push(...(media ?? []).map((item) => item.object_path))
      if (!media || media.length < mediaPageSize) break
    }

    const avatarPaths: string[] = []
    for (let offset = 0; ; offset += avatarPageSize) {
      const { data: files, error: avatarError } = await service.storage
        .from('isomo-profile-avatars')
        .list(user.id, { limit: avatarPageSize, offset })
      if (avatarError) throw avatarError
      avatarPaths.push(...(files ?? [])
        .filter((file) => file.id !== null)
        .map((file) => `${user.id}/${file.name}`))
      if (!files || files.length < avatarPageSize) break
    }

    for (let offset = 0; offset < objectPaths.length; offset += storageBatchSize) {
      const { error: storageError } = await service.storage
        .from('isomo-chat-media')
        .remove(objectPaths.slice(offset, offset + storageBatchSize))
      if (storageError) throw new Error('Some account media could not be removed. Retry account deletion.')
    }
    for (let offset = 0; offset < avatarPaths.length; offset += storageBatchSize) {
      const { error: avatarStorageError } = await service.storage
        .from('isomo-profile-avatars')
        .remove(avatarPaths.slice(offset, offset + storageBatchSize))
      if (avatarStorageError) throw new Error('The profile photo could not be removed. Retry account deletion.')
    }

    deletionRequestId = crypto.randomUUID()
    const { error: purgeError } = await service.rpc('purge_account_content', {
      p_user_id: user.id,
      p_request_id: deletionRequestId,
    })
    if (purgeError) throw purgeError
    contentPurged = true

    const { error: deleteError } = await service.auth.admin.deleteUser(user.id)
    if (deleteError) {
      console.error('Account content was removed, but Auth account deletion failed.', {
        deletionRequestId,
        error: deleteError.message,
      })
      return errorResponse(
        new Error('Your messages and media were removed, but the account could not be deactivated. Retry or contact support.'),
        502,
      )
    }

    const { error: auditError } = await service.rpc('complete_account_deletion', {
      p_request_id: deletionRequestId,
    })
    if (auditError) {
      console.error('Account was deleted, but the privacy-preserving audit record could not be completed.', {
        deletionRequestId,
        error: auditError.message,
      })
    }
    return jsonResponse({ deleted: true, auditPending: Boolean(auditError) })
  } catch (error) {
    if (error instanceof RateLimitError) return errorResponse(error, 429)
    console.error('Account deletion failed.', {
      deletionRequestId,
      contentPurged,
      error: error instanceof Error ? error.message : error,
    })
    return errorResponse(
      new Error(contentPurged
        ? 'Your messages and media were removed, but account deletion did not finish. Retry or contact support.'
        : 'Account deletion could not be completed. Your account is still active; retry or contact support.'),
      500,
    )
  }
})
