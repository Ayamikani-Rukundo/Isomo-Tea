import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { requireSupabase } from '../lib/supabase'
import type { PrivateConversationSummary } from '../types'
import { resolveProfileAvatarUrls } from '../lib/profileAvatars'

type InboxState = {
  ownerId: string
  conversations: PrivateConversationSummary[]
  loading: boolean
  error: string
  connectionStatus: 'connecting' | 'connected' | 'disconnected'
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Private conversations could not be loaded.'
}

export function usePrivateInbox(session: Session | null, enabled: boolean) {
  const [state, setState] = useState<InboxState | null>(null)
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
      const { data, error } = await requireSupabase().rpc('get_private_conversation_list')
      if (error) throw error
      const avatarUrls = await resolveProfileAvatarUrls(data.map((row) => row.peer_avatar_url))
      if (latestUserId.current !== requestUserId || requestVersion.current !== requestId) return false
      const conversations: PrivateConversationSummary[] = data.map((row) => ({
        conversationId: row.conversation_id,
        peerId: row.peer_id,
        peerUsername: row.peer_username,
        peerAvatarUrl: row.peer_avatar_url ? avatarUrls.get(row.peer_avatar_url) ?? null : null,
        latestMessage: row.latest_message,
        latestMessageAt: row.latest_message_at,
        unreadCount: row.unread_count,
        lastReadAt: row.last_read_at,
      }))
      setState((current) => ({
        ownerId: userId,
        conversations,
        loading: false,
        error: '',
        connectionStatus: current?.ownerId === userId ? current.connectionStatus : 'connecting',
      }))
      return true
    } catch (error) {
      if (latestUserId.current !== requestUserId || requestVersion.current !== requestId) return false
      console.error('Could not load the private conversation list.', error)
      setState((current) => ({
        ownerId: userId,
        conversations: current?.ownerId === userId ? current.conversations : [],
        loading: false,
        error: errorText(error),
        connectionStatus: current?.ownerId === userId ? current.connectionStatus : 'disconnected',
      }))
      return false
    }
  }, [userId])

  useEffect(() => {
    if (!enabled || !userId) return undefined
    const client = requireSupabase()
    let active = true
    let timer: number | undefined
    let channel: ReturnType<typeof client.channel> | null = null
    setState((current) => ({
      ownerId: userId,
      conversations: current?.ownerId === userId ? current.conversations : [],
      loading: true,
      error: '',
      connectionStatus: 'connecting',
    }))

    const scheduleRefresh = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (active) void refresh()
      }, 120)
    }

    channel = client
      .channel(`private-inbox:${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'messages',
      }, scheduleRefresh)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'conversation_members',
        filter: `user_id=eq.${userId}`,
      }, scheduleRefresh)
      .subscribe((status) => {
        if (!active) return
        if (status === 'SUBSCRIBED') {
          setState((current) => current?.ownerId === userId
            ? { ...current, connectionStatus: 'connected' }
            : current)
          void refresh()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setState((current) => current?.ownerId === userId
            ? { ...current, connectionStatus: 'disconnected' }
            : current)
        }
      })
    void refresh()

    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
      if (channel) void client.removeChannel(channel)
    }
  }, [enabled, refresh, userId])

  const hideConversation = useCallback(async (conversationId: string) => {
    if (!userId) return false
    const requestUserId = userId
    try {
      const { error } = await requireSupabase().rpc('hide_private_conversation', {
        p_conversation_id: conversationId,
      })
      if (error) throw error
      if (latestUserId.current !== requestUserId) return false
      setState((current) => current?.ownerId === userId
        ? {
            ...current,
            conversations: current.conversations.filter((item) => item.conversationId !== conversationId),
            error: '',
          }
        : current)
      return true
    } catch (error) {
      if (latestUserId.current !== requestUserId) return false
      console.error('Could not hide the private conversation.', error)
      setState((current) => current?.ownerId === userId
        ? { ...current, error: errorText(error) }
        : current)
      return false
    }
  }, [userId])

  return {
    conversations: isCurrent ? state.conversations : [],
    loading: enabled && Boolean(userId) && (!isCurrent || state.loading),
    error: isCurrent ? state.error : '',
    connectionStatus: isCurrent ? state.connectionStatus : 'connecting',
    refresh,
    hideConversation,
  }
}
