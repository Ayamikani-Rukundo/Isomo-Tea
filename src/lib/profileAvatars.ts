import { requireSupabase } from './supabase'

export const PROFILE_AVATAR_BUCKET = 'isomo-profile-avatars'
const signedUrlLifetimeSeconds = 86_400

export async function resolveProfileAvatarUrls(paths: Array<string | null | undefined>) {
  const uniquePaths = [...new Set(paths.filter((path): path is string => Boolean(path)))]
  if (!uniquePaths.length) return new Map<string, string>()

  const { data, error } = await requireSupabase()
    .storage
    .from(PROFILE_AVATAR_BUCKET)
    .createSignedUrls(uniquePaths, signedUrlLifetimeSeconds)
  if (error) throw error

  const urls = new Map<string, string>()
  for (const item of data) {
    if (item.error) throw new Error(`Could not access a profile photo: ${item.error}`)
    if (!item.path || !item.signedUrl) throw new Error('The profile photo service returned an invalid URL.')
    urls.set(item.path, item.signedUrl)
  }
  return urls
}
