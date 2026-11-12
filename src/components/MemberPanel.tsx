import { ArrowLeft, ArrowUpRight, Check, ShieldCheck, X } from 'lucide-react'
import type { CommunityMember } from '../types'

type MemberPanelProps = {
  communityName: string
  communityAvatarUrl: string
  members: CommunityMember[]
  onMessage: (username: string, userId?: string) => void
  onClose: () => void
  loading?: boolean
  loadingMore?: boolean
  hasMore?: boolean
  error?: string
  onLoadMore?: () => void
}

export function MemberPanel({
  communityName,
  communityAvatarUrl,
  members,
  onMessage,
  onClose,
  loading = false,
  loadingMore = false,
  hasMore = false,
  error = '',
  onLoadMore,
}: MemberPanelProps) {
  return (
    <aside className="member-panel mobile-open">
      <div className="panel-title-row">
        <div><p className="eyebrow">SUPPORT CIRCLE</p><h2>About the circle</h2></div>
        <button className="panel-icon panel-close" onClick={onClose} type="button" aria-label="Close community panel">
          <X className="desktop-panel-close-icon" size={16} />
          <ArrowLeft className="mobile-panel-back-icon" size={18} />
        </button>
      </div>
      <div className="community-card">
        <div className="community-cover"><span>ISOMO <i>✳</i> SUPPORT</span></div>
        <div className="community-card-body">
          <img className="community-card-avatar" src={communityAvatarUrl} alt="" />
          <strong>{communityName}</strong>
          <p>A space to listen and support</p>
          <div className="member-count"><span className="online-dot" /> {loading ? 'Loading members…' : `${members.length}${hasMore ? '+' : ''} people in the circle`}</div>
        </div>
      </div>
      <div className="member-list-heading">
        <h3>In the circle <span>{members.length}{hasMore ? '+' : ''}</span></h3>
        {!loading && <span className="online-count">Presence unavailable</span>}
      </div>
      <div className="member-list">
        {members.map((member) => (
          <button className="member-row" key={member.id ?? member.username} onClick={() => onMessage(member.username, member.id)} type="button">
            <span className={`avatar avatar-${member.color}`}>{member.avatarUrl
              ? <img className="avatar-image" src={member.avatarUrl} alt="" />
              : member.initials}<i className={`status-dot ${member.status}`} /></span>
            <span className="member-name"><strong>{member.username}</strong><small>{member.admin ? 'Administrator' : member.status === 'online' ? 'Around now' : member.status === 'away' ? 'Away for a bit' : 'Community member'}</small></span>
            <ArrowUpRight size={14} className="member-action" />
          </button>
        ))}
        {!loading && error && <p className="member-load-error" role="alert">Members could not be loaded: {error}</p>}
        {!loading && !error && !members.length && <p className="member-load-error">No community members found.</p>}
        {!loading && !error && hasMore && <button className="member-load-more" type="button" onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more members'}</button>}
      </div>
      <div className="privacy-note">
        <ShieldCheck size={17} />
        <span>Share at your pace.<br /><strong>Ask for support when you’re ready.</strong></span>
        <Check size={14} className="privacy-check" />
      </div>
      <div className="panel-footer">Peer support for Isomo <span>✳</span></div>
    </aside>
  )
}
