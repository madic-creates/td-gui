import { useState } from 'react'
import { Link } from 'react-router'
import { FETCH_LIMIT } from '../../api/queries'
import EmptyState from '../../components/EmptyState'
import PriorityTag from '../../components/PriorityTag'
import SkeletonRows from '../../components/SkeletonRows'
import StatusTag from '../../components/StatusTag'
import { PRIORITY_ORDER } from '../issues/ordering'
import { RelatedRow } from '../issues/RelatedIssues'
import { useIssueIndex } from '../issues/useIssueIndex'
import EpicProgress from './EpicProgress'
import { childIndex, rollup, type ChildIndex } from './epicRollup'
import type { Issue } from '../../api/types'

/** An unrecognised priority sorts last rather than ahead of P0. */
function priorityRank(issue: Issue): number {
  const index = PRIORITY_ORDER.indexOf(issue.priority)
  return index === -1 ? PRIORITY_ORDER.length : index
}

/**
 * `td epic list`'s own order. That it is (priority, created_at) was checked
 * against the thirty-epic project rather than assumed — that pair reproduces
 * the CLI's output exactly, and (priority, title) does not. The two are views
 * of one list, and a reader with both open should not have to re-find a row
 * when they switch.
 *
 * An unparseable `created_at` compares as NaN, which is falsy, so such a row
 * falls through to the id instead of landing wherever the sort happens to put
 * it. The id tiebreak makes the order total, which is what keeps an SSE
 * refetch from reshuffling equal rows under the reader.
 */
function byEpicOrder(a: Issue, b: Issue): number {
  return priorityRank(a) - priorityRank(b)
    || Date.parse(a.created_at) - Date.parse(b.created_at)
    || a.id.localeCompare(b.id)
}

/**
 * The epics of a project, each with how far the work under it has come.
 *
 * An epic is `type === 'epic'`, which is the definition `td epic list` uses —
 * deliberately not "any issue with children". `parent_id` carries no
 * restriction to epic parents, so a `feature` with tasks keeps showing them on
 * its own detail view and stays out of this list. Two questions, two answers.
 *
 * Everything here comes from `useIssueIndex`, which the list view has already
 * warmed: the hierarchy is entirely derivable from `parent_id`, so there is no
 * server route, no third `/gui/` exception and no `td tree` subprocess behind
 * this page.
 */
