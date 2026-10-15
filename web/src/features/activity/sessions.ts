import { shortSession } from '../../lib/format'
import type { Session } from '../../api/types'

/** What a session is called on the page: td's name, its agent, or its id. */
export function sessionLabel(session: Session): string {
  return session.name || session.agent_type || shortSession(session.id)
}

/**
 * The byline for a feed entry. A session missing from the list (still
 * loading, failed, or not listed by td) falls back to its short id, so the
 * feed never waits on or breaks with the sessions request.
 */
export function labelFor(sessions: Session[] | undefined, id: string): string {
  if (id === '') return 'unknown session'
  const session = sessions?.find(s => s.id === id)
  return session ? sessionLabel(session) : shortSession(id)
}

/** Unparseable sorts last; NaN would otherwise make the sort order arbitrary. */
function instant(iso: string): number {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? -Infinity : t
}

/**
 * Newest first, by instant rather than by string: td writes local offsets
 * (`+02:00`), and those do not sort lexically. Two unparseable values
 * subtract to NaN, which is falsy, so they fall through to the id like equal
 * ones do. The tiebreak makes the order total.
 */
export function byRecentActivity(a: Session, b: Session): number {
  return instant(b.last_activity) - instant(a.last_activity) || a.id.localeCompare(b.id)
}
