import { useEffect, useRef, useState } from 'react'
import { unboundMessage } from '../../api/client'
import { useBoards } from '../../api/boards'
import { useCreateBoard, useUpdateBoard } from '../../api/mutations'
import ErrorPanel from '../../components/ErrorPanel'
import FieldError, { fieldAria } from '../../components/FieldError'
import type { Board } from '../../api/types'

const NAME_INPUT = 'saved-query-name'
const boundFields = ['name']

interface Props {
  /** The query that is running, or undefined while the list is not in query mode. */
  query?: string
  /** The board it was loaded from, if it was loaded from one. */
  board?: string
  /** A saved query was picked: its text, and the board it came from. */
  onPick: (query: string, board: string) => void
  /** The running query is now this board's. */
  onSaved: (board: string) => void
}

/**
 * Save the query in the search box, load a saved one back, write a changed one
 * back to where it came from.
 *
 * A saved query is a board. td already stores a name plus a TDQ expression and
 * `docs/boards.md` opens by saying so, so this bar borrows that store rather
 * than growing one of its own — nothing here is td-gui's own project state.
 *
 * The board id is provenance, not a request: `query` is what runs, and this
 * component only decides what may be written back to where. An id no board
 * answers to (deleted in another tab) resolves to nothing and the bar offers
 * to save the query afresh, which is the state it would be in anyway.
 */
export default function SavedQueryBar({ query, board: boardId, onPick, onSaved }: Props) {
  const { data } = useBoards()
  const [naming, setNaming] = useState(false)

  const board = data?.boards.find(b => b.id === boardId)
  // Exact strings: whitespace counts as a change. That offers a write which
  // turns out to be a no-op, rather than hiding one that was wanted.
  const changed = board !== undefined && query !== undefined && board.query !== query

  // A url naming a board, before the board list has arrived. The query is
  // saved, we just cannot say to what yet, so the bar offers nothing rather
  // than flashing "Save" at a query that already has a home.
  const resolving = boardId !== undefined && data === undefined

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Picker boards={data?.boards ?? []} onPick={(q, id) => { setNaming(false); onPick(q, id) }} />

      {query !== undefined && !board && !resolving && (
        <Action onClick={() => setNaming(true)} pressed={naming}>Save</Action>
      )}
      {changed && (
        <>
          <UpdateButton board={board} query={query} />
          <Action onClick={() => setNaming(true)} pressed={naming}>Save as new</Action>
        </>
      )}

      {naming && query !== undefined && (
        <NameForm
          query={query}
          onDone={id => { setNaming(false); onSaved(id) }}
          onCancel={() => setNaming(false)}
        />
      )}
    </div>
  )
}

function Action(
  { onClick, pressed, children }:
  { onClick: () => void; pressed?: boolean; children: React.ReactNode },
) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={pressed}
      className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted hover:text-ink"
    >
      {children}
    </button>
  )
}

/**
 * The menu of saved queries.
 *
 * Boards with an empty query are left out. Emptiness means two different
 * things there — the whole project on td's builtin, only the hand-placed cards
 * on a board of your own — and in the search box it would mean every issue,
 * which is neither of them.
 */
function Picker({ boards, onPick }: { boards: Board[]; onPick: (q: string, id: string) => void }) {
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const listed = boards.filter(b => b.query !== '')

  // Closing on a click anywhere else is what makes this a menu rather than a
  // panel that has to be dismissed with the same button that opened it.
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div
      ref={wrapper}
      className="relative"
      onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted hover:text-ink"
      >
        Saved queries
      </button>

      {open && (
        <div
          role="menu"
          className="absolute z-10 mt-1 max-h-80 w-80 overflow-y-auto rounded-sm border border-line bg-surface py-1 shadow-lg"
        >
          {listed.length === 0 ? (
            <p className="px-2.5 py-1.5 text-[11px] text-ink-faint">
              No saved queries yet. Run one and save it.
            </p>
          ) : (
            listed.map(b => (
              <button
                key={b.id}
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); onPick(b.query, b.id) }}
                className="block w-full px-2.5 py-1.5 text-left hover:bg-surface-inset"
              >
                <span className="block text-[13px] text-ink">{b.name}</span>
                <span className="block truncate font-mono text-[11px] text-ink-faint">
                  {b.query}
                </span>
              </button>
            ))
          )}
          {/* Said once, where it matters: these are boards, so a reader who
              wants to rename or delete one knows which page to go to. */}
          <p className="mt-1 border-t border-line px-2.5 pt-1.5 text-[11px] text-ink-faint">
            A saved query is a board. Rename or delete it on the Boards page.
          </p>
        </div>
      )}
    </div>
  )
}

/** Writes the query on screen back to the board it was loaded from. */
function UpdateButton({ board, query }: { board: Board; query: string }) {
  const update = useUpdateBoard(board.id)
  const message = unboundMessage(update.error)

  return (
    <>
      {/* No confirmation: the query is on screen and its results are under it,
          so there is nothing hidden to confirm. The board keeps its name —
          renaming lives in BoardForm, one route away. */}
      <button
        type="button"
        disabled={update.isPending}
        onClick={() => update.mutate({ name: board.name, query })}
        className="rounded-sm border border-accent px-2.5 py-1 text-[11px] text-accent disabled:opacity-40"
      >
        Update &quot;{board.name}&quot;
      </button>
      {message && <ErrorPanel message={message} />}
    </>
  )
}

/**
 * The name for a new board, asked for in place.
 *
 * Not a dialog: the list underneath is the evidence that this is the right
 * query to save, and a dialog would cover it. Nothing here checks the name —
 * td owns that, and answers in its own words under the field.
 */
function NameForm(
  { query, onDone, onCancel }:
  { query: string; onDone: (id: string) => void; onCancel: () => void },
) {
  const [name, setName] = useState('')
  const create = useCreateBoard()
  const panelError = unboundMessage(create.error, boundFields)

  // Same guard as the other forms: the disabled attribute reads from state and
  // does not stop a second native submit landing in the same tick.
  const submitting = useRef(false)

  return (
    <form
      className="flex flex-wrap items-center gap-1.5"
      onSubmit={e => {
        e.preventDefault()
        if (submitting.current) return
        submitting.current = true
        create.mutate({ name, query }, {
          onSuccess: result => onDone(result.board.id),
          onSettled: () => { submitting.current = false },
        })
      }}
    >
      <label htmlFor={NAME_INPUT} className="sr-only">Board name</label>
      <input
        id={NAME_INPUT}
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Board name"
        autoFocus
        className="rounded-sm border border-line bg-surface-inset px-2.5 py-1 text-[11px] text-ink placeholder:text-ink-faint"
        {...fieldAria(create.error, 'name', NAME_INPUT)}
      />
      <button
        type="submit"
        disabled={create.isPending}
        className="rounded-sm border border-accent px-2.5 py-1 text-[11px] text-accent disabled:opacity-40"
      >
        Save board
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted hover:text-ink"
      >
        Cancel
      </button>
      <FieldError error={create.error} field="name" inputId={NAME_INPUT} />
      {panelError && <ErrorPanel message={panelError} />}
    </form>
  )
}
