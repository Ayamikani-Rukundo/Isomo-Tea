import { corsHeaders, errorResponse, isOptions, jsonResponse, readJson } from '../_shared/http.ts'
import { enforceRateLimit, RateLimitError } from '../_shared/rate-limit.ts'
import { accessToken, serviceClient } from '../_shared/supabase.ts'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const pageSize = 500
const storageBatchSize = 100

Deno.serve(async (request) => {
  if (isOptions(request)) return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return errorResponse(new Error('Method not allowed.'), 405)

  try {
    await enforceRateLimit(request, 'delete-conversation', 10)
    const body = await readJson(request)
    if (typeof body.conversationId !== 'string' || !uuidPattern.test(body.conversationId)) {
      return errorResponse(new Error('Choose a valid conversation.'), 400)
    }

    const service = serviceClient()
    const { data: { user }, error: authError } = await service.auth.getUser(accessToken(request))
    if (authError || !user) return errorResponse(new Error('Sign in again before deleting this conversation.'), 401)

    const { data: deletion, error: startError } = await service.rpc('start_conversation_deletion', {
      p_conversation_id: body.conversationId,
      p_actor_id: user.id,
    })
    if (startError) throw startError
    if (!deletion) return jsonResponse({ deleted: true, alreadyDeleted: true })
    if (typeof deletion.job_id !== 'string' || !['private', 'group'].includes(deletion.kind)) {
      throw new Error('The conversation deletion service returned an invalid job.')
    }

    const { data: job, error: jobError } = await service
      .from('conversation_deletion_jobs')
      .select('avatar_path')
      .eq('id', deletion.job_id)
      .single()
    if (jobError) throw jobError

    for (let offset = 0; ; offset += pageSize) {
      const { data: media, error: mediaError } = await service
        .from('conversation_deletion_media')
        .select('object_path')
        .eq('job_id', deletion.job_id)
        .order('object_path')
        .range(offset, offset + pageSize - 1)
      if (mediaError) throw mediaError
      if (!media?.length) break

      const paths = media.map((item) => item.object_path)
      for (let batchOffset = 0; batchOffset < paths.length; batchOffset += storageBatchSize) {
        const { error: storageError } = await service.storage
          .from('isomo-chat-media')
          .remove(paths.slice(batchOffset, batchOffset + storageBatchSize))
        if (storageError) throw new Error('Conversation media could not be removed. Retry the deletion.')
      }
      if (media.length < pageSize) break
    }

    if (job.avatar_path) {
      const { error: avatarError } = await service.storage
        .from('isomo-community-assets')
        .remove([job.avatar_path])
      if (avatarError) throw new Error('The group photo could not be removed. Retry the deletion.')
    }

    const { data: deleted, error: completeError } = await service.rpc('complete_conversation_deletion', {
      p_job_id: deletion.job_id,
      p_actor_id: user.id,
    })
    if (completeError) throw completeError
    if (!deleted) throw new Error('The conversation deletion could not be completed.')

    return jsonResponse({ deleted: true })
  } catch (error) {
    if (error instanceof RateLimitError) return errorResponse(error, 429)
    console.error('Conversation deletion failed.', error)
    return errorResponse(error, 500)
  }
})
