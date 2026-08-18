import { relativeTime, shortSession } from '../../lib/format'
import type { ActiveReview, Review } from '../../api/types'
import Markdown from '../../components/Markdown'

const decisionTone: Record<string, string> = {
  approved: 'text-success',
  rejected: 'text-danger',
}

/**
 * The review standing on the issue, and what it replaced.
 *
 * `active` is absent until a review is recorded — td omits the key entirely —
 * so the whole panel disappears rather than showing an empty heading, which
 * would read as "reviewed, details missing".
 *
 * The history arrives with the issue under `?with=reviews`, so the disclosure
 * opens without a request. Entries other than the standing one are marked
 * superseded, matching what td's own modal shows.
 */
export default function ReviewPanel({
  active,
  history,
}: {
  active?: ActiveReview
  history?: Review[]
}) {
  if (!active) return null

  const earlier = (history ?? []).filter(review => review.id !== active.id)

  return (
    <section className="mt-3 rounded-md border border-line bg-surface-raised px-3 py-3">
      <h2 className="mb-1.5 text-[11px] uppercase tracking-widest text-ink-muted">Review</h2>

      <div className="flex items-baseline gap-2 text-[11px]">
        <span className={decisionTone[active.decision] ?? 'text-ink'}>{active.decision}</span>
        <span className="font-mono text-ink-muted">{shortSession(active.reviewer_session)}</span>
        <span className="ml-auto text-ink-faint">{relativeTime(active.created_at)}</span>
      </div>
      {active.self_review && (
        <p className="mt-1 text-[11px] text-st-review">self-reviewed</p>
      )}
      {active.summary && (
        <div className="mt-1.5 text-[11px] text-ink">
          <Markdown variant="compact">{active.summary}</Markdown>
        </div>
      )}

      {earlier.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-ink-muted">
            {earlier.length} earlier review{earlier.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-1.5">
            {earlier.map(review => (
              <li key={review.id} className="border-t border-line-subtle py-1.5">
                <div className="flex items-baseline gap-2 text-[11px]">
                  <span className={decisionTone[review.decision] ?? 'text-ink'}>
                    {review.decision}
                  </span>
                  <span className="text-ink-faint">(superseded)</span>
                  <span className="font-mono text-ink-muted">
                    {shortSession(review.reviewer_session)}
                  </span>
                  <span className="ml-auto text-ink-faint">{relativeTime(review.created_at)}</span>
                </div>
                {review.summary && (
                  <div className="mt-1 text-[11px] text-ink-muted">
                    <Markdown variant="compact">{review.summary}</Markdown>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
