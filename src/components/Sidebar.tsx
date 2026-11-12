import { useState } from 'react'
import { CircleUserRound, LogOut, MessageCircle, Moon, ShieldCheck, Sun, WifiOff } from 'lucide-react'
import type { AppSection } from '../types'
import { Brand } from './Brand'

type SidebarProps = {
  active: AppSection
  theme: 'dark' | 'light'
  username: string
  avatarUrl?: string | null
  isAdministrator: boolean
  collapsed?: boolean
  isOnline: boolean
  messageUnreadCount?: number
  onNavigate: (section: AppSection) => void
  onToggleTheme: () => void
  onSignOut: () => Promise<void>
}

export function Sidebar({
  active,
  theme,
  username,
  avatarUrl,
  isAdministrator,
  collapsed = false,
  isOnline,
  messageUnreadCount = 0,
  onNavigate,
  onToggleTheme,
  onSignOut,
}: SidebarProps) {
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const links: { id: AppSection; label: string; icon: typeof MessageCircle; unread?: string }[] = [
    { id: 'inbox', label: 'Conversations', icon: MessageCircle, unread: messageUnreadCount > 0 ? messageUnreadCount > 99 ? '99+' : String(messageUnreadCount) : undefined },
    { id: 'profile', label: 'Your profile', icon: CircleUserRound },
    ...(isAdministrator ? [{ id: 'admin' as const, label: 'Admin codes', icon: ShieldCheck }] : []),
  ]

  async function signOut() {
    setSigningOut(true)
    setSignOutError('')
    try {
      await onSignOut()
    } catch (error) {
      console.error('Could not sign out from the navigation panel.', error)
      setSignOutError(error instanceof Error ? error.message : 'Could not sign out.')
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="sidebar-top">
        <Brand compact={collapsed} onClick={() => onNavigate('inbox')} />
        <div className="community-chip" title="Isomo Academy">
          <span className="community-avatar">IA</span>
          <span><strong>Isomo Academy</strong><small>Peer support space</small></span>
        </div>
        <nav className="primary-nav" aria-label="Main navigation">
          <p className="nav-caption">SUPPORT SPACE</p>
          {links.map(({ id, label, icon: Icon, unread }) => (
            <button
              className={`nav-link ${(id === 'inbox' ? active === 'inbox' || active === 'tea' : active === id) ? 'selected' : ''}`}
              key={id}
              onClick={() => onNavigate(id)}
              type="button"
              title={collapsed ? label : undefined}
              aria-label={collapsed ? label : undefined}
            >
              <Icon size={18} />
              <span>{label}</span>
              {unread && <span className="unread-count">{unread}</span>}
            </button>
          ))}
        </nav>
        {!isOnline && <div className="sidebar-offline-status" role="status" title="Connect to the internet to send messages">
          <WifiOff size={15} />
          <span>You’re offline. Connect to the internet to send messages.</span>
        </div>}
      </div>

      <div className="sidebar-bottom">
        <div className="daily-note">
          <span className="note-spark">✳</span>
          <p><strong>You’re not alone.</strong><br />Share at your own pace.</p>
        </div>
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          type="button"
          aria-label={`${theme === 'dark' ? 'Dark' : 'Light'} Mode selected; switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
        >
          <span className="theme-toggle-icon">{theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}</span>
          <span className="theme-toggle-label">{theme === 'dark' ? 'Dark Mode' : 'Light Mode'}</span>
        </button>
        <div className="profile-mini">
          {avatarUrl
            ? <img className="avatar sidebar-avatar" src={avatarUrl} alt="" />
            : <span className="avatar avatar-self">{username.slice(0, 1).toUpperCase() || '?'}</span>}
          <span><strong>{username}</strong><small>Here to listen.</small></span>
          <span className="mini-status" />
        </div>
        {signOutError && <p className="sidebar-signout-error" role="alert">{signOutError}</p>}
        <button className="sidebar-signout" onClick={() => void signOut()} disabled={signingOut} type="button" aria-label={signingOut ? 'Signing out' : 'Sign out'} title={collapsed ? 'Sign out' : undefined}>
          <LogOut size={15} /> <span>{signingOut ? 'Signing out…' : 'Sign out'}</span>
        </button>
      </div>
    </aside>
  )
}
