import { useEffect, useRef, useState } from 'react'
import { ClearIcon } from '../../components/Icon'
import type { IssueListParams } from '../../api/queries'
import type { IssueStatus } from '../../api/types'

// td's own vocabulary — no separate display labels.
const statuses: IssueStatus[] = ['open', 'in_progress', 'in_review', 'blocked', 'closed']

// Long enough to absorb a normal typing burst, short enough that the list
// still feels live.
const SEARCH_DEBOUNCE_MS = 300

/**
 * The one character that switches the box from full-text search to TDQ.
 *
 * A prefix rather than a second input or a toggle: the two modes answer the
 * same question and only one of them can be active, so a second control would
 * be a mode with no home. The cost is that full-text search for text starting
 * with `?` is no longer reachable, and there is no escape for it — searching
 * td's own corpus of ids, titles, log lines and handoffs for a leading
 * question mark is not a thing anyone does.
 */
const QUERY_PREFIX = '?'

/** The query in `text`, or null when it is not a query at all. */
function queryIn(text: string): string | null {
  if (!text.startsWith(QUERY_PREFIX)) return null
  return text.slice(QUERY_PREFIX.length).trim()
}

/** What the box shows for a given set of params. */
function textFor(params: IssueListParams): string {
  if (params.query !== undefined) return QUERY_PREFIX + params.query
  return params.search ?? ''
}

interface Props {
  params: IssueListParams
  onChange: (next: IssueListParams) => void
}

export default function IssueFilters({ params, onChange }: Props) {
  const [text, setText] = useState(() => textFor(params))
  const query = queryIn(text)
  const input = useRef<HTMLInputElement>(null)

  /**
   * Empties the box in one click, whichever mode it is in.
   *
   * It does not wait for the debounce: the reader has said what they want in
   * full, so there is no half-typed state left to protect them from, and a
   * query would not be cleared by the timer at all — that path never runs one.
   * The focus goes back where the cursor already was, so the next search is
   * typed rather than aimed at.
   */
  function clear() {
    setText('')
    onChange({ ...params, search: undefined, query: undefined })
    input.current?.focus()
  }

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
    // A half-typed query is a parse error, and running one costs a td
    // subprocess and an error panel for a mistake the user is still in the
    // middle of not making. Query mode waits for Enter; the debounce below
    // only ever serves full-text search.
    if (queryIn(text) !== null) return
    const handle = setTimeout(() => {
      onChangeRef.current({ ...paramsRef.current, search: text || undefined, query: undefined })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [text])

  // The input sits in no form, so Enter has no default to prevent.
  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    // A bare `?` expresses no query yet. An empty TDQ is legal and matches
    // every issue, but running it here would answer a question nobody asked.
    if (!query) return
    onChange({ ...params, query, search: undefined })
  }

  return (
    <div className="border-b border-line px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {/* The input keeps `type="search"` for its semantics, but Chrome's own
            cancel button is hidden: it answers the mouse only, and two crosses
            side by side would be the worst of both. */}
        <div className="relative flex flex-1 items-center">
          <input
            ref={input}
            type="search"
            aria-label="Search"
            placeholder="search … or ?type = bug for a td query"
            className={`w-full rounded-sm border bg-surface-inset py-1.5 pl-2.5 pr-8 text-ink placeholder:text-ink-faint [&::-webkit-search-cancel-button]:appearance-none ${
              query === null ? 'border-line' : 'border-accent font-mono'
            }`}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {text !== '' && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={clear}
              className="absolute right-1.5 rounded-sm p-1 text-ink-faint hover:bg-transparent hover:text-ink"
            >
              <ClearIcon />
            </button>
          )}
        </div>
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
      {query !== null && (
        <p className="mt-1.5 text-[11px] text-ink-faint">
          TDQ — press Enter to run. See the{' '}
          <a
            href="https://td.haplab.com/docs/query-language"
            target="_blank" rel="noreferrer"
            className="text-ink-muted underline"
          >
            query language reference
          </a>.
        </p>
      )}
    </div>
  )
}
