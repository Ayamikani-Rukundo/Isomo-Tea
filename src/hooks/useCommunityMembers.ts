import { useCallback, useEffect, useState } from 'react'
import { requireSupabase } from '../lib/supabase'
import { resolveProfileAvatarUrls } from '../lib/profileAvatars'
import type { CommunityMember } from '../types'

const PAGE_SIZE = 40
const colors = ['coral', 'purple', 'blue', 'gold', 'green', 'pink']

type MemberPage = {
  ownerId: string
  members: CommunityMember[]
  hasMore: boolean
  error: string
}

function initials(username: string) {
  return username.split(/[._]/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || '?'
}

function colorFor(id: string) {
  let hash = 0
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return colors[hash % colors.length]
}

export function useCommunityMembers(userId: string | undefined, enabled: boolean) {
  const [page, setPage] = useState<MemberPage | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const isCurrentPage = Boolean(enabled && userId && page?.ownerId === userId)

  useEffect(() => {
    let active = true
    if (!enabled || !userId) return () => { active = false }

    void (async () => {
      try {
        const client = requireSupabase()
        const [{ data: profiles, error: profileError }, { data: administrators, error: adminError }] = await Promise.all([
          client.from('profiles').select('id, username, avatar_url').order('username').limit(PAGE_SIZE),
          client.from('administrators').select('user_id'),
        ])
        if (profileError) throw profileError
        if (adminError) throw adminError
        const avatarUrls = await resolveProfileAvatarUrls(profiles.map((profile) => profile.avatar_url))
        if (!active) return

        const adminIds = new Set(administrators.map((administrator) => administrator.user_id))
        const members = profiles.map((profile) => ({
          id: profile.id,
          username: profile.username,
          avatarUrl: profile.avatar_url ? avatarUrls.get(profile.avatar_url) ?? null : null,
          initials: initials(profile.username),
          color: colorFor(profile.id),
          status: 'member',
          admin: adminIds.has(profile.id),
        }))
        setPage({
          ownerId: userId,
          members,
          hasMore: profiles.length === PAGE_SIZE,
          error: '',
        })
      } catch (error) {
        if (!active) return
        console.error('Could not load community members.', error)
        setPage({
          ownerId: userId,
          members: [],
          hasMore: false,
          error: error instanceof Error ? error.message : 'Community members could not be loaded.',
        })
      }
    })()

    return () => { active = false }
  }, [enabled, userId])

  const loadMore = useCallback(async () => {
    if (!enabled || !userId || !isCurrentPage || !page?.hasMore || loadingMore) return
    const lastUsername = page.members[page.members.length - 1]?.username
    if (!lastUsername) return
    setLoadingMore(true)
    try {
      const client = requireSupabase()
      const [{ data: profiles, error: profileError }, { data: administrators, error: adminError }] = await Promise.all([
        client.from('profiles').select('id, username, avatar_url').gt('username', lastUsername).order('username').limit(PAGE_SIZE),
        client.from('administrators').select('user_id'),
      ])
      if (profileError) throw profileError
      if (adminError) throw adminError
      const avatarUrls = await resolveProfileAvatarUrls(profiles.map((profile) => profile.avatar_url))
      if (page.ownerId !== userId) return

      const adminIds = new Set(administrators.map((administrator) => administrator.user_id))
      const nextMembers = profiles.map((profile) => ({
        id: profile.id,
        username: profile.username,
        avatarUrl: profile.avatar_url ? avatarUrls.get(profile.avatar_url) ?? null : null,
        initials: initials(profile.username),
        color: colorFor(profile.id),
        status: 'member',
        admin: adminIds.has(profile.id),
      }))
      setPage((current) => current && current.ownerId === userId
        ? {
            ...current,
            members: [...current.members, ...nextMembers.filter((next) => !current.members.some((item) => item.id === next.id))],
            hasMore: profiles.length === PAGE_SIZE,
            error: '',
          }
        : current)
    } catch (error) {
      console.error('Could not load more community members.', error)
      setPage((current) => current && current.ownerId === userId
        ? { ...current, error: error instanceof Error ? error.message : 'More community members could not be loaded.' }
        : current)
    } finally {
      setLoadingMore(false)
    }
  }, [enabled, isCurrentPage, loadingMore, page, userId])

  return {
    members: isCurrentPage ? page.members : [],
    loading: enabled && Boolean(userId) && !isCurrentPage,
    loadingMore,
    hasMore: isCurrentPage && Boolean(page.hasMore),
    error: isCurrentPage ? page.error : '',
    loadMore,
  }
}
