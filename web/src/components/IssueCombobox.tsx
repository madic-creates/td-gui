import { useEffect, useRef, useState } from 'react'
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
 * A fully typed id names one issue, so it takes the first row. Matching is a
 * substring test over id *and* title, and without this a candidate whose title
 * merely quotes the id — "Follow-up to td-a1b2c3" — can sit above the issue
 * the reader actually named. Ordering before the MAX_OPTIONS slice also keeps
 * an exact match from being cut off by the cap.
 */
function rank(matched: Issue[], query: string): Issue[] {
  const needle = query.trim().toLowerCase()
  const exact = matched.findIndex(issue => issue.id.toLowerCase() === needle)
  if (exact <= 0) return matched          // absent, or already first
  return [matched[exact], ...matched.slice(0, exact), ...matched.slice(exact + 1)]
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
  // The active row is held by issue id, never by position. `candidates` is
  // rebuilt and re-partitioned whenever the issues query refetches — and
  // useLiveUpdates invalidates every query on each SSE event — so an index
  // would keep pointing at a slot while a different issue slid into it.
  // `null` means no row is active: the state an opening list starts in, so
  // Enter stays the surrounding form's until the reader picks a row.
  const [activeId, setActiveId] = useState<string | null>(null)
  const activeRef = useRef<HTMLLIElement>(null)

  const found = rank(candidates.filter(issue => matches(issue, value)), value)
  const shown = found.slice(0, MAX_OPTIONS)
  const expanded = open && shown.length > 0
  // -1 whenever nothing is active, including when the active issue has left
  // the list: unknown is not "the row that took its place".
  const activeIndex = activeId === null
    ? -1
    : shown.findIndex(issue => issue.id === activeId)
  const listId = `${id}-listbox`
  const optionId = (index: number) => `${listId}-option-${index}`
  const capNoticeId = `${id}-cap-notice`
  const capped = found.length > shown.length

  // Keyboard nav can walk the active row below the fold of the scrollable
  // list (MAX_OPTIONS is 20, the list shows about 8) — without this, the
  // highlight moves out of view and the widget looks dead.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, expanded])

  const select = (issue: Issue) => {
    onChange(issue.id)
    setOpen(false)
    setActiveId(null)
  }

  /** From no active row, Down takes the first and Up the last — ARIA's pattern. */
  const move = (delta: number) => {
    if (activeIndex < 0) {
      setActiveId(delta > 0 ? shown[0].id : shown[shown.length - 1].id)
      return
    }
    setActiveId(shown[Math.min(Math.max(activeIndex + delta, 0), shown.length - 1)].id)
  }

  const keyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      // A closed list opens where it left off rather than jumping a row.
      if (!expanded) setOpen(true)
      else move(1)
      return
    }
    if (event.key === 'ArrowUp') {
      // Closed, ArrowUp is the caret's — swallowing it here would break
      // moving to position 0 in a single-line input.
      if (!expanded) return
      event.preventDefault()
      move(-1)
      return
    }
    if (event.key === 'Enter') {
      // The field sits inside a form at both call sites: taking a suggestion
      // must not also submit it. With the list closed — or open but with no
      // row chosen — Enter is the form's, and the typed text stands as the id.
      if (!expanded || activeIndex < 0) return
      event.preventDefault()
      select(shown[activeIndex])
      return
    }
    if (event.key === 'Escape') {
      // The text survives — only the list closes.
      setOpen(false)
    }
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
        onChange={event => { onChange(event.target.value); setOpen(true); setActiveId(null) }}
        onKeyDown={keyDown}
        aria-activedescendant={expanded && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-describedby={expanded && capped ? capNoticeId : undefined}
        className={className}
      />

      {expanded && (
        // One floating panel holding both the list and the cap notice, so
        // the notice stays visually attached under the rows without being
        // absolutely positioned itself (it would have no static position of
        // its own to anchor to, since the <ul> beside it already is).
        <div className="absolute z-10 mt-0.5 w-full rounded-sm border border-line bg-surface-raised">
          <ul
            id={listId}
            role="listbox"
            aria-label="Issue suggestions"
            // Blur would close the list before a row's click ever landed. On
            // the <ul> rather than each <li> so a mousedown on the scrollbar
            // itself — which bubbles from the list, not a row — is covered too.
            onMouseDown={event => event.preventDefault()}
            className="max-h-64 overflow-y-auto"
          >
            {shown.map((issue, index) => (
              <li
                key={issue.id}
                ref={index === activeIndex ? activeRef : undefined}
                id={optionId(index)}
                role="option"
                aria-selected={index === activeIndex}
                onClick={() => select(issue)}
                className={`flex cursor-pointer items-baseline gap-2 px-2.5 py-1.5 ${
                  index === activeIndex ? 'bg-surface-hover' : ''
                }`}
              >
                <span className="font-mono text-[11px] text-ink-muted">{issue.id}</span>
                <span className="flex-1 truncate text-ink">{issue.title}</span>
                <StatusTag status={issue.status} />
              </li>
            ))}
          </ul>

          {capped && (
            // A sibling of the listbox, not a child: role="listbox" only
            // counts role="option" children, so a note living inside it
            // would report a 21st option to assistive tech rather than
            // reach it as a hint.
            <p
              id={capNoticeId}
              aria-live="polite"
              className="border-t border-line px-2.5 py-1.5 text-[11px] text-ink-faint"
            >
              {shown.length} of {found.length} matches — keep typing
            </p>
          )}
        </div>
      )}
    </div>
  )
}
