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
    // Full-bleed, like AppShell's header: this bar sits right under it, and a
    // rule that stops at main's 1440px cap while the header's spans the whole
    // window would read as two disagreeing rules stacked on top of each
    // other. Unlike the header, this bar is a descendant of <main> — already
    // capped — not a sibling of it, so reaching the window edges takes the
    // calc(50%-50vw) breakout below rather than simply leaving a width class
    // off.
    <div className="mx-[calc(50%-50vw)] w-screen border-b border-line">
      <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-1.5 px-4 py-2.5">
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
    </div>
  )
}
