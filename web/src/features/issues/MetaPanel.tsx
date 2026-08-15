import { Children, type ReactNode } from 'react'
import { Link, type To } from 'react-router'
import { relativeTime, shortSession } from '../../lib/format'
import type { Issue } from '../../api/types'

/**
 * One label/value line. Rendering is the caller's decision: `Row` is only
 * reached for values that exist, so there is no "absent" state to style.
 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="w-[68px] shrink-0 text-[11px] uppercase tracking-widest text-ink-faint">
        {label}
      </span>
      <span className="flex-1 break-words text-[11px] text-ink">{children}</span>
    </div>
  )
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  // Every Row inside is conditional, so a Block can end up with no rendered
  // children (e.g. a plain issue with no metadata set). Children.toArray
  // drops null/undefined/false but keeps '' (the falsy value a `sprint &&`
  // guard yields), so filter(Boolean) is still needed on top of it.
  if (Children.toArray(children).filter(Boolean).length === 0) return null

  return (
    <section className="border-b border-line-subtle py-3 last:border-b-0">
      <h2 className="mb-1.5 text-[11px] uppercase tracking-widest text-ink-muted">{title}</h2>
      {children}
    </section>
  )
}

const linkTo = (id: string): To => `/issues/${id}`

/**
 * The facts about an issue that would interrupt the reading flow if they sat
 * between the description and the activity log.
 *
 * Every row is conditional. An unset field renders nothing at all rather than
 * a placeholder: td distinguishes "no sprint" from "sprint unknown" only by
 * absence, and a dash in the value column claims more than we know.
 */
export default function MetaPanel({ issue }: { issue: Issue }) {
  return (
    <div className="rounded-md border border-line bg-surface-raised px-3">
      <Block title="Metadata">
        {issue.points > 0 && <Row label="Points">{issue.points}</Row>}
        {issue.labels.length > 0 && <Row label="Labels">{issue.labels.join(', ')}</Row>}
        {issue.sprint && <Row label="Sprint">{issue.sprint}</Row>}
        {issue.parent_id && (
          <Row label="Parent">
            <Link to={linkTo(issue.parent_id)} className="font-mono text-accent">
              {issue.parent_id}
            </Link>
          </Row>
        )}
        {issue.due_date && <Row label="Due">{issue.due_date}</Row>}
        {issue.defer_until && <Row label="Deferred">{issue.defer_until}</Row>}
        {issue.defer_count > 0 && <Row label="Defers">{issue.defer_count}</Row>}
        {issue.minor && <Row label="Minor">self-reviewable</Row>}
        {issue.created_branch && (
          <Row label="Branch">
            <span className="font-mono">{issue.created_branch}</span>
          </Row>
        )}
      </Block>

      <Block title="Sessions">
        {issue.implementer_session && (
          <Row label="Impl"><span className="font-mono">{shortSession(issue.implementer_session)}</span></Row>
        )}
        {issue.reviewer_session && (
          <Row label="Reviewer"><span className="font-mono">{shortSession(issue.reviewer_session)}</span></Row>
        )}
        {issue.creator_session && (
          <Row label="Creator"><span className="font-mono">{shortSession(issue.creator_session)}</span></Row>
        )}
        {issue.closed_by_session && (
          <Row label="Closed by"><span className="font-mono">{shortSession(issue.closed_by_session)}</span></Row>
        )}
      </Block>

      <Block title="Timeline">
        <Row label="Created">{relativeTime(issue.created_at)}</Row>
        <Row label="Updated">{relativeTime(issue.updated_at)}</Row>
        {issue.reviewed_at && <Row label="Reviewed">{relativeTime(issue.reviewed_at)}</Row>}
        {issue.closed_at && <Row label="Closed">{relativeTime(issue.closed_at)}</Row>}
      </Block>
    </div>
  )
}
