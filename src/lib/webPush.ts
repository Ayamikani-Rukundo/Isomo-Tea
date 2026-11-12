import { requireSupabase } from './supabase'
import type { NativeNotificationPermission } from './nativeNotifications'

function applicationServerKey() {
  const key = import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY?.trim()
  if (!key) throw new Error('Browser push notifications are not configured yet.')
  const padding = '='.repeat((4 - key.length % 4) % 4)
  const base64 = (key + padding).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
}

export async function enableWebPush(userId: string) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    throw new Error('This browser does not support push notifications.')
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Allow notifications in your browser settings to enable alerts.')
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(),
  })
  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    await subscription.unsubscribe()
    throw new Error('The browser returned an incomplete push subscription.')
  }
  const { error } = await requireSupabase()
    .from('web_push_subscriptions')
    .upsert({
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    }, { onConflict: 'endpoint' })
  if (error) throw error
}

export async function disableWebPush(userId: string) {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return
  const endpoint = subscription.endpoint
  const { error } = await requireSupabase()
    .from('web_push_subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('endpoint', endpoint)
  if (error) throw error
  await subscription.unsubscribe()
}

export function browserPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function browserPushConfigured() {
  return Boolean(import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY?.trim()) && browserPushSupported()
}

export function browserNotificationPermission(): NativeNotificationPermission {
  if (!('Notification' in window)) return 'unavailable'
  return Notification.permission === 'default' ? 'prompt' : Notification.permission
}
