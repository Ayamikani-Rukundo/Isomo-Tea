import { useCallback, useEffect, useState } from 'react'
import { COMMUNITY_AVATAR_BUCKET, type CommunityProfile } from '../lib/community'
import { requireSupabase } from '../lib/supabase'

const defaultCommunityProfile: CommunityProfile = {
  id: '',
  title: 'Delta Tea',
  avatarPath: null,
  avatarUrl: '/delta-tea-avatar.png',
}

export function useCommunitySettings(userId?: string) {
  const [settings, setSettings] = useState(defaultCommunityProfile)
  const [error, setError] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)

  const refresh = useCallback(() => setRefreshVersion((version) => version + 1), [])

  useEffect(() => {
    if (!userId) return

    const client = requireSupabase()
    let active = true
    let channel: ReturnType<typeof client.channel> | null = null
    let requestVersion = 0

    async function loadSettings() {
      const currentRequest = ++requestVersion
      try {
        const { data: conversation, error: conversationError } = await client
          .from('conversations')
          .select('id,title,avatar_path')
          .eq('kind', 'general')
          .maybeSingle()
        if (conversationError) throw conversationError
        if (!conversation) throw new Error('The community conversation was not found.')

        let avatarUrl = '/delta-tea-avatar.png'
        if (conversation.avatar_path) {
          const { data, error: avatarError } = await client.storage
            .from(COMMUNITY_AVATAR_BUCKET)
            .createSignedUrl(conversation.avatar_path, 86_400)
          if (avatarError) throw avatarError
          if (!data?.signedUrl) throw new Error('The community photo service returned an invalid URL.')
          avatarUrl = data.signedUrl
        }

        if (!active || currentRequest !== requestVersion) return
        setSettings({
          id: conversation.id,
          title: conversation.title?.trim() || 'Delta Tea',
          avatarPath: conversation.avatar_path,
          avatarUrl,
        })
        setError('')

        if (!channel) {
          channel = client
            .channel(`community-settings:${conversation.id}`)
            .on('postgres_changes', {
              event: 'UPDATE',
              schema: 'public',
              table: 'conversations',
              filter: `id=eq.${conversation.id}`,
            }, () => { void loadSettings() })
            .subscribe()
        }
      } catch (loadError) {
        if (!active || currentRequest !== requestVersion) return
        console.error('Could not load the community profile.', loadError)
        setError('Community profile settings could not be loaded.')
      }
    }

    void loadSettings()
    return () => {
      active = false
      if (channel) void client.removeChannel(channel)
    }
  }, [refreshVersion, userId])

  return { ...(userId ? settings : defaultCommunityProfile), error: userId ? error : '', refresh }
}
