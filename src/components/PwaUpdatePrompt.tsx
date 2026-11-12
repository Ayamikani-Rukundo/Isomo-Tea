import { Capacitor } from '@capacitor/core'
import { useEffect, useRef, useState } from 'react'

export function PwaUpdatePrompt() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null)
  const updateAccepted = useRef(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !import.meta.env.PROD || Capacitor.isNativePlatform()) return
    let active = true
    let registration: ServiceWorkerRegistration | null = null
    let updateInterval = 0
    const hadController = Boolean(navigator.serviceWorker.controller)

    const showWaitingWorker = () => {
      if (active && registration?.waiting && hadController) setWaitingWorker(registration.waiting)
    }
    const handleControllerChange = () => {
      if (hadController && updateAccepted.current) window.location.reload()
    }
    const handleUpdateFound = () => {
      const installing = registration?.installing
      if (!installing) return
      installing.addEventListener('statechange', showWaitingWorker)
    }
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('Isomo Tea encountered an unhandled asynchronous error.', event.reason)
    }
    const handleRuntimeError = (event: ErrorEvent) => {
      console.error('Isomo Tea encountered a runtime error.', event.error ?? event.message)
    }

    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    window.addEventListener('error', handleRuntimeError)
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange)
    void navigator.serviceWorker.register('/service-worker.js').then((nextRegistration) => {
      if (!active) return
      registration = nextRegistration
      showWaitingWorker()
      registration.addEventListener('updatefound', handleUpdateFound)
      updateInterval = window.setInterval(() => {
        void registration?.update().catch((error: unknown) => {
          console.error('Isomo Tea could not check for app updates.', error)
        })
      }, 60 * 60 * 1000)
    }).catch((error: unknown) => {
      console.error('Isomo Tea offline support could not be enabled.', error)
    })

    return () => {
      active = false
      window.clearInterval(updateInterval)
      registration?.removeEventListener('updatefound', handleUpdateFound)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
      window.removeEventListener('error', handleRuntimeError)
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange)
    }
  }, [])

  if (!waitingWorker) return null
  return (
    <aside className="pwa-update-prompt" role="status">
      <span>A new version of Isomo Tea is ready.</span>
      <button onClick={() => {
        updateAccepted.current = true
        waitingWorker.postMessage({ type: 'SKIP_WAITING' })
      }} type="button">Update</button>
      <button onClick={() => setWaitingWorker(null)} type="button" aria-label="Dismiss update notice">Not now</button>
    </aside>
  )
}
