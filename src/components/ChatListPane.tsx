import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { CircleX, MessageCircle, Plus } from 'lucide-react'
import type { PrivateConversationSummary } from '../types'

const chatListMinWidth = 280
const chatListMaxWidth = 500
const chatListDefaultWidth = 380
const chatListWidthKey = 'isomo-chat-list-width'

function getChatListMaxWidth() {
  return Math.max(chatListMinWidth, Math.min(chatListMaxWidth, window.innerWidth * 0.4))
}

function clampChatListWidth(width: number) {
  return Math.round(Math.max(chatListMinWidth, Math.min(getChatListMaxWidth(), width)))
}

function readChatListWidth() {
  try {
    const saved = Number(localStorage.getItem(chatListWidthKey))
    return Number.isFinite(saved) && saved > 0 ? clampChatListWidth(saved) : clampChatListWidth(chatListDefaultWidth)
  } catch (error) {
    console.error('Could not load the saved message-list width.', error)
    return clampChatListWidth(chatListDefaultWidth)
  }
}

type ChatListPaneProps = {
  conversations: PrivateConversationSummary[]
  loading: boolean
  error?: string
  activeKind: 'tea' | 'inbox' | 'none'
  activeConversationId?: string | null
  deltaUnreadCount: number
  communityName: string
  communityAvatarUrl: string
  deltaPreview: string | null
  deltaLatestAt: string | null
  onOpenSupportCircle: () => void
  onOpenConversation: (conversation: PrivateConversationSummary) => void
  onClearSelection: () => void
  onNewChat: () => void
}

function formatChatTime(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  const today = new Date()
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function ChatListPane({
  conversations,
  loading,
  error = '',
  activeKind,
  activeConversationId,
  deltaUnreadCount,
  communityName,
  communityAvatarUrl,
  deltaPreview,
  deltaLatestAt,
  onOpenSupportCircle,
  onOpenConversation,
  onClearSelection,
  onNewChat,
}: ChatListPaneProps) {
  const [width, setWidth] = useState(readChatListWidth)
  const draggingPointer = useRef<number | null>(null)

  function updateWidth(nextWidth: number) {
    const next = clampChatListWidth(nextWidth)
    setWidth(next)
    try {
      localStorage.setItem(chatListWidthKey, String(next))
    } catch (error) {
      console.error('Could not save the message-list width.', error)
    }
  }

  function resizeFromPointer(event: PointerEvent<HTMLDivElement>) {
    if (draggingPointer.current !== event.pointerId) return
    const pane = event.currentTarget.previousElementSibling
    if (!(pane instanceof HTMLElement) || pane.offsetWidth === 0) return
    const bounds = pane.getBoundingClientRect()
    const scale = bounds.width / pane.offsetWidth
    if (scale === 0) return
    updateWidth((event.clientX - bounds.left) / scale)
  }

  function resizeFromKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      updateWidth(width + (event.key === 'ArrowRight' ? 20 : -20))
    } else if (event.key === 'Home') {
      event.preventDefault()
      updateWidth(chatListMinWidth)
    } else if (event.key === 'End') {
      event.preventDefault()
      updateWidth(getChatListMaxWidth())
    }
  }

  return (
    <>
      <aside className="chat-list-pane" aria-label="Conversations" style={{ flexBasis: `${width}px` }}>
        <header className="chat-list-header">
          <h1>Conversations</h1>
          <div className="chat-list-header-actions">
            {activeKind !== 'none' && <button onClick={onClearSelection} type="button" aria-label="Clear selected conversation" title="Clear selected conversation"><CircleX size={17} /></button>}
            <button onClick={onNewChat} type="button" aria-label="Start a new chat" title="Start a new chat"><Plus size={18} /></button>
          </div>
        </header>
        <div className="chat-list-items">
          <button
            className={`chat-list-item ${activeKind === 'tea' ? 'active' : ''}`}
            onClick={onOpenSupportCircle}
            type="button"
            aria-current={activeKind === 'tea' ? 'page' : undefined}
          >
            <img className="chat-list-avatar" src={communityAvatarUrl} alt="" />
            <span className="chat-list-item-copy">
              <span className="chat-list-item-top"><strong>{communityName}</strong><time>{formatChatTime(deltaLatestAt)}</time></span>
              <span className="chat-list-item-bottom"><span>{deltaPreview ?? 'A place to listen and support'}</span>
                {deltaUnreadCount > 0 && <b aria-label={`${deltaUnreadCount} unread messages`}>{deltaUnreadCount > 99 ? '99+' : deltaUnreadCount}</b>}
              </span>
            </span>
          </button>
          {conversations.map((conversation) => (
          <button
            className={`chat-list-item ${activeKind === 'inbox' && activeConversationId === conversation.conversationId ? 'active' : ''}`}
            key={conversation.conversationId}
            onClick={() => onOpenConversation(conversation)}
            type="button"
            aria-current={activeKind === 'inbox' && activeConversationId === conversation.conversationId ? 'page' : undefined}
          >
            {conversation.peerAvatarUrl
              ? <img className="chat-list-avatar" src={conversation.peerAvatarUrl} alt="" referrerPolicy="no-referrer" />
              : <span className="chat-list-avatar chat-list-avatar-fallback">{conversation.peerUsername.slice(0, 1).toUpperCase()}</span>}
            <span className="chat-list-item-copy">
              <span className="chat-list-item-top"><strong>@{conversation.peerUsername}</strong><time>{formatChatTime(conversation.latestMessageAt)}</time></span>
              <span className="chat-list-item-bottom"><span>{conversation.latestMessage ?? 'No messages yet'}</span>
                {conversation.unreadCount > 0 && <b aria-label={`${conversation.unreadCount} unread messages`}>{conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</b>}
              </span>
            </span>
          </button>
          ))}
          {loading && !conversations.length && <p className="chat-list-status">Loading chats…</p>}
          {!loading && error && <p className="chat-list-status error" role="status">Private chats could not be refreshed.</p>}
          {!loading && !error && !conversations.length && <p className="chat-list-status">One-to-one conversations will appear here when you start them.</p>}
        </div>
        <button className="chat-list-new-chat" onClick={onNewChat} type="button"><MessageCircle size={15} /> New chat</button>
      </aside>
      <div
        className="chat-pane-divider"
        role="separator"
        aria-label="Resize message list"
        aria-orientation="vertical"
        aria-valuemin={chatListMinWidth}
        aria-valuemax={getChatListMaxWidth()}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          draggingPointer.current = event.pointerId
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={resizeFromPointer}
        onPointerUp={(event) => {
          draggingPointer.current = null
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => { draggingPointer.current = null }}
        onKeyDown={resizeFromKeyboard}
        onDoubleClick={() => updateWidth(chatListDefaultWidth)}
      />
    </>
  )
}
