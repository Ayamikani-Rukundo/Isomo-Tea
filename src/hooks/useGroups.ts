import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { COMMUNITY_AVATAR_BUCKET } from '../lib/community'
import { resolveProfileAvatarUrls } from '../lib/profileAvatars'
import { requireSupabase } from '../lib/supabase'
import type { GroupConversationSummary, GroupMember } from '../types'

type GroupListState = {
  ownerId: string
  groups: GroupConversationSummary[]
  loading: boolean
  error: string
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Groups could not be loaded.'
}

export function useGroups(session: Session | null, enabled: boolean) {
  const [state, setState] = useState<GroupListState | null>(null)
  const userId = session?.user.id
  const latestUserId = useRef(userId)
  const requestVersion = useRef(0)
  latestUserId.current = userId
  const isCurrent = Boolean(enabled && userId && state?.ownerId === userId)

  const refresh = useCallback(async () => {
    if (!userId) return false
    const requestUserId = userId
    const requestId = ++requestVersion.current
    try {
      const client = requireSupabase()
      const { data, error } = await client.rpc('get_group_conversation_list')
      if (error) throw error
      const paths = [...new Set(data.flatMap((group) => group.avatar_path ? [group.avatar_path] : []))]
      const avatarUrls = await Promise.all(paths.map(async (path) => {
        const { data: signed, error: signedError } = await client.storage
          .from(COMMUNITY_AVATAR_BUCKET)
          .createSignedUrl(path, 86_400)
        if (signedError) throw signedError
        if (!signed?.signedUrl) throw new Error('The group photo service returned an invalid URL.')
        return [path, signed.signedUrl] as const
      }))
      const urlByPath = new Map(avatarUrls)
      if (latestUserId.current !== requestUserId || requestVersion.current !== requestId) return false
      setState({
        ownerId: userId,
        groups: data.map((group) => ({
          conversationId: group.conversation_id,
          title: group.title?.trim() || 'Group',
          avatarPath: group.avatar_path,
          avatarUrl: group.avatar_path ? urlByPath.get(group.avatar_path) ?? '/delta-tea-avatar.png' : '/delta-tea-avatar.png',
          latestMessage: group.latest_message,
          latestMessageAt: group.latest_message_at,
          unreadCount: group.unread_count,
          memberCount: group.member_count,
          myRole: group.my_role,
          deletionPending: group.deletion_pending,
        })),
        loading: false,
        error: '',
      })
      return true
    } catch (error) {
      if (latestUserId.current !== requestUserId || requestVersion.current !== requestId) return false
      console.error('Could not load groups.', error)
      setState((current) => ({
        ownerId: userId,
        groups: current?.ownerId === userId ? current.groups : [],
        loading: false,
        error: errorText(error),
      }))
      return false
    }
  }, [userId])

  useEffect(() => {
    if (!enabled || !userId) return undefined
    const client = requireSupabase()
    let active = true
    let timer: number | undefined
    const scheduleRefresh = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (active) void refresh()
      }, 120)
    }

    setState((current) => ({
      ownerId: userId,
      groups: current?.ownerId === userId ? current.groups : [],
      loading: true,
      error: '',
    }))
    const channel = client
      .channel(`groups:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members', filter: `user_id=eq.${userId}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, scheduleRefresh)
      .subscribe(() => {
        if (active) void refresh()
      })
    void refresh()

    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
      void client.removeChannel(channel)
    }
  }, [enabled, refresh, userId])

  const createGroup = useCallback(async (title: string) => {
    const client = requireSupabase()
    const { data, error } = await client.rpc('create_group_conversation', { p_title: title })
    if (error) throw error
    if (!data) throw new Error('The group service returned an invalid conversation.')
    await refresh()
    return data
  }, [refresh])

  const deleteConversation = useCallback(async (conversationId: string) => {
    const { data, error } = await requireSupabase().functions.invoke<{ deleted: boolean }>('delete-conversation', {
      body: { conversationId },
    })
    if (error) {
      if (error.context instanceof Response) {
        const payload = await error.context.json().catch(() => null) as { error?: string } | null
        throw new Error(payload?.error ?? error.message)
      }
      throw new Error(error.message)
    }
    if (!data?.deleted) throw new Error('The group deletion service returned an invalid response.')
    setState((current) => current?.ownerId === userId
      ? { ...current, groups: current.groups.filter((group) => group.conversationId !== conversationId) }
      : current)
  }, [userId])

  const leaveGroup = useCallback(async (conversationId: string) => {
    const { error } = await requireSupabase().rpc('leave_group', { p_conversation_id: conversationId })
    if (error) throw error
    setState((current) => current?.ownerId === userId
      ? { ...current, groups: current.groups.filter((group) => group.conversationId !== conversationId) }
      : current)
  }, [userId])

  const joinByInvite = useCallback(async (token: string) => {
    const { data, error } = await requireSupabase().rpc('join_group_by_invite', { p_token: token })
    if (error) throw error
    if (!data) throw new Error('The invite service returned an invalid group.')
    await refresh()
    return data
  }, [refresh])

  return {
    groups: isCurrent ? state.groups : [],
    loading: enabled && Boolean(userId) && (!isCurrent || state.loading),
    error: isCurrent ? state.error : '',
    refresh,
    createGroup,
    deleteConversation,
    leaveGroup,
    joinByInvite,
  }
}

