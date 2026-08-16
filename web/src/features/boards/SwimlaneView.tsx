import { useState } from 'react'
import type { DragEvent } from 'react'
import BoardCard from './BoardCard'
import BoardTransitionPanel, { STATUS_LABEL } from './BoardTransitionPanel'
import type { BoardCard as Card, IssueStatus } from '../../api/types'

const COLUMNS: IssueStatus[] = ['open', 'in_progress', 'blocked', 'in_review', 'closed']

/**
 * `idle` — nothing is being dragged. `armed` — a drop here would propose a
 * status change, drawn the moment a card is picked up so every column that
 * would take it is legible before the cursor finds one. `active` — the cursor
 * is over this column and this is where the card lands. `origin` — the dragged
 * card is already here, where a drop has nothing to propose.
 */
type ColumnState = 'idle' | 'armed' | 'active' | 'origin'

/**
 * The border width never changes, only its colour, so nothing reflows out from
 * under the cursor mid-drag. `origin` is deliberately identical to `idle`: the
 * column the card came from is the one place staying quiet is the message.
 */
const COLUMN_STYLE: Record<ColumnState, string> = {
  idle: 'border-line',
  origin: 'border-line',
  armed: 'border-line bg-surface-inset',
  active: 'border-accent bg-accent-bg',
}

/**
 * The board as status columns.
 *
 * Reordering is deliberately absent: td stores one position sequence per board,
 * so an order written inside a column would also order that card against every
 * card in every other column. Dragging here means one thing only — a status
 * change — and even that is proposed rather than performed.
 *
 * Every column renders, including Closed. Without include_closed td leaves
 * closed issues out of the payload, so a column conditioned on holding a card
 * would never appear — and closing is the transition a drop most often wants
 * to propose. `includeClosed` is not what decides that; it only says whether an
 * empty Closed column means "filtered out" or "nothing closed here".
 */
export default function SwimlaneView({
  cards, includeClosed,
}: {
  cards: Card[]
  includeClosed: boolean
}) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [overColumn, setOverColumn] = useState<IssueStatus | null>(null)
  const [pending, setPending] = useState<{ issueId: string; status: IssueStatus } | null>(null)

  const endDrag = () => {
    setDragging(null)
    setOverColumn(null)
  }

  /** The column the dragged card is already in, or null when nothing is dragged. */
  const origin = dragging === null
    ? null
    : (cards.find(c => c.issue.id === dragging)?.issue.status ?? null)

  /**
   * A drag that no card here started leaves `dragging` null — a link from
   * another window arrives as its URL — and `dropOn` discards that payload
   * without a word. So the columns stay idle rather than advertise a drop that
   * never happens, the same refusal the backlog gaps make by staying dark.
   */
  const columnState = (status: IssueStatus): ColumnState => {
    if (dragging === null) return 'idle'
    if (status === origin) return 'origin'
    return overColumn === status ? 'active' : 'armed'
  }

  const dropOn = (status: IssueStatus) => (event: DragEvent) => {
    event.preventDefault()
    const issueId = event.dataTransfer.getData('text/plain') || dragging
    endDrag()
    if (!issueId) return
    const card = cards.find(c => c.issue.id === issueId)
    // A drop inside the card's own column has nothing to propose.
    if (!card || card.issue.status === status) return
    setPending({ issueId, status })
  }

  return (
    <div>
      <div className="flex gap-2.5 overflow-x-auto p-4">
        {COLUMNS.map(status => {
          const column = cards.filter(c => c.issue.status === status)
          const state = columnState(status)
          return (
            <section
              key={status}
              role="region"
              aria-label={STATUS_LABEL[status]}
              data-state={state}
              onDragOver={e => {
                e.preventDefault()
                // `dropOn` refuses a drop on the card's own column, so the
                // cursor says so too rather than promising a move that the
                // handler then declines in silence.
                e.dataTransfer.dropEffect = state === 'origin' ? 'none' : 'move'
                // Set on dragover rather than dragenter: dragover repeats for
                // as long as the cursor is held, so a dragenter the browser
                // skipped still resolves. Setting it for the origin column too
                // is what unmarks whichever column the cursor came from.
                setOverColumn(status)
              }}
              onDragLeave={e => {
                // dragleave bubbles out of the cards inside the column as well,
                // so clearing on every one of them would unmark the column that
                // the dragover about to follow immediately marks again — a
                // flicker on each card the cursor crosses.
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
                setOverColumn(current => (current === status ? null : current))
              }}
              onDrop={dropOn(status)}
              className={`w-64 shrink-0 rounded-sm border p-2 ${COLUMN_STYLE[state]}`}
            >
              <h2 className="mb-1.5 text-[11px] uppercase tracking-widest text-ink-muted">
                {STATUS_LABEL[status]}
              </h2>
              {status === 'closed' && column.length === 0 && !includeClosed && (
                <p className="text-[11px] text-ink-faint">
                  Closed issues are hidden unless you include them.
                </p>
              )}
              <ul className="space-y-1.5">
                {column.map(card => (
                  <li
                    key={card.issue.id}
                    draggable
                    onDragStart={e => {
                      e.dataTransfer.setData('text/plain', card.issue.id)
                      e.dataTransfer.effectAllowed = 'move'
                      setDragging(card.issue.id)
                    }}
                    onDragEnd={endDrag}
                  >
                    <BoardCard issue={card.issue} />
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      {pending && (
        <BoardTransitionPanel
          // A drop while a form for a different card is still open must not
          // reuse that instance: TransitionBar's reason/attribution state is
          // local and keyed to nothing, so without a remount it would survive
          // the switch and submit against the wrong issue.
          key={pending.issueId}
          issueId={pending.issueId}
          droppedOn={pending.status}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  )
}
