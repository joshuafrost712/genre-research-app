/**
 * Mirrors the live identity into the device-local feedback-author cache, so the
 * devfeedback layer can stamp each comment with who left it without importing
 * Supabase or React. The account (Supabase) identity takes precedence; when no
 * account is signed in, a connected Google account is used as a fallback so a
 * Gmail-only tester's comments are still attributed. Renders nothing; mounted
 * only in beta mode.
 *
 * The Google side is set here on session change; `BetaSignIn` also updates the
 * author when Google is connected/disconnected while no account is signed in,
 * so the fallback stays current between session changes.
 */
import { useEffect } from 'react'
import { useSupabaseSession } from '../../lib/supabase/session'
import { getAccount } from '../../lib/google/account'
import { setFeedbackAuthor } from '../../lib/feedback/identity'

export function BetaIdentityBridge() {
  const { user } = useSupabaseSession()
  useEffect(() => {
    if (user) {
      setFeedbackAuthor({ id: user.id, email: user.email, name: user.name })
      return
    }
    // No account: fall back to a connected Google identity if one exists.
    let active = true
    getAccount().then((acc) => {
      if (active) setFeedbackAuthor(acc ? { email: acc.email, name: acc.name } : null)
    })
    return () => {
      active = false
    }
  }, [user])
  return null
}
