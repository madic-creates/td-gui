import { Link } from 'react-router'
import { ApiError } from '../../api/client'
import { useMonitor, useSessions } from '../../api/queries'
import EmptyState from '../../components/EmptyState'
import ErrorPanel from '../../components/ErrorPanel'
import SkeletonRows from '../../components/SkeletonRows'
import { relativeTime } from '../../lib/format'
import { labelFor } from './sessions'

/**
 * td's recent activity across every session, in td's order and td's words.
 *
 * Sessions are read for bylines only. Their request failing or still loading
 * costs a name, never the feed: `labelFor` falls back to the short id.
 */
export default function ActivityFeed() {
  const { data, isPending, error } = useMonitor()
  const { data: sessions } = useSessions()

  const activity = data?.monitor.activity ?? []

  return (
    <section aria-labelledby="activity-heading" className="min-w-0">
      <h2 id="activity-heading" className="text-[11px] uppercase tracking-widest text-ink-muted">
        Recent activity
      </h2>

      {isPending ? (
        <SkeletonRows rows={5} label="Loading activity" />
      ) : error ? (
        <div className="mt-3">
          <ErrorPanel message={error instanceof ApiError ? error.message : String(error)} />
        </div>
      ) : activity.length === 0 ? (
        <EmptyState message="No recent activity." hint="Logs, handoffs and issue changes appear here." />
      ) : (
        <ul aria-label="Recent activity" className="mt-3 divide-y divide-line">
          {activity.map((item, i) => (
            // td sends no event id. Position plus timestamp is unique within
            // one response, and the whole list is replaced on each refetch.
            <li key={`${i}-${item.timestamp}`} className="flex flex-col gap-1 py-3">
              <div className="flex items-baseline gap-2 text-[11px]">
                <span className="font-semibold text-ink">{labelFor(sessions?.sessions, item.session_id)}</span>
                <span className="flex-1" />
                <time dateTime={item.timestamp} title={item.timestamp} className="text-ink-faint">
                  {relativeTime(item.timestamp)}
                </time>
              </div>
              <p className="whitespace-pre-line break-words text-ink">{item.message}</p>
              {(item.issue_title || item.log_type) && (
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  {/* td fills issue_title only when issue_id is an issue. */}
                  {item.issue_title && (
                    <Link to={`/issues/${item.issue_id}`} className="text-accent hover:underline">
                      {item.issue_title}
                    </Link>
                  )}
                  {item.log_type && (
                    <span className="rounded-sm border border-line px-1.5 font-mono text-ink-muted">
                      {item.log_type}
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
