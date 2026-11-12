export const COMMUNITY_AVATAR_BUCKET = 'isomo-community-assets'

export type CommunityProfile = {
  id: string
  title: string
  avatarPath: string | null
  avatarUrl: string
}
