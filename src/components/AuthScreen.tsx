import { Capacitor } from '@capacitor/core'
import { useEffect, useState, type FormEvent } from 'react'
import { ArrowDownToLine, ArrowRight, Eye, EyeOff, LockKeyhole, MessageCircle, MonitorDown, RefreshCw, Smartphone, UsersRound } from 'lucide-react'
import type { AuthMode } from '../types'
import { Brand } from './Brand'
import { useAuth } from '../context/useAuth'
import { promptPwaInstall, subscribeToPwaInstall, type PwaInstallState } from '../lib/pwaInstall'
import {
  availableUsernameSuggestions,
  registerScholar,
  signInAdministrator,
  signInScholar,
  usernameAvailable,
} from '../lib/auth'

type AuthScreenProps = {
  initialMode: AuthMode
  onAuthenticated: () => void
}

export function AuthScreen({ initialMode, onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState(initialMode)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [accessCode, setAccessCode] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [availability, setAvailability] = useState<{ username: string; status: 'checking' | 'available' | 'taken' | 'error' }>({ username: '', status: 'checking' })
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [suggestionsError, setSuggestionsError] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [pwaInstallState, setPwaInstallState] = useState<PwaInstallState>({ available: false, installed: false })
  const [installStatus, setInstallStatus] = useState('')
  const [showInstallHelp, setShowInstallHelp] = useState(false)
  const { configured } = useAuth()
  const isNativeApp = Capacitor.isNativePlatform()
  const isWindowsDevice = /Windows/i.test(navigator.userAgent)
  const { available: installPromptAvailable, installed } = pwaInstallState
  const configuredApkUrl = import.meta.env.VITE_ANDROID_APK_URL?.trim()
  const androidApkUrl = (() => {
    if (!configuredApkUrl) return null
    try {
      const url = new URL(configuredApkUrl)
      return url.protocol === 'https:' ? url.toString() : null
    } catch {
      return null
    }
  })()

  useEffect(() => {
    return subscribeToPwaInstall(setPwaInstallState)
  }, [])

  async function installApp() {
    if (!installPromptAvailable) {
      setShowInstallHelp(true)
      return
    }
    setShowInstallHelp(false)
    try {
      const choice = await promptPwaInstall()
      if (!choice) {
        setShowInstallHelp(true)
        return
      }
      setInstallStatus(choice.outcome === 'accepted'
        ? isWindowsDevice
          ? 'Install accepted. If it does not open automatically, launch Isomo Tea from Start or your browser’s apps list, then pin it from its taskbar icon.'
          : 'Install accepted. If it does not open automatically, launch Isomo Tea from your home screen or browser’s apps list.'
        : 'Install cancelled. You can try again from your browser’s app menu.')
    } catch (installError) {
      console.error('PWA installation could not be started.', installError)
      setInstallStatus('Installation could not be started. Use your browser’s app menu to install Isomo Tea.')
    }
  }

  function reloadApp() {
    if ((username || password || accessCode || adminEmail) && !window.confirm('Reload Isomo Tea? Unsaved sign-in details will be cleared.')) return
    window.location.reload()
  }

  useEffect(() => {
    if (mode !== 'register' || username.trim().length < 3) return
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
  }, [mode, username])
  const usernameAvailability = mode === 'register' && username.trim().length >= 3
    ? availability.username === username.trim().toLowerCase() ? availability.status : 'checking'
    : 'idle'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'register') {
        if (usernameAvailability === 'taken') throw new Error('That username is already taken. Try another one.')
        if (usernameAvailability === 'checking') throw new Error('Please wait for the username availability check to finish.')
        await registerScholar(username, password, accessCode)
      } else if (mode === 'admin') {
        await signInAdministrator(adminEmail, password)
      } else {
        await signInScholar(username, password)
      }
      onAuthenticated()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Authentication failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function loadSuggestions() {
    setSuggestionsError('')
    setSuggestionsLoading(true)
    try {
      setSuggestions(await availableUsernameSuggestions())
    } catch (requestError) {
      setSuggestionsError(requestError instanceof Error ? requestError.message : 'Could not load username suggestions.')
    } finally {
      setSuggestionsLoading(false)
    }
  }

  function changeMode(next: AuthMode) {
    setMode(next)
    setError('')
    setAvailability({ username: '', status: 'checking' })
    setSuggestions([])
  }

  return (
    <main className={`auth-page ${isNativeApp ? 'native-app' : ''}`}>
      <div className="auth-art">
        <div className="auth-brand-row">
          <Brand />
          {installed && !isNativeApp && <button className="auth-refresh-button" onClick={reloadApp} type="button" aria-label="Reload Isomo Tea" title="Reload Isomo Tea"><RefreshCw size={15} /></button>}
        </div>
        <div className="auth-art-copy">
          <span className="eyebrow">PRIVATE COMMUNITY · ISOMO ACADEMY</span>
          <h1>Your people.<br /><em>Your space.</em></h1>
          <p>A familiar, private place to catch up with the Isomo community.</p>
          <div className="auth-benefits" aria-label="Isomo Tea features">
            <span><LockKeyhole size={15} /> Private by alias</span>
            <span><MessageCircle size={15} /> Group and private chats</span>
            <span><UsersRound size={15} /> Made for Isomo</span>
          </div>
        </div>
        {!isNativeApp && <div className="auth-art-footer">
          <div className="auth-actions">
            <button className="pwa-install-button" onClick={() => void installApp()} type="button" disabled={installed}>
              <MonitorDown size={18} /> {installed ? 'Installed on this device' : 'Install this app'}
            </button>
            <div className="auth-downloads">
              {androidApkUrl
                ? <a className="app-download-button" href={androidApkUrl} aria-label="Download the Isomo Tea Android APK">
                    <Smartphone size={17} />
                    <span><strong>Download APK</strong><small>{import.meta.env.VITE_ANDROID_APK_VERSION || 'Android app'}{import.meta.env.VITE_ANDROID_APK_SIZE ? ` · ${import.meta.env.VITE_ANDROID_APK_SIZE}` : ''}</small></span>
                    <ArrowDownToLine size={15} />
                  </a>
                : <button className="app-download-unavailable" type="button" disabled aria-label="APK download link not configured">
                    <Smartphone size={17} />
                    <span><strong>Download APK</strong><small>Link added after release</small></span>
                  </button>}
            </div>
          </div>
          <div className="auth-install">
            {showInstallHelp && !installPromptAvailable && !installed && <p className="auth-install-status" role="status">
              No install prompt is available. In Edge, use <strong>… → Apps → Install this site as an app</strong>; in Chrome, use <strong>⋮ → Install page as app</strong>. Windows users can pin the taskbar icon after installation; the browser and operating system control launch behavior and pinning.
            </p>}
            {installed && <p className="auth-install-status">{isWindowsDevice ? 'Installed. On Windows, right-click its taskbar icon and choose “Pin to taskbar”.' : 'Isomo Tea is installed. Open it from your home screen or apps list.'}</p>}
            {installStatus && <p className="auth-install-status" role="status">{installStatus}</p>}
          </div>
        </div>}
        <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
      </div>
      <section className="auth-form-side">
        <div className="auth-form-box">
          <span className="eyebrow">{mode === 'admin' ? 'ADMIN SIGN IN' : 'UWABABIRI GUSA'}</span>
          <h2>{mode === 'login' ? 'Welcome back.' : mode === 'admin' ? 'Administrator sign in.' : 'Choose your alias.'}</h2>
          <p className="auth-subtitle">{mode === 'login' ? 'Sign in with the username your community sees.' : mode === 'admin' ? 'Sign in with your administrator account.' : 'Choose a unique name members will see.'}</p>
          <div className="auth-tabs" role="tablist" aria-label="Account options">
            <button aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => changeMode('login')} role="tab" type="button">Sign in</button>
            <button aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => changeMode('register')} role="tab" type="button">Create account</button>
          </div>
          {!configured && <div className="auth-inline-notice config-notice" role="status">Supabase is not configured. Add the project URL and anon key to <code>.env.local</code>, then deploy the backend functions.</div>}
          {error && <div className="auth-error" role="alert">{error}</div>}
          <form className="auth-fields" onSubmit={(event) => void submit(event)}>
            {mode === 'register' && <>
              <label>Isomo access code<input required type="password" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} autoComplete="off" placeholder="Enter your community code" /><small>Shared by your Isomo administrator. Validated securely by the backend.</small></label>
            </>}
            {mode === 'admin'
              ? <label>Administrator email<div className="input-with-icon"><span>@</span><input required type="email" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} autoComplete="username" placeholder="admin@isomo.rw" /></div></label>
              : <label>Username<div className="input-with-icon"><span>@</span><input required minLength={3} maxLength={24} pattern="[A-Za-z0-9._]+( [A-Za-z0-9._]+)*" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder="No way out" aria-describedby={mode === 'register' ? 'username-status' : undefined} /></div>
                {mode === 'register' && <small id="username-status" className={`availability availability-${availability}`}>
                  {usernameAvailability === 'checking' ? 'Checking availability…' : usernameAvailability === 'available' ? 'This username is available.' : usernameAvailability === 'taken' ? 'That username is already taken.' : usernameAvailability === 'error' ? 'Availability check failed. The server will still verify on submit.' : 'Use 3–24 letters, numbers, periods, underscores, and single spaces.'}
                </small>}
              </label>}
            {mode === 'register' && <>
              <button className="text-button suggestion-trigger" onClick={() => void loadSuggestions()} disabled={suggestionsLoading} type="button">{suggestionsLoading ? 'Checking suggestions…' : 'Suggest an available username'}</button>
              {suggestionsError && <span className="auth-inline-notice" role="status">{suggestionsError}</span>}
              {suggestions.length > 0 && <div className="username-suggestions" aria-label="Available username suggestions">{suggestions.slice(0, 5).map((suggestion) => <button key={suggestion} onClick={() => { setUsername(suggestion); setSuggestions([]) }} type="button">@{suggestion}</button>)}</div>}
            </>}
            <label>Password<div className="input-with-action"><input required minLength={8} type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" autoComplete={mode === 'login' || mode === 'admin' ? 'current-password' : 'new-password'} /><button onClick={() => setShowPassword(!showPassword)} type="button" aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
            <button className="primary-button auth-submit" type="submit" disabled={busy || !configured}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in to your space' : mode === 'admin' ? 'Administrator sign in' : 'Create my anonymous account'} <ArrowRight size={17} />
            </button>
            <p className="auth-privacy">{mode === 'admin' ? 'Administrator access is invite-only.' : 'Euwanaaa, this is the only place wamurasiramo.'}</p>
          </form>
          <button className="admin-login-link" onClick={() => changeMode(mode === 'admin' ? 'login' : 'admin')} type="button">{mode === 'admin' ? 'Scholar sign in' : 'Administrator sign in'}</button>
          <p className="auth-privacy auth-back-link">Messages which are not tea are not allowed.</p>
        </div>
      </section>
    </main>
  )
}
