import { accessToken, serviceClient } from '../_shared/supabase.ts'
import { corsHeaders, isOptions } from '../_shared/http.ts'

const bucket = 'isomo-chat-media'
const jsonHeaders = { ...corsHeaders, 'Cache-Control': 'no-store' }

function jsonResponse(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...jsonHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  if (isOptions(request)) return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse('Method not allowed.', 405)

  try {
    const service = serviceClient()
    const token = accessToken(request)
    const { data: { user }, error: authError } = await service.auth.getUser(token)
    if (authError || !user) return jsonResponse('Authentication required.', 401)

    const rawBody = await request.text()
    if (rawBody.length > 4096) return jsonResponse('Request is too large.', 413)
    let body: unknown
    try {
      body = JSON.parse(rawBody)
    } catch {
      return jsonResponse('Request body must be valid JSON.', 400)
    }
    if (
      typeof body !== 'object'
      || body === null
      || !('messageId' in body)
      || typeof body.messageId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.messageId)
    ) return jsonResponse('A valid message ID is required.', 400)

    const { data: media, error: mediaError } = await service
      .from('message_media')
      .select('message_id,conversation_id,sender_id,object_path,media_kind,mime_type,view_once,expires_at')
      .eq('message_id', body.messageId)
      .maybeSingle()
    if (mediaError) throw mediaError
    if (!media) return jsonResponse('Media is unavailable.', 404)

    const [
      { data: message, error: messageError },
      { data: membership, error: membershipError },
      { data: hidden, error: hiddenError },
    ] = await Promise.all([
      service.from('messages')
        .select('deleted_at')
        .eq('id', media.message_id)
        .eq('conversation_id', media.conversation_id)
        .maybeSingle(),
      service.from('conversation_members')
        .select('user_id')
        .eq('conversation_id', media.conversation_id)
        .eq('user_id', user.id)
        .maybeSingle(),
      service.from('message_hidden_for_users')
        .select('message_id')
        .eq('message_id', media.message_id)
        .eq('user_id', user.id)
        .maybeSingle(),
    ])
    if (messageError) throw messageError
    if (membershipError) throw membershipError
    if (hiddenError) throw hiddenError
    if (!message || message.deleted_at || !membership || hidden) {
      return jsonResponse('Media is unavailable to this account.', 404)
    }

    let objectPath = media.object_path
    let claimId: string | null = null
    if (media.view_once) {
      const { data, error } = await service.rpc('claim_view_once_media', {
        p_message_id: media.message_id,
        p_user_id: user.id,
      })
      if (error) throw error
      const consumed = Array.isArray(data) ? data[0] : null
      if (!consumed) return jsonResponse('This view-once media has expired or was already opened.', 410)
      objectPath = consumed.object_path
      claimId = consumed.claim_id
    }

    const { data: file, error: downloadError } = await service.storage.from(bucket).download(objectPath)
    if (downloadError || !file) {
      console.error('Media object could not be retrieved.', downloadError)
      return jsonResponse('Media could not be retrieved.', 502)
    }
    if (media.view_once && claimId) {
      const { data: completed, error: completionError } = await service.rpc('complete_view_once_media', {
        p_message_id: media.message_id,
        p_user_id: user.id,
        p_claim_id: claimId,
      })
      if (completionError) throw completionError
      if (completed !== true) return jsonResponse('This view-once media could not be opened.', 410)
    } else if (media.view_once) {
      return jsonResponse('This view-once media could not be opened.', 410)
    }

    return new Response(file.stream(), {
      headers: {
        ...corsHeaders,
        'Content-Type': media.mime_type,
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
        'X-Content-Type-Options': 'nosniff',
        'Content-Length': String(file.size),
      },
    })
  } catch (error) {
    console.error('Media access request failed.', error)
    return jsonResponse('Media access could not be completed.', 500)
  }
})
