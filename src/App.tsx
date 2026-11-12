import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Bell, X } from 'lucide-react'
import { ChatView } from './components/ChatView'
import { AuthScreen } from './components/AuthScreen'
import { AdminDashboard } from './components/AdminDashboard'
import { MemberPanel } from './components/MemberPanel'
import { ProfileView } from './components/ProfileView'
import { PrivateInboxView } from './components/PrivateInboxView'
import { ChatListPane } from './components/ChatListPane'
import { ChatLandingPane } from './components/ChatLandingPane'
import { Sidebar } from './components/Sidebar'
import type { AppSection } from './types'
import { AuthProvider } from './context/AuthProvider'
import { useAuth } from './context/useAuth'
import { clearLocalSession, signOut } from './lib/auth'
import { useConversationChat, useGeneralChat } from './hooks/useGeneralChat'
import { useCommunityMembers } from './hooks/useCommunityMembers'
import { usePrivateInbox } from './hooks/usePrivateInbox'
import { useCommunitySettings } from './hooks/useCommunitySettings'
import { loadUserSettings, saveUserSettings } from './lib/settings'
import {
  checkNativeNotificationPermission,
  listenForNativeNotificationActions,
  requestNativeNotificationPermission,
  registerNativePush,
  type NativeNotificationPermission,
} from './lib/nativeNotifications'
import { browserNotificationPermission, browserPushConfigured, enableWebPush } from './lib/webPush'
import { supabase } from './lib/supabase'
import './App.css'

function readTheme(): 'dark' | 'light' {
  const stored = localStorage.getItem('isomo-theme')
  return stored === 'light' || stored === 'dark' ? stored : 'dark'
}

