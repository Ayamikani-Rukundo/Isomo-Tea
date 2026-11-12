import { createContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { PublicProfile } from '../lib/auth'

export type AuthContextValue = {
  session: Session | null
  profile: PublicProfile | null
  isAdministrator: boolean
  administratorLoading: boolean
  administratorError: boolean
  loading: boolean
  configured: boolean
  profileError: string
  refreshProfile: () => Promise<void>
  clearSession: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
