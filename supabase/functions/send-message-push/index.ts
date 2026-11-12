import webpush from 'npm:web-push@3.6.7'
import { serviceClient } from '../_shared/supabase.ts'

type WebPushSubscription = {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}

type NativePushToken = { id: string; user_id: string; token: string }

const webhookSecret = Deno.env.get('MESSAGE_PUSH_WEBHOOK_SECRET')
const vapidPublicKey = Deno.env.get('WEB_PUSH_PUBLIC_KEY')
const vapidPrivateKey = Deno.env.get('WEB_PUSH_PRIVATE_KEY')
const vapidSubject = Deno.env.get('WEB_PUSH_SUBJECT') ?? 'mailto:support@isomotea.site'
const firebaseServiceAccount = Deno.env.get('FIREBASE_SERVICE_ACCOUNT')
let firebaseAccessToken: { value: string; expiresAt: number } | null = null

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function encodeBase64Url(value: Uint8Array | string) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function decodePem(value: string) {
  const body = value.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '')
  return Uint8Array.from(atob(body), (character) => character.charCodeAt(0))
}

async function getFirebaseAccessToken() {
  if (!firebaseServiceAccount) throw new Error('Firebase push credentials are not configured.')
  if (firebaseAccessToken && firebaseAccessToken.expiresAt > Date.now() + 60_000) {
    return firebaseAccessToken.value
  }
  const account = JSON.parse(firebaseServiceAccount) as {
    client_email: string
    private_key: string
    project_id: string
  }
  if (!account.client_email || !account.private_key || !account.project_id) {
    throw new Error('Firebase service-account credentials are incomplete.')
  }
  const issuedAt = Math.floor(Date.now() / 1000)
  const header = encodeBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = encodeBase64Url(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: issuedAt,
    exp: issuedAt + 3600,
  }))
  const unsignedToken = `${header}.${claims}`
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    decodePem(account.private_key.replace(/\\n/g, '\n')),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(unsignedToken),
  ))
  const assertion = `${unsignedToken}.${encodeBase64Url(signature)}`
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!response.ok) throw new Error(`Firebase authorization failed (${response.status}).`)
  const tokenResult = await response.json() as { access_token: string; expires_in: number }
  firebaseAccessToken = {
    value: tokenResult.access_token,
    expiresAt: Date.now() + tokenResult.expires_in * 1000,
  }
  return firebaseAccessToken.value
}

