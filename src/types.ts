export type AppSection = 'tea' | 'inbox' | 'profile' | 'admin' | 'welcome' | 'auth'
export type AuthMode = 'login' | 'register' | 'admin'
export type MessageReaction = { emoji: string; count: number; reactedByMe?: boolean }
export type MessageMedia = {
  kind: 'image' | 'audio' | 'video'
  mimeType: string
  byteSize: number
  viewOnce: boolean
  expiresAt: string | null
}
export type PollOption = { id: string; label: string; votes: number }
export type MessagePoll = {
  question: string
  options: PollOption[]
  myVote: string | null
  closesAt: string | null
}
export type MentionNotification = {
  messageId: string
  conversationId: string
  author: string
  body: string
  createdAt: string
  readAt: string | null
}
export type PrivateConversationSummary = {
  conversationId: string
  peerId: string | null
  peerUsername: string
  peerAvatarUrl: string | null
  latestMessage: string | null
  latestMessageAt: string | null
  unreadCount: number
  lastReadAt: string | null
}

export type DemoMessage = {
  id: string
  author: string
  initials: string
  color: string
  body: string
  time: string
  mine?: boolean
  reactions?: MessageReaction[]
  deliveryStatus?: 'sending' | 'sent' | 'read' | 'failed'
  uploadProgress?: number
  createdAt?: string
  updatedAt?: string
  deletedAt?: string
  systemEvent?: 'username_changed'
  authorId?: string
  avatarUrl?: string | null
  replyToId?: string
  replyPreview?: { author: string; body: string }
  mediaGroupId?: string
  media?: MessageMedia
  poll?: MessagePoll
  sticker?: string
}

export type CommunityMember = {
  id?: string
  username: string
  avatarUrl?: string | null
  initials: string
  color: string
  status: string
  admin?: boolean
}
