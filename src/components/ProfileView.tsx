import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { AlertTriangle, Bell, Camera, Check, ChevronRight, KeyRound, Moon, Shield, Sparkles, Sun, Trash2, UserRound, X } from 'lucide-react'
import { changeUsername, deleteOwnAccount, usernameAvailable } from '../lib/auth'
import { PROFILE_AVATAR_BUCKET } from '../lib/profileAvatars'
import { requireSupabase } from '../lib/supabase'
import type { NativeNotificationPermission } from '../lib/nativeNotifications'

type ProfileViewProps = {
  theme: 'dark' | 'light'
  username: string
  communityName: string
  avatarUrl: string | null
  avatarPath: string | null
  userId?: string
  notificationsEnabled: boolean
  nativeApp: boolean
  notificationPermission: NativeNotificationPermission
  settingsError: string
  profileError: string
  profileEnabled: boolean
  isAdministrator: boolean
  onUsernameChanged: () => Promise<void>
  onAvatarChanged: () => Promise<void>
  onToggleTheme: () => void
  onNotificationsChanged: (enabled: boolean) => Promise<void>
  onSignOut: () => Promise<void>
  onAccountDeleted: () => Promise<void>
}

const maxAvatarBytes = 5 * 1024 * 1024

export function ProfileView({
  theme,
  username: currentUsername,
  communityName,
  avatarUrl,
  avatarPath,
  userId,
  notificationsEnabled,
  nativeApp,
  notificationPermission,
  settingsError,
  profileError,
  profileEnabled,
  isAdministrator,
  onUsernameChanged,
  onAvatarChanged,
  onToggleTheme,
  onNotificationsChanged,
  onSignOut,
  onAccountDeleted,
}: ProfileViewProps) {
  const [username, setUsername] = useState(currentUsername)
  const [saved, setSaved] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [showDeleteAccount, setShowDeleteAccount] = useState(false)
  const [deletionPhrase, setDeletionPhrase] = useState('')
  const [deletionPassword, setDeletionPassword] = useState('')
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [deletionError, setDeletionError] = useState('')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [availability, setAvailability] = useState<{ username: string; status: 'checking' | 'available' | 'taken' | 'error' }>({ username: '', status: 'checking' })

  useEffect(() => {
    if (!username.trim() || username.trim().toLowerCase() === currentUsername.toLowerCase()) {
      return
    }
    let active = true
    const timeout = window.setTimeout(() => {
      setAvailability({ username: username.trim().toLowerCase(), status: 'checking' })
      void usernameAvailable(username).then((available) => {
        if (active) setAvailability({ username: username.trim().toLowerCase(), status: available ? 'available' : 'taken' })
      }).catch(() => {
        if (active) setAvailability({ username: username.trim().toLowerCase(), status: 'error' })
      })
    }, 350)
    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [username, currentUsername])
  const usernameAvailability = username.trim().toLowerCase() !== currentUsername.toLowerCase()
    ? availability.username === username.trim().toLowerCase() ? availability.status : 'checking'
    : 'idle'

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (username.trim().toLowerCase() !== currentUsername.toLowerCase()) {
        if (usernameAvailability === 'checking') throw new Error('Please wait for the username availability check to finish.')
        if (usernameAvailability === 'taken') throw new Error('That username is already taken. Try another one.')
        await changeUsername(username)
        await onUsernameChanged()
      }
      setSaved(true)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save your username.')
    } finally {
      setBusy(false)
    }
  }

  async function handleSignOut() {
    setSigningOut(true)
    setError('')
    try {
      await onSignOut()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not sign out.')
    } finally {
      setSigningOut(false)
    }
  }

  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (deletionPhrase !== 'DELETE MY ACCOUNT' || !deletionPassword || deletingAccount || isAdministrator) return
    setDeletingAccount(true)
    setDeletionError('')
    try {
      await deleteOwnAccount(deletionPassword)
      await onAccountDeleted()
    } catch (requestError) {
      console.error('Account deletion could not be completed.', requestError)
      setDeletionError(requestError instanceof Error ? requestError.message : 'Account deletion could not be completed.')
    } finally {
      setDeletingAccount(false)
    }
  }

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!profileEnabled || !userId) {
      setError('Sign in before changing your profile photo.')
      return
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Choose a JPEG, PNG, or WebP image.')
      return
    }
    if (file.size > maxAvatarBytes) {
      setError('Profile photos must be 5 MB or smaller.')
      return
    }

    setUploadingAvatar(true)
    setError('')
    setNotice('')
    const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp'
    const path = `${userId}/${crypto.randomUUID()}.${extension}`
    const client = requireSupabase()
    try {
      const { error: uploadError } = await client.storage
        .from(PROFILE_AVATAR_BUCKET)
        .upload(path, file, { contentType: file.type, cacheControl: '3600', upsert: false })
      if (uploadError) throw uploadError
      const { error: updateError } = await client
        .from('profiles')
        .update({ avatar_url: path })
        .eq('id', userId)
      if (updateError) {
        const { error: cleanupError } = await client.storage.from(PROFILE_AVATAR_BUCKET).remove([path])
        if (cleanupError) console.error('The unused profile photo could not be removed.', cleanupError)
        throw updateError
      }

      await onAvatarChanged()
      if (avatarPath?.startsWith(`${userId}/`)) {
        const { error: removalError } = await client.storage.from(PROFILE_AVATAR_BUCKET).remove([avatarPath])
        if (removalError) {
          console.error('The previous profile photo could not be removed.', removalError)
          setNotice('Your new photo is saved. The previous photo could not be cleaned up.')
          return
        }
      }
      setNotice('Profile photo updated. It is visible to the community.')
    } catch (requestError) {
      console.error('Profile photo upload failed.', requestError)
      setError(requestError instanceof Error ? requestError.message : 'Could not update your profile photo.')
    } finally {
      setUploadingAvatar(false)
    }
  }

  async function removeAvatar() {
    if (!profileEnabled || !userId) {
      setError('Sign in before changing your profile photo.')
      return
    }

    setUploadingAvatar(true)
    setError('')
    setNotice('')
    const client = requireSupabase()
    try {
      const { data, error: updateError } = await client
        .from('profiles')
        .update({ avatar_url: null })
        .eq('id', userId)
        .select('id')
        .maybeSingle()
      if (updateError) throw updateError
      if (!data) throw new Error('Your profile could not be found.')

      await onAvatarChanged()
      if (avatarPath?.startsWith(`${userId}/`)) {
        const { error: removalError } = await client.storage.from(PROFILE_AVATAR_BUCKET).remove([avatarPath])
        if (removalError) {
          console.error('The removed profile photo could not be deleted from storage.', removalError)
          setNotice('Your profile photo was removed, but its stored file could not be cleaned up.')
          return
        }
      }
      setNotice('Profile photo removed.')
    } catch (requestError) {
      console.error('Profile photo removal failed.', requestError)
      setError(requestError instanceof Error ? requestError.message : 'Could not remove your profile photo.')
    } finally {
      setUploadingAvatar(false)
    }
  }

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (newPassword.length < 8 || newPassword !== confirmPassword) {
      setError(newPassword !== confirmPassword ? 'The new passwords do not match.' : 'Use at least 8 characters for your password.')
      return
    }
    setSavingPassword(true)
    setError('')
    setNotice('')
    try {
      const { error: passwordError } = await requireSupabase().auth.updateUser({ password: newPassword })
      if (passwordError) throw passwordError
      setShowPasswordForm(false)
      setNewPassword('')
      setConfirmPassword('')
      setNotice('Your password has been updated.')
    } catch (requestError) {
      console.error('Password update failed.', requestError)
      setError(requestError instanceof Error ? requestError.message : 'Could not update your password.')
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <main className="profile-page">
      <header className="page-header"><div><p className="eyebrow">YOUR LITTLE CORNER</p><h1>Your profile</h1><p>Make this space feel a little more like you.</p></div><span className="profile-header-icon"><UserRound size={19} /></span></header>
      {profileError && <p className="profile-notice" role="alert">{profileError}</p>}
      {settingsError && <p className="profile-notice" role="alert">{settingsError}</p>}
      <section className="profile-card profile-identity">
        <input ref={avatarInputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadAvatar(event)} />
        <div className="profile-avatar-wrap">
          {avatarUrl
            ? <img className="profile-large-avatar profile-avatar-image" src={avatarUrl} alt={`Profile photo for ${currentUsername}`} />
            : <span className="profile-large-avatar">{currentUsername.slice(0, 1).toUpperCase() || '?'}</span>}
          <button onClick={() => avatarInputRef.current?.click()} type="button" disabled={!profileEnabled || uploadingAvatar} aria-label="Change profile photo">
            {uploadingAvatar ? <span className="avatar-uploading" /> : <Camera size={15} />}
          </button>
          {(avatarPath || avatarUrl) && <button className="profile-avatar-remove" onClick={() => void removeAvatar()} type="button" disabled={!profileEnabled || uploadingAvatar}>
            <Trash2 size={12} /> Remove
          </button>}
        </div>
        <div className="profile-identity-copy"><span className="eyebrow">YOUR COMMUNITY IDENTITY</span><h2>@{currentUsername || '...'}</h2><p>Your photo and alias are visible to signed-in community members.</p></div>
        <span className="anonymous-badge"><Shield size={14} /> Anonymous</span>
      </section>
      {error && <p className="profile-error" role="alert">{error}</p>}
      {notice && <p className="profile-notice" role="status">{notice}</p>}
      <form className="profile-card profile-settings" onSubmit={(event) => void save(event)}>
        <div className="settings-title"><div><h2>Make it yours</h2><p>Your classmates only see the alias you choose.</p></div><Sparkles size={18} /></div>
        <label className="profile-label">Username<div className="username-input"><span>@</span><input value={username} onChange={(event) => { setUsername(event.target.value); setSaved(false); setError('') }} minLength={3} maxLength={48} /></div><small>Usernames must be unique. Emoji are welcome. Changing yours will be announced in {communityName}.</small></label>
        {username.trim().toLowerCase() !== currentUsername.toLowerCase() && <p className={`profile-availability availability-${usernameAvailability}`} role="status">{usernameAvailability === 'checking' ? 'Checking availability…' : usernameAvailability === 'available' ? 'This username is available.' : usernameAvailability === 'taken' ? 'That username is already taken.' : usernameAvailability === 'error' ? 'Availability check failed. The server will still verify on save.' : 'Use 3–24 letters, numbers, periods, underscores, emoji, and single spaces.'}</p>}
        <button className="primary-button save-profile" type="submit" disabled={busy}>{busy ? 'Saving…' : saved ? <><Check size={16} /> Username saved</> : <>Save changes <ChevronRight size={16} /> </>}</button>
      </form>
      <div className="profile-card preferences">
        <div className="settings-title"><div><h2>Preferences</h2><p>The little things, just how you like them.</p></div></div>
        <button className="preference-row" onClick={onToggleTheme} type="button"><span className="preference-icon">{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</span><span><strong>Appearance</strong><small>{theme === 'dark' ? 'Dark mode' : 'Light mode'}</small></span><ChevronRight size={17} /></button>
        <button
          className="preference-row"
          onClick={() => void onNotificationsChanged(!notificationsEnabled || (nativeApp && notificationPermission !== 'granted'))}
          type="button"
          aria-pressed={notificationsEnabled && (!nativeApp || notificationPermission === 'granted')}
        >
          <span className="preference-icon"><Bell size={17} /></span>
          <span><strong>Activity notifications</strong><small>{nativeApp
            ? notificationPermission === 'denied'
              ? 'Allow notifications in Android settings'
              : notificationPermission === 'unavailable'
                ? 'Android notifications are unavailable'
                : notificationPermission !== 'granted'
                  ? 'Tap to allow Android mention alerts'
                  : notificationsEnabled ? 'Mention alerts are on' : 'Mention alerts are off'
            : notificationsEnabled ? 'Mention notifications are on' : 'Mention notifications are off'}</small></span>
          <span className={`settings-toggle ${notificationsEnabled && (!nativeApp || notificationPermission === 'granted') ? 'enabled' : ''}`} aria-hidden="true"><i /></span>
        </button>
        <div className="preference-row password-preference">
          <span className="preference-icon"><KeyRound size={17} /></span>
          <span><strong>Password</strong><small>Update your sign-in password</small></span>
          <button className="password-toggle" onClick={() => { setShowPasswordForm((current) => !current); setError('') }} type="button" aria-expanded={showPasswordForm}>{showPasswordForm ? 'Cancel' : 'Change'}</button>
        </div>
        {showPasswordForm && <form className="password-change-form" onSubmit={(event) => void updatePassword(event)}>
          <label className="profile-label">New password<input type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
          <label className="profile-label">Confirm new password<input type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
          <button className="primary-button" type="submit" disabled={savingPassword}>{savingPassword ? 'Updating…' : 'Update password'}</button>
        </form>}
      </div>
      <section className="profile-card profile-account-info">
        <div className="settings-title"><div><h2>Account information</h2><p>Sign-in and privacy details for this account.</p></div></div>
        <p><span>Account type</span><strong>{isAdministrator ? 'Administrator' : 'Community member'}</strong></p>
        <p><span>Real name and email</span><strong>Not shown to community members</strong></p>
      </section>
      {profileEnabled && <section className="profile-card account-deletion">
        <div className="settings-title"><div><h2>Delete account</h2><p>Permanently remove your scholar account and your authored messages.</p></div><AlertTriangle size={18} /></div>
        {isAdministrator
          ? <p className="profile-deletion-note">Administrator accounts cannot be deleted here. Transfer administrator duties before requesting account closure.</p>
          : <>
              <p className="profile-deletion-note">Your sent media and messages will be removed. Other participants’ messages and conversation history are retained. This cannot be undone.</p>
              {deletionError && <p className="profile-error" role="alert">{deletionError}</p>}
              {!showDeleteAccount
                ? <button className="delete-account-trigger" onClick={() => { setShowDeleteAccount(true); setDeletionError('') }} type="button"><Trash2 size={15} /> Continue to account deletion</button>
                : <form className="delete-account-form" onSubmit={(event) => void deleteAccount(event)}>
                    <label className="profile-label">Current password
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={deletionPassword}
                        onChange={(event) => setDeletionPassword(event.target.value)}
                        required
                      />
                    </label>
                    <label className="profile-label">Type <strong>DELETE MY ACCOUNT</strong> to confirm
                      <input
                        value={deletionPhrase}
                        onChange={(event) => setDeletionPhrase(event.target.value)}
                        autoComplete="off"
                        required
                      />
                    </label>
                    <div className="delete-account-actions">
                      <button className="cancel-delete" onClick={() => {
                        setShowDeleteAccount(false)
                        setDeletionPhrase('')
                        setDeletionPassword('')
                      }} type="button" disabled={deletingAccount}><X size={14} /> Cancel</button>
                      <button className="confirm-delete" type="submit" disabled={deletingAccount || deletionPhrase !== 'DELETE MY ACCOUNT' || !deletionPassword}>
                        {deletingAccount ? 'Deleting…' : 'Delete my account'}
                      </button>
                    </div>
                  </form>}
            </>}
      </section>}
      {profileEnabled
        ? <button className="signout-button" onClick={() => void handleSignOut()} disabled={signingOut} type="button">{signingOut ? 'Signing out…' : 'Sign out'}</button>
        : null}
      {profileEnabled && <p className="profile-footnote">Your account preferences are saved to your Isomo Tea account.</p>}
    </main>
  )
}
