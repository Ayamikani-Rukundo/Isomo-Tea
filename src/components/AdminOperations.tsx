import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Activity, Ban, Check, Clock3, RefreshCw, Shield, Trash2, UserPlus, Users } from 'lucide-react'
import {
  adminConsoleAction,
  inviteAdministrator,
  type AdminAuditEntry,
  type AdminMember,
  type AdminOverviewData,
  type AdminRole,
} from '../lib/admin-console'
import { ConfirmDialog } from './ConfirmDialog'
import { CommunitySettingsAdmin } from './CommunitySettingsAdmin'

type Pane = 'overview' | 'members' | 'administrators' | 'moderation' | 'community' | 'audit'

type AdminOperationsProps = {
  userId: string
  communityName: string
  communityAvatarUrl: string
  communityAvatarPath: string | null
  onCommunitySettingsChanged: () => void
}

type GeneralMessage = {
  id: string
  body: string
  author: string
  created_at: string
}

function localDateTimeValue(date: Date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 16)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

const panes: Array<{ id: Pane; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'members', label: 'Members' },
  { id: 'administrators', label: 'Administrators' },
  { id: 'moderation', label: 'Moderation' },
  { id: 'community', label: 'Group profile' },
  { id: 'audit', label: 'Audit log' },
]

export function AdminOperations({
  userId,
  communityName,
  communityAvatarUrl,
  communityAvatarPath,
  onCommunitySettingsChanged,
}: AdminOperationsProps) {
  const [pane, setPane] = useState<Pane>('overview')
  const [overview, setOverview] = useState<AdminOverviewData | null>(null)
  const [members, setMembers] = useState<AdminMember[]>([])
  const [memberOffset, setMemberOffset] = useState(0)
  const [membersHaveMore, setMembersHaveMore] = useState(false)
  const [administrators, setAdministrators] = useState<AdminRole[]>([])
  const [messages, setMessages] = useState<GeneralMessage[]>([])
  const [auditEntries, setAuditEntries] = useState<AdminAuditEntry[]>([])
  const [email, setEmail] = useState('')
  const [messageId, setMessageId] = useState('')
  const [startAt, setStartAt] = useState(() => localDateTimeValue(new Date(Date.now() - 7 * 86400000)))
  const [endAt, setEndAt] = useState(() => localDateTimeValue(new Date()))
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    title: string
    message: string
    confirmLabel: string
    confirm: () => void
  } | null>(null)
  const loadGeneration = useRef(0)

  const load = useCallback(async (targetPane: Pane, offset = 0) => {
    const generation = ++loadGeneration.current
    try {
      if (targetPane === 'overview') {
        const { overview: result } = await adminConsoleAction<{ overview: AdminOverviewData }>({ action: 'overview' })
        if (generation !== loadGeneration.current) return
        setOverview(result)
      } else if (targetPane === 'members') {
        const { members: result, hasMore } = await adminConsoleAction<{ members: AdminMember[]; hasMore: boolean }>({
          action: 'members',
          offset,
        })
        if (generation !== loadGeneration.current) return
        setMembers(result)
        setMemberOffset(offset)
        setMembersHaveMore(hasMore)
      } else if (targetPane === 'administrators') {
        const { administrators: result } = await adminConsoleAction<{ administrators: AdminRole[] }>({ action: 'administrators' })
        if (generation !== loadGeneration.current) return
        setAdministrators(result)
      } else if (targetPane === 'moderation') {
        const { messages: result } = await adminConsoleAction<{ messages: GeneralMessage[] }>({ action: 'general-messages' })
        if (generation !== loadGeneration.current) return
        setMessages(result)
      } else if (targetPane === 'audit') {
        const { entries } = await adminConsoleAction<{ entries: AdminAuditEntry[] }>({ action: 'audit-log' })
        if (generation !== loadGeneration.current) return
        setAuditEntries(entries)
      }
    } catch (loadError) {
      if (generation !== loadGeneration.current) return
      setError(loadError instanceof Error ? loadError.message : 'Administrator data could not be loaded.')
    } finally {
      if (generation === loadGeneration.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => {
      if (active) return load(pane, pane === 'members' ? memberOffset : 0)
    })
    return () => { active = false }
  }, [load, memberOffset, pane])

  async function runOperation(operation: () => Promise<void>, successText: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await operation()
      setNotice(successText)
      setLoading(true)
      await load(pane)
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'The administrator action failed.')
    } finally {
      setBusy(false)
    }
  }

  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const invitedEmail = email.trim()
    if (!invitedEmail) return
    void runOperation(async () => {
      await inviteAdministrator(invitedEmail)
      setEmail('')
    }, 'Administrator invitation sent.')
  }

  function changeMemberAccess(member: AdminMember) {
    const active = member.suspended
    const action = active ? 'Restore' : 'Suspend'
    if (!window.confirm(`${action} access for ${member.username}?`)) return
    void runOperation(async () => {
      await adminConsoleAction({ action: 'set-member-access', userId: member.id, active })
    }, `${member.username} access ${active ? 'restored' : 'suspended'}.`)
  }

  function removeAdministrator(role: AdminRole) {
    if (!window.confirm(`Remove administrator access from ${role.username}?`)) return
    void runOperation(async () => {
      await adminConsoleAction({ action: 'remove-administrator', userId: role.user_id })
    }, `${role.username} is no longer an administrator.`)
  }

  function deleteGeneralMessage(message: GeneralMessage) {
    setPendingConfirmation({
      title: 'Delete message?',
      message: `Delete this ${communityName} message from ${message.author} for everyone?`,
      confirmLabel: 'Delete for everyone',
      confirm: () => {
        void runOperation(async () => {
          await adminConsoleAction({ action: 'delete-message', messageId: message.id })
        }, 'Message deleted for everyone.')
      },
    })
  }

  function deleteMessageById(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const targetId = messageId.trim()
    if (!targetId) return
    setPendingConfirmation({
      title: 'Delete message?',
      message: `Delete message ${targetId} for everyone?`,
      confirmLabel: 'Delete for everyone',
      confirm: () => {
        void runOperation(async () => {
          await adminConsoleAction({ action: 'delete-message', messageId: targetId })
          setMessageId('')
        }, 'Message deleted for everyone.')
      },
    })
  }

  function clearHistory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const start = new Date(startAt)
    const end = new Date(endAt)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
      setError('Choose a valid date range.')
      return
    }
    setPendingConfirmation({
      title: `Clear ${communityName} history?`,
      message: `Clear messages from ${formatDate(start.toISOString())} through ${formatDate(end.toISOString())}? This cannot be undone.`,
      confirmLabel: 'Clear history',
      confirm: () => {
        void runOperation(async () => {
          const { clearedCount } = await adminConsoleAction<{ clearedCount: number }>({
            action: 'clear-history',
            startAt: start.toISOString(),
            endAt: end.toISOString(),
          })
          setNotice(`${clearedCount} ${communityName} messages cleared.`)
        }, `${communityName} history cleared.`)
      },
    })
  }

  const stats = overview ? [
    { label: 'Members', value: overview.members, icon: Users },
    { label: 'Administrators', value: overview.administrators, icon: Shield },
    { label: 'Messages', value: overview.messages, icon: Activity },
    { label: 'New members · 7 days', value: overview.recentMembers, icon: Clock3 },
  ] : []

  return (
    <section className="admin-operations">
      <nav className="admin-ops-tabs" aria-label="Administrator tools">
        {panes.map((item) => <button
          aria-current={pane === item.id ? 'page' : undefined}
          className={pane === item.id ? 'active' : ''}
          key={item.id}
          onClick={() => { setNotice(''); setError(''); setLoading(true); setPane(item.id) }}
          type="button"
        >{item.label}</button>)}
      </nav>
      <div className="admin-ops-content">
        <div className="admin-ops-heading">
          <div><p className="eyebrow">ADMINISTRATION</p><h2>{panes.find((item) => item.id === pane)?.label}</h2></div>
          <button className="admin-refresh" onClick={() => { setError(''); setLoading(true); void load(pane) }} type="button" disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spinning' : ''} /><span>Refresh</span>
          </button>
        </div>
        {error && <p className="admin-feedback error" role="alert">{error}</p>}
        {notice && <p className="admin-feedback success" role="status">{notice}</p>}
        {loading ? <div className="admin-empty-state"><RefreshCw size={20} className="spinning" /><p>Loading administrator data…</p></div> : (
          <>
            {pane === 'overview' && <div className="admin-stat-grid">
              {stats.map(({ label, value, icon: Icon }) => <article className="admin-stat-card" key={label}>
                <span><Icon size={16} /></span><small>{label}</small><strong>{value.toLocaleString()}</strong>
              </article>)}
              <article className="admin-stat-card"><span><Check size={16} /></span><small>Active access codes</small><strong>{overview?.activeCodes ?? 0}</strong></article>
            </div>}

            {pane === 'members' && <div className="admin-ops-list">
              <p className="admin-section-note">Member access is enforced by Supabase Auth. Page {Math.floor(memberOffset / 100) + 1}.</p>
              {members.map((member) => <article className="admin-ops-row" key={member.id}>
                <span className="admin-ops-avatar">{member.username.slice(0, 2).toUpperCase()}</span>
                <span className="admin-ops-row-copy"><strong>{member.username}</strong><small>Joined {formatDate(member.created_at)}</small></span>
                <span className={`admin-status-badge ${member.suspended ? 'inactive' : 'active'}`}><i />{member.suspended ? 'Suspended' : 'Active'}</span>
                <button className={member.suspended ? 'admin-secondary-button' : 'admin-danger-button'} disabled={busy} onClick={() => changeMemberAccess(member)} type="button">
                  {member.suspended ? 'Restore' : 'Suspend'}
                </button>
              </article>)}
              <div className="admin-member-pagination">
                <button className="admin-secondary-button" disabled={loading || memberOffset === 0} onClick={() => { setLoading(true); setMemberOffset(Math.max(memberOffset - 100, 0)) }} type="button">Previous</button>
                <button className="admin-secondary-button" disabled={loading || !membersHaveMore} onClick={() => { setLoading(true); setMemberOffset(memberOffset + 100) }} type="button">Next</button>
              </div>
              {!members.length && <div className="admin-empty-state"><p>No community members found.</p></div>}
            </div>}

            {pane === 'administrators' && <>
              <form className="admin-card admin-invite-form" onSubmit={invite}>
                <label className="admin-field"><span>Invite administrator by email</span><input autoComplete="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></label>
                <button className="admin-primary-button" disabled={busy} type="submit"><UserPlus size={15} />{busy ? 'Sending…' : 'Send invitation'}</button>
              </form>
              <div className="admin-ops-list">
                {administrators.map((role) => <article className="admin-ops-row" key={role.user_id}>
                  <span className="admin-ops-avatar"><Shield size={15} /></span>
                  <span className="admin-ops-row-copy"><strong>{role.username}</strong><small>Administrator since {formatDate(role.created_at)}</small></span>
                  <button className="admin-danger-button" disabled={busy || administrators.length <= 1} onClick={() => removeAdministrator(role)} type="button">Remove access</button>
                </article>)}
              </div>
            </>}

            {pane === 'moderation' && <>
              <section className="admin-card">
                <div className="admin-card-heading"><span className="admin-icon-box"><Trash2 size={16} /></span><div><h2>Recent {communityName} messages</h2><p>Only community message text is listed here; private conversation content is not exposed.</p></div></div>
                <div className="admin-ops-list">
                  {messages.map((message) => <article className="admin-ops-row admin-message-row" key={message.id}>
                    <span className="admin-ops-row-copy"><strong>{message.author} · {formatDate(message.created_at)}</strong><small>{message.body}</small><code>{message.id}</code></span>
                    <button className="admin-danger-button" disabled={busy} onClick={() => deleteGeneralMessage(message)} type="button">Delete</button>
                  </article>)}
                  {!messages.length && <p className="admin-section-note">No recent messages are available.</p>}
                </div>
              </section>
              <form className="admin-card admin-invite-form" onSubmit={deleteMessageById}>
                <label className="admin-field"><span>Delete a message by ID</span><input autoComplete="off" onChange={(event) => setMessageId(event.target.value)} placeholder="Message UUID" required value={messageId} /></label>
                <button className="admin-danger-button" disabled={busy} type="submit"><Trash2 size={14} />Delete message</button>
              </form>
              <form className="admin-card admin-history-form" onSubmit={clearHistory}>
                <div className="admin-card-heading"><span className="admin-icon-box"><Ban size={16} /></span><div><h2>Clear {communityName} history</h2><p>Messages in the selected half-open interval are replaced by deletion records. Private conversations are not changed.</p></div></div>
                <div className="admin-form-grid">
                  <label className="admin-field"><span>Start date/time</span><input onChange={(event) => setStartAt(event.target.value)} required type="datetime-local" value={startAt} /></label>
                  <label className="admin-field"><span>End date/time</span><input onChange={(event) => setEndAt(event.target.value)} required type="datetime-local" value={endAt} /></label>
                </div>
                <button className="admin-danger-button" disabled={busy} type="submit">{busy ? 'Clearing…' : 'Clear selected history'}</button>
              </form>
            </>}

            {pane === 'audit' && <div className="admin-ops-list">
              {auditEntries.map((entry) => <article className="admin-ops-row" key={entry.id}>
                <span className="admin-ops-avatar"><Activity size={14} /></span>
                <span className="admin-ops-row-copy"><strong>{entry.action.replaceAll('.', ' ')}</strong><small>{formatDate(entry.created_at)} · {entry.actor_id ?? 'system'}</small>
                  {(entry.target_user_id || entry.target_message_id) && <code>{entry.target_user_id ?? entry.target_message_id}</code>}
                  {Object.keys(entry.details).length > 0 && <small>{JSON.stringify(entry.details)}</small>}
                </span>
              </article>)}
              {!auditEntries.length && <div className="admin-empty-state"><p>No administrator actions recorded yet.</p></div>}
            </div>}
            {pane === 'community' && <CommunitySettingsAdmin
              key={`${communityName}:${communityAvatarPath ?? ''}`}
              userId={userId}
              title={communityName}
              avatarUrl={communityAvatarUrl}
              avatarPath={communityAvatarPath}
              onUpdated={onCommunitySettingsChanged}
            />}
          </>
        )}
      </div>
      {pendingConfirmation && <ConfirmDialog
        title={pendingConfirmation.title}
        message={pendingConfirmation.message}
        confirmLabel={pendingConfirmation.confirmLabel}
        onCancel={() => setPendingConfirmation(null)}
        onConfirm={() => {
          const confirmation = pendingConfirmation
          setPendingConfirmation(null)
          confirmation.confirm()
        }}
      />}
    </section>
  )
}
