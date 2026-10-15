import { useState } from 'react'
import { ApiError } from '../../api/client'
import { useSessions } from '../../api/queries'
import EmptyState from '../../components/EmptyState'
import ErrorPanel from '../../components/ErrorPanel'
import SkeletonRows from '../../components/SkeletonRows'
import { relativeTime } from '../../lib/format'
import { byRecentActivity, sessionLabel } from './sessions'

/** How many sessions show before "Show all". Most of a project's are weeks old. */
const VISIBLE = 20

/**
 * The project's agent sessions, most recently active first.
 *
 * "Seen" is the last time a session wrote to td, which is all td records. A
 * session seen a minute ago may have exited since, and one seen a week ago
 * may still be running idle, hence the note under the heading.
 */
export default function SessionList() {
  const { data, isPending, error } = useSessions()
  // Component state: which half of a long list is open is a reading posture,
  // not something worth a URL or a stored preference.
  const [showAll, setShowAll] = useState(false)

  const sessions = [...(data?.sessions ?? [])].sort(byRecentActivity)
  const shown = showAll ? sessions : sessions.slice(0, VISIBLE)

  return (
    <section aria-labelledby="sessions-heading" className="min-w-0">
      <h2 id="sessions-heading" className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-ink-muted">
        Agent sessions{' '}
        {data && <span className="rounded-sm border border-line px-1.5 font-mono normal-case tracking-normal">{sessions.length}</span>}
      </h2>
      <p className="mt-1 text-[11px] text-ink-faint">Last recorded activity, not process health.</p>

      {isPending ? (
        <SkeletonRows rows={3} label="Loading sessions" />
      ) : error ? (
        <div className="mt-3">
          <ErrorPanel message={error instanceof ApiError ? error.message : String(error)} />
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState message="No agent sessions recorded." />
      ) : (
        <>
          <ul aria-label="Agent sessions" className="mt-3 divide-y divide-line">
            {shown.map(session => (
              <li key={session.id} className="flex flex-col gap-0.5 py-2.5">
                <strong className="truncate font-semibold text-ink">{sessionLabel(session)}</strong>
                <span className="font-mono text-[11px] text-ink-muted">{session.id}</span>
                <span className="truncate text-[11px] text-ink-muted">{session.branch || 'no branch'}</span>
                <span className="text-[11px] text-ink-faint" title={session.last_activity}>
                  Seen {relativeTime(session.last_activity)}
                </span>
              </li>
            ))}
          </ul>
          {!showAll && sessions.length > VISIBLE && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-2 rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted"
            >
              Show all ({sessions.length})
            </button>
          )}
        </>
      )}
    </section>
  )
}
