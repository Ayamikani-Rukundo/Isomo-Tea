import { useMemo, useState } from 'react'
import { ArrowRight, Inbox, MessageCircle, Search, Trash2, Users, X } from 'lucide-react'
import type { CommunityMember, GroupConversationSummary, PrivateConversationSummary } from '../types'
import { ConfirmDialog } from './ConfirmDialog'

type PrivateInboxViewProps = {
  className?: string
  mode?: 'inbox' | 'picker'
  conversations: PrivateConversationSummary[]
  groups: GroupConversationSummary[]
  members: CommunityMember[]
  currentUserId?: string
  loading: boolean
  loadingMembers: boolean
  loadingMoreMembers: boolean
  hasMoreMembers: boolean
  error: string
  deltaUnreadCount: number
  communityName: string
  communityAvatarUrl: string
  deltaUnreadError: string
  deltaLatestMessage: string | null
  deltaLatestAt: string | null
  onOpenSupportCircle: () => void
  onOpenGroup: (group: GroupConversationSummary) => void
  onDeleteGroup: (conversationId: string) => Promise<void>
  onCreateGroup: () => void
  onOpenConversation: (conversation: PrivateConversationSummary) => void
  onStartConversation: (member: CommunityMember) => void
  onDeleteConversation: (conversationId: string) => Promise<boolean>
  onLoadMoreMembers: () => void
  onCancelPicker?: () => void
}

