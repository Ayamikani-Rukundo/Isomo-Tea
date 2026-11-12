import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { requireSupabase } from '../lib/supabase'
import type { PublicProfile } from '../lib/auth'
import type { Database } from '../lib/database.types'
import type { DemoMessage, MentionNotification, MessageReaction } from '../types'
import { getStickerOption } from '../lib/stickers'
import { resolveProfileAvatarUrls } from '../lib/profileAvatars'
import {
  extensionForMediaType,
  MAX_MEDIA_BYTES,
  mediaKindFor,
  normalizeMediaType,
  loadQueuedMedia,
  removeQueuedMedia,
  requestMessageMedia,
  saveQueuedMedia,
  uploadMedia,
  type QueuedMedia,
} from '../lib/media'

const PAGE_SIZE = 50
const avatarColors = ['coral', 'purple', 'blue', 'gold', 'green', 'pink']
const messageColumns = 'id,conversation_id,sender_id,body,system_event,reply_to_id,media_group_id,created_at,updated_at,deleted_at'
type MessageRow = Database['public']['Tables']['messages']['Row']
type ProfileRow = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'username' | 'avatar_url'> & {
  avatarUrl?: string | null
}
type PendingMessage = { id: string; conversationId: string; body: string; replyToId?: string }
type PendingMediaMessage = PendingMessage & {
  file: File
  mimeType: string
  viewOnce: boolean
  mediaGroupId?: string
}
type PersistedPendingMessage = { id: string; conversationId: string; body: string; replyToId?: string }
type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected'
type ConversationKind = 'general' | 'private'

function isMessageRow(value: unknown): value is MessageRow {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return typeof row.id === 'string'
    && typeof row.conversation_id === 'string'
    && (typeof row.sender_id === 'string' || row.sender_id === null)
    && typeof row.body === 'string'
    && (row.system_event === null || row.system_event === 'username_changed')
    && (typeof row.reply_to_id === 'string' || row.reply_to_id === null)
    && typeof row.created_at === 'string'
    && typeof row.updated_at === 'string'
    && (typeof row.deleted_at === 'string' || row.deleted_at === null)
}

