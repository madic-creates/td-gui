import { useState } from 'react'
import type { Issue } from '../api/types'
import StatusTag from './StatusTag'

/** Rows past this stay unrendered, and the list says so rather than lying. */
export const MAX_OPTIONS = 20

interface Props {
  id: string
  value: string
  onChange: (value: string) => void
  candidates: Issue[]
  placeholder?: string
  className?: string
}

/** Substring, not prefix: "storage" should find a title that carries it. */
function matches(issue: Issue, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return issue.id.toLowerCase().includes(needle)
    || issue.title.toLowerCase().includes(needle)
}

/**
 * An issue picker over a list the caller already holds. Presentational on
 * purpose: it neither queries nor mutates, and reports the bare id through
 * `onChange`, so a caller's submit path cannot tell a typed id from a picked
 * one. Free text is never rejected here — the candidate list is capped at
 * td's 1000-issue page, so a valid id may simply not be in it, and only the
 * server is in a position to say.
 *
 * `className` styles the input; the wrapper stays `relative` so the listbox
 * can hang off it. Callers that need layout wrap the component themselves.
 */
export default function IssueCombobox({
  id, value, onChange, candidates, placeholder, className,
}: Props) {
  const [open, setOpen] = useState(false)

  const found = candidates.filter(issue => matches(issue, value))
  const shown = found.slice(0, MAX_OPTIONS)
  const expanded = open && shown.length > 0
  const listId = `${id}-listbox`

  const select = (issue: Issue) => {
    onChange(issue.id)
    setOpen(false)
  }

  return (
    <div className="relative">
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={event => { onChange(event.target.value); setOpen(true) }}
        className={className}
      />

      {expanded && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-0.5 max-h-64 w-full overflow-y-auto rounded-sm border border-line bg-surface-raised"
        >
          {shown.map(issue => (
            <li
              key={issue.id}
              role="option"
              aria-selected={false}
              // Blur would close the list before the click ever landed.
              onMouseDown={event => event.preventDefault()}
              onClick={() => select(issue)}
              className="flex cursor-pointer items-baseline gap-2 px-2.5 py-1.5"
            >
              <span className="font-mono text-[11px] text-ink-muted">{issue.id}</span>
              <span className="flex-1 truncate text-ink">{issue.title}</span>
              <StatusTag status={issue.status} />
            </li>
          ))}
          {found.length > shown.length && (
            <li role="presentation" className="px-2.5 py-1.5 text-[11px] text-ink-faint">
              {shown.length} of {found.length} matches — keep typing
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
