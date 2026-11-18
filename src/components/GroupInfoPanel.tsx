import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { ArrowLeft, Camera, Check, Copy, LogOut, Save, Shield, Trash2, Users, X } from 'lucide-react'
import { COMMUNITY_AVATAR_BUCKET } from '../lib/community'
import { requireSupabase } from '../lib/supabase'
import type { GroupConversationSummary, GroupMember } from '../types'
import { ConfirmDialog } from './ConfirmDialog'

type GroupInfoPanelProps = {
  group: GroupConversationSummary
  members: GroupMember[]
  currentUserId?: string
  isAdministrator: boolean
  loading: boolean
  error: string
  onClose: () => void
  onMessage: (username: string, userId?: string) => void
  onUpdated: () => void
  onLeave: () => Promise<void>
  onDelete: () => Promise<void>
}

const maxPhotoBytes = 5 * 1024 * 1024

export function GroupInfoPanel({
  group,
  members,
  currentUserId,
  isAdministrator,
  loading,
  error: memberError,
  onClose,
  onMessage,
  onUpdated,
  onLeave,
  onDelete,
}: GroupInfoPanelProps) {
  const [title, setTitle] = useState(group.title)
  const [photo, setPhoto] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [removePhoto, setRemovePhoto] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [confirmation, setConfirmation] = useState<'leave' | 'delete' | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const canManage = group.myRole === 'admin'

  useEffect(() => () => {
    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Choose a JPEG, PNG, or WebP group photo.')
      return
    }
    if (file.size > maxPhotoBytes) {
      setError('Group photos must be 5 MB or smaller.')
      return
    }
    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
    setPhoto(file)
    setPreviewUrl(URL.createObjectURL(file))
    setRemovePhoto(false)
    setError('')
    setNotice('')
  }

  async function saveGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextTitle = title.trim()
    if (!nextTitle || nextTitle.length > 40) {
      setError('The group name must be 1-40 characters.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    const client = requireSupabase()
    let uploadedPath: string | null = null
    try {
      if (photo) {
        const extension = photo.type === 'image/jpeg' ? 'jpg' : photo.type === 'image/png' ? 'png' : 'webp'
        uploadedPath = `${group.conversationId}/${crypto.randomUUID()}.${extension}`
        const { error: uploadError } = await client.storage
          .from(COMMUNITY_AVATAR_BUCKET)
          .upload(uploadedPath, photo, { contentType: photo.type, cacheControl: '3600', upsert: false })
        if (uploadError) throw uploadError
      }

      const nextAvatarPath = uploadedPath ?? (removePhoto ? null : group.avatarPath)
      const { error: saveError } = await client.rpc('update_group_settings', {
        p_conversation_id: group.conversationId,
        p_title: nextTitle,
        p_avatar_path: nextAvatarPath,
      })
      if (saveError) throw saveError

      if (group.avatarPath && group.avatarPath !== nextAvatarPath) {
        const { error: cleanupError } = await client.storage
          .from(COMMUNITY_AVATAR_BUCKET)
          .remove([group.avatarPath])
        if (cleanupError) {
          console.error('The replaced group photo could not be removed.', cleanupError)
          setNotice('Group details were saved, but the old photo could not be removed.')
        } else {
          setNotice('Group name and photo updated.')
        }
      } else {
        setNotice('Group name and photo updated.')
      }

      if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
      setPhoto(null)
      setRemovePhoto(false)
      onUpdated()
    } catch (saveError) {
      if (uploadedPath) {
        const { error: cleanupError } = await client.storage
          .from(COMMUNITY_AVATAR_BUCKET)
          .remove([uploadedPath])
        if (cleanupError) {
          console.error('The unsaved group photo could not be removed.', cleanupError)
          setError('Group settings were not saved, and the newly uploaded photo could not be cleaned up.')
          setBusy(false)
          return
        }
      }
      console.error('Could not update group settings.', saveError)
      setError(saveError instanceof Error ? saveError.message : 'Group settings could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  async function createInvite() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { data: token, error: inviteError } = await requireSupabase().rpc('create_group_invite', {
        p_conversation_id: group.conversationId,
      })
      if (inviteError) throw inviteError
      if (typeof token !== 'string' || !token) throw new Error('The invite service returned an invalid link.')
      const url = new URL(window.location.href)
      url.searchParams.set('groupInvite', token)
      url.searchParams.delete('section')
      setInviteLink(url.toString())
      setNotice('Invite link created. It is valid for 7 days and up to 50 uses.')
    } catch (inviteError) {
      console.error('Could not create a group invite link.', inviteError)
      setError(inviteError instanceof Error ? inviteError.message : 'The invite link could not be created.')
    } finally {
      setBusy(false)
    }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteLink)
      setNotice('Invite link copied.')
      setError('')
    } catch (copyError) {
      console.error('Could not copy the group invite link.', copyError)
      setNotice('Select and copy the invite link below.')
    }
  }

  async function changeRole(member: GroupMember) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { error: roleError } = await requireSupabase().rpc('change_group_member_role', {
        p_conversation_id: group.conversationId,
        p_user_id: member.id,
        p_role: 'admin',
      })
      if (roleError) throw roleError
      setNotice(`@${member.username} is now a group admin.`)
      onUpdated()
    } catch (roleError) {
      console.error('Could not change the group member role.', roleError)
      setError(roleError instanceof Error ? roleError.message : 'The member role could not be changed.')
    } finally {
      setBusy(false)
    }
  }

  async function confirmAction() {
    if (!confirmation) return
    const action = confirmation
    setConfirmation(null)
    setBusy(true)
    setError('')
    try {
      if (action === 'leave') await onLeave()
      else await onDelete()
    } catch (actionError) {
      console.error(`Could not ${action} the group.`, actionError)
      const verb = action === 'leave' ? 'left' : 'deleted'
      setError(actionError instanceof Error ? actionError.message : `The group could not be ${verb}.`)
    } finally {
      setBusy(false)
    }
  }

  const displayedAvatar = previewUrl ?? (removePhoto ? '/delta-tea-avatar.png' : group.avatarUrl)

  return (
    <aside className="member-panel mobile-open group-info-panel">
      <div className="panel-title-row">
        <div><p className="eyebrow">PRIVATE GROUP</p><h2>Group info</h2></div>
        <button className="panel-icon panel-close" onClick={onClose} type="button" aria-label="Close group info">
          <X className="desktop-panel-close-icon" size={16} />
          <ArrowLeft className="mobile-panel-back-icon" size={18} />
        </button>
      </div>
      <div className="community-card">
        <div className="community-cover"><span>i FAM <i>✳</i> SUPPORT</span></div>
        <div className="community-card-body">
          <img className="community-card-avatar" src={displayedAvatar} alt="" />
          <strong>{group.title}</strong>
          <p>A private space to listen and support</p>
          <div className="member-count"><Users size={12} /> {group.memberCount} members · {canManage ? 'You are an admin' : 'You are a member'}</div>
        </div>
      </div>

      {canManage && <form className="group-info-settings" onSubmit={(event) => void saveGroup(event)}>
        <label className="admin-field"><span>Group name</span><input maxLength={40} onChange={(event) => setTitle(event.target.value)} required value={title} /></label>
        <div className="group-photo-row">
          <img src={displayedAvatar} alt="" />
          <input ref={fileInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} />
          <button className="admin-secondary-button" disabled={busy} onClick={() => fileInput.current?.click()} type="button"><Camera size={13} /> Photo</button>
          {(group.avatarPath || photo) && <button className="admin-text-button" disabled={busy} onClick={() => {
            if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
            setPhoto(null)
            setPreviewUrl(null)
            setRemovePhoto(true)
          }} type="button">Remove</button>}
        </div>
        <button className="admin-primary-button" disabled={busy || (!photo && !removePhoto && title.trim() === group.title)} type="submit"><Save size={13} /> Save details</button>
        <button className="admin-secondary-button" disabled={busy} onClick={() => void createInvite()} type="button"><Users size={13} /> Create invite link</button>
        {inviteLink && <div className="group-invite-link">
          <input aria-label="Group invite link" onFocus={(event) => event.currentTarget.select()} readOnly value={inviteLink} />
          <button className="admin-secondary-button" disabled={busy} onClick={() => void copyInvite()} type="button"><Copy size={13} /> Copy</button>
        </div>}
      </form>}

      {(error || memberError) && <p className="admin-feedback error" role="alert">{error || `Group members could not be loaded: ${memberError}`}</p>}
      {notice && <p className="admin-feedback success" role="status">{notice}</p>}

      <div className="member-list-heading"><h3>Members <span>{members.length}</span></h3></div>
      <div className="member-list">
        {members.map((member) => (
          <div className="member-row group-member-row" key={member.id}>
            <span className={`avatar avatar-${member.color}`}>{member.avatarUrl
              ? <img className="avatar-image" src={member.avatarUrl} alt="" />
              : member.initials}</span>
            <button className="member-name group-member-open" onClick={() => {
              if (member.id !== currentUserId) onMessage(member.username, member.id)
            }} type="button">
              <strong>{member.id === currentUserId ? 'You' : `@${member.username}`}</strong>
              <small>{member.role === 'admin' ? 'Group admin' : 'Member'}</small>
            </button>
            {canManage && member.role !== 'admin' && <button
              className="group-promote-button"
              disabled={busy}
              onClick={() => void changeRole(member)}
              type="button"
              aria-label={`Make @${member.username} a group admin`}
              title="Make group admin"
            ><Shield size={14} /></button>}
            {member.role === 'admin' && <Shield size={14} className="group-admin-indicator" aria-label="Group admin" />}
          </div>
        ))}
        {loading && <p className="member-load-error">Loading group members…</p>}
        {!loading && !memberError && !members.length && <p className="member-load-error">No group members found.</p>}
      </div>

      <div className="group-info-actions">
        <button className="admin-secondary-button" disabled={busy} onClick={() => setConfirmation('leave')} type="button"><LogOut size={14} /> Leave group</button>
        {(canManage || isAdministrator) && <button className="admin-danger-button" disabled={busy} onClick={() => setConfirmation('delete')} type="button"><Trash2 size={14} /> Delete group</button>}
      </div>
      <div className="privacy-note"><Check size={16} /><span>Only invited members can see this group's conversations.</span></div>
      {confirmation && <ConfirmDialog
        title={confirmation === 'leave' ? 'Leave this group?' : 'Delete this group?'}
        message={confirmation === 'leave'
          ? 'You will no longer see this group or its messages. A group must keep at least one admin.'
          : 'This permanently deletes the group, all its messages, media, and invite links for every member.'}
        confirmLabel={confirmation === 'leave' ? 'Leave group' : 'Delete group'}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => void confirmAction()}
      />}
    </aside>
  )
}