function messageTime(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  const today = new Date()
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function PrivateInboxView({
  className = '',
  mode = 'inbox',
  conversations,
  groups,
  members,
  currentUserId,
  loading,
  loadingMembers,
  loadingMoreMembers,
  hasMoreMembers,
  error,
  deltaUnreadCount,
  communityName,
  communityAvatarUrl,
  deltaUnreadError,
  deltaLatestMessage,
  deltaLatestAt,
  onOpenSupportCircle,
  onOpenGroup,
  onDeleteGroup,
  onCreateGroup,
  onOpenConversation,
  onStartConversation,
  onDeleteConversation,
  onLoadMoreMembers,
  onCancelPicker,
}: PrivateInboxViewProps) {
  const [starting, setStarting] = useState(false)
  const [query, setQuery] = useState('')
  const [conversationToDelete, setConversationToDelete] = useState<PrivateConversationSummary | null>(null)
  const [groupActionError, setGroupActionError] = useState('')
  const visibleMembers = useMemo(() => {
    const search = query.trim().toLowerCase()
    return members
      .filter((member) => member.id !== currentUserId)
      .filter((member) => !search || member.username.toLowerCase().includes(search))
  }, [currentUserId, members, query])
  const unreadTotal = [...conversations, ...groups].reduce((count, item) => count + (item.unreadCount > 0 ? 1 : 0), 0)
  const showMemberPicker = mode === 'picker' || starting

  function chooseMember(member: CommunityMember) {
    onStartConversation(member)
    setQuery('')
    setStarting(false)
  }

  async function retryGroupDeletion(conversationId: string) {
    try {
      await onDeleteGroup(conversationId)
      setGroupActionError('')
    } catch (actionError) {
      console.error('Could not complete group deletion.', actionError)
      setGroupActionError(actionError instanceof Error ? actionError.message : 'Group deletion could not be completed. Retry to continue.')
    }
  }

  return (
    <main className={`private-inbox-page ${className} ${mode === 'picker' ? 'picker-mode' : ''}`}>
      <header className="private-inbox-header">
        <div>
          <p className="eyebrow">{mode === 'picker' ? 'NEW CONVERSATION' : 'YOUR CONVERSATIONS'}</p>
          <h1>{mode === 'picker' ? 'Choose a member' : 'Conversations'}</h1>
          <p>{mode === 'picker' ? 'Choose someone you’d like to talk with one-to-one.' : `Open ${communityName} or reach out one-to-one.`}</p>
        </div>
        <span className="private-inbox-icon"><Inbox size={20} /></span>
      </header>
      <div className="private-inbox-toolbar">
        {!showMemberPicker
          ? <><button className="primary-button" onClick={() => setStarting(true)} type="button"><MessageCircle size={15} /> New conversation</button>
            <button className="private-inbox-back" onClick={onCreateGroup} type="button"><Users size={15} /> Create group</button></>
          : <button className="private-inbox-back" onClick={() => {
            setQuery('')
            if (mode === 'picker') onCancelPicker?.()
            else setStarting(false)
          }} type="button"><X size={15} /> Cancel</button>}
      </div>

      {error && <p className="private-inbox-error" role="alert">{error}</p>}
      {groupActionError && <p className="private-inbox-error" role="alert">{groupActionError}</p>}
      {deltaUnreadError && <p className="private-inbox-error" role="alert">{deltaUnreadError}</p>}

      {showMemberPicker ? (
        <section className="private-member-picker" aria-label="Choose a community member">
          <label className="private-member-search">
            <Search size={16} />
            <input
              aria-label="Search community members"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search community members"
              value={query}
            />
          </label>
          <div className="private-member-results">
            {visibleMembers.map((member) => (
              <button className="private-member-option" key={member.id ?? member.username} onClick={() => chooseMember(member)} type="button">
                {member.id && member.id === currentUserId ? null : <span className={`avatar avatar-${member.color}`}>{member.avatarUrl
                  ? <img className="avatar-image" src={member.avatarUrl} alt="" />
                  : member.initials}</span>}
                <span><strong>@{member.username}</strong><small>{member.admin ? 'Administrator' : 'Community member'}</small></span>
                <ArrowRight size={16} />
              </button>
            ))}
            {loadingMembers && <p className="private-inbox-empty">Loading community members…</p>}
            {!loadingMembers && !visibleMembers.length && <p className="private-inbox-empty">{query ? 'No matching members in the loaded list.' : 'No other community members are available.'}</p>}
          </div>
          {hasMoreMembers && <button className="private-load-members" disabled={loadingMoreMembers} onClick={onLoadMoreMembers} type="button">
            {loadingMoreMembers ? 'Loading…' : query ? 'Load more members' : 'Show more members'}
          </button>}
        </section>
      ) : (
        <section className="private-conversation-list" aria-label="Conversations">
          <div className="private-conversation-row delta-tea-row">
            <img className="avatar delta-tea-avatar private-conversation-avatar" src={communityAvatarUrl} alt="" />
            <button className="private-conversation-open" onClick={onOpenSupportCircle} type="button" aria-label={`Open ${communityName} support chat`}>
              <span className="private-conversation-topline"><strong>{communityName}</strong><time>{messageTime(deltaLatestAt)}</time></span>
              <span className="private-conversation-preview">{deltaLatestMessage ?? 'A place to listen and support'}</span>
            </button>
            {deltaUnreadCount > 0 && <span className="private-unread-count" aria-label={`${deltaUnreadCount} unread ${communityName} messages`}>{deltaUnreadCount > 99 ? '99+' : deltaUnreadCount}</span>}
          </div>
          {groups.map((group) => (
            <div className="private-conversation-row" key={group.conversationId}>
              <img className="avatar private-conversation-avatar" src={group.avatarUrl} alt="" />
              <button className="private-conversation-open" disabled={group.deletionPending} onClick={() => onOpenGroup(group)} type="button">
                <span className="private-conversation-topline"><strong>{group.title}</strong><time>{messageTime(group.latestMessageAt)}</time></span>
                <span className="private-conversation-preview">{group.deletionPending
                  ? 'Deletion cleanup pending · retry to finish'
                  : group.latestMessage ?? `${group.memberCount} members · ${group.myRole === 'admin' ? 'Group admin' : 'Group'}`}</span>
              </button>
              {group.deletionPending && <button className="private-delete-button" onClick={() => { void retryGroupDeletion(group.conversationId) }} type="button" aria-label={`Retry deletion of ${group.title}`}><Trash2 size={16} /></button>}
              {group.unreadCount > 0 && !group.deletionPending && <span className="private-unread-count" aria-label={`${group.unreadCount} unread messages`}>{group.unreadCount > 99 ? '99+' : group.unreadCount}</span>}
            </div>
          ))}
          {loading && !conversations.length && !groups.length && <p className="private-inbox-empty">Loading your conversations…</p>}
          {!loading && !conversations.length && !groups.length && <div className="private-inbox-empty-card">
            <Users size={24} />
            <strong>No one-to-one conversations yet</strong>
            <span>Start a conversation whenever you’re ready to talk.</span>
          </div>}
          {conversations.map((conversation) => (
            <div className="private-conversation-row" key={conversation.conversationId}>
              {conversation.peerAvatarUrl
                ? <img className="avatar private-conversation-avatar" src={conversation.peerAvatarUrl} alt="" referrerPolicy="no-referrer" />
                : <span className="avatar avatar-coral private-conversation-avatar">{conversation.peerUsername.slice(0, 1).toUpperCase()}</span>}
              <button className="private-conversation-open" disabled={conversation.deletionPending} onClick={() => onOpenConversation(conversation)} type="button">
                <span className="private-conversation-topline"><strong>{conversation.peerId ? `@${conversation.peerUsername}` : conversation.peerUsername}</strong><time>{messageTime(conversation.latestMessageAt)}</time></span>
                <span className="private-conversation-preview">{conversation.deletionPending
                  ? 'Deletion cleanup pending · retry to finish'
                  : conversation.latestMessage ?? 'No messages yet'}</span>
              </button>
              {conversation.unreadCount > 0 && !conversation.deletionPending && <span className="private-unread-count" aria-label={`${conversation.unreadCount} unread messages`}>{conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</span>}
              <button
                className="private-delete-button"
                onClick={() => {
                  if (conversation.deletionPending) void onDeleteConversation(conversation.conversationId)
                  else setConversationToDelete(conversation)
                }}
                type="button"
                aria-label={conversation.deletionPending
                  ? `Retry deletion of conversation with ${conversation.peerUsername}`
                  : `Permanently delete conversation with ${conversation.peerUsername}`}
              ><Trash2 size={16} /></button>
            </div>
          ))}
          {unreadTotal > 0 && <p className="private-inbox-footnote">{unreadTotal} conversation{unreadTotal === 1 ? '' : 's'} with unread messages</p>}
        </section>
      )}
      {conversationToDelete && !conversationToDelete.deletionPending && <ConfirmDialog
        title="Permanently delete conversation?"
        message={`This permanently deletes the chat and all messages and media for both people. This cannot be undone.`}
        confirmLabel="Delete permanently"
        onCancel={() => setConversationToDelete(null)}
        onConfirm={() => {
          const conversationId = conversationToDelete.conversationId
          setConversationToDelete(null)
          void onDeleteConversation(conversationId)
        }}
      />}
    </main>
  )
}
