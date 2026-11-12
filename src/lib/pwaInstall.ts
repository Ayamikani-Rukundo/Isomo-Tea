export type PwaInstallState = {
  available: boolean
  installed: boolean
}

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

type InstallChoice = { outcome: 'accepted' | 'dismissed'; platform: string }

let deferredPrompt: InstallPromptEvent | null = null
let installed = false
const listeners = new Set<(state: PwaInstallState) => void>()

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || ('standalone' in navigator && navigator.standalone === true)
}

function getState(): PwaInstallState {
  return { available: deferredPrompt !== null, installed: installed || isStandalone() }
}

function notifyListeners() {
  const state = getState()
  listeners.forEach((listener) => listener(state))
}

if (typeof window !== 'undefined') {
  installed = isStandalone()
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt = event as InstallPromptEvent
    notifyListeners()
  })
  window.addEventListener('appinstalled', () => {
    installed = true
    deferredPrompt = null
    notifyListeners()
  })
  window.matchMedia('(display-mode: standalone)').addEventListener('change', (event) => {
    installed = event.matches
    notifyListeners()
  })
}

export function subscribeToPwaInstall(listener: (state: PwaInstallState) => void) {
  listeners.add(listener)
  listener(getState())
  return () => {
    listeners.delete(listener)
  }
}

export async function promptPwaInstall(): Promise<InstallChoice | null> {
  if (!deferredPrompt) return null
  const prompt = deferredPrompt
  deferredPrompt = null
  notifyListeners()
  await prompt.prompt()
  const choice = await prompt.userChoice
  notifyListeners()
  return choice
}
