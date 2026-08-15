import type { ReactNode } from 'react'
import { Link } from 'react-router'
import StatusTag from '../../components/StatusTag'
import type { Related } from './issueIndex'

/**
 * One reference to another issue. `children` is a trailing slot for a control
 * that belongs to the row — DependencyPanel puts its remove button there, so
 * the two surfaces share this markup instead of drifting apart.
 *
 * An unresolved reference renders the bare id and an empty title cell: that
 * is exactly what the panel showed before titles existed, and it beats
 * inventing a "not found" the reader cannot verify. The title cell is rendered
 * either way so the trailing slot keeps its position.
 */
export function RelatedRow({ id, issue, children }: Related & { children?: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5 border-b border-line-subtle py-1.5 last:border-b-0">
      <Link to={`/issues/${id}`} className="shrink-0 font-mono text-[11px] text-accent">
        {id}
      </Link>
      <span className="flex-1 truncate text-ink">{issue?.title}</span>
      {issue && <StatusTag status={issue.status} />}
      {children}
    </li>
  )
}

/**
 * Opens a group of references, with the number in it. Shared with
 * DependencyPanel: the row below it already came from here, and the heading
 * drifting apart from the row it belongs to is what a restyle in one file
 * would otherwise cause.
 */
export function GroupHeading({ title, count }: { title: string; count: number }) {
  return (
    <h2 className="mb-2 text-[11px] uppercase tracking-widest text-ink-muted">
      {title} ({count})
    </h2>
  )
}

/**
 * One titled group of references — what this issue is blocked by, what it
 * blocks, or an epic's tasks.
 */
export default function RelatedIssues({
  title,
  items,
}: {
  title: string
  items: Related[]
}) {
  if (items.length === 0) return null

  return (
    <section className="mt-6">
      <GroupHeading title={title} count={items.length} />
      <ul>
        {items.map(item => (
          <RelatedRow key={item.id} {...item} />
        ))}
      </ul>
    </section>
  )
}
