import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, Clipboard, KeyRound, Plus, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'
import { createAccessCode, listAccessCodes, setAccessCodeActive, type AccessCode } from '../lib/access-codes'
import { AdminOperations } from './AdminOperations'
import './AdminDashboard.css'

type AdminDashboardProps = {
  userId: string
  communityName: string
  communityAvatarUrl: string
  communityAvatarPath: string | null
  onCommunitySettingsChanged: () => void
}

function localDateTimeValue(date: Date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 16)
}

function newExpiryDefault() {
  return localDateTimeValue(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
}

function formatDate(value: string | null) {
  if (!value) return 'No expiration'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function accessCodeState(code: AccessCode) {
  if (!code.active) return { label: 'Inactive', className: 'inactive' }
  if (code.expired) {
    return { label: 'Expired', className: 'inactive' }
  }
  if (code.remaining === 0) return { label: 'Limit reached', className: 'inactive' }
  return { label: 'Active', className: 'active' }
}

export function AdminDashboard({
  userId,
  communityName,
  communityAvatarUrl,
  communityAvatarPath,
  onCommunitySettingsChanged,
}: AdminDashboardProps) {
  const [dashboardTab, setDashboardTab] = useState<'codes' | 'operations'>('codes')
  const [codes, setCodes] = useState<AccessCode[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [busyCodeId, setBusyCodeId] = useState('')
  const [codeValue, setCodeValue] = useState('')
  const [maxUses, setMaxUses] = useState('50')
  const [expiresAt, setExpiresAt] = useState(newExpiryDefault)
  const [noExpiration, setNoExpiration] = useState(false)
  const [replaceExisting, setReplaceExisting] = useState(false)
  const [replaceId, setReplaceId] = useState('')
  const [oneTimeCode, setOneTimeCode] = useState('')
  const [copied, setCopied] = useState(false)

  const replaceableCodes = useMemo(() => codes.filter((code) => code.active), [codes])

  async function refreshCodes() {
    setLoadError('')
    try {
      setCodes(await listAccessCodes())
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Access codes could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    void listAccessCodes().then((items) => {
      if (!active) return
      setCodes(items)
    }).catch((error: unknown) => {
      if (!active) return
      setLoadError(error instanceof Error ? error.message : 'Access codes could not be loaded.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [])

  function generateCode() {
    setCodeValue(`ISOMO-${crypto.randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase()}`)
    setFormError('')
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')
    setNotice('')
    const parsedMaxUses = Number(maxUses)
    if (!Number.isSafeInteger(parsedMaxUses) || parsedMaxUses < 1 || parsedMaxUses > 2_147_483_647) {
      setFormError('Set a whole-number registration limit greater than zero.')
      return
    }
    if (codeValue.length < 8 || codeValue.length > 128 || codeValue.trim() !== codeValue) {
      setFormError('Use 8–128 characters for the code, without spaces at the beginning or end.')
      return
    }
    if (!noExpiration && (!expiresAt || new Date(expiresAt).getTime() <= Date.now())) {
      setFormError('Choose an expiration date and time in the future, or select no expiration.')
      return
    }
    if (replaceExisting && !replaceId) {
      setFormError('Select the active code to deactivate, or turn off replacement.')
      return
    }
    if (replaceExisting) {
      const codeToReplace = codes.find((code) => code.id === replaceId)
      if (!codeToReplace || !window.confirm(
        `Create the new code and deactivate code ${codeToReplace.safeId}? Existing scholars keep their accounts, but this code will stop working for future registrations.`,
      )) {
        return
      }
    }

    setBusy(true)
    try {
      const result = await createAccessCode({
        code: codeValue,
        maxUses: parsedMaxUses,
        expiresAt: noExpiration ? null : new Date(expiresAt).toISOString(),
        deactivateId: replaceExisting ? replaceId : null,
      })
      setOneTimeCode(result.code)
      setCopied(false)
      setCodeValue('')
      setNotice(replaceExisting ? 'Replacement code created and selected previous code deactivated.' : 'Access code created.')
      setReplaceId('')
      setReplaceExisting(false)
      await refreshCodes()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Access code could not be created.')
    } finally {
      setBusy(false)
    }
  }

  async function changeStatus(code: AccessCode, active: boolean) {
    const action = active ? 'activate' : 'deactivate'
    if (!window.confirm(`${active ? 'Activate' : 'Deactivate'} code ${code.safeId}? ${active ? 'It will be accepted for future registrations.' : 'Future registrations will no longer be able to use it.'}`)) {
      return
    }
    setBusyCodeId(code.id)
    setNotice('')
    setLoadError('')
    try {
      const updated = await setAccessCodeActive(code.id, active)
      setCodes((current) => current.map((item) => item.id === code.id ? { ...item, ...updated } : item))
      setNotice(`Code ${code.safeId} ${active ? 'activated' : 'deactivated'}.`)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : `Could not ${action} this code.`)
    } finally {
      setBusyCodeId('')
    }
  }

  async function copyOneTimeCode() {
    try {
      await navigator.clipboard.writeText(oneTimeCode)
      setCopied(true)
      setNotice('Code copied. Store it somewhere safe; it cannot be retrieved again.')
    } catch {
      setCopied(false)
      setFormError('Copy was unavailable. Select and copy the code from the one-time display.')
    }
  }

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div className="admin-title-icon"><ShieldCheck size={20} /></div>
        <div>
          <p className="eyebrow">ADMINISTRATION</p>
          <h1>{dashboardTab === 'codes' ? 'Access codes' : 'Admin dashboard'}</h1>
          <p className="admin-page-subtitle">{dashboardTab === 'codes' ? 'Create and manage the codes scholars use to register.' : 'Manage community access and review moderation activity.'}</p>
        </div>
        {dashboardTab === 'codes' && <button className="admin-refresh" onClick={() => { setLoading(true); void refreshCodes() }} type="button" disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spinning' : ''} />
          <span>Refresh</span>
        </button>}
      </header>

      <nav className="admin-root-tabs" aria-label="Administrator sections">
        <button className={dashboardTab === 'operations' ? 'active' : ''} onClick={() => setDashboardTab('operations')} type="button">Dashboard & tools</button>
        <button className={dashboardTab === 'codes' ? 'active' : ''} onClick={() => setDashboardTab('codes')} type="button">Access codes</button>
      </nav>

      {dashboardTab === 'operations' ? <AdminOperations
        userId={userId}
        communityName={communityName}
        communityAvatarUrl={communityAvatarUrl}
        communityAvatarPath={communityAvatarPath}
        onCommunitySettingsChanged={onCommunitySettingsChanged}
      /> : <>
      <section className="admin-card admin-create-card" aria-labelledby="create-code-heading">
        <div className="admin-card-heading">
          <span className="admin-icon-box"><Plus size={18} /></span>
          <div>
            <h2 id="create-code-heading">Create a registration code</h2>
            <p>Codes are stored as salted password hashes and shown only once after creation.</p>
          </div>
        </div>

        <form className="admin-code-form" onSubmit={(event) => void handleCreate(event)}>
          <label className="admin-field admin-code-field">
            <span>Custom code</span>
            <div className="admin-code-input-row">
              <input
                autoComplete="off"
                maxLength={128}
                minLength={8}
                onChange={(event) => setCodeValue(event.target.value)}
                placeholder="Enter your own code"
                required
                value={codeValue}
              />
              <button className="admin-secondary-button" onClick={generateCode} type="button">
                <Sparkles size={15} /> Generate
              </button>
            </div>
            <small>Choose 8–128 characters. The exact code is revealed once after saving.</small>
          </label>

          <div className="admin-form-grid">
            <label className="admin-field">
              <span>Maximum registrations</span>
              <input
                inputMode="numeric"
                max={2_147_483_647}
                min={1}
                onChange={(event) => setMaxUses(event.target.value)}
                required
                type="number"
                value={maxUses}
              />
              <small>Each successful registration uses one slot.</small>
            </label>
            <label className={`admin-field ${noExpiration ? 'admin-field-disabled' : ''}`}>
              <span>Expires</span>
              <input
                disabled={noExpiration}
                min={localDateTimeValue(new Date())}
                onChange={(event) => setExpiresAt(event.target.value)}
                required={!noExpiration}
                type="datetime-local"
                value={expiresAt}
              />
              <small>Expiration is checked by the server during registration.</small>
            </label>
          </div>

          <label className="admin-check-row">
            <input checked={noExpiration} onChange={(event) => setNoExpiration(event.target.checked)} type="checkbox" />
            <span><strong>No expiration</strong><small>Use only when you intend this code to remain valid until exhausted or deactivated.</small></span>
          </label>

          <div className="admin-replace-box">
            <label className="admin-check-row">
              <input checked={replaceExisting} onChange={(event) => { setReplaceExisting(event.target.checked); setReplaceId('') }} type="checkbox" />
              <span><strong>Replace and deactivate one active code</strong><small>The new code and deactivation are applied together. Other codes are unchanged.</small></span>
            </label>
            {replaceExisting && (
              <label className="admin-field admin-replace-select">
                <span>Code to deactivate</span>
                <select onChange={(event) => setReplaceId(event.target.value)} required value={replaceId}>
                  <option value="">Select an active code</option>
                  {replaceableCodes.map((code) => (
                    <option key={code.id} value={code.id}>Code {code.safeId} · {code.uses}/{code.max_uses ?? '∞'} used</option>
                  ))}
                </select>
                {replaceableCodes.length === 0 && <small>There are no active codes to replace.</small>}
              </label>
            )}
          </div>

          {formError && <p className="admin-feedback error" role="alert">{formError}</p>}
          {notice && <p className="admin-feedback success" role="status">{notice}</p>}
          <button className="admin-primary-button" disabled={busy || (replaceExisting && replaceableCodes.length === 0)} type="submit">
            <KeyRound size={16} /> {busy ? 'Creating code…' : 'Create access code'}
          </button>
        </form>

        {oneTimeCode && (
          <div className="admin-one-time-code" role="status">
            <div>
              <strong>Your new code — save it now</strong>
              <p>This code is not stored in readable form and cannot be viewed again after you dismiss it.</p>
              <code>{oneTimeCode}</code>
            </div>
            <div className="admin-one-time-actions">
              <button className="admin-secondary-button" onClick={() => void copyOneTimeCode()} type="button">
                {copied ? <Check size={15} /> : <Clipboard size={15} />} {copied ? 'Copied' : 'Copy code'}
              </button>
              <button className="admin-text-button" onClick={() => { setOneTimeCode(''); setCopied(false) }} type="button">Dismiss</button>
            </div>
          </div>
        )}
      </section>

      <section className="admin-codes-section" aria-labelledby="existing-codes-heading">
        <div className="admin-list-heading">
          <div>
            <p className="eyebrow">REGISTRATION</p>
            <h2 id="existing-codes-heading">Existing codes <span>{codes.length}</span></h2>
          </div>
        </div>

        {loadError && <p className="admin-feedback error" role="alert">{loadError}</p>}
        {loading ? (
          <div className="admin-empty-state"><RefreshCw size={20} className="spinning" /><p>Loading access codes…</p></div>
        ) : codes.length === 0 ? (
          <div className="admin-empty-state"><KeyRound size={22} /><strong>No access codes yet</strong><p>Create a code above to allow scholar registration.</p></div>
        ) : (
          <div className="admin-code-list">
            {codes.map((code) => {
              const status = accessCodeState(code)
              const max = code.max_uses
              const remaining = code.remaining
              const progress = max ? Math.min((code.uses / max) * 100, 100) : 0
              const canActivate = !code.active
                && !code.expired
                && (remaining === null || remaining > 0)
              return (
                <article className="admin-code-card" key={code.id}>
                  <div className="admin-code-card-top">
                    <div className="admin-code-ident">
                      <span className="admin-code-symbol"><KeyRound size={16} /></span>
                      <div><strong>Code {code.safeId}</strong><small>Created {formatDate(code.created_at)}</small></div>
                    </div>
                    <span className={`admin-status-badge ${status.className}`}><i />{status.label}</span>
                  </div>
                  <div className="admin-usage">
                    <div className="admin-usage-label">
                      <span>Registrations</span>
                      <strong>{code.uses} used <span>·</span> {remaining === null ? 'Unlimited remaining' : `${remaining} remaining`} <span>·</span> {max ?? 'No limit'} max</strong>
                    </div>
                    {max !== null && <div className="admin-usage-track"><i style={{ width: `${progress}%` }} /></div>}
                  </div>
                  <dl className="admin-code-meta">
                    <div><dt>Expires</dt><dd>{formatDate(code.expires_at)}</dd></div>
                    <div><dt>Code identifier</dt><dd>{code.safeId}</dd></div>
                  </dl>
                  <div className="admin-code-actions">
                    {code.active ? (
                      <button
                        className="admin-danger-button"
                        disabled={busyCodeId === code.id}
                        onClick={() => void changeStatus(code, false)}
                        type="button"
                      >{busyCodeId === code.id ? 'Updating…' : 'Deactivate'}</button>
                    ) : (
                      <button
                        className="admin-secondary-button"
                        disabled={!canActivate || busyCodeId === code.id}
                        onClick={() => void changeStatus(code, true)}
                        title={canActivate ? 'Activate this code' : 'Expired or fully used codes cannot be reactivated'}
                        type="button"
                      >{busyCodeId === code.id ? 'Updating…' : 'Activate'}</button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>
      </>}
    </main>
  )
}
