import type { IssueListParams } from '../../api/queries'
import type { IssueStatus } from '../../api/types'

// td's own vocabulary — no separate display labels.
const statuses: IssueStatus[] = ['open', 'in_progress', 'in_review', 'blocked', 'closed']

interface Props {
  params: IssueListParams
  onChange: (next: IssueListParams) => void
}

export default function IssueFilters({ params, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5">
      <input
        type="search"
        aria-label="Search"
        placeholder="search …"
        className="flex-1 rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 text-ink placeholder:text-ink-faint"
        defaultValue={params.search ?? ''}
        onChange={e => onChange({ ...params, search: e.target.value || undefined })}
      />
      {statuses.map(status => {
        const active = params.status?.includes(status) ?? false
        return (
          <label
            key={status}
            className={`cursor-pointer rounded-sm border px-2.5 py-1 text-[11px] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${
              active ? 'border-accent bg-accent-bg text-accent' : 'border-line text-ink-muted'
            }`}
          >
            {/* Stays a real checkbox: a button would cost keyboard behaviour,
                screen-reader semantics and the existing tests. */}
            <input
              type="checkbox"
              className="sr-only"
              checked={active}
              onChange={() => {
                const current = params.status ?? []
                const next = active
                  ? current.filter(v => v !== status)
                  : [...current, status]
                onChange({ ...params, status: next.length ? next : undefined })
              }}
            />
            {status}
          </label>
        )
      })}
    </div>
  )
}