export function useGroupMembers(session: Session | null, conversationId: string | null, enabled: boolean) {
  const [state, setState] = useState<{
    conversationId: string
    members: GroupMember[]
    loading: boolean
    error: string
  } | null>(null)
  const requestVersion = useRef(0)
  const isCurrent = Boolean(enabled && conversationId && state?.conversationId === conversationId)

  const refresh = useCallback(async () => {
    if (!conversationId || !session?.user.id) return
    const requestId = ++requestVersion.current
    setState((current) => ({
      conversationId,
      members: current?.conversationId === conversationId ? current.members : [],
      loading: true,
      error: '',
    }))
    try {
      const { data, error: membersError } = await requireSupabase().rpc('get_group_members', {
        p_conversation_id: conversationId,
      })
      if (membersError) throw membersError
      const avatarUrls = await resolveProfileAvatarUrls(data.map((member) => member.avatar_url))
      if (requestVersion.current !== requestId) return
      const members = data.map((member, index) => {
        const avatarUrl = member.avatar_url ? avatarUrls.get(member.avatar_url) ?? null : null
        const initials = member.username.slice(0, 2).toUpperCase()
        return {
          id: member.user_id,
          username: member.username,
          avatarUrl,
          initials,
          color: ['green', 'coral', 'purple', 'blue'][index % 4],
          status: 'offline',
          admin: member.role === 'admin',
          role: member.role,
        }
      })
      setState({ conversationId, members, loading: false, error: '' })
    } catch (loadError) {
      if (requestVersion.current !== requestId) return
      console.error('Could not load group members.', loadError)
      setState((current) => ({
        conversationId,
        members: current?.conversationId === conversationId ? current.members : [],
        loading: false,
        error: errorText(loadError),
      }))
    } finally {
      if (requestVersion.current === requestId) {
        setState((current) => current?.conversationId === conversationId
          ? { ...current, loading: false }
          : current)
      }
    }
  }, [conversationId, session?.user.id])

  useEffect(() => {
    if (!enabled || !conversationId) return undefined
    const client = requireSupabase()
    const channel = client
      .channel(`group-members:${conversationId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'conversation_members',
        filter: `conversation_id=eq.${conversationId}`,
      }, () => { void refresh() })
      .subscribe()
    void refresh()
    return () => { void client.removeChannel(channel) }
  }, [conversationId, enabled, refresh])

  return {
    members: isCurrent ? state?.members ?? [] : [],
    loading: enabled && Boolean(conversationId) && (!isCurrent || state?.loading === true),
    error: isCurrent ? state?.error ?? '' : '',
    refresh,
  }
}
