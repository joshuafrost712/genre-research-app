/**
 * Mirrors the live Supabase session into the device-local feedback-author cache,
 * so the devfeedback layer can stamp each comment with who left it without
 * importing Supabase or React. Renders nothing; mounted only in beta mode.
 */
import { useEffect } from 'react'
import { useSupabaseSession } from '../../lib/supabase/session'
import { setFeedbackAuthor } from '../../lib/feedback/identity'

export function BetaIdentityBridge() {
  const { user } = useSupabaseSession()
  useEffect(() => {
    setFeedbackAuthor(user ? { id: user.id, email: user.email, name: user.name } : null)
  }, [user])
  return null
}
