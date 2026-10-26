import { useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ClearIcon } from '../../components/Icon'
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
    // `-mx-1.5 px-1.5` lets the tint breathe past the text without moving it:
    // the row has no padding of its own, so a flush background would sit hard
    // against the id and the trailing control. Tint only, no accent edge —
    // the row holds a link, it is not one.
    <li className="-mx-1.5 flex items-center gap-2.5 rounded-sm border-b border-line-subtle px-1.5 py-1.5 last:border-b-0 hover:bg-surface-hover">
      <Link
        to={`/issues/${id}`}
        className="shrink-0 font-mono text-[11px] text-accent hover:underline"
      >
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
 * The fewest rows a searchable group needs before it offers a search box. A
 * list shorter than this is read faster than it is searched, and a box above
 * three rows would be the biggest thing in the group. docs/issues.md names
 * this number; keep the two in step.
 */
export const SEARCH_MIN_ITEMS = 6

/**
 * Case-insensitive substring match on the id and the title — the two things a
 * row shows that a reader can type. An unresolved reference has only its id.
 */
function matches({ id, issue }: Related, needle: string) {
  return id.toLowerCase().includes(needle)
    || (issue?.title.toLowerCase().includes(needle) ?? false)
}

/**
 * One titled group of references — what this issue is blocked by, what it
 * blocks, or an epic's tasks.
 */
export default function RelatedIssues({
  title,
  items,
  lead,
  searchable = false,
}: {
  title: string
  items: Related[]
  /**
   * Rendered between the heading and the rows. The Tasks group puts the
   * progress bar here: above the whole section it would be a line belonging to
   * nothing, and under the rows it would be a summary the reader only reaches
   * after having counted the list themselves.
   */
  lead?: ReactNode
  /**
   * Offers a box that filters the rows as you type, once the group holds
   * SEARCH_MIN_ITEMS or more. The filter narrows the rows alone: the heading
   * still counts the whole group and `lead` is the caller's, so a rollup
   * passed there keeps reporting every task while a search is active.
   */
  searchable?: boolean
}) {
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)

  if (items.length === 0) return null

  const search = searchable && items.length >= SEARCH_MIN_ITEMS
  const needle = search ? text.trim().toLowerCase() : ''
  const shown = needle ? items.filter(item => matches(item, needle)) : items
  const noun = title.toLowerCase()

  function clear() {
    setText('')
    input.current?.focus()
  }

  return (
    <section className="mt-6">
      <GroupHeading title={title} count={items.length} />
      {lead && <div className="mb-2">{lead}</div>}
      {search && (
        // Chrome's own cancel button is hidden for the reason IssueFilters
        // gives: it answers the mouse only, and two crosses would be one too
        // many.
        <div className="relative mb-2 flex items-center">
          <input
            ref={input}
            type="search"
            aria-label={`Search ${noun}`}
            placeholder={`filter ${noun} by id or title`}
            className="w-full rounded-sm border border-line bg-surface-inset py-1 pl-2.5 pr-8 text-[12px] text-ink placeholder:text-ink-faint [&::-webkit-search-cancel-button]:appearance-none"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') setText('') }}
          />
          {text !== '' && (
            <button
              type="button"
              aria-label={`Clear ${noun} search`}
              onClick={clear}
              className="absolute right-1.5 rounded-sm p-1 text-ink-faint hover:bg-transparent hover:text-ink"
            >
              <ClearIcon />
            </button>
          )}
        </div>
      )}
      {shown.length > 0 ? (
        <ul>
          {shown.map(item => (
            <RelatedRow key={item.id} {...item} />
          ))}
        </ul>
      ) : (
        <p className="py-1.5 text-ink-muted">No {noun} match "{text.trim()}".</p>
      )}
    </section>
  )
}
