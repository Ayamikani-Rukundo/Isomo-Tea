import { Capacitor, type PermissionState, type PluginListenerHandle } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { PushNotifications } from '@capacitor/push-notifications'
import { requireSupabase } from './supabase'
import type { MentionNotification } from '../types'

const mentionChannelId = 'isomo-mentions'
const messageChannelId = 'isomo-messages'
let mentionChannelReady = false

export type NativeNotificationPermission = PermissionState | 'unavailable'

async function ensureMentionChannel() {
  if (Capacitor.getPlatform() !== 'android' || mentionChannelReady) return
  const { channels } = await LocalNotifications.listChannels()
  if (!channels.some((channel) => channel.id === mentionChannelId)) {
    await LocalNotifications.createChannel({
      id: mentionChannelId,
      name: 'Isomo Tea mentions',
      description: 'Alerts when someone mentions you in a conversation.',
      importance: 4,
    })
  }
  if (!channels.some((channel) => channel.id === messageChannelId)) {
    await LocalNotifications.createChannel({
      id: messageChannelId,
      name: 'Isomo Tea messages',
      description: 'Alerts for new messages in your conversations.',
      importance: 4,
    })
  }
  mentionChannelReady = true
}

export async function checkNativeNotificationPermission(): Promise<NativeNotificationPermission> {
  if (!Capacitor.isNativePlatform()) return 'unavailable'
  const { receive } = await PushNotifications.checkPermissions()
  return receive
}

export async function requestNativeNotificationPermission(): Promise<NativeNotificationPermission> {
  if (!Capacitor.isNativePlatform()) return 'unavailable'
  let { receive } = await PushNotifications.checkPermissions()
  if (receive === 'prompt' || receive === 'prompt-with-rationale') {
    receive = (await PushNotifications.requestPermissions()).receive
  }
  if (receive === 'granted') {
    await ensureMentionChannel()
    const { display } = await LocalNotifications.checkPermissions()
    if (display === 'prompt' || display === 'prompt-with-rationale') {
      await LocalNotifications.requestPermissions()
    }
  }
  return receive
}

export async function registerNativePush(userId: string, onError: (message: string) => void) {
  if (!Capacitor.isNativePlatform()) return async () => {}
  const listeners: PluginListenerHandle[] = []
  listeners.push(await PushNotifications.addListener('registration', async ({ value }) => {
    try {
      const { error } = await requireSupabase()
        .from('native_push_tokens')
        .upsert({
          user_id: userId,
          token: value,
          platform: Capacitor.getPlatform() === 'ios' ? 'ios' : 'android',
        }, { onConflict: 'token' })
      if (error) throw error
    } catch (error) {
      console.error('Could not save this device push token.', error)
      onError('Push notifications could not be connected to this device.')
    }
  }))
  listeners.push(await PushNotifications.addListener('registrationError', (error) => {
    console.error('Native push registration failed.', error)
    onError('This Android build is missing Firebase push configuration.')
  }))
  await PushNotifications.register()
  return async () => {
    await Promise.all(listeners.map((listener) => listener.remove()))
  }
}

export async function listenForNativeNotificationActions() {
  if (!Capacitor.isNativePlatform()) return async () => {}
  const listener = await PushNotifications.addListener('pushNotificationActionPerformed', () => {
    window.dispatchEvent(new CustomEvent('isomo:open-inbox'))
  })
  return () => listener.remove()
}

function notificationId(messageId: string) {
  let hash = 0
  for (let index = 0; index < messageId.length; index += 1) {
    hash = Math.imul(hash, 31) + messageId.charCodeAt(index)
  }
  return Math.abs(hash % 2147483647) + 1
}

export async function showNativeMentionNotification(mention: MentionNotification) {
  if (!Capacitor.isNativePlatform()) return
  if ((await LocalNotifications.checkPermissions()).display !== 'granted') return
  await ensureMentionChannel()
  await LocalNotifications.schedule({
    notifications: [{
      id: notificationId(mention.messageId),
      title: 'Isomo Tea',
      body: `@${mention.author} mentioned you.`,
      ...(Capacitor.getPlatform() === 'android' ? { channelId: mentionChannelId } : {}),
    }],
  })
}
