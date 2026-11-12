import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { loadProfile, type PublicProfile } from '../lib/auth'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { AuthContext } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [administratorCheck, setAdministratorCheck] = useState<{
    userId: string
    authorized: boolean
    failed: boolean
  } | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [profileError, setProfileError] = useState('')

  const refreshProfile = useCallback(async () => {
    if (!session) {
      setProfile(null)
      return
    }
    try {
      const next = await loadProfile(session.user.id)
      setProfile(next)
      setProfileError('')
    } catch (error) {
      setProfile(null)
      setProfileError(error instanceof Error ? error.message : 'Could not load your profile.')
    }
  }, [session])

  const clearSession = useCallback(() => {
    setSession(null)
    setProfile(null)
    setAdministratorCheck(null)
    setProfileError('')
  }, [])

  useEffect(() => {
    if (!supabase) return
    let active = true
    let authChangeVersion = 0
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      authChangeVersion += 1
      setSession(nextSession)
      setAdministratorCheck((current) => (
        nextSession?.user.id === current?.userId ? current : null
      ))
      if (!nextSession) {
        setProfile(null)
        setProfileError('')
      }
      setLoading(false)
    })

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (authChangeVersion === 0) {
        if (error) setProfileError(error.message)
        setSession(data.session)
      }
      setLoading(false)
    }).catch((error: unknown) => {
      if (!active) return
      if (authChangeVersion === 0) {
        setProfileError(error instanceof Error ? error.message : 'Could not restore your sign-in session.')
      }
      setLoading(false)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session || !supabase) return
    let active = true
    void supabase
      .from('administrators')
      .select('user_id')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return
        setAdministratorCheck({
          userId: session.user.id,
          authorized: !error && Boolean(data),
          failed: Boolean(error),
        })
      }, () => {
        if (!active) return
        setAdministratorCheck({ userId: session.user.id, authorized: false, failed: true })
      })
    void loadProfile(session.user.id).then((value) => {
      if (!active) return
      setProfile(value)
      setProfileError('')
    }).catch((error: unknown) => {
      if (!active) return
      setProfile(null)
      setProfileError(error instanceof Error ? error.message : 'Could not load your profile.')
    })
    return () => { active = false }
  }, [session])

  const isAdministrator = Boolean(
    session
    && administratorCheck?.userId === session.user.id
    && administratorCheck.authorized,
  )
  const administratorLoading = Boolean(
    session
    && isSupabaseConfigured
    && administratorCheck?.userId !== session.user.id,
  )
  const administratorError = Boolean(
    session
    && administratorCheck?.userId === session.user.id
    && administratorCheck.failed,
  )

  const value = useMemo(() => ({
    session, profile, isAdministrator, administratorLoading, administratorError, loading, configured: isSupabaseConfigured, profileError, refreshProfile, clearSession,
  }), [session, profile, isAdministrator, administratorLoading, administratorError, loading, profileError, refreshProfile, clearSession])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
