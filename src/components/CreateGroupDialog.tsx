import { useState, type FormEvent } from 'react'
import { Users, X } from 'lucide-react'

type CreateGroupDialogProps = {
  onCreate: (title: string) => Promise<string>
  onCreated: (conversationId: string) => void
  onClose: () => void
}

export function CreateGroupDialog({ onCreate, onCreated, onClose }: CreateGroupDialogProps) {
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedTitle = title.trim()
    if (trimmedTitle.length < 1 || trimmedTitle.length > 40) {
      setError('Group names must be 1-40 characters.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const conversationId = await onCreate(trimmedTitle)
      onCreated(conversationId)
    } catch (createError) {
      console.error('Could not create the group.', createError)
      setError(createError instanceof Error ? createError.message : 'The group could not be created.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="group-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <form className="group-dialog" onSubmit={(event) => void submit(event)} role="dialog" aria-modal="true" aria-labelledby="create-group-title">
        <div className="group-dialog-heading">
          <span><Users size={18} /></span>
          <div><h2 id="create-group-title">Create a group</h2><p>Start a private support space and invite people to join.</p></div>
          <button aria-label="Close dialog" disabled={busy} onClick={onClose} type="button"><X size={17} /></button>
        </div>
        <label className="admin-field">
          <span>Group name</span>
          <input autoComplete="off" autoFocus maxLength={40} onChange={(event) => setTitle(event.target.value)} required value={title} />
          <small>1-40 characters. Only invited members can see this group.</small>
        </label>
        {error && <p className="admin-feedback error" role="alert">{error}</p>}
        <div className="group-dialog-actions">
          <button className="private-inbox-back" disabled={busy} onClick={onClose} type="button">Cancel</button>
          <button className="admin-primary-button" disabled={busy || !title.trim()} type="submit">{busy ? 'Creating…' : 'Create group'}</button>
        </div>
      </form>
    </div>
  )
}