function colorFor(userId: string) {
  let hash = 0
  for (const character of userId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return avatarColors[hash % avatarColors.length]
}

function initialsFor(username: string) {
  return username
    .split(/[._]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('') || '?'
}

function toMessage(row: MessageRow, profile: ProfileRow | undefined, userId: string): DemoMessage {
  const author = profile?.username ?? 'former member'
  return {
    id: row.id,
    author: row.sender_id === userId ? 'you' : author,
    initials: row.sender_id === userId ? 'Y' : initialsFor(author),
    color: row.sender_id === userId ? 'self' : colorFor(row.sender_id ?? 'former-member'),
    avatarUrl: profile?.avatarUrl ?? null,
    body: row.deleted_at ? 'This message was deleted.' : row.body,
    time: new Date(row.created_at).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
    mine: row.sender_id === userId,
    deliveryStatus: row.sender_id === userId ? 'sent' : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined,
    systemEvent: row.system_event ?? undefined,
    authorId: row.sender_id ?? undefined,
    replyToId: row.reply_to_id ?? undefined,
    mediaGroupId: row.media_group_id ?? undefined,
  }
}

function mergeMessages(current: DemoMessage[], incoming: DemoMessage[]) {
  const byId = new Map(current.map((message) => [message.id, message]))
  for (const message of incoming) {
    byId.set(message.id, { ...byId.get(message.id), ...message })
  }
  return [...byId.values()].sort((left, right) => {
    if (!left.createdAt || !right.createdAt) return 0
    const timeDifference = Date.parse(left.createdAt) - Date.parse(right.createdAt)
    return timeDifference || left.id.localeCompare(right.id)
  })
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'An unexpected chat error occurred.'
}

function outboxKey(userId: string, conversationId: string) {
  return `isomo-chat-outbox:${userId}:${conversationId}`
}

function readOutbox(userId: string, conversationId: string): PersistedPendingMessage[] {
  try {
    const raw = sessionStorage.getItem(outboxKey(userId, conversationId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('Pending message data is invalid.')
    return parsed.filter((item): item is PersistedPendingMessage => (
      typeof item === 'object'
      && item !== null
      && typeof item.id === 'string'
      && typeof item.conversationId === 'string'
      && item.conversationId === conversationId
      && typeof item.body === 'string'
      && (item.replyToId === undefined || typeof item.replyToId === 'string')
    ))
  } catch (error) {
    console.error('Could not restore pending messages from this browser tab.', error)
    return []
  }
}

function writeOutbox(userId: string, conversationId: string, messages: PersistedPendingMessage[]) {
  try {
    const key = outboxKey(userId, conversationId)
    if (messages.length) sessionStorage.setItem(key, JSON.stringify(messages))
    else sessionStorage.removeItem(key)
    return true
  } catch (error) {
    console.error('Could not preserve a pending message in this browser tab.', error)
    return false
  }
}

function summarizeReactions(
  rows: Array<{ message_id: string; user_id: string; emoji: string }>,
  userId: string,
) {
  const grouped = new Map<string, Map<string, MessageReaction>>()
  for (const row of rows) {
    let messageReactions = grouped.get(row.message_id)
    if (!messageReactions) {
      messageReactions = new Map()
      grouped.set(row.message_id, messageReactions)
    }
    const reaction = messageReactions.get(row.emoji) ?? { emoji: row.emoji, count: 0, reactedByMe: false }
    reaction.count += 1
    reaction.reactedByMe ||= row.user_id === userId
    messageReactions.set(row.emoji, reaction)
  }
  return new Map([...grouped].map(([messageId, reactions]) => [
    messageId,
    [...reactions.values()].sort((left, right) => left.emoji.localeCompare(right.emoji)),
  ]))
}

export function useConversationChat(
  session: Session | null,
  enabled: boolean,
  ownProfile: PublicProfile | null,
  kind: ConversationKind = 'general',
  participantId?: string,
  existingConversationId?: string,
) {
  const [messages, setMessages] = useState<DemoMessage[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle')
  const [recipientReadMarker, setRecipientReadMarker] = useState<{ owner: string; readAt: string | null } | null>(null)
  const [mentionNotifications, setMentionNotifications] = useState<{ owner: string; items: MentionNotification[] } | null>(null)
  const pendingMessages = useRef(new Map<string, PendingMessage>())
  const pendingMediaMessages = useRef(new Map<string, PendingMediaMessage>())
  const sendingIds = useRef(new Set<string>())
  const reactionOperations = useRef(new Set<string>())
  const pollOperations = useRef(new Set<string>())
  const pendingPollIds = useRef(new Map<string, string>())
  const pendingStickerIds = useRef(new Map<string, string>())
  const profilesRef = useRef(new Map<string, ProfileRow>())
  const activeUserId = useRef<string | null>(null)
  const activeConversationId = useRef<string | null>(null)
  const refreshLatestRef = useRef<((roomId: string) => Promise<void>) | null>(null)
  const channelRemovalRef = useRef<Promise<void> | null>(null)
  const contextKey = session
    ? `${kind}:${session.user.id}:${participantId ?? ''}:${existingConversationId ?? ''}`
    : ''

  useEffect(() => {
    let active = true
    const profiles = profilesRef.current
    profiles.clear()
    const userId = session?.user.id

    if (!enabled || !userId) {
      activeUserId.current = null
      activeConversationId.current = null
      return () => { active = false }
    }

    const client = requireSupabase()
    activeUserId.current = userId
    activeConversationId.current = null
    pendingMessages.current.clear()
    pendingMediaMessages.current.clear()
    sendingIds.current.clear()

    let channel: ReturnType<typeof client.channel> | null = null
    let needsCatchup = false

    async function refreshRecipientReadMarker(roomId: string) {
      if (kind !== 'private') return
      const { data, error: markerError } = await client
        .from('conversation_members')
        .select('user_id,last_read_at')
        .eq('conversation_id', roomId)
        .neq('user_id', userId)
      if (markerError) throw markerError
      const marker = data?.[0]?.last_read_at ?? null
      if (active && activeConversationId.current === roomId) {
        setRecipientReadMarker({ owner: contextKey, readAt: marker })
      }
    }

    async function markConversationRead(roomId: string) {
      if (kind !== 'private') return
      const { data, error: markerError } = await client.rpc('mark_conversation_read', {
        p_conversation_id: roomId,
      })
      if (markerError) throw markerError
      if (typeof data !== 'string') throw new Error('The chat service returned an invalid read marker.')
    }

    async function profilesFor(rows: MessageRow[]) {
      const missingIds = [...new Set(rows
        .map((row) => row.sender_id)
        .filter((id): id is string => Boolean(id) && !profiles.has(id)))]
      if (missingIds.length === 0) return

      const { data, error: profileError } = await client
        .from('profiles')
        .select('id, username, avatar_url')
        .in('id', missingIds)
      if (profileError) throw profileError
      const avatarUrls = await resolveProfileAvatarUrls(data.map((profile) => profile.avatar_url))
      for (const profile of data) {
        profiles.set(profile.id, {
          ...profile,
          avatarUrl: profile.avatar_url ? avatarUrls.get(profile.avatar_url) ?? null : null,
        })
      }
    }

    async function refreshMentionNotifications() {
      const { data: mentionRows, error: mentionsError } = await client
        .from('message_mentions')
        .select('message_id,conversation_id,mentioned_by,created_at,read_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(30)
      if (mentionsError) throw mentionsError
      const messageIds = [...new Set((mentionRows ?? []).map((mention) => mention.message_id))]
      const { data: mentionedMessages, error: messagesError } = messageIds.length
        ? await client.from('messages').select(messageColumns).in('id', messageIds)
        : { data: [], error: null }
      if (messagesError) throw messagesError
      const rows = mentionedMessages ?? []
      await profilesFor(rows)
      const messagesById = new Map(rows.map((row) => [row.id, row]))
      const notifications: MentionNotification[] = (mentionRows ?? []).map((mention) => {
        const message = messagesById.get(mention.message_id)
        return {
          messageId: mention.message_id,
          conversationId: mention.conversation_id,
          author: message?.sender_id
            ? profiles.get(message.sender_id)?.username ?? 'community member'
            : 'community member',
          body: message?.deleted_at ? 'This mentioned message was deleted.' : message?.body ?? 'Message unavailable.',
          createdAt: mention.created_at,
          readAt: mention.read_at,
        }
      })
      if (active) setMentionNotifications({ owner: contextKey, items: notifications })
    }

    async function mapRows(rows: MessageRow[], roomId: string) {
      const messageIds = rows.map((row) => row.id)
      const { data: mediaRows, error: mediaError } = messageIds.length
        ? await client
          .from('message_media')
          .select('message_id,media_kind,mime_type,byte_size,view_once,expires_at')
          .in('message_id', messageIds)
        : { data: [], error: null }
      if (mediaError) throw mediaError
      const mediaByMessageId = new Map((mediaRows ?? []).map((media) => [media.message_id, {
        kind: media.media_kind,
        mimeType: media.mime_type,
        byteSize: media.byte_size,
        viewOnce: media.view_once,
        expiresAt: media.expires_at,
      }]))
      const { data: pollRows, error: pollError } = messageIds.length
        ? await client
          .from('message_polls')
          .select('message_id,question,closes_at')
          .in('message_id', messageIds)
        : { data: [], error: null }
      if (pollError) throw pollError
      const pollIds = (pollRows ?? []).map((poll) => poll.message_id)
      const { data: optionRows, error: optionsError } = pollIds.length
        ? await client
          .from('poll_options')
          .select('id,message_id,label,position')
          .in('message_id', pollIds)
          .order('position')
        : { data: [], error: null }
      if (optionsError) throw optionsError
      const { data: pollResults, error: pollResultsError } = pollIds.length
        ? await client.rpc('get_poll_results', {
          p_conversation_id: roomId,
          p_message_ids: pollIds,
        })
        : { data: [], error: null }
      if (pollResultsError) throw pollResultsError
      const { data: stickerRows, error: stickerError } = messageIds.length
        ? await client
          .from('message_stickers')
          .select('message_id,sticker_code')
          .in('message_id', messageIds)
        : { data: [], error: null }
      if (stickerError) throw stickerError
      const pollsById = new Map((pollRows ?? []).map((poll) => {
        const options = (optionRows ?? [])
          .filter((option) => option.message_id === poll.message_id)
          .map((option) => {
            const result = (pollResults ?? []).find((item) => item.message_id === poll.message_id && item.option_id === option.id)
            return { id: option.id, label: option.label, votes: Number(result?.vote_count ?? 0) }
          })
        return [poll.message_id, {
          question: poll.question,
          options,
          myVote: (pollResults ?? []).find((item) => item.message_id === poll.message_id && item.my_vote)?.option_id ?? null,
          closesAt: poll.closes_at,
        }]
      }))
      const stickersById = new Map((stickerRows ?? []).map((sticker) => [
        sticker.message_id,
        getStickerOption(sticker.sticker_code)?.code ?? '',
      ]))
      const replyIds = [...new Set(rows
        .filter((row) => !row.deleted_at)
        .map((row) => row.reply_to_id)
        .filter((id): id is string => Boolean(id)))]
      let replies: MessageRow[] = []
      if (replyIds.length > 0) {
        const { data, error: repliesError } = await client
          .from('messages')
          .select(messageColumns)
          .eq('conversation_id', roomId)
          .is('deleted_at', null)
          .in('id', replyIds)
        if (repliesError) throw repliesError
        replies = data ?? []
      }
      await profilesFor([...rows, ...replies])
      const repliesById = new Map(replies.map((row) => [row.id, row]))
      return rows.map((row) => {
          const message = toMessage(row, row.sender_id ? profiles.get(row.sender_id) : undefined, userId)
          const parent = row.reply_to_id ? repliesById.get(row.reply_to_id) : undefined
          return {
            ...message,
            media: mediaByMessageId.get(row.id),
            poll: pollsById.get(row.id),
            sticker: stickersById.get(row.id),
            replyPreview: parent
              ? {
                  author: parent.sender_id ? profiles.get(parent.sender_id)?.username ?? 'former member' : 'former member',
                  body: parent.body,
                }
              : undefined,
          }
        })
    }

    async function reactionSummary(roomId: string) {
      const { data, error: reactionError } = await client
        .from('message_reactions')
        .select('message_id,user_id,emoji')
        .eq('conversation_id', roomId)
      if (reactionError) throw reactionError
      return summarizeReactions(data ?? [], userId)
    }

    async function refreshReactions(roomId: string) {
      const summary = await reactionSummary(roomId)
      if (!active || activeConversationId.current !== roomId) return
      setMessages((current) => current.map((message) => ({
        ...message,
        reactions: message.deletedAt ? [] : summary.get(message.id) ?? [],
      })))
    }

    async function reloadLatest(roomId: string) {
      const { data, error: refreshError } = await client
        .from('messages')
        .select(messageColumns)
        .eq('conversation_id', roomId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE_SIZE)
      if (refreshError) throw refreshError
      const rows = [...(data ?? [])].reverse()
      const mapped = await mapRows(rows, roomId)
      const summary = await reactionSummary(roomId)
      if (!active || activeConversationId.current !== roomId) return
      setMessages((current) => mergeMessages(current, mapped.map((message) => ({
        ...message,
        reactions: message.deletedAt ? [] : summary.get(message.id) ?? [],
      }))))
      setHasMore(rows.length === PAGE_SIZE)
    }
    refreshLatestRef.current = reloadLatest

    async function receiveRealtimeMessage(value: unknown, roomId: string) {
      const row = isMessageRow(value) ? value : null
      if (!active || !row || row.conversation_id !== roomId) return
      if (row.sender_id !== userId && kind === 'private') {
        void markConversationRead(roomId).catch((markerError) => {
          if (!active) return
          console.error('Could not update the private conversation read marker.', markerError)
          setError('The conversation was received, but its read status could not be updated.')
        })
      }
      try {
        const [message] = await mapRows([row], roomId)
        if (active && message) {
          setMessages((current) => mergeMessages(current, [{
            ...message,
            reactions: message.deletedAt ? [] : message.reactions,
          }]))
        }
      } catch (profileError) {
        console.error('Could not resolve a message author.', profileError)
        if (active) {
          setMessages((current) => mergeMessages(current, [
            toMessage(row, undefined, userId),
          ]))
        }
      }
    }

    async function load() {
      try {
        let roomId: string
        if (kind === 'general') {
          const { data: room, error: roomError } = await client
            .from('conversations')
            .select('id')
            .eq('kind', 'general')
            .maybeSingle()
          if (roomError) throw roomError
          if (!room) throw new Error('The Delta Tea conversation is unavailable to this account.')
          roomId = room.id
        } else {
          if (!participantId && !existingConversationId) {
            throw new Error('Select a community member or an existing private conversation.')
          }
          const { data: privateId, error: privateError } = existingConversationId
            ? await client.rpc('open_private_conversation', { p_conversation_id: existingConversationId })
            : await client.rpc('get_or_create_private_conversation', { p_other_user_id: participantId! })
          if (privateError) throw privateError
          if (typeof privateId !== 'string') throw new Error('The private conversation service returned an invalid conversation.')
          roomId = privateId
        }
        if (!active) return
        setMessages([])
        setLoadingEarlier(false)
        setHasMore(false)
        setLoading(true)
        setError('')
        setConnectionStatus('connecting')
        setOwnerId(contextKey)
        setConversationId(roomId)
        activeConversationId.current = roomId
        let queuedMessages: PersistedPendingMessage[] = []
        let queuedMedia: QueuedMedia[] = []
        if (kind === 'general' || kind === 'private') {
          queuedMessages = readOutbox(userId, roomId)
          try {
            queuedMedia = await loadQueuedMedia(userId, roomId)
          } catch (outboxError) {
            console.error('Could not restore queued media from this browser.', outboxError)
            setError(`Pending media could not be restored: ${errorText(outboxError)}`)
          }
          if (!active) return
          for (const pending of queuedMedia) {
            pendingMediaMessages.current.set(pending.id, {
              id: pending.id,
              conversationId: pending.conversationId,
              body: pending.body,
              replyToId: pending.replyToId,
              file: pending.file,
              mimeType: pending.mimeType,
              viewOnce: pending.viewOnce,
              mediaGroupId: pending.mediaGroupId,
            })
          }
          const queuedIds = [...queuedMessages, ...queuedMedia].map((message) => message.id)
          if (queuedIds.length) {
            for (const pending of queuedMessages) pendingMessages.current.set(pending.id, pending)
            const { data: confirmed, error: confirmError } = await client
              .from('messages')
              .select(messageColumns)
              .eq('conversation_id', roomId)
              .in('id', queuedIds)
            if (!active) return
            if (confirmError) {
              console.error('Could not confirm queued message delivery.', confirmError)
              setError('Some pending messages could not be confirmed. Retry safely to check their status.')
            } else {
              const confirmedById = new Map((confirmed ?? []).map((row) => [row.id, row]))
              queuedMessages = queuedMessages.filter((pending) => {
                const row = confirmedById.get(pending.id)
                const isConfirmed = (
                  row?.sender_id === userId
                  && row.conversation_id === roomId
                )
                if (isConfirmed && row.body === pending.body) return false
                return true
              })
              const confirmedMedia = queuedMedia.filter((pending) => {
                const row = confirmedById.get(pending.id)
                return row?.sender_id === userId && row.conversation_id === roomId
              })
              queuedMedia = queuedMedia.filter((pending) => !confirmedMedia.some((item) => item.id === pending.id))
              for (const item of confirmedMedia) {
                pendingMediaMessages.current.delete(item.id)
                void removeQueuedMedia(item.id).catch((cleanupError) => {
                  console.error('Could not clear a confirmed local media upload.', cleanupError)
                })
              }
              const persisted = readOutbox(userId, roomId)
                .filter((pending) => queuedMessages.some((queued) => queued.id === pending.id))
              writeOutbox(userId, roomId, persisted)
            }
          }
        }

        if (kind === 'private') await refreshRecipientReadMarker(roomId)
        if (!active) return
        if (channelRemovalRef.current) {
          const previousRemoval = channelRemovalRef.current
          try {
            await previousRemoval
          } catch (removalError) {
            if (!active) return
            console.error('The previous Realtime channel could not be removed.', removalError)
            setConnectionStatus('disconnected')
            setError('A previous live connection could not be closed. Reload the app before sending.')
            return
          }
          if (channelRemovalRef.current === previousRemoval) channelRemovalRef.current = null
        }
        if (!active) return

        channel = client
          .channel(`${kind}-chat:${roomId}`)
          .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `conversation_id=eq.${roomId}`,
          }, (payload) => {
            void receiveRealtimeMessage(payload.new, roomId)
          })
          .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'messages',
            filter: `conversation_id=eq.${roomId}`,
          }, (payload) => {
            void receiveRealtimeMessage(payload.new, roomId)
          })
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'message_reactions',
            filter: `conversation_id=eq.${roomId}`,
          }, () => {
            void refreshReactions(roomId).catch((reactionError) => {
              if (!active) return
              console.error('Could not refresh message reactions.', reactionError)
              setError('Recent reactions could not be synchronized.')
            })
          })
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'poll_votes',
            filter: `conversation_id=eq.${roomId}`,
          }, () => {
            void reloadLatest(roomId).catch((pollError) => {
              if (!active) return
              console.error('Could not refresh poll results.', pollError)
              setError('Poll results could not be synchronized.')
            })
          })
          .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'conversation_members',
            filter: `conversation_id=eq.${roomId}`,
          }, () => {
            void refreshRecipientReadMarker(roomId).catch((markerError) => {
              if (!active) return
              console.error('Could not refresh the private conversation read marker.', markerError)
              setError('The latest private conversation read status is unavailable.')
            })
          })
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'message_mentions',
            filter: `user_id=eq.${userId}`,
          }, () => {
            void refreshMentionNotifications().catch((mentionError) => {
              if (!active) return
              console.error('Could not refresh mention notifications.', mentionError)
              setError('Mention notifications could not be synchronized.')
            })
          })
          .subscribe((status) => {
            if (!active) return
            if (status === 'SUBSCRIBED') {
              setConnectionStatus('connected')
              void refreshMentionNotifications().catch((mentionError) => {
                if (!active) return
                console.error('Could not load mention notifications.', mentionError)
                setError('Mention notifications could not be loaded.')
              })
              if (kind === 'private') {
                void refreshRecipientReadMarker(roomId).catch((markerError) => {
                  if (!active) return
                  console.error('Could not synchronize the private conversation read marker.', markerError)
                  setError('The latest private conversation read status is unavailable.')
                })
              }
              setError((current) => current === 'Live updates are unavailable. You can still try sending a message.'
                ? ''
                : current)
              if (needsCatchup) {
                needsCatchup = false
                void reloadLatest(roomId).catch((syncError) => {
                  if (!active) return
                  console.error('Could not synchronize messages after reconnecting.', syncError)
                  setError('Live updates reconnected, but recent messages could not be synchronized.')
                })
              }
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              needsCatchup = true
              setConnectionStatus('disconnected')
              setError('Live updates are unavailable. You can still try sending a message.')
            }
          })

        const { data, error: messagesError } = await client
          .from('messages')
          .select(messageColumns)
          .eq('conversation_id', roomId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(PAGE_SIZE)
        if (messagesError) throw messagesError
        const rows = [...(data ?? [])].reverse()
        const mapped = await mapRows(rows, roomId)
        const summary = await reactionSummary(roomId)
        if (!active) return
        setMessages((current) => mergeMessages(current, [
          ...mapped.map((message) => ({
            ...message,
            reactions: message.deletedAt ? [] : summary.get(message.id) ?? [],
          })),
          ...queuedMessages.map((pending) => ({
            id: pending.id,
            author: 'you',
            initials: initialsFor(profilesRef.current.get(userId)?.username ?? 'you'),
            color: 'self',
            body: pending.body,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
            mine: true,
            deliveryStatus: 'failed' as const,
            replyToId: pending.replyToId,
          })),
          ...queuedMedia.map((pending) => ({
            id: pending.id,
            author: 'you',
            initials: initialsFor(profilesRef.current.get(userId)?.username ?? 'you'),
            color: 'self',
            body: pending.body,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
            mine: true,
            deliveryStatus: 'failed' as const,
            replyToId: pending.replyToId,
            media: {
              kind: mediaKindFor(pending.mimeType),
              mimeType: pending.mimeType,
              byteSize: pending.file.size,
              viewOnce: pending.viewOnce,
              expiresAt: null,
            },
          })),
        ]))
        setHasMore(rows.length === PAGE_SIZE)
        if (kind === 'private') {
          await markConversationRead(roomId)
        }
        void refreshMentionNotifications().catch((mentionError) => {
          if (!active) return
          console.error('Could not load mention notifications.', mentionError)
          setError('Mention notifications could not be loaded.')
        })
      } catch (loadError) {
        if (!active) return
        console.error('Could not load Delta Tea messages.', loadError)
        setMessages([])
        setLoadingEarlier(false)
        setHasMore(false)
        setOwnerId(contextKey)
        setConversationId(null)
        activeConversationId.current = null
        setError(`Could not load ${kind === 'general' ? 'Delta Tea' : 'private conversation'}: ${errorText(loadError)}`)
        setConnectionStatus('disconnected')
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => {
      active = false
      if (activeUserId.current === userId) activeUserId.current = null
      activeConversationId.current = null
      refreshLatestRef.current = null
      if (channel) {
        const removal = client.removeChannel(channel).then((status) => {
          if (status !== 'ok') throw new Error(`Realtime channel removal returned ${status}.`)
        })
        channelRemovalRef.current = removal
        void removal.catch((removalError) => {
          console.error('Realtime channel cleanup failed.', removalError)
        })
      }
    }
  }, [contextKey, enabled, existingConversationId, kind, participantId, session?.user.id])

  useEffect(() => {
    if (ownProfile) profilesRef.current.set(ownProfile.id, ownProfile)
  }, [ownProfile])

  const isCurrentOwner = Boolean(enabled && session && ownerId === contextKey)
  const recipientReadAt = recipientReadMarker?.owner === contextKey ? recipientReadMarker.readAt : null
  const visibleMessages = useMemo(
    () => {
      if (!isCurrentOwner) return []
      if (kind !== 'private' || !recipientReadAt) return messages
      const readThrough = Date.parse(recipientReadAt)
      return messages.map((message) => (
        message.mine
        && message.deliveryStatus === 'sent'
        && message.createdAt
        && Date.parse(message.createdAt) <= readThrough
          ? { ...message, deliveryStatus: 'read' as const }
          : message
      ))
    },
    [isCurrentOwner, kind, messages, recipientReadAt],
  )
  const visibleConversationId = isCurrentOwner ? conversationId : null
  const visibleMentions = useMemo(
    () => isCurrentOwner && mentionNotifications?.owner === contextKey
      ? mentionNotifications.items
      : [],
    [contextKey, isCurrentOwner, mentionNotifications],
  )
  const mentionsReady = isCurrentOwner && mentionNotifications?.owner === contextKey

  const persistMessage = useCallback(async (pending: PendingMessage) => {
    if (sendingIds.current.has(pending.id)) return
    const userId = session?.user.id
    if (
      !userId
      || activeUserId.current !== userId
      || activeConversationId.current !== pending.conversationId
    ) return
    sendingIds.current.add(pending.id)
    setMessages((current) => current.map((message) => (
      message.id === pending.id ? { ...message, deliveryStatus: 'sending' } : message
    )))

    try {
      const client = requireSupabase()
      const { data, error: insertError } = await client
        .from('messages')
        .insert({
          id: pending.id,
          conversation_id: pending.conversationId,
          sender_id: userId,
          body: pending.body,
          reply_to_id: pending.replyToId ?? null,
        })
        .select(messageColumns)
        .single()

      let row = data
      if (insertError) {
        const { data: existing, error: lookupError } = await client
          .from('messages')
          .select(messageColumns)
          .eq('id', pending.id)
          .maybeSingle()
        if (lookupError) console.error('Could not confirm message persistence after a send error.', lookupError)
        if (
          !existing
          || existing.sender_id !== userId
          || existing.conversation_id !== pending.conversationId
          || existing.body !== pending.body
        ) throw insertError
        row = existing
      }
      if (!isMessageRow(row)) throw new Error('The chat service returned an invalid message.')
      if (activeUserId.current !== userId || activeConversationId.current !== pending.conversationId) return
      const profile = ownProfile
      const message = {
        ...toMessage(row, profile ?? undefined, session?.user.id ?? ''),
        deliveryStatus: 'sent' as const,
      }
      pendingMessages.current.delete(pending.id)
      const queuedMessages = readOutbox(userId, pending.conversationId)
      if (!writeOutbox(userId, pending.conversationId, queuedMessages.filter((message) => message.id !== pending.id))) {
        setError('Message sent, but this tab could not clear its retry marker. It will be confirmed before retrying.')
      }
      setMessages((current) => mergeMessages(current, [message]))
    } catch (sendError) {
      console.error(`Could not send a ${kind === 'general' ? 'Delta Tea' : 'private'} message.`, sendError)
      if (activeUserId.current !== userId || activeConversationId.current !== pending.conversationId) return
      setMessages((current) => current.map((message) => (
        message.id === pending.id ? { ...message, deliveryStatus: 'failed' } : message
      )))
      setError('Message not sent. Check your connection and retry.')
    } finally {
      sendingIds.current.delete(pending.id)
    }
  }, [kind, ownProfile, session])

  const persistMediaMessage = useCallback(async (pending: PendingMediaMessage) => {
    if (sendingIds.current.has(pending.id)) return
    const userId = session?.user.id
    if (
      !userId
      || activeUserId.current !== userId
      || activeConversationId.current !== pending.conversationId
    ) return
    sendingIds.current.add(pending.id)
    setMessages((current) => current.map((message) => (
      message.id === pending.id ? { ...message, deliveryStatus: 'sending', uploadProgress: 0 } : message
    )))

    try {
      const client = requireSupabase()
      const kind = mediaKindFor(pending.mimeType)
    if (!pending.viewOnce) {
      await saveQueuedMedia({
        ...pending,
        userId,
      })
    }
      const path = `${pending.conversationId}/${userId}/${pending.id}.${extensionForMediaType(pending.mimeType)}`
      let uploadError: unknown
      try {
        await uploadMedia(pending.file, path, (progress) => {
          if (activeUserId.current !== userId || activeConversationId.current !== pending.conversationId) return
          setMessages((current) => current.map((message) => (
            message.id === pending.id ? { ...message, uploadProgress: progress } : message
          )))
        })
      } catch (error) {
        uploadError = error
      }

      const mediaArgs = {
        p_message_id: pending.id,
        p_conversation_id: pending.conversationId,
        p_body: '',
        p_reply_to_id: pending.replyToId ?? null,
        p_object_path: path,
        p_media_kind: kind,
        p_mime_type: pending.mimeType,
        p_byte_size: pending.file.size,
        p_view_once: pending.viewOnce,
      }
      const { data: savedId, error: saveError } = pending.mediaGroupId
        ? await client.rpc('register_grouped_message_media', {
          ...mediaArgs,
          p_media_kind: 'image',
          p_media_group_id: pending.mediaGroupId,
        })
        : await client.rpc('register_message_media', mediaArgs)
      if (saveError) {
        if (uploadError) {
          throw new Error(`Upload did not complete (${errorText(uploadError)}). ${errorText(saveError)}`)
        }
        throw saveError
      }
      if (savedId !== pending.id) throw new Error('The chat service returned an invalid media message.')
      if (activeUserId.current !== userId || activeConversationId.current !== pending.conversationId) return
      pendingMediaMessages.current.delete(pending.id)
      try {
        await removeQueuedMedia(pending.id)
      } catch (cleanupError) {
        console.error('Media was sent, but its local retry copy could not be cleared.', cleanupError)
        setError('Media sent. This browser could not clear its local retry copy; it will be confirmed before retrying.')
      }
      setMessages((current) => current.map((message) => (
        message.id === pending.id
          ? {
              ...message,
              deliveryStatus: 'sent',
              uploadProgress: 100,
              media: {
                kind,
                mimeType: pending.mimeType,
                byteSize: pending.file.size,
                viewOnce: pending.viewOnce,
                expiresAt: pending.viewOnce ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null,
              },
            }
          : message
      )))
      if (activeUserId.current === userId && activeConversationId.current === pending.conversationId) {
        setError((current) => current.startsWith('Media sent.') ? current : '')
      }
    } catch (uploadError) {
      console.error(`Could not send media to the ${kind === 'general' ? 'Delta Tea' : 'private'} conversation.`, uploadError)
      if (activeUserId.current !== userId || activeConversationId.current !== pending.conversationId) return
      setMessages((current) => current.map((message) => (
        message.id === pending.id ? { ...message, deliveryStatus: 'failed' } : message
      )))
      setError(`Media not sent. ${errorText(uploadError)}`)
    } finally {
      sendingIds.current.delete(pending.id)
    }
  }, [kind, session])

  const send = useCallback((text: string, replyToId?: string) => {
    const body = text.trim()
    const roomId = visibleConversationId
    const userId = session?.user.id
    if (!userId || !session || !roomId || !body) {
      setError('The chat is not ready yet. Try again in a moment.')
      return
    }

    const id = crypto.randomUUID()
    const username = ownProfile?.username ?? 'you'
    const pending = { id, conversationId: roomId, body, replyToId }
    pendingMessages.current.set(id, pending)
    if (!writeOutbox(userId, roomId, [...readOutbox(userId, roomId).filter((message) => message.id !== id), pending])) {
      setError('This tab could not preserve the pending message across a reload.')
    }
    setMessages((current) => mergeMessages(current, [{
      id,
      author: 'you',
      initials: initialsFor(username),
      color: 'self',
      body,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      mine: true,
      deliveryStatus: 'sending',
      replyToId,
    }]))
    void persistMessage(pending)
  }, [ownProfile, persistMessage, session, visibleConversationId])

  const sendMedia = useCallback((file: File, viewOnce = false, replyToId?: string, mediaGroupId?: string) => {
    const userId = session?.user.id
    const roomId = visibleConversationId
    const mimeType = normalizeMediaType(file)
    if (!userId || !roomId) {
      setError('The conversation is not ready to send media.')
      return
    }
    if (!mimeType) {
      setError('Choose a supported image, audio, or video file.')
      return
    }
    if (file.size < 1 || file.size > MAX_MEDIA_BYTES) {
      setError('Media must be smaller than 20 MB.')
      return
    }
    const kind = mediaKindFor(mimeType)
    if (mediaGroupId && kind !== 'image') {
      setError('Only image attachments can be sent as a group.')
      return
    }
    const id = crypto.randomUUID()
    const username = ownProfile?.username ?? 'you'
    const pending: PendingMediaMessage = {
      id,
      conversationId: roomId,
      body: '',
      replyToId,
      file,
      mimeType,
      viewOnce,
      mediaGroupId,
    }
    pendingMediaMessages.current.set(id, pending)
    setMessages((current) => mergeMessages(current, [{
      id,
      author: 'you',
      initials: initialsFor(username),
      color: 'self',
      body: pending.body,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      mine: true,
      deliveryStatus: 'sending',
      uploadProgress: 0,
      replyToId,
      mediaGroupId,
      media: {
        kind,
        mimeType,
        byteSize: file.size,
        viewOnce,
        expiresAt: viewOnce ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null,
      },
    }]))
    void persistMediaMessage(pending)
  }, [ownProfile, persistMediaMessage, session, visibleConversationId])

  const retry = useCallback((messageId: string) => {
    const pending = pendingMessages.current.get(messageId)
    const pendingMedia = pendingMediaMessages.current.get(messageId)
    if (pendingMedia) void persistMediaMessage(pendingMedia)
    else if (pending) void persistMessage(pending)
  }, [persistMediaMessage, persistMessage])

  const discardPendingMedia = useCallback(async (messageId: string) => {
    const pending = pendingMediaMessages.current.get(messageId)
    if (!pending || sendingIds.current.has(messageId)) return
    try {
      const userId = session?.user.id
      if (!userId) throw new Error('Sign in again before discarding this upload.')
      const objectPath = `${pending.conversationId}/${userId}/${pending.id}.${extensionForMediaType(pending.mimeType)}`
      const { error: storageError } = await requireSupabase()
        .storage.from('isomo-chat-media')
        .remove([objectPath])
      if (storageError) throw storageError
      await removeQueuedMedia(messageId)
      pendingMediaMessages.current.delete(messageId)
      setMessages((current) => current.filter((message) => message.id !== messageId))
      setError('')
    } catch (discardError) {
      console.error('Could not discard the local pending media file.', discardError)
      setError(`Pending media could not be discarded: ${errorText(discardError)}`)
    }
  }, [session])

  useEffect(() => {
    const resumePendingSends = () => {
      if (!navigator.onLine) return
      for (const pending of pendingMessages.current.values()) void persistMessage(pending)
      for (const pending of pendingMediaMessages.current.values()) void persistMediaMessage(pending)
    }
    window.addEventListener('online', resumePendingSends)
    return () => window.removeEventListener('online', resumePendingSends)
  }, [persistMediaMessage, persistMessage])

  const openMedia = useCallback((messageId: string) => requestMessageMedia(messageId), [])

  const createPoll = useCallback(async (question: string, options: string[], replyToId?: string) => {
    const userId = session?.user.id
    const roomId = visibleConversationId
    if (!userId || !roomId) return false
    const requestKey = `${roomId}:${question.trim()}:${options.map((option) => option.trim()).join('|')}:${replyToId ?? ''}`
    const messageId = pendingPollIds.current.get(requestKey) ?? crypto.randomUUID()
    pendingPollIds.current.set(requestKey, messageId)
    let saved = false
    try {
      const { data, error: pollError } = await requireSupabase().rpc('create_message_poll', {
        p_message_id: messageId,
        p_conversation_id: roomId,
        p_question: question.trim(),
        p_options: options.map((option) => option.trim()),
        p_reply_to_id: replyToId ?? null,
        p_closes_at: null,
      })
      if (pollError) {
        const { data: existing, error: lookupError } = await requireSupabase()
          .from('message_polls')
          .select('message_id')
          .eq('message_id', messageId)
          .maybeSingle()
        if (lookupError || existing?.message_id !== messageId) throw pollError
      } else if (data !== messageId) {
        throw new Error('The chat service returned an invalid poll message.')
      }
      saved = true
      pendingPollIds.current.delete(requestKey)
      if (activeUserId.current !== userId || activeConversationId.current !== roomId) return false
      try {
        await refreshLatestRef.current?.(roomId)
      } catch (syncError) {
        console.error('Poll was created, but the latest conversation could not be refreshed.', syncError)
        setError('Poll created. Conversation updates are still synchronizing.')
      }
      return true
    } catch (pollError) {
      console.error('Could not create a conversation poll.', pollError)
      if (activeUserId.current === userId && activeConversationId.current === roomId) {
        setError(saved
          ? 'Poll created, but conversation updates are still synchronizing.'
          : `Poll could not be created: ${errorText(pollError)}`)
      }
      return saved
    }
  }, [session, visibleConversationId])

  const votePoll = useCallback(async (messageId: string, optionId: string) => {
    const userId = session?.user.id
    const roomId = visibleConversationId
    if (!userId || !roomId) return false
    if (pollOperations.current.has(messageId)) return false
    pollOperations.current.add(messageId)
    try {
      const { error: voteError } = await requireSupabase().rpc('cast_poll_vote', {
        p_message_id: messageId,
        p_option_id: optionId,
      })
      if (voteError) throw voteError
      if (activeUserId.current !== userId || activeConversationId.current !== roomId) return false
      await refreshLatestRef.current?.(roomId)
      setError('')
      return true
    } catch (voteError) {
      console.error('Could not record a poll vote.', voteError)
      if (activeUserId.current === userId && activeConversationId.current === roomId) {
        setError(`Vote could not be recorded: ${errorText(voteError)}`)
      }
      return false
    } finally {
      pollOperations.current.delete(messageId)
    }
  }, [session, visibleConversationId])

  const sendSticker = useCallback(async (stickerCode: string, replyToId?: string) => {
    const userId = session?.user.id
    const roomId = visibleConversationId
    if (!userId || !roomId) return false
    const requestKey = `${roomId}:${stickerCode}:${replyToId ?? ''}`
    const messageId = pendingStickerIds.current.get(requestKey) ?? crypto.randomUUID()
    pendingStickerIds.current.set(requestKey, messageId)
    let saved = false
    try {
      const { data, error: stickerError } = await requireSupabase().rpc('create_sticker_message', {
        p_message_id: messageId,
        p_conversation_id: roomId,
        p_sticker_code: stickerCode,
        p_reply_to_id: replyToId ?? null,
      })
      if (stickerError) {
        const { data: existing, error: lookupError } = await requireSupabase()
          .from('message_stickers')
          .select('message_id')
          .eq('message_id', messageId)
          .maybeSingle()
        if (lookupError || existing?.message_id !== messageId) throw stickerError
      } else if (data !== messageId) {
        throw new Error('The chat service returned an invalid sticker message.')
      }
      saved = true
      pendingStickerIds.current.delete(requestKey)
      if (activeUserId.current !== userId || activeConversationId.current !== roomId) return false
      try {
        await refreshLatestRef.current?.(roomId)
      } catch (syncError) {
        console.error('Sticker was sent, but the latest conversation could not be refreshed.', syncError)
        setError('Sticker sent. Conversation updates are still synchronizing.')
      }
      return true
    } catch (stickerError) {
      console.error('Could not send a sticker.', stickerError)
      if (activeUserId.current === userId && activeConversationId.current === roomId) {
        setError(saved
          ? 'Sticker sent, but conversation updates are still synchronizing.'
          : `Sticker could not be sent: ${errorText(stickerError)}`)
      }
      return saved
    }
  }, [session, visibleConversationId])

  const markMentionsRead = useCallback(async () => {
    const unreadIds = visibleMentions.filter((mention) => !mention.readAt).map((mention) => mention.messageId)
    if (!unreadIds.length) return
    try {
      const { error: readError } = await requireSupabase().rpc('mark_mentions_read', {
        p_message_ids: unreadIds,
      })
      if (readError) throw readError
      const readAt = new Date().toISOString()
      setMentionNotifications((current) => current && current.owner === contextKey
        ? {
            ...current,
            items: current.items.map((mention) => unreadIds.includes(mention.messageId)
              ? { ...mention, readAt }
              : mention),
          }
        : current)
    } catch (readError) {
      console.error('Could not mark mention notifications as read.', readError)
      setError(`Mention notifications could not be marked read: ${errorText(readError)}`)
    }
  }, [contextKey, visibleMentions])

  const toggleReaction = useCallback(async (messageId: string, emoji: string) => {
    const userId = session?.user.id
    const roomId = visibleConversationId
    const message = visibleMessages.find((candidate) => candidate.id === messageId)
    if (!userId || !roomId || !message) {
      setError('The message is no longer available for a reaction.')
      return
    }
    const operationId = `${messageId}:${emoji}`
    if (reactionOperations.current.has(operationId)) return
    reactionOperations.current.add(operationId)

    try {
      const client = requireSupabase()
      const alreadyReacted = message.reactions?.some((reaction) => reaction.emoji === emoji && reaction.reactedByMe)
      const result = alreadyReacted
        ? await client.from('message_reactions').delete()
            .eq('conversation_id', roomId)
            .eq('message_id', messageId)
            .eq('user_id', userId)
            .eq('emoji', emoji)
        : await client.from('message_reactions').insert({
            conversation_id: roomId,
            message_id: messageId,
            user_id: userId,
            emoji,
          })
      if (result.error) throw result.error
      const { data, error: refreshError } = await client
        .from('message_reactions')
        .select('message_id,user_id,emoji')
        .eq('conversation_id', roomId)
      if (refreshError) throw refreshError
      if (activeUserId.current !== userId || activeConversationId.current !== roomId) return
      const summary = summarizeReactions(data ?? [], userId)
      setMessages((current) => current.map((item) => ({
        ...item,
        reactions: summary.get(item.id) ?? [],
      })))
      setError('')
    } catch (reactionError) {
      console.error('Could not save a message reaction.', reactionError)
      if (activeUserId.current === userId && activeConversationId.current === roomId) {
        setError('Reaction not saved. Check your connection and try again.')
      }
    } finally {
      reactionOperations.current.delete(operationId)
    }
  }, [session, visibleConversationId, visibleMessages])

  const editMessage = useCallback(async (messageId: string, body: string) => {
    const userId = session?.user.id
    const roomId = visibleConversationId
    const text = body.trim()
    if (!userId || !roomId || !text) return false
    try {
      const client = requireSupabase()
      const { error: editError } = await client.rpc('edit_message', {
        p_message_id: messageId,
        p_body: text,
      })
      if (editError) throw editError
      const { data, error: messageError } = await client
        .from('messages')
        .select(messageColumns)
        .eq('conversation_id', roomId)
        .eq('id', messageId)
        .single()
      if (messageError) throw messageError
      if (!isMessageRow(data)) throw new Error('The chat service returned an invalid edited message.')
      if (activeUserId.current !== userId || activeConversationId.current !== roomId) return false
      setMessages((current) => mergeMessages(current, [toMessage(data, ownProfile ?? undefined, userId)]))
      setError('')
      return true
    } catch (editError) {
      console.error('Could not edit a message.', editError)
      if (activeUserId.current === userId && activeConversationId.current === roomId) {
        setError(`Message could not be edited: ${errorText(editError)}`)
      }
      return false
    }
  }, [ownProfile, session, visibleConversationId])

  const deleteMessageForMe = useCallback(async (messageId: string) => {
    const userId = session?.user.id
    const roomId = visibleConversationId
    if (!userId || !roomId) return false
    try {
      const client = requireSupabase()
      const { error: deleteError } = await client.rpc('delete_message_for_me', { p_message_id: messageId })
      if (deleteError) throw deleteError
      if (activeUserId.current !== userId || activeConversationId.current !== roomId) return false
      setMessages((current) => current.filter((message) => message.id !== messageId))
      setError('')
      return true
    } catch (deleteError) {
      console.error('Could not hide a message for this account.', deleteError)
      if (activeUserId.current === userId && activeConversationId.current === roomId) {
        setError(`Message could not be hidden: ${errorText(deleteError)}`)
      }
      return false
    }
  }, [session, visibleConversationId])

  const deleteMessageForEveryone = useCallback(async (messageId: string) => {
    const userId = session?.user.id
    const roomId = visibleConversationId
    if (!userId || !roomId) return false
    try {
      const client = requireSupabase()
      const { error: deleteError } = await client.rpc('delete_message_for_everyone', { p_message_id: messageId })
      if (deleteError) throw deleteError
      const { data, error: messageError } = await client
        .from('messages')
        .select(messageColumns)
        .eq('conversation_id', roomId)
        .eq('id', messageId)
        .single()
      if (messageError) throw messageError
      if (!isMessageRow(data)) throw new Error('The chat service returned an invalid deleted message.')
      if (activeUserId.current !== userId || activeConversationId.current !== roomId) return false
      setMessages((current) => mergeMessages(current, [{
        ...toMessage(data, ownProfile ?? undefined, userId),
        reactions: [],
      }]))
      setError('')
      return true
    } catch (deleteError) {
      console.error('Could not delete a message for everyone.', deleteError)
      if (activeUserId.current === userId && activeConversationId.current === roomId) {
        setError(`Message could not be deleted: ${errorText(deleteError)}`)
      }
      return false
    }
  }, [ownProfile, session, visibleConversationId])

  const loadEarlier = useCallback(async () => {
    const oldest = visibleMessages[0]
    if (!visibleConversationId || !oldest?.createdAt || loadingEarlier || !hasMore) return
    const userId = session?.user.id
    if (!userId) return
    setLoadingEarlier(true)
    try {
      const client = requireSupabase()
      const { data, error: pageError } = await client
        .from('messages')
        .select(messageColumns)
        .eq('conversation_id', visibleConversationId)
        .or(`created_at.lt.${oldest.createdAt},and(created_at.eq.${oldest.createdAt},id.lt.${oldest.id})`)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE_SIZE)
      if (pageError) throw pageError
      if (activeUserId.current !== userId || activeConversationId.current !== visibleConversationId) return
      const rows = [...(data ?? [])].reverse()
      const missingIds = [...new Set(rows
        .map((row) => row.sender_id)
        .filter((id): id is string => Boolean(id) && !profilesRef.current.has(id)))]
      if (missingIds.length > 0) {
        const { data: profiles, error: profileError } = await client
          .from('profiles')
          .select('id, username, avatar_url')
          .in('id', missingIds)
        if (profileError) throw profileError
        for (const profile of profiles) profilesRef.current.set(profile.id, profile)
      }
      const replyIds = [...new Set(rows.map((row) => row.reply_to_id).filter((id): id is string => Boolean(id)))]
      let replies: MessageRow[] = []
      if (replyIds.length > 0) {
        const { data: replyRows, error: replyError } = await client
          .from('messages')
          .select(messageColumns)
          .eq('conversation_id', visibleConversationId)
          .is('deleted_at', null)
          .in('id', replyIds)
        if (replyError) throw replyError
        replies = replyRows ?? []
        const replySenderIds = [...new Set(replies
          .map((row) => row.sender_id)
          .filter((id): id is string => Boolean(id) && !profilesRef.current.has(id)))]
        if (replySenderIds.length > 0) {
          const { data: profiles, error: profileError } = await client
            .from('profiles')
            .select('id, username, avatar_url')
            .in('id', replySenderIds)
          if (profileError) throw profileError
          for (const profile of profiles) profilesRef.current.set(profile.id, profile)
        }
      }
      const repliesById = new Map(replies.map((row) => [row.id, row]))
      const { data: mediaRows, error: mediaError } = await client
        .from('message_media')
        .select('message_id,media_kind,mime_type,byte_size,view_once,expires_at')
        .in('message_id', rows.map((row) => row.id))
      if (mediaError) throw mediaError
      const mediaByMessageId = new Map((mediaRows ?? []).map((media) => [media.message_id, {
        kind: media.media_kind,
        mimeType: media.mime_type,
        byteSize: media.byte_size,
        viewOnce: media.view_once,
        expiresAt: media.expires_at,
      }]))
      const { data: pollRows, error: pollError } = await client
        .from('message_polls')
        .select('message_id,question,closes_at')
        .in('message_id', rows.map((row) => row.id))
      if (pollError) throw pollError
      const pollIds = (pollRows ?? []).map((poll) => poll.message_id)
      const { data: optionRows, error: optionsError } = pollIds.length
        ? await client
          .from('poll_options')
          .select('id,message_id,label,position')
          .in('message_id', pollIds)
          .order('position')
        : { data: [], error: null }
      if (optionsError) throw optionsError
      const { data: pollResults, error: pollResultsError } = pollIds.length
        ? await client.rpc('get_poll_results', {
          p_conversation_id: visibleConversationId,
          p_message_ids: pollIds,
        })
        : { data: [], error: null }
      if (pollResultsError) throw pollResultsError
      const { data: stickerRows, error: stickerError } = await client
        .from('message_stickers')
        .select('message_id,sticker_code')
        .in('message_id', rows.map((row) => row.id))
      if (stickerError) throw stickerError
      const pollsById = new Map((pollRows ?? []).map((poll) => {
        const options = (optionRows ?? [])
          .filter((option) => option.message_id === poll.message_id)
          .map((option) => {
            const result = (pollResults ?? []).find((item) => item.message_id === poll.message_id && item.option_id === option.id)
            return { id: option.id, label: option.label, votes: Number(result?.vote_count ?? 0) }
          })
        return [poll.message_id, {
          question: poll.question,
          options,
          myVote: (pollResults ?? []).find((item) => item.message_id === poll.message_id && item.my_vote)?.option_id ?? null,
          closesAt: poll.closes_at,
        }]
      }))
      const stickersById = new Map((stickerRows ?? []).map((sticker) => [
        sticker.message_id,
        getStickerOption(sticker.sticker_code)?.code ?? '',
      ]))
      const mapped = rows.map((row) => {
        const authorProfile = row.sender_id === session?.user.id
          ? ownProfile
          : row.sender_id ? profilesRef.current.get(row.sender_id) : undefined
        const message = toMessage(row, authorProfile ?? undefined, session?.user.id ?? '')
        const parent = row.reply_to_id ? repliesById.get(row.reply_to_id) : undefined
        return {
          ...message,
          media: mediaByMessageId.get(row.id),
          poll: pollsById.get(row.id),
          sticker: stickersById.get(row.id),
          replyPreview: parent
            ? {
                author: parent.sender_id ? profilesRef.current.get(parent.sender_id)?.username ?? 'former member' : 'former member',
                body: parent.body,
              }
            : undefined,
        }
      })
      const { data: reactionRows, error: reactionError } = await client
        .from('message_reactions')
        .select('message_id,user_id,emoji')
        .eq('conversation_id', visibleConversationId)
      if (reactionError) throw reactionError
      const summary = summarizeReactions(reactionRows ?? [], userId)
      setMessages((current) => mergeMessages(current, mapped.map((message) => ({
        ...message,
        reactions: message.deletedAt ? [] : summary.get(message.id) ?? [],
      }))))
      setHasMore(rows.length === PAGE_SIZE)
    } catch (pageError) {
      if (activeUserId.current !== userId || activeConversationId.current !== visibleConversationId) return
      console.error('Could not load earlier Delta Tea messages.', pageError)
      setError(`Could not load earlier messages: ${errorText(pageError)}`)
    } finally {
      if (activeUserId.current === userId) setLoadingEarlier(false)
    }
  }, [hasMore, loadingEarlier, ownProfile, session, visibleConversationId, visibleMessages])

  return {
    messages: visibleMessages,
    conversationId: visibleConversationId,
    loading: enabled && session ? !isCurrentOwner || loading : false,
    loadingEarlier: isCurrentOwner && loadingEarlier,
    hasMore: isCurrentOwner && hasMore,
    error: isCurrentOwner ? error : '',
    connectionStatus: isCurrentOwner ? connectionStatus : enabled && session ? 'connecting' : 'idle',
    send,
    retry,
    discardPendingMedia,
    sendMedia,
    openMedia,
    createPoll,
    votePoll,
    sendSticker,
    mentions: visibleMentions,
    mentionsReady,
    markMentionsRead,
    loadEarlier,
    toggleReaction,
    editMessage,
    deleteMessageForMe,
    deleteMessageForEveryone,
  }
}

export function useGeneralChat(
  session: Session | null,
  enabled: boolean,
  ownProfile: PublicProfile | null,
) {
  return useConversationChat(session, enabled, ownProfile, 'general')
}
