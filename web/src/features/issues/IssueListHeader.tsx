import { COL, ROW_LAYOUT } from './columns'
import type { Sort, SortDirection, SortKey } from './ordering'

const LABEL: Record<SortKey, string> = {
  id: 'ID',
  title: 'TITLE',
  priority: 'PRIO',
  updated: 'UPDATED',
}

interface SortButtonProps {
  column: SortKey
  sort: Sort
  onChange: (sort: Sort) => void
}

function SortButton({ column, sort, onChange }: SortButtonProps) {
  const active = sort.key === column
  const flipped: SortDirection = sort.direction === 'asc' ? 'desc' : 'asc'
  const next: Sort = active
    ? { key: column, direction: flipped }
    : { key: column, direction: 'asc' }

  // The name says both where the list stands and what the click will do; the
  // arrow alone is not available to a screen reader.
  const name = active
    ? `Sorted by ${column}, ${sort.direction === 'asc' ? 'ascending' : 'descending'}. Sort ${flipped === 'asc' ? 'ascending' : 'descending'}.`
    : `Sort by ${column}, ascending`

  return (
    <button
      type="button"
      aria-label={name}
      onClick={() => onChange(next)}
      className={`whitespace-nowrap ${active ? 'text-ink' : 'text-ink-faint hover:text-ink-muted'}`}
    >
      {LABEL[column]}
      <span aria-hidden="true">{active ? (sort.direction === 'asc' ? ' ▴' : ' ▾') : ''}</span>
    </button>
  )
}

/** STATUS has no button: it is the grouping, so sorting by it is a no-op. */
export default function IssueListHeader({
  sort,
  onChange,
}: {
  sort: Sort
  onChange: (sort: Sort) => void
}) {
  return (
    <div
      className={`${ROW_LAYOUT} border-b border-line py-1.5 text-[11px] tracking-wider text-ink-faint`}
    >
      <span className={COL.id}><SortButton column="id" sort={sort} onChange={onChange} /></span>
      <span className={COL.title}><SortButton column="title" sort={sort} onChange={onChange} /></span>
      <span className={COL.priority}><SortButton column="priority" sort={sort} onChange={onChange} /></span>
      <span className={COL.updated}><SortButton column="updated" sort={sort} onChange={onChange} /></span>
      <span className={COL.status}>STATUS</span>
    </div>
  )
}
