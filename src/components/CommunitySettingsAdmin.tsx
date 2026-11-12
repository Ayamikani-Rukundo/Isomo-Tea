import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Camera, Save, Trash2 } from 'lucide-react'
import { COMMUNITY_AVATAR_BUCKET } from '../lib/community'
import { adminConsoleAction } from '../lib/admin-console'
import { requireSupabase } from '../lib/supabase'

type CommunitySettingsAdminProps = {
  userId: string
  title: string
  avatarPath: string | null
  avatarUrl: string
  onUpdated: () => void
}

const maxPhotoBytes = 5 * 1024 * 1024

export function CommunitySettingsAdmin({
  userId,
  title: currentTitle,
  avatarPath,
  avatarUrl,
  onUpdated,
}: CommunitySettingsAdminProps) {
  const [title, setTitle] = useState(currentTitle)
  const [photo, setPhoto] = useState<File | null>(null)
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null)
  const [removeCurrentPhoto, setRemoveCurrentPhoto] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const objectUrl = useRef<string | null>(null)

  useEffect(() => () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
  }, [])

  function clearPhotoDraft() {
    setPhoto(null)
    setRemoveCurrentPhoto(true)
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    objectUrl.current = null
    setPreviewObjectUrl(null)
  }

  function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
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
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    objectUrl.current = URL.createObjectURL(file)
    setPhoto(file)
    setRemoveCurrentPhoto(false)
    setPreviewObjectUrl(objectUrl.current)
    setError('')
    setNotice('')
  }

  async function save(event: FormEvent<HTMLFormElement>) {
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
        uploadedPath = `${userId}/${crypto.randomUUID()}.${extension}`
        const { error: uploadError } = await client.storage
          .from(COMMUNITY_AVATAR_BUCKET)
          .upload(uploadedPath, photo, { contentType: photo.type, cacheControl: '3600', upsert: false })
        if (uploadError) throw uploadError
      }

      const nextAvatarPath = uploadedPath ?? (removeCurrentPhoto ? null : avatarPath)
      const result = await adminConsoleAction<{ updated: boolean; cleanupWarning: string | null }>({
        action: 'update-community-settings',
        title: nextTitle,
        avatarPath: nextAvatarPath,
      })
      if (!result.updated) throw new Error('The group settings were not saved.')
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = null
      setPhoto(null)
      setPreviewObjectUrl(null)
      setRemoveCurrentPhoto(false)
      setNotice(result.cleanupWarning ?? 'Group name and photo updated.')
      onUpdated()
    } catch (saveError) {
      if (uploadedPath) {
        const { error: cleanupError } = await client.storage.from(COMMUNITY_AVATAR_BUCKET).remove([uploadedPath])
        if (cleanupError) {
          console.error('The unsaved group photo could not be removed.', cleanupError)
          setError('Group settings were not saved, and the newly uploaded photo could not be cleaned up.')
          setBusy(false)
          return
        }
      }
      console.error('Could not update the community profile.', saveError)
      setError(saveError instanceof Error ? saveError.message : 'Group settings could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const previewUrl = previewObjectUrl ?? (removeCurrentPhoto ? '/delta-tea-avatar.png' : avatarUrl)

  return (
    <form className="admin-card admin-community-settings" onSubmit={(event) => void save(event)}>
      <div className="admin-card-heading">
        <span className="admin-icon-box"><Camera size={16} /></span>
        <div><h2>Community profile</h2><p>Changes appear in chat lists and the group header. Replaced photos are removed from storage.</p></div>
      </div>
      <label className="admin-field">
        <span>Group name</span>
        <input autoComplete="off" maxLength={40} onChange={(event) => setTitle(event.target.value)} required value={title} />
        <small>1-40 characters.</small>
      </label>
      <div className="admin-community-photo-row">
        <img className="admin-community-photo" src={previewUrl} alt="Group photo preview" />
        <div className="admin-community-photo-actions">
          <strong>Group photo</strong>
          <span>JPEG, PNG, or WebP up to 5 MB.</span>
          <input ref={fileInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => selectPhoto(event)} />
          <div>
            <button className="admin-secondary-button" onClick={() => fileInput.current?.click()} type="button" disabled={busy}><Camera size={14} /> Choose photo</button>
            {(avatarPath || photo) && <button className="admin-danger-button" onClick={clearPhotoDraft} type="button" disabled={busy}><Trash2 size={14} /> Remove photo</button>}
          </div>
        </div>
      </div>
      {error && <p className="admin-feedback error" role="alert">{error}</p>}
      {notice && <p className={notice.startsWith('The group settings were saved') ? 'admin-feedback error' : 'admin-feedback success'} role="status">{notice}</p>}
      <button className="admin-primary-button" disabled={busy || (!photo && !removeCurrentPhoto && title.trim() === currentTitle)} type="submit">
        <Save size={14} />{busy ? 'Saving…' : 'Save group profile'}
      </button>
    </form>
  )
}
