import { useEffect, useRef, useState } from 'react'
import { useLabels } from '../../api/queries'

interface Props {
  value: string[]
  onChange: (labels: string[]) => void
}

/** Substring, not prefix: "end" should find both "backend" and "frontend". */
function matches(label: string, query: string): boolean {
  return label.toLowerCase().includes(query.trim().toLowerCase())
}

/**
 * Chips plus a combobox over the labels already used in the project. Focus
 * opens the list, typing filters it, and a click or Enter takes a row; free
 * text stays possible, because a label the project has not used yet has to
 * come from somewhere. td does not validate labels — it accepted "has space"
 * — so nothing here rejects input either.
 *
 * The listbox is a local copy of the IssueCombobox pattern rather than a
 * shared component: that one is typed on Issue, ranks an exact id match, caps
 * its rows and renders a StatusTag per row, none of which a bare string wants.
 */
export default function LabelInput({ value, onChange }: Props) {
  const [entry, setEntry] = useState('')
  const [open, setOpen] = useState(false)
  // The active row is held by label, never by position: the labels query is
  // invalidated on every SSE event, and adding a label drops a row out of the
  // list, so an index would keep pointing at a slot a different label slid
  // into. `null` means no row is active — the state an opening list starts
  // in, so Enter stays the surrounding form's until the reader picks a row.
  const [active, setActive] = useState<string | null>(null)
  const activeRef = useRef<HTMLLIElement>(null)
  const { data } = useLabels()

  // Exact string comparison against `value`, not case-folded: td stores
  // labels verbatim, so "Bug" and "bug" are two labels and hiding one because
  // the other is applied would be a lie.
  const shown = (data?.labels ?? []).filter(label => !value.includes(label) && matches(label, entry))
  const expanded = open && shown.length > 0
  // -1 whenever nothing is active, including when the active label has left
  // the list: unknown is not "the row that took its place".
  const activeIndex = active === null ? -1 : shown.indexOf(active)
  const listId = 'label-suggestions'
  const optionId = (index: number) => `${listId}-option-${index}`

  // Keyboard nav can walk the active row below the fold of the scrollable list.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, expanded])

  // A closed list has no active row. Every close goes through here, so a
  // highlight the reader arrowed past — and then left without taking — cannot
  // sit armed behind the closed list and spend the next Enter on itself.
  const close = () => {
    setOpen(false)
    setActive(null)
  }

  const add = (label: string) => {
    setEntry('')
    close()
    if (!label || value.includes(label)) return
    onChange([...value, label])
  }

  /** From no active row, Down takes the first and Up the last — ARIA's pattern. */
  const move = (delta: number) => {
    if (activeIndex < 0) {
      setActive(delta > 0 ? shown[0] : shown[shown.length - 1])
      return
    }
    setActive(shown[Math.min(Math.max(activeIndex + delta, 0), shown.length - 1)])
  }

  const keyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      // A closed list only opens; the walk starts on the next press, from no
      // active row, exactly as it does when focus opens the list.
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
      // The field sits inside a form at both call sites: adding a label must
      // not also submit it. With no row highlighted the typed text stands,
      // which is the only way to introduce a label new to the project.
      event.preventDefault()
      add(expanded && activeIndex >= 0 ? shown[activeIndex] : entry.trim())
      return
    }
    if (event.key === 'Escape') {
      // The text survives — only the list closes.
      close()
    }
  }

  return (
    <div>
      <label htmlFor="label-entry" className="mb-1.5 block text-[11px] uppercase tracking-widest text-ink-muted">
        Labels
      </label>

      {value.length > 0 && (
        <ul className="mb-1.5 flex flex-wrap gap-1.5">
          {value.map((label, index) => (
            // Removal is by index, not by value: td doesn't dedup labels on
            // its write path, so a caller outside this widget (the CLI, a
            // script) can leave an issue with a literal duplicate. Filtering
            // by value would drop every occurrence on a single click.
            <li key={`${label}-${index}`} className="flex items-center gap-1 rounded-sm border border-line px-1.5 py-0.5 font-mono text-[11px]">
              <span>{label}</span>
              <button
                type="button"
                aria-label={`Remove label ${label}`}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
                // The padding gives the global hover background a shape, and
                // makes the remove target findable — it is a bare × otherwise.
                className="rounded-sm px-1 text-ink-faint"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-1.5">
        {/* Relative, and flex-1 in the input's place, so the list hangs off
            the field rather than off the row that also holds the button. */}
        <div className="relative flex-1">
          <input
            id="label-entry"
            value={entry}
            role="combobox"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-autocomplete="list"
            autoComplete="off"
            aria-activedescendant={expanded && activeIndex >= 0 ? optionId(activeIndex) : undefined}
            onFocus={() => setOpen(true)}
            onBlur={close}
            onChange={e => { setEntry(e.target.value); setOpen(true); setActive(null) }}
            onKeyDown={keyDown}
            className="w-full rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 text-ink"
          />

          {expanded && (
            <ul
              id={listId}
              role="listbox"
              aria-label="Label suggestions"
              // Blur would close the list before a row's click ever landed. On
              // the <ul> rather than each <li> so a mousedown on the scrollbar
              // itself — which bubbles from the list, not a row — is covered too.
              onMouseDown={event => event.preventDefault()}
              className="absolute z-10 mt-0.5 max-h-64 w-full overflow-y-auto rounded-sm border border-line bg-surface-raised"
            >
              {shown.map((label, index) => (
                <li
                  key={label}
                  ref={index === activeIndex ? activeRef : undefined}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === activeIndex}
                  onClick={() => add(label)}
                  className={`cursor-pointer px-2.5 py-1.5 font-mono text-[11px] text-ink ${
                    index === activeIndex ? 'bg-surface-hover' : ''
                  }`}
                >
                  {label}
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={() => add(entry.trim())}
          className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted"
        >
          Add label
        </button>
      </div>
    </div>
  )
}
