/**
 * Who is leaving feedback. In beta mode this is the signed-in Supabase user;
 * we cache their id/email/name on-device so the feedback layer can stamp each
 * comment synchronously at save time without reaching into Supabase or React.
 *
 * Kept deliberately small and framework-free: a `<BetaIdentityBridge>` mirrors
 * the live Supabase session into here whenever it changes, and the devfeedback
 * code reads `getFeedbackAuthor()` when a comment is saved.
 */
export interface FeedbackAuthor {
  id?: string
  email?: string
  name?: string
}

const KEY = 'genre.feedback.author'

export function setFeedbackAuthor(author: FeedbackAuthor | null): void {
  try {
    if (author && (author.email || author.id)) {
      localStorage.setItem(KEY, JSON.stringify(author))
    } else {
      localStorage.removeItem(KEY)
    }
  } catch {
    /* ignore */
  }
}

export function getFeedbackAuthor(): FeedbackAuthor | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as FeedbackAuthor
    return parsed.email || parsed.id ? parsed : null
  } catch {
    return null
  }
}
