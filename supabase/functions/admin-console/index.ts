import { corsHeaders, isOptions } from '../_shared/http.ts'
import { requireAdministrator } from '../_shared/supabase.ts'

const communityAvatarBucket = 'isomo-community-assets'
type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
  })
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function validIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function validCommunityAvatarPath(value: unknown, userId: string): value is string {
  return typeof value === 'string'
    && new RegExp(`^${userId}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(jpg|png|webp)$`, 'i').test(value)
}

async function writeAudit(
  service: Awaited<ReturnType<typeof requireAdministrator>>['service'],
  actorId: string,
  action: string,
  targetUserId: string | null = null,
  details: JsonRecord = {},
) {
  const { error } = await service.from('admin_audit_log').insert({
    actor_id: actorId,
    action,
    target_user_id: targetUserId,
    details,
  })
  if (error) throw error
}

Deno.serve(async (request) => {
  if (isOptions(request)) return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return response({ error: 'Method not allowed.' }, 405)

  let action = 'authorize'
  try {
    const { service, user } = await requireAdministrator(request)
    const rawBody = await request.text()
    if (rawBody.length > 8192) return response({ error: 'Request is too large.' }, 413)

    let body: unknown
    try {
      body = JSON.parse(rawBody)
    } catch {
      return response({ error: 'Request body must be valid JSON.' }, 400)
    }
    if (!isRecord(body) || typeof body.action !== 'string') {
      return response({ error: 'Choose a valid administrator action.' }, 400)
    }
    action = body.action

    if (action === 'overview') {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const [
        { count: members, error: membersError },
        { count: administrators, error: administratorsError },
        { count: messages, error: messagesError },
        { count: activeCodes, error: codesError },
        { count: recentMembers, error: recentMembersError },
      ] = await Promise.all([
        service.from('profiles').select('id', { count: 'exact', head: true }),
        service.from('administrators').select('user_id', { count: 'exact', head: true }),
        service.from('messages').select('id', { count: 'exact', head: true }).is('deleted_at', null),
        service.from('access_codes').select('id', { count: 'exact', head: true }).eq('active', true),
        service.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', since),
      ])
      const error = membersError ?? administratorsError ?? messagesError ?? codesError ?? recentMembersError
      if (error) throw error
      return response({ overview: { members, administrators, messages, activeCodes, recentMembers } })
    }

    if (action === 'update-community-settings') {
      if (typeof body.title !== 'string' || body.title.trim().length < 1 || body.title.trim().length > 40) {
        return response({ error: 'The group name must be 1-40 characters.' }, 400)
      }
      if (body.avatarPath !== null && typeof body.avatarPath !== 'string') {
        return response({ error: 'Choose a valid uploaded group photo.' }, 400)
      }
      const avatarPath = typeof body.avatarPath === 'string' ? body.avatarPath : null
      const { data: currentCommunity, error: currentCommunityError } = await service
        .from('conversations')
        .select('avatar_path')
        .eq('kind', 'general')
        .maybeSingle()
      if (currentCommunityError) throw currentCommunityError
      if (!currentCommunity) return response({ error: 'The community conversation was not found.' }, 404)
      const photoChanged = currentCommunity.avatar_path !== avatarPath
      if (photoChanged && avatarPath && !validCommunityAvatarPath(avatarPath, user.id)) {
        return response({ error: 'Choose a valid uploaded group photo.' }, 400)
      }
      if (photoChanged && avatarPath) {
        const fileName = avatarPath.slice(user.id.length + 1)
        const { data: objects, error: listError } = await service.storage
          .from(communityAvatarBucket)
          .list(user.id, { search: fileName, limit: 100 })
        if (listError) throw listError
        if (!objects?.some((object) => object.name === fileName)) {
          return response({ error: 'The uploaded group photo could not be found.' }, 400)
        }
      }

      const { data: updateResult, error: updateError } = await service.rpc('admin_update_general_conversation', {
        p_title: body.title.trim(),
        p_avatar_path: avatarPath,
        p_actor_id: user.id,
      })
      if (updateError) throw updateError

      const previousAvatarPath = isRecord(updateResult)
        && typeof updateResult.previous_avatar_path === 'string'
        ? updateResult.previous_avatar_path
        : null
      if (previousAvatarPath && previousAvatarPath !== avatarPath) {
        const { error: cleanupError } = await service.storage
          .from(communityAvatarBucket)
          .remove([previousAvatarPath])
        if (cleanupError) {
          console.error('The previous community photo could not be removed.', cleanupError)
          return response({
            updated: true,
            cleanupWarning: 'The group settings were saved, but the previous photo could not be deleted from storage.',
          })
        }
      }
      return response({ updated: true, cleanupWarning: null })
    }

    if (action === 'members') {
      const offset = typeof body.offset === 'number' && Number.isSafeInteger(body.offset) && body.offset >= 0
        ? Math.min(body.offset, 100000)
        : 0
      const { data: profiles, error: profilesError } = await service
        .from('profiles')
        .select('id,username,created_at')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + 99)
      if (profilesError) throw profilesError

      const { data: users, error: usersError } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 })
      if (usersError) throw usersError
      const userById = new Map(users.users.map((account) => [account.id, account]))
      const memberRows = (profiles ?? []).map((profile) => ({
        ...profile,
        suspended: Boolean(userById.get(profile.id)?.banned_until
          && new Date(userById.get(profile.id)?.banned_until ?? 0).getTime() > Date.now()),
      }))
      return response({
        members: memberRows,
        hasMore: (profiles ?? []).length === 100,
        nextOffset: offset + memberRows.length,
      })
    }

    if (action === 'set-member-access') {
      if (!validUuid(body.userId) || typeof body.active !== 'boolean') {
        return response({ error: 'Choose a valid member and access status.' }, 400)
      }
      const { data: target, error: profileError } = await service
        .from('profiles')
        .select('id')
        .eq('id', body.userId)
        .maybeSingle()
      if (profileError) throw profileError
      if (!target) return response({ error: 'The member was not found.' }, 404)
      const { data: administrator, error: administratorError } = await service
        .from('administrators')
        .select('user_id')
        .eq('user_id', body.userId)
        .maybeSingle()
      if (administratorError) throw administratorError
      if (administrator) return response({ error: 'Manage administrator access separately.' }, 409)

      const { error: updateError } = await service.auth.admin.updateUserById(body.userId, {
        ban_duration: body.active ? 'none' : '876000h',
      })
      if (updateError) throw updateError
      await writeAudit(service, user.id, body.active ? 'member.access_restored' : 'member.access_suspended', body.userId)
      return response({ updated: true })
    }

    if (action === 'administrators') {
      const { data: roles, error: rolesError } = await service
        .from('administrators')
        .select('user_id,created_at,created_by')
        .order('created_at', { ascending: true })
      if (rolesError) throw rolesError
      const ids = (roles ?? []).map((role) => role.user_id)
      const { data: profiles, error: profilesError } = ids.length
        ? await service.from('profiles').select('id,username').in('id', ids)
        : { data: [], error: null }
      if (profilesError) throw profilesError
      const profilesById = new Map((profiles ?? []).map((profile) => [profile.id, profile]))
      return response({
        administrators: (roles ?? []).map((role) => ({
          ...role,
          username: profilesById.get(role.user_id)?.username ?? 'profile unavailable',
        })),
      })
    }

    if (action === 'general-messages') {
      const { data: room, error: roomError } = await service
        .from('conversations')
        .select('id')
        .eq('kind', 'general')
        .maybeSingle()
      if (roomError) throw roomError
      if (!room) return response({ messages: [] })

      const { data: messages, error: messagesError } = await service
        .from('messages')
        .select('id,body,sender_id,created_at')
        .eq('conversation_id', room.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(50)
      if (messagesError) throw messagesError
      const senderIds = [...new Set((messages ?? [])
        .map((message) => message.sender_id)
        .filter((id): id is string => Boolean(id)))]
      const { data: profiles, error: profilesError } = senderIds.length
        ? await service.from('profiles').select('id,username').in('id', senderIds)
        : { data: [], error: null }
      if (profilesError) throw profilesError
      const usernameById = new Map((profiles ?? []).map((profile) => [profile.id, profile.username]))
      return response({
        messages: (messages ?? []).map((message) => ({
          ...message,
          author: message.sender_id ? usernameById.get(message.sender_id) ?? 'former member' : 'former member',
        })),
      })
    }

    if (action === 'remove-administrator') {
      if (!validUuid(body.userId)) return response({ error: 'Choose a valid administrator.' }, 400)
      const { error: removeError } = await service.rpc('admin_remove_administrator', {
        p_target_id: body.userId,
        p_actor_id: user.id,
      })
      if (removeError) throw removeError
      return response({ removed: true })
    }

    if (action === 'delete-message') {
      if (!validUuid(body.messageId)) return response({ error: 'Choose a valid message.' }, 400)
      const { error: deleteError } = await service.rpc('admin_delete_message', {
        p_message_id: body.messageId,
        p_actor_id: user.id,
      })
      if (deleteError) throw deleteError
      return response({ deleted: true })
    }

    if (action === 'clear-history') {
      if (!validIsoDate(body.startAt) || !validIsoDate(body.endAt) || Date.parse(body.startAt) >= Date.parse(body.endAt)) {
        return response({ error: 'Choose a valid start and end date.' }, 400)
      }
      const { data, error: clearError } = await service.rpc('admin_clear_message_history', {
        p_start_at: new Date(body.startAt).toISOString(),
        p_end_at: new Date(body.endAt).toISOString(),
        p_actor_id: user.id,
      })
      if (clearError) throw clearError
      return response({ clearedCount: data })
    }

    if (action === 'audit-log') {
      const { data, error: auditError } = await service
        .from('admin_audit_log')
        .select('id,actor_id,action,target_user_id,target_message_id,details,created_at')
        .order('created_at', { ascending: false })
        .limit(100)
      if (auditError) throw auditError
      return response({ entries: data ?? [] })
    }

    return response({ error: 'Choose a valid administrator action.' }, 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const status = message === 'Authentication required.' ? 401
      : message === 'Administrator access is required.' ? 403
        : 500
    console.error('Administrator console operation failed.', {
      action,
      message: error instanceof Error ? error.message : 'unknown error',
    })
    return response({
      error: status < 500 ? message : 'The administrator request could not be completed.',
    }, status)
  }
})
