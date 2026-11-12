import { requireSupabase } from './supabase'

export const MAX_MEDIA_BYTES = 20 * 1024 * 1024
export const MAX_OUTBOX_BYTES = 50 * 1024 * 1024
const bucket = 'isomo-chat-media'
const allowedTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
  'audio/mpeg',
  'video/mp4',
  'video/webm',
])

export type MediaKind = 'image' | 'audio' | 'video'
export type QueuedMedia = {
  id: string
  userId: string
  conversationId: string
  body: string
  replyToId?: string
  file: File
  mimeType: string
  viewOnce: boolean
  mediaGroupId?: string
}

type StoredMedia = Omit<QueuedMedia, 'file'> & { blob: Blob; fileName: string }
const outboxDatabase = 'isomo-tea-outbox'
const outboxStore = 'media'

export class MediaAccessError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'MediaAccessError'
    this.status = status
  }
}

function openOutbox() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(outboxDatabase, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(outboxStore, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the media outbox.'))
    request.onblocked = () => reject(new Error('The media outbox is blocked by another open tab.'))
  })
}

export async function saveQueuedMedia(media: QueuedMedia) {
  if (media.viewOnce) throw new Error('View-once media cannot be stored in the persistent retry queue.')
  const database = await openOutbox()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(outboxStore, 'readwrite')
      const store = transaction.objectStore(outboxStore)
      const request = store.getAll() as IDBRequest<StoredMedia[]>
      request.onsuccess = () => {
        const totalSize = request.result
          .filter((item) => item.userId === media.userId && item.id !== media.id)
          .reduce((total, item) => total + item.blob.size, 0)
        if (totalSize + media.file.size > MAX_OUTBOX_BYTES) {
          transaction.abort()
          reject(new Error('The local media outbox is full. Send or remove a pending upload first.'))
          return
        }
        const stored: StoredMedia = {
          ...media,
          blob: media.file,
          fileName: media.file.name,
        }
        store.put(stored)
      }
      request.onerror = () => reject(request.error ?? new Error('Could not inspect pending media.'))
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not preserve pending media.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not preserve pending media.'))
    })
  } finally {
    database.close()
  }
}

export async function loadQueuedMedia(userId: string, conversationId: string) {
  const database = await openOutbox()
  try {
    const stored = await new Promise<StoredMedia[]>((resolve, reject) => {
      const transaction = database.transaction(outboxStore, 'readwrite')
      const store = transaction.objectStore(outboxStore)
      const request = store.getAll() as IDBRequest<StoredMedia[]>
      let queued: StoredMedia[] = []
      request.onsuccess = () => {
        const allItems = request.result
        allItems.filter((item) => item.viewOnce).forEach((item) => store.delete(item.id))
        queued = allItems.filter((item) => (
          !item.viewOnce && item.userId === userId && item.conversationId === conversationId
        ))
      }
      request.onerror = () => reject(request.error ?? new Error('Could not restore pending media.'))
      transaction.oncomplete = () => resolve(queued)
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not restore pending media.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not restore pending media.'))
    })
    return stored.map(({ blob, fileName, ...item }) => ({
      ...item,
      file: new File([blob], fileName, { type: item.mimeType }),
    }))
  } finally {
    database.close()
  }
}

export async function removeQueuedMedia(id: string) {
  const database = await openOutbox()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(outboxStore, 'readwrite')
      transaction.objectStore(outboxStore).delete(id)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not clear the pending media item.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not clear the pending media item.'))
    })
  } finally {
    database.close()
  }
}

export function normalizeMediaType(file: File) {
  const declared = file.type.split(';', 1)[0].trim().toLowerCase()
  if (allowedTypes.has(declared)) return declared
  const extension = file.name.split('.').pop()?.toLowerCase()
  const fromExtension: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    webm: declared.startsWith('audio/') ? 'audio/webm' : 'video/webm',
    m4a: 'audio/mp4',
    ogg: 'audio/ogg',
    mp3: 'audio/mpeg',
    mp4: declared.startsWith('audio/') ? 'audio/mp4' : 'video/mp4',
  }
  const guessed = extension ? fromExtension[extension] : undefined
  return guessed && allowedTypes.has(guessed) ? guessed : ''
}

export function mediaKindFor(mimeType: string): MediaKind {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType.startsWith('video/')) return 'video'
  throw new Error('Choose an image, audio recording, or video file.')
}

export function extensionForMediaType(mimeType: string) {
  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/webm': 'webm',
    'audio/mp4': 'm4a',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
  }
  const extension = extensions[mimeType]
  if (!extension) throw new Error('This media format is not supported.')
  return extension
}

export async function uploadMedia(
  file: File,
  path: string,
  onProgress: (progress: number) => void,
) {
  const client = requireSupabase()
  const [{ data: { session }, error: sessionError }] = await Promise.all([
    client.auth.getSession(),
  ])
  if (sessionError) throw sessionError
  if (!session) throw new Error('Sign in again before uploading media.')

  const endpoint = import.meta.env.VITE_SUPABASE_URL?.trim()
  const apiKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!endpoint || !apiKey) throw new Error('Supabase media storage is not configured.')

  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', `${endpoint}/storage/v1/object/${bucket}/${encodedPath}`)
    request.setRequestHeader('Authorization', `Bearer ${session.access_token}`)
    request.setRequestHeader('apikey', apiKey)
    request.setRequestHeader('Content-Type', normalizeMediaType(file))
    request.setRequestHeader('x-upsert', 'false')
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
    }
    request.onerror = () => reject(new Error('Media upload failed. Check your connection and try again.'))
    request.onabort = () => reject(new Error('Media upload was cancelled.'))
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100)
        resolve()
        return
      }
      let message = `Media upload failed (${request.status}).`
      try {
        const response = JSON.parse(request.responseText) as { message?: unknown; error?: unknown }
        if (typeof response.message === 'string') message = response.message
        else if (typeof response.error === 'string') message = response.error
      } catch {
        if (request.statusText) message = `Media upload failed: ${request.statusText}`
      }
      reject(new Error(message))
    }
    request.send(file)
  })
}

export async function requestMessageMedia(messageId: string) {
  const client = requireSupabase()
  const [{ data: { session }, error: sessionError }] = await Promise.all([
    client.auth.getSession(),
  ])
  if (sessionError) throw sessionError
  if (!session) throw new Error('Sign in again to view conversation media.')
  const endpoint = import.meta.env.VITE_SUPABASE_URL?.trim()
  const apiKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!endpoint || !apiKey) throw new Error('Supabase media access is not configured.')

  const response = await fetch(`${endpoint}/functions/v1/media-access`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messageId }),
  })
  if (!response.ok) {
    let message = `Media could not be opened (${response.status}).`
    try {
      const body = await response.json() as { error?: unknown }
      if (typeof body.error === 'string') message = body.error
    } catch {
      if (response.statusText) message = `Media could not be opened: ${response.statusText}`
    }
    throw new MediaAccessError(message, response.status)
  }
  return response.blob()
}