function AppContent() {
  const nativeApp = Capacitor.isNativePlatform()
  const [section, setSection] = useState<AppSection>(() => (
    new URLSearchParams(window.location.search).get('section') === 'inbox' ? 'inbox' : 'welcome'
  ))
  const [theme, setTheme] = useState<'dark' | 'light'>(readTheme)
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [showMembers, setShowMembers] = useState(false)
  const [privateName, setPrivateName] = useState('Private Inbox')
  const [privatePeerId, setPrivatePeerId] = useState<string | null>(null)
  const [privateConversationId, setPrivateConversationId] = useState<string | null>(null)
  const [startingConversation, setStartingConversation] = useState(false)
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)
  const [notificationsSnoozedUntil, setNotificationsSnoozedUntil] = useState<string | null>(null)
  const [settingsLoadedFor, setSettingsLoadedFor] = useState<string | null>(null)
  const [notificationPromptDismissed, setNotificationPromptDismissed] = useState(false)
  const [notificationPermission, setNotificationPermission] = useState<NativeNotificationPermission>(
    nativeApp ? 'prompt' : browserNotificationPermission(),
  )
  const [settingsError, setSettingsError] = useState('')
  const [deltaUnreadCount, setDeltaUnreadCount] = useState(0)
  const [deltaUnreadError, setDeltaUnreadError] = useState('')
  const [deltaReadMarker, setDeltaReadMarker] = useState<{ userId: string; readAt: string } | null>(null)
  const { session, profile, isAdministrator, administratorError, loading, profileError, refreshProfile, clearSession } = useAuth()
  const userId = session?.user.id
  const communitySettings = useCommunitySettings(userId)
  const signedInLanding = Boolean(session && (section === 'welcome' || section === 'auth'))
  const generalChatEnabled = Boolean(session)
  const generalChat = useGeneralChat(session, generalChatEnabled, profile)
  const privateChatEnabled = Boolean(
    session
    && section === 'inbox'
    && (privatePeerId || privateConversationId),
  )
  const privateChat = useConversationChat(
    session,
    privateChatEnabled,
    profile,
    'private',
    privatePeerId ?? undefined,
    privateConversationId ?? undefined,
  )
  const privateInbox = usePrivateInbox(session, section === 'inbox' || section === 'tea' || signedInLanding)
  const community = useCommunityMembers(profile?.id, Boolean(
    session && (section === 'tea' || section === 'inbox' || signedInLanding),
  ))
  const latestGeneralMessage = generalChat.messages[generalChat.messages.length - 1]
  const generalMessageRevision = generalChat.messages.map((message) => message.id).join('|')
  const deltaLatestPreview = latestGeneralMessage?.body
    || (latestGeneralMessage?.media
      ? `${latestGeneralMessage.media.kind === 'image' ? 'Photo' : latestGeneralMessage.media.kind === 'video' ? 'Video' : 'Audio'}${latestGeneralMessage.media.viewOnce ? ' · View once' : ''}`
      : latestGeneralMessage?.poll ? 'Poll' : latestGeneralMessage?.sticker ? 'Sticker' : null)

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    let active = true
    const refreshPermission = async () => {
      try {
        const permission = nativeApp
          ? await checkNativeNotificationPermission()
          : browserNotificationPermission()
        if (active) setNotificationPermission(permission)
      } catch (error) {
        if (!active) return
        console.error('Could not check Android notification permission.', error)
        setNotificationPermission('unavailable')
      }
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshPermission()
    }
    void refreshPermission()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleVisibilityChange)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleVisibilityChange)
    }
  }, [nativeApp])

  useEffect(() => {
    if (!nativeApp) return undefined
    let active = true
    let removeListener: (() => Promise<void>) | undefined
    void listenForNativeNotificationActions().then((cleanup) => {
      if (active) removeListener = cleanup
      else void cleanup()
    }).catch((error: unknown) => {
      console.error('Could not listen for Android notification taps.', error)
    })
    return () => {
      active = false
      if (removeListener) void removeListener()
    }
  }, [nativeApp])

  useEffect(() => {
    if (!session) return
    let active = true
    void loadUserSettings(session.user.id).then((settings) => {
      if (!active || !settings) return
      setTheme(settings.theme)
      localStorage.setItem('isomo-theme', settings.theme)
      setNotificationsEnabled(settings.notifications_enabled)
      const activeSnooze = settings.notifications_snoozed_until
        && new Date(settings.notifications_snoozed_until).getTime() > Date.now()
        ? settings.notifications_snoozed_until
        : null
      setNotificationsSnoozedUntil(activeSnooze)
      if (settings.notifications_snoozed_until && !activeSnooze) {
        void saveUserSettings(session.user.id, { notifications_snoozed_until: null }).catch((error: unknown) => {
          console.error('Could not clear the expired notification pause.', error)
        })
      }
      setSettingsError('')
    }).catch((error: unknown) => {
      if (!active) return
      console.error('Could not load account preferences.', error)
      setSettingsError('Account preferences could not be loaded. Changes may not match your other devices.')
    }).finally(() => {
      if (active) setSettingsLoadedFor(session.user.id)
    })
    return () => { active = false }
  }, [session])

  useEffect(() => {
    if (!nativeApp || !userId || settingsLoadedFor !== userId || !notificationsEnabled || notificationPermission !== 'granted') return undefined
    let active = true
    let removeListeners: (() => Promise<void>) | undefined
    void registerNativePush(userId, (message) => {
      if (active) setSettingsError(message)
    }).then((cleanup) => {
      if (active) removeListeners = cleanup
      else void cleanup()
    }).catch((error: unknown) => {
      if (!active) return
      console.error('Could not register Android push notifications.', error)
      setSettingsError('Push notifications could not be started on this Android device.')
    })
    return () => {
      active = false
      if (removeListeners) void removeListeners()
    }
  }, [nativeApp, notificationPermission, notificationsEnabled, settingsLoadedFor, userId])

  useEffect(() => {
    if (!userId || !notificationsSnoozedUntil) return undefined
    const delay = Math.max(0, new Date(notificationsSnoozedUntil).getTime() - Date.now())
    const timeout = window.setTimeout(() => {
      setNotificationsSnoozedUntil(null)
      void saveUserSettings(userId, { notifications_snoozed_until: null }).catch((error: unknown) => {
        console.error('Could not resume message notifications after the pause ended.', error)
      })
    }, delay)
    return () => window.clearTimeout(timeout)
  }, [notificationsSnoozedUntil, userId])

  useEffect(() => {
    const handleOpenInbox = () => setSection('inbox')
    window.addEventListener('isomo:open-inbox', handleOpenInbox)
    return () => window.removeEventListener('isomo:open-inbox', handleOpenInbox)
  }, [])

  function markDeltaRead() {
    if (!userId) return
    const readAt = new Date().toISOString()
    localStorage.setItem(`delta-tea-last-read:${userId}`, readAt)
    setDeltaReadMarker({ userId, readAt })
    setDeltaUnreadCount(0)
    setDeltaUnreadError('')
  }

  useEffect(() => {
    if (!userId || !generalChat.conversationId || section === 'tea' || !supabase) return
    const storageKey = `delta-tea-last-read:${userId}`
    const storedReadAt = deltaReadMarker?.userId === userId
      ? deltaReadMarker.readAt
      : localStorage.getItem(storageKey)
    const readAt = storedReadAt ?? new Date().toISOString()
    if (!storedReadAt) localStorage.setItem(storageKey, readAt)
    let active = true
    void supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', generalChat.conversationId)
      .neq('sender_id', userId)
      .gt('created_at', readAt)
      .is('deleted_at', null)
      .then(({ count, error }) => {
        if (!active) return
        if (error) {
          console.error('Could not load Support Circle unread count.', error)
          setDeltaUnreadError('Support Circle unread messages could not be counted.')
          return
        }
        setDeltaUnreadCount(count ?? 0)
        setDeltaUnreadError('')
      })
    return () => { active = false }
  }, [deltaReadMarker, generalChat.conversationId, generalMessageRevision, section, userId])

  function navigate(next: AppSection) {
    if (next !== 'welcome' && next !== 'auth' && !session) {
      setSection('welcome')
      return
    }
    if (next === 'admin' && !isAdministrator) return
    if (next === 'tea' || section === 'tea') markDeltaRead()
    if (next === 'inbox') {
      setPrivatePeerId(null)
      setPrivateConversationId(null)
      setStartingConversation(false)
    }
    setSection(next)
    setShowMembers(false)
  }

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('isomo-theme', next)
    if (session) {
      void saveUserSettings(session.user.id, { theme: next }).then(() => {
        setSettingsError('')
      }).catch((error: unknown) => {
        console.error('Could not save the appearance preference.', error)
        setSettingsError('The appearance changed on this device, but could not be saved to your account.')
      })
    }
  }

  async function changeNotifications(enabled: boolean) {
    if (!session) return
    const previous = notificationsEnabled
    if (enabled) {
      try {
        if (nativeApp) {
          const permission = await requestNativeNotificationPermission()
          setNotificationPermission(permission)
          if (permission !== 'granted') {
            setSettingsError(permission === 'denied'
              ? 'Notifications are blocked. Allow Isomo Support notifications in Android settings, then try again.'
              : 'Android did not grant notification permission. Please try again.')
            return
          }
        } else {
          await enableWebPush(session.user.id)
          setNotificationPermission('granted')
        }
      } catch (error) {
        if (!nativeApp) setNotificationPermission(browserNotificationPermission())
        console.error('Could not enable message notifications.', error)
        setSettingsError(error instanceof Error ? error.message : 'Notifications could not be enabled.')
        return
      }
    }
    setNotificationsEnabled(enabled)
    try {
      await saveUserSettings(session.user.id, { notifications_enabled: enabled })
      setSettingsError('')
    } catch (error) {
      console.error('Could not save notification preferences.', error)
      setNotificationsEnabled(previous)
      setSettingsError('Notification preferences could not be saved. Please try again.')
    }
  }

  async function changeNotificationSnooze(hours: number | null) {
    if (!session) return
    const next = hours === null ? null : new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
    const previous = notificationsSnoozedUntil
    setNotificationsSnoozedUntil(next)
    try {
      await saveUserSettings(session.user.id, { notifications_snoozed_until: next })
      setSettingsError('')
    } catch (error) {
      console.error('Could not update the notification pause.', error)
      setNotificationsSnoozedUntil(previous)
      setSettingsError('The notification pause could not be saved. Please try again.')
    }
  }
  function openPrivateChat(username: string, userId?: string) {
    if (userId && userId === profile?.id) return
    if (section === 'tea') markDeltaRead()
    setPrivateName(username)
    setPrivatePeerId(userId ?? null)
    setPrivateConversationId(null)
    setStartingConversation(false)
    setSection('inbox')
    setShowMembers(false)
  }

  function openPrivateConversation(conversationId: string, username: string, peerId: string | null) {
    setPrivateName(username)
    setPrivatePeerId(peerId)
    setPrivateConversationId(conversationId)
    setStartingConversation(false)
    setSection('inbox')
    setShowMembers(false)
  }

  async function handleSignOut() {
    if (section === 'tea') markDeltaRead()
    await signOut()
    clearSession()
    setNotificationsEnabled(true)
    setNotificationsSnoozedUntil(null)
    setSettingsLoadedFor(null)
    setNotificationPromptDismissed(false)
    setSettingsError('')
    setPrivatePeerId(null)
    setPrivateConversationId(null)
    setStartingConversation(false)
    setShowMembers(false)
    setDeltaReadMarker(null)
    setDeltaUnreadCount(0)
    setSection('welcome')
  }

  async function handleAccountDeleted() {
    try {
      await clearLocalSession()
    } catch (error) {
      console.error('The deleted account session could not be cleared from this device.', error)
    }
    clearSession()
    setNotificationsEnabled(true)
    setNotificationsSnoozedUntil(null)
    setSettingsLoadedFor(null)
    setNotificationPromptDismissed(false)
    setSettingsError('')
    setPrivatePeerId(null)
    setPrivateConversationId(null)
    setStartingConversation(false)
    setShowMembers(false)
    setDeltaReadMarker(null)
    setDeltaUnreadCount(0)
    setSection('welcome')
  }

  const authenticatedSection = section !== 'welcome' && section !== 'auth'
  const visibleSection = signedInLanding
    ? 'inbox'
    : authenticatedSection && (!session || loading)
      ? 'welcome'
      : section
  const nativeMobileChat = nativeApp && (visibleSection === 'tea' || privateChatEnabled)
  const nativeMobileChatList = nativeApp
    && visibleSection === 'inbox'
    && !privateChatEnabled
    && !startingConversation
  const nativeMobilePicker = nativeApp
    && visibleSection === 'inbox'
    && !privateChatEnabled
    && startingConversation
  const appShellClasses = [
    'app-shell',
    showMembers && visibleSection === 'tea' ? 'members-open' : '',
    nativeApp ? 'native-app-shell' : '',
    nativeMobileChat ? 'native-mobile-chat' : '',
    nativeMobileChatList ? 'native-mobile-chat-list' : '',
    nativeMobilePicker ? 'native-mobile-picker' : '',
    nativeApp && showMembers && visibleSection === 'tea' ? 'native-mobile-members-open' : '',
  ].filter(Boolean).join(' ')
  const privateUnreadCount = privateInbox.conversations.reduce((total, conversation) => total + conversation.unreadCount, 0)
  const privateInboxViewProps = {
    conversations: privateInbox.conversations,
    members: community.members,
    currentUserId: profile?.id,
    loading: Boolean(session && privateInbox.loading),
    loadingMembers: Boolean(session && community.loading),
    loadingMoreMembers: community.loadingMore,
    hasMoreMembers: Boolean(session && community.hasMore),
    error: isOnline ? privateInbox.error || community.error : '',
    deltaUnreadCount,
    communityName: communitySettings.title,
    communityAvatarUrl: communitySettings.avatarUrl,
    deltaUnreadError: isOnline ? deltaUnreadError : '',
    deltaLatestMessage: deltaLatestPreview,
    deltaLatestAt: latestGeneralMessage?.createdAt ?? null,
    onOpenSupportCircle: () => navigate('tea'),
    onOpenConversation: (conversation: (typeof privateInbox.conversations)[number]) => openPrivateConversation(
      conversation.conversationId,
      conversation.peerUsername,
      conversation.peerId,
    ),
    onStartConversation: (member: (typeof community.members)[number]) => openPrivateChat(member.username, member.id),
    onHideConversation: privateInbox.hideConversation,
    onLoadMoreMembers: () => { void community.loadMore() },
  }
  function startNewConversation() {
    if (section === 'tea') markDeltaRead()
    setPrivatePeerId(null)
    setPrivateConversationId(null)
    setSection('inbox')
    setShowMembers(false)
    setStartingConversation(true)
  }
  function clearChatSelection() {
    if (section === 'tea') markDeltaRead()
    setPrivatePeerId(null)
    setPrivateConversationId(null)
    setStartingConversation(false)
    setSection('inbox')
    setShowMembers(false)
  }
  const content = visibleSection === 'welcome' || visibleSection === 'auth'
      ? <AuthScreen initialMode="login" onAuthenticated={() => setSection('inbox')} />
      : (
        <div className={appShellClasses} data-theme={theme}>
          <Sidebar
            active={visibleSection === 'tea' ? 'inbox' : visibleSection}
            theme={theme}
            username={profile?.username ?? 'your.alias'}
            avatarUrl={profile?.avatarUrl}
            isAdministrator={isAdministrator}
            collapsed={showMembers && visibleSection === 'tea'}
            messageUnreadCount={deltaUnreadCount + privateUnreadCount}
            isOnline={isOnline}
            onNavigate={navigate}
            onToggleTheme={toggleTheme}
            onSignOut={handleSignOut}
          />
          {visibleSection === 'inbox'
            && session
            && settingsLoadedFor === session.user.id
            && !notificationPromptDismissed
            && (nativeApp ? notificationPermission !== 'unavailable' : browserPushConfigured())
            && (!notificationsEnabled || notificationPermission !== 'granted')
            && <div className="notification-prompt-banner" role="status">
                <Bell size={18} />
                <span><strong>Stay in the loop</strong><small>Get new-message alerts when Isomo Support isn’t open.</small></span>
                <button onClick={() => {
                  if (notificationPermission === 'denied') navigate('profile')
                  else void changeNotifications(true)
                }} type="button">{notificationPermission === 'denied' ? 'Notification settings' : 'Enable alerts'}</button>
                <button className="notification-prompt-dismiss" onClick={() => setNotificationPromptDismissed(true)} type="button" aria-label="Dismiss notification prompt"><X size={15} /></button>
              </div>}
          {administratorError && <p className="admin-role-warning" role="alert">Administrator access could not be verified. Reload the app or sign in again to retry.</p>}
          {(visibleSection === 'tea' || visibleSection === 'inbox') && <ChatListPane
            conversations={privateInbox.conversations}
            loading={privateInbox.loading}
            error={isOnline ? privateInbox.error : ''}
            activeKind={visibleSection === 'tea' ? 'tea' : privateChatEnabled ? 'inbox' : 'none'}
            activeConversationId={privateChat.conversationId ?? privateConversationId}
            deltaUnreadCount={deltaUnreadCount}
            communityName={communitySettings.title}
            communityAvatarUrl={communitySettings.avatarUrl}
            deltaPreview={deltaLatestPreview}
            deltaLatestAt={latestGeneralMessage?.createdAt ?? null}
            onOpenSupportCircle={() => navigate('tea')}
            onOpenConversation={(conversation) => openPrivateConversation(
              conversation.conversationId,
              conversation.peerUsername,
              conversation.peerId,
            )}
            onClearSelection={clearChatSelection}
            onNewChat={startNewConversation}
          />}
          {visibleSection === 'admin' && isAdministrator
            ? <AdminDashboard
                userId={profile?.id ?? ''}
                communityName={communitySettings.title}
                communityAvatarUrl={communitySettings.avatarUrl}
                communityAvatarPath={communitySettings.avatarPath}
                onCommunitySettingsChanged={communitySettings.refresh}
              />
            : visibleSection === 'profile'
            ? <ProfileView key={`${profile?.id ?? ''}:${profile?.username ?? ''}`} theme={theme} username={profile?.username ?? ''} communityName={communitySettings.title} avatarUrl={profile?.avatarUrl ?? null} avatarPath={profile?.avatar_url ?? null} userId={profile?.id} notificationsEnabled={notificationsEnabled} notificationsSnoozedUntil={notificationsSnoozedUntil} nativeApp={nativeApp} notificationPermission={notificationPermission} settingsError={settingsError} profileError={profileError} profileEnabled={Boolean(session)} isAdministrator={isAdministrator} onUsernameChanged={refreshProfile} onAvatarChanged={refreshProfile} onToggleTheme={toggleTheme} onNotificationsChanged={changeNotifications} onNotificationSnoozeChanged={changeNotificationSnooze} onSignOut={handleSignOut} onAccountDeleted={handleAccountDeleted} />
            : visibleSection === 'inbox' && !privateChatEnabled && startingConversation
            ? <PrivateInboxView {...privateInboxViewProps} mode="picker" onCancelPicker={() => setStartingConversation(false)} />
            : visibleSection === 'inbox' && !privateChatEnabled
            ? <>
                <PrivateInboxView {...privateInboxViewProps} className="mobile-inbox-only" />
                <ChatLandingPane communityName={communitySettings.title} onOpenSupportCircle={() => navigate('tea')} onNewChat={startNewConversation} />
              </>
            : <ChatView
                kind={visibleSection === 'inbox' ? 'inbox' : 'tea'}
                messages={visibleSection === 'inbox'
                  ? privateChatEnabled ? privateChat.messages : []
                  : generalChat.messages}
                onSend={(text, replyToId) => visibleSection === 'inbox'
                  ? privateChatEnabled ? privateChat.send(text, replyToId) : undefined
                  : generalChat.send(text, replyToId)}
                onReplyInbox={openPrivateChat}
                onOpenMembers={() => setShowMembers(!showMembers)}
                onOpenChatList={() => {
                  setPrivatePeerId(null)
                  setPrivateConversationId(null)
                  setStartingConversation(false)
                  setShowMembers(false)
                  setSection('inbox')
                }}
                onBack={() => {
                  setPrivatePeerId(null)
                  setPrivateConversationId(null)
                  void privateInbox.refresh()
                }}
                privateName={privateName}
                communityName={communitySettings.title}
                communityAvatarUrl={communitySettings.avatarUrl}
                liveMessages={Boolean(session && (visibleSection === 'tea' || visibleSection === 'inbox'))}
                loadingMessages={visibleSection === 'tea'
                  ? generalChat.loading
                  : visibleSection === 'inbox' && session
                    ? privateChat.loading
                    : false}
                canSend={visibleSection === 'tea'
                  ? Boolean(generalChat.conversationId)
                  : Boolean(privateChat.conversationId)}
                onToggleReaction={(messageId, emoji) => {
                  if (visibleSection === 'tea' && session) void generalChat.toggleReaction(messageId, emoji)
                  else if (visibleSection === 'inbox' && privateChatEnabled) void privateChat.toggleReaction(messageId, emoji)
                }}
                onEditMessage={(messageId, text) => visibleSection === 'tea'
                  ? generalChat.editMessage(messageId, text)
                  : privateChat.editMessage(messageId, text)}
                onDeleteMessageForMe={(messageId) => visibleSection === 'tea'
                  ? generalChat.deleteMessageForMe(messageId)
                  : privateChat.deleteMessageForMe(messageId)}
                onDeleteMessageForEveryone={(messageId) => visibleSection === 'tea'
                  ? generalChat.deleteMessageForEveryone(messageId)
                  : privateChat.deleteMessageForEveryone(messageId)}
                chatError={!isOnline ? '' : visibleSection === 'tea' && session
                  ? [generalChat.error, communitySettings.error].filter(Boolean).join(' ')
                  : visibleSection === 'inbox' && session
                    ? privateChatEnabled ? privateChat.error : 'Choose a member or an existing conversation from your Private Inbox.'
                    : ''}
                hasMoreMessages={visibleSection === 'tea'
                  ? Boolean(session && generalChat.hasMore)
                  : Boolean(session && privateChat.hasMore)}
                loadingEarlier={visibleSection === 'tea' ? generalChat.loadingEarlier : privateChat.loadingEarlier}
                onLoadEarlier={() => visibleSection === 'tea' ? generalChat.loadEarlier() : privateChat.loadEarlier()}
                onRetryMessage={visibleSection === 'tea' ? generalChat.retry : privateChat.retry}
                onSendMedia={(file, viewOnce, replyToId, mediaGroupId) => {
                  if (visibleSection === 'tea' && session) generalChat.sendMedia(file, viewOnce, replyToId, mediaGroupId)
                  else if (visibleSection === 'inbox' && privateChatEnabled) privateChat.sendMedia(file, viewOnce, replyToId, mediaGroupId)
                }}
                onOpenMedia={visibleSection === 'tea' ? generalChat.openMedia : privateChat.openMedia}
                onDiscardMedia={(messageId) => {
                  if (visibleSection === 'tea') void generalChat.discardPendingMedia(messageId)
                  else void privateChat.discardPendingMedia(messageId)
                }}
                onCreatePoll={(question, options, replyToId) => visibleSection === 'tea'
                  ? generalChat.createPoll(question, options, replyToId)
                  : privateChat.createPoll(question, options, replyToId)}
                onVotePoll={(messageId, optionId) => visibleSection === 'tea'
                  ? generalChat.votePoll(messageId, optionId)
                  : privateChat.votePoll(messageId, optionId)}
                onSendSticker={(stickerCode, replyToId) => visibleSection === 'tea'
                  ? generalChat.sendSticker(stickerCode, replyToId)
                  : privateChat.sendSticker(stickerCode, replyToId)}
                theme={theme}
                mentionMembers={visibleSection === 'inbox'
                  ? community.members.filter((member) => member.id === privatePeerId)
                  : community.members}
                currentUserId={profile?.id}
                mentions={notificationsEnabled ? visibleSection === 'tea' ? generalChat.mentions : privateChat.mentions : []}
                onMarkMentionsRead={() => visibleSection === 'tea'
                  ? generalChat.markMentionsRead()
                  : privateChat.markMentionsRead()}
                nativeMobileExperience={nativeApp}
              />}
          {visibleSection === 'tea' && showMembers && <MemberPanel
            communityName={communitySettings.title}
            communityAvatarUrl={communitySettings.avatarUrl}
            members={community.members}
            loading={Boolean(session && community.loading)}
            loadingMore={community.loadingMore}
            hasMore={Boolean(session && community.hasMore)}
            error={community.error}
            onLoadMore={() => { void community.loadMore() }}
            onMessage={openPrivateChat}
            onClose={() => setShowMembers(false)}
          />}
        </div>
      )

  return (
    <div className="app-root" data-theme={visibleSection === 'welcome' || visibleSection === 'auth' ? theme : undefined}>
      {content}
    </div>
  )
}

function App() {
  return <AuthProvider><AppContent /></AuthProvider>
}

export default App
