import { useEffect, useRef, useState } from 'react'
import type { IssueListParams } from '../../api/queries'
import type { IssueStatus } from '../../api/types'

// td's own vocabulary — no separate display labels.
const statuses: IssueStatus[] = ['open', 'in_progress', 'in_review', 'blocked', 'closed']

// Long enough to absorb a normal typing burst, short enough that the list
// still feels live.
const SEARCH_DEBOUNCE_MS = 300

interface Props {
  params: IssueListParams
  onChange: (next: IssueListParams) => void
}

export default function IssueFilters({ params, onChange }: Props) {
  const [search, setSearch] = useState(params.search ?? '')

  // Refs, not deps, so the debounce timer always applies to the latest
  // params/onChange (e.g. a status checkbox toggled mid-typing) without
  // restarting the delay on every keystroke.
  const paramsRef = useRef(params)
  paramsRef.current = params
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    const handle = setTimeout(() => {
      onChangeRef.current({ ...paramsRef.current, search: search || undefined })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [search])

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5">
      <input
        type="search"
        aria-label="Search"
        placeholder="search …"
        className="flex-1 rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 text-ink placeholder:text-ink-faint"
        value={search}
        onChange={e => setSearch(e.target.value)}
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
