import { serviceClient } from '../_shared/supabase.ts'

function jsonResponse(message: string, status = 200) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

function hasValidSecret(request: Request) {
  const expected = Deno.env.get('MEDIA_CLEANUP_SECRET')
  const supplied = request.headers.get('x-media-cleanup-secret')
  if (!expected || !supplied || expected.length !== supplied.length) return false
  let mismatch = 0
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ supplied.charCodeAt(index)
  }
  return mismatch === 0
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return jsonResponse('Method not allowed.', 405)
  if (!hasValidSecret(request)) return jsonResponse('Not authorized.', 401)

  try {
    const service = serviceClient()
    const { data: candidates, error: candidateError } = await service.rpc(
      'get_message_media_cleanup_candidates',
      { p_limit: 100 },
    )
    if (candidateError) throw candidateError
    let removed = 0
    for (const { message_id: messageId, object_path: objectPath } of candidates ?? []) {
      const { error: storageError } = await service.storage.from('isomo-chat-media').remove([objectPath])
      if (storageError) {
        console.error('Could not remove expired or consumed media object.', { messageId, storageError })
        continue
      }
      const { error: metadataError } = await service.rpc('delete_cleaned_message_media', {
        p_message_ids: [messageId],
      })
      if (metadataError) {
        console.error('Could not remove cleaned media metadata.', { messageId, metadataError })
        continue
      }
      removed += 1
    }

    return jsonResponse(`Removed ${removed} media item(s).`)
  } catch (error) {
    console.error('Media cleanup failed.', error)
    return jsonResponse('Media cleanup failed.', 500)
  }
})