async function sendFirebasePush(
  token: NativePushToken,
  projectId: string,
  accessToken: string,
  title: string,
  body: string,
  messageId: string,
) {
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token: token.token,
        notification: { title, body },
        data: { url: '/?section=inbox', messageId },
        android: {
          notification: { tag: `isomo-${messageId}`, channel_id: 'isomo-messages' },
        },
      },
    }),
  })
  if (response.status === 404 || response.status === 410) {
    const { error } = await serviceClient().from('native_push_tokens').delete().eq('id', token.id)
    if (error) console.error('Could not remove an expired FCM token.', error)
    return false
  }
  if (!response.ok) {
    const bodyText = await response.text()
    throw new Error(`Firebase message delivery failed (${response.status}): ${bodyText}`)
  }
  return true
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  if (!webhookSecret || request.headers.get('x-isomo-push-secret') !== webhookSecret) {
    return json({ error: 'Not authorized.' }, 401)
  }
  if (!vapidPublicKey || !vapidPrivateKey) {
    return json({ error: 'Web Push VAPID keys are not configured.' }, 503)
  }

  try {
    const webhook = await request.json() as {
      type?: string
      table?: string
      record?: { id?: string }
    }
    const messageId = webhook.record?.id
    if (webhook.type !== 'INSERT' || webhook.table !== 'messages' || !messageId) {
      return json({ ignored: true })
    }

    const service = serviceClient()
    const { data: message, error: messageError } = await service
      .from('messages')
      .select('id,conversation_id,sender_id,body,system_event,deleted_at')
      .eq('id', messageId)
      .maybeSingle()
    if (messageError) throw messageError
    if (!message || !message.sender_id || message.deleted_at || message.system_event) {
      return json({ ignored: true })
    }
    const { data: conversation, error: conversationError } = await service
      .from('conversations')
      .select('kind,title')
      .eq('id', message.conversation_id)
      .single()
    if (conversationError) throw conversationError
    const { data: sender, error: senderError } = await service
      .from('profiles')
      .select('username')
      .eq('id', message.sender_id)
      .maybeSingle()
    if (senderError) throw senderError
    const { data: members, error: membersError } = await service
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', message.conversation_id)
      .neq('user_id', message.sender_id)
    if (membersError) throw membersError
    const recipientIds = [...new Set((members ?? []).map((member) => member.user_id))]
    if (!recipientIds.length) return json({ delivered: 0 })

    const [{ data: settings, error: settingsError }, { data: webSubscriptions, error: webError }, { data: nativeTokens, error: nativeError }] = await Promise.all([
      service.from('user_settings').select('user_id,notifications_enabled,notifications_snoozed_until').in('user_id', recipientIds),
      service.from('web_push_subscriptions').select('id,user_id,endpoint,p256dh,auth').in('user_id', recipientIds),
      service.from('native_push_tokens').select('id,user_id,token').in('user_id', recipientIds),
    ])
    if (settingsError) throw settingsError
    if (webError) throw webError
    if (nativeError) throw nativeError

    const settingsByUser = new Map((settings ?? []).map((item) => [item.user_id, item]))
    const eligible = new Set(recipientIds.filter((id) => {
      const preference = settingsByUser.get(id)
      return preference?.notifications_enabled !== false
        && (!preference?.notifications_snoozed_until
          || new Date(preference.notifications_snoozed_until).getTime() <= Date.now())
    }))
    const title = conversation.kind === 'general'
      ? conversation.title || 'Delta Tea'
      : `@${sender?.username ?? 'A classmate'}`
    const body = message.body.trim().slice(0, 180) || 'Sent a new message.'
    const payload = JSON.stringify({
      title,
      body,
      tag: `isomo-${message.id}`,
      url: '/?section=inbox',
    })
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
    const webTargets = (webSubscriptions ?? []).filter((target) => eligible.has(target.user_id))
    const nativeTargets = (nativeTokens ?? []).filter((target) => eligible.has(target.user_id))

    const webResults = await Promise.allSettled(webTargets.map(async (target: WebPushSubscription) => {
      try {
        await webpush.sendNotification({
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.auth },
        }, payload, { TTL: 86_400, urgency: 'high' })
        return true
      } catch (error) {
        const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
          ? Number(error.statusCode)
          : 0
        if (statusCode === 404 || statusCode === 410) {
          const { error: deleteError } = await service.from('web_push_subscriptions').delete().eq('id', target.id)
          if (deleteError) console.error('Could not remove an expired web push subscription.', deleteError)
          return false
        }
        throw error
      }
    }))

    let firebaseResults: PromiseSettledResult<boolean>[] = []
    if (nativeTargets.length) {
      const account = firebaseServiceAccount
        ? JSON.parse(firebaseServiceAccount) as { project_id?: string }
        : null
      if (!account?.project_id) {
        console.error('Native push tokens exist, but Firebase service-account credentials are not configured.')
      } else {
        const accessToken = await getFirebaseAccessToken()
        firebaseResults = await Promise.allSettled(nativeTargets.map((target: NativePushToken) => (
          sendFirebasePush(target, account.project_id!, accessToken, title, body, message.id)
        )))
      }
    }

    const rejected = [...webResults, ...firebaseResults].filter((result) => result.status === 'rejected')
    rejected.forEach((result) => {
      if (result.status === 'rejected') console.error('A message push notification failed.', result.reason)
    })
    return json({
      webDelivered: webResults.filter((result) => result.status === 'fulfilled' && result.value).length,
      nativeDelivered: firebaseResults.filter((result) => result.status === 'fulfilled' && result.value).length,
      failures: rejected.length,
    }, rejected.length ? 207 : 200)
  } catch (error) {
    console.error('Message push dispatch failed.', error)
    return json({ error: error instanceof Error ? error.message : 'Push dispatch failed.' }, 500)
  }
})