export default function EpicList() {
  const { issues, isPending, capped } = useIssueIndex()
  // In component state, not the url. Which rows are open is a reading posture
  // rather than a view worth linking to, and the list this page is derived
  // from is already addressable at `/`.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [showClosed, setShowClosed] = useState(false)

  if (isPending) return <SkeletonRows label="Loading epics" />

  const children = childIndex(issues)
  const epics = issues.filter(issue => issue.type === 'epic')
  const closedCount = epics.filter(epic => epic.status === 'closed').length
  const shown = epics
    .filter(epic => showClosed || epic.status !== 'closed')
    .sort(byEpicOrder)

  function toggle(id: string) {
    setExpanded(current => {
      const next = new Set(current)
      // delete reports whether it removed anything, which is the same question
      // as whether the row was open.
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  return (
    <div>
      <div className="flex items-center gap-2.5 border-b border-line bg-surface-inset px-4 py-2">
        <h1 className="text-[11px] uppercase tracking-widest text-ink-muted">Epics</h1>
        <span className="flex-1" />
        {/* Only offered when there is something behind it. A chip that toggles
            between one empty set and the same empty set is a control that
            answers nothing. */}
        {closedCount > 0 && (
          <label
            className={`cursor-pointer rounded-sm border px-2.5 py-1 text-[11px] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${
              showClosed ? 'border-accent bg-accent-bg text-accent' : 'border-line text-ink-muted'
            }`}
          >
            {/* A real checkbox under the chip, as in IssueFilters: the styling
                is ours, the keyboard behaviour and the semantics are the
                platform's. */}
            <input
              type="checkbox"
              className="sr-only"
              checked={showClosed}
              onChange={() => setShowClosed(!showClosed)}
            />
            closed ({closedCount})
          </label>
        )}
      </div>

      {/* The index cap is a real limit and is admitted rather than hidden: a
          rollup computed off a partial index is a lower bound, and a number
          presented as fact is worse than a stated gap. */}
      {capped && (
        <p className="border-b border-line bg-surface-inset px-4 py-1.5 text-[11px] text-ink-muted">
          The issue index is capped at {FETCH_LIMIT} rows per half and one half
          came back full — the counts below may be undercounting.
        </p>
      )}

      {shown.length === 0 ? (
        // Two different absences. "No epics yet" in front of a project whose
        // epics are all closed would be a lie, and it would point at the wrong
        // control — the chip above, not the create form.
        epics.length === 0 ? (
          <EmptyState
            message="No epics yet."
            hint="An epic is an issue of type epic — nothing else marks one."
            action={
              <Link
                to="/new"
                data-button
                className="rounded-sm border border-accent px-2.5 py-1 text-[11px] text-accent"
              >
                New issue
              </Link>
            }
          />
        ) : (
          <EmptyState
            message="No open epics."
            hint="Every epic here is closed. Show them with the closed chip above."
          />
        )
      ) : (
        <ul>
          {shown.map(epic => (
            <EpicRow
              key={epic.id}
              epic={epic}
              children_={children}
              expanded={expanded.has(epic.id)}
              onToggle={() => toggle(epic.id)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

interface RowProps {
  epic: Issue
  /** Named around `children`, which React reserves for the JSX slot. */
  children_: ChildIndex
  expanded: boolean
  onToggle: () => void
}

function EpicRow({ epic, children_, expanded, onToggle }: RowProps) {
  const tasks = children_.get(epic.id) ?? []

  return (
    <li className="border-b border-line-subtle">
      <div className="flex items-center gap-3 px-4 py-2 hover:bg-surface-hover">
        {/* Nothing to expand is a row with no chevron, not a dead one: a
            disabled control still invites the click that proves it dead, and
            the width is held either way so the ids stay in one column. */}
        {tasks.length > 0 ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={`Tasks of ${epic.id}`}
            className="w-3 shrink-0 text-ink-faint hover:bg-transparent hover:text-ink"
          >
            <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          </button>
        ) : (
          <span aria-hidden="true" className="w-3 shrink-0" />
        )}

        <Link
          to={`/issues/${epic.id}`}
          className="w-[74px] shrink-0 font-mono text-[11px] text-accent hover:underline"
        >
          {epic.id}
        </Link>
        <span className="w-8 shrink-0 text-right"><PriorityTag priority={epic.priority} /></span>
        <Link to={`/issues/${epic.id}`} className="flex-1 truncate text-ink hover:underline">
          {epic.title}
        </Link>
        {/* The epic's own status, which the progress bar does not carry — that
            one is about the tasks under it. It matters most with the closed
            chip on, where nothing else in the row says which is which. */}
        <StatusTag status={epic.status} />
        {/* The id rides on the accessible name: there is one of these per row,
            and "+ Task" alone would name thirty controls identically. */}
        <Link
          to={`/new?parent=${epic.id}`}
          data-button
          aria-label={`New task under ${epic.id}`}
          className="shrink-0 rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted"
        >
          + Task
        </Link>
        <EpicProgress rollup={rollup(children_, epic.id)} />
      </div>

      {/* Direct children only, while the count above is transitive — so a deep
          tree shows fewer rows than its own number. Rather than growing a
          multi-level tree for a depth that does not exist on any measured
          project, a child that has children of its own carries its own count
          and the two numbers reconcile on screen. */}
      {expanded && tasks.length > 0 && (
        <ul className="px-4 pb-2 pl-[42px]">
          {tasks.map(task => {
            const sub = rollup(children_, task.id)
            return (
              <RelatedRow key={task.id} id={task.id} issue={task}>
                {sub.total > 0 && (
                  <span className="shrink-0 font-mono text-[11px] text-ink-faint">
                    {sub.done}/{sub.total}
                  </span>
                )}
              </RelatedRow>
            )
          })}
        </ul>
      )}
    </li>
  )
}
