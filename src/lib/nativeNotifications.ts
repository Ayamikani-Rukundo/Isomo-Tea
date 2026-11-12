import { Capacitor, type PermissionState } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { MentionNotification } from '../types'

const mentionChannelId = 'isomo-mentions'
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
  mentionChannelReady = true
}

export async function checkNativeNotificationPermission(): Promise<NativeNotificationPermission> {
  if (!Capacitor.isNativePlatform()) return 'unavailable'
  const { display } = await LocalNotifications.checkPermissions()
  return display
}

export async function requestNativeNotificationPermission(): Promise<NativeNotificationPermission> {
  if (!Capacitor.isNativePlatform()) return 'unavailable'
  let { display } = await LocalNotifications.checkPermissions()
  if (display === 'prompt' || display === 'prompt-with-rationale') {
    display = (await LocalNotifications.requestPermissions()).display
  }
  if (display === 'granted') await ensureMentionChannel()
  return display
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
