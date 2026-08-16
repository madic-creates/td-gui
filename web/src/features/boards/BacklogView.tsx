import { Fragment, useState } from 'react'
import type { DragEvent } from 'react'
import { unboundMessage } from '../../api/client'
import { useClearCardPosition, useSetCardPosition } from '../../api/mutations'
import ErrorPanel from '../../components/ErrorPanel'
import BoardCard from './BoardCard'
import { dragSourceProps } from './dragSource'
import { insertSlot } from './position'
import type { BoardCard as Card } from '../../api/types'

interface Props {
  boardId: string
  cards: Card[]
}

/**
 * The flat, ordered view of a board.
 *
 * td stores one position sequence per board, and cards without a position
 * always sort after every card that has one. That boundary is drawn on screen
 * rather than hidden: above it the order is stored and editable, below it the
 * order is whatever the board query returned and nothing can be moved within
 * it.
 */
export default function BacklogView({ boardId, cards }: Props) {
  const pinned = cards.filter(c => c.has_position)
  const auto = cards.filter(c => !c.has_position)

  const setPosition = useSetCardPosition(boardId)
  const clearPosition = useClearCardPosition(boardId)
  const busy = setPosition.isPending || clearPosition.isPending

  // Which of the two mutations owns the panel. React Query holds a mutation's
  // error until that same mutation runs again, so without this an unpin that
  // succeeded would leave a rejected move on screen describing a card that has
  // already left the pinned block. Selecting the outcome rather than reset()ing
  // the sibling matters: MutationObserver.reset() detaches the observer from a
  // *pending* mutation, so td's answer never arrives. Same pattern as
  // TransitionBar and DependencyPanel.
  const [lastAction, setLastAction] = useState<'set' | 'clear' | null>(null)
  const error =
    lastAction === 'set' ? setPosition.error
    : lastAction === 'clear' ? clearPosition.error
    : null
  const message = unboundMessage(error)

  /** No optimistic move: td computes the sort key and may respace the board. */
  const move = (issueId: string, slot: number | null) => {
    if (slot === null) return
    setLastAction('set')
    setPosition.mutate({ issueId, slot })
  }

  const unpin = (issueId: string) => {
    setLastAction('clear')
    clearPosition.mutate(issueId)
  }

  /**
   * The card a write is currently about, so it can be dimmed. Nothing is
   * reordered optimistically, so the card sits in its old place for the whole
   * flight and `aria-busy` on the list is the only other sign anything is
   * happening — and that says a write is in flight, not which card it moves.
   */
  const movingId = setPosition.isPending
    ? (setPosition.variables?.issueId ?? null)
    : clearPosition.isPending
      ? (clearPosition.variables ?? null)
      : null

  const [dragging, setDragging] = useState<string | null>(null)
  const [overGap, setOverGap] = useState<number | null>(null)

  /**
   * A drag that a card on this board started, which a drop would accept. Foreign
   * payloads leave `dragging` null and `dropAt` refuses them, so the gaps stay
   * dark rather than advertise a drop that is discarded without a word — the
   * same reason they stay dark while `busy`.
   */
  const armed = dragging !== null && !busy

  const endDrag = () => {
    setDragging(null)
    setOverGap(null)
  }

  /** The dragged card's index in the pinned block, or null when unpinned. */
  const pinnedIndexOf = (issueId: string) => {
    const index = pinned.findIndex(c => c.issue.id === issueId)
    return index === -1 ? null : index
  }

  const dropAt = (gap: number) => (event: DragEvent) => {
    event.preventDefault()
    // Same refusal the Move and Unpin buttons make with `disabled={busy}`, and
    // the one the list announces as aria-busy. Nothing is reordered
    // optimistically, so while a write is in flight the rendered block is the
    // one td is about to replace — a gap measured against it would name a
    // different place by the time td applied it.
    if (busy) return
    // text/plain is the whole story here, with no fallback on `dragging` — see
    // dragSource for why the drag data store is readable at drop.
    const issueId = event.dataTransfer.getData('text/plain')
    endDrag()
    // text/plain is whatever the drag carried, and a drag that started outside
    // the board carries something else — a link from another window arrives as
    // its URL, and a drag carrying no text at all arrives empty. td would answer
    // either with a 404 the user did nothing to earn, so a payload that names no
    // card here is a no-op, as in SwimlaneView.
    if (!issueId) return
    if (!cards.some(c => c.issue.id === issueId)) return
    move(issueId, insertSlot(gap, pinnedIndexOf(issueId)))
  }

  const gapProps = (gap: number) => ({
    gap,
    state: (!armed ? 'idle' : overGap === gap ? 'active' : 'armed') as GapState,
    onDrop: dropAt(gap),
    // Set on dragover rather than dragenter: dragover repeats for as long as
    // the cursor is held over the gap, so a dragenter the browser skipped on a
    // 6px strip still resolves. Re-setting the same value is a no-op in React.
    onDragOver: () => setOverGap(gap),
    // Only if it is still this gap's turn: the gap being left reports dragleave
    // after the gap being entered has already reported dragover.
    onDragLeave: () => setOverGap(current => (current === gap ? null : current)),
  })

  /** Dims the card a write is currently about. */
  const dim = (issueId: string) => (movingId === issueId ? 'opacity-40' : '')

  return (
    <div className="space-y-4 p-4">
      {message && <ErrorPanel message={message} />}

      <section>
        <h2 className="mb-1.5 text-[11px] uppercase tracking-widest text-ink-muted">Pinned</h2>
        {pinned.length === 0 ? (
          <>
            <p className="text-[11px] text-ink-faint">
              Nothing is pinned. Drag a card up here to give it a stored position.
            </p>
            <ul aria-label="Pinned">
              <DropGap {...gapProps(0)} />
            </ul>
          </>
        ) : (
          <ul aria-label="Pinned" aria-busy={busy} className="space-y-1.5">
            {pinned.map((card, index) => (
              <Fragment key={card.issue.id}>
                <DropGap {...gapProps(index)} />
                <li
                  {...dragSourceProps(card.issue.id, { setDragging, endDrag, enabled: !busy })}
                  className="flex items-center gap-1.5"
                >
                  {/* The dimming sits on the card, not the row: the controls
                      beside it are `disabled` while a write is in flight and
                      already carry their own `disabled:opacity-40`. */}
                  <span
                    data-testid={`card-${card.issue.id}`}
                    className={`flex-1 ${dim(card.issue.id)}`}
                  >
                    <BoardCard issue={card.issue} />
                  </span>
                  <button
                    type="button"
                    aria-label={`Move ${card.issue.id} up`}
                    // The glyph names nothing on its own, and this is the
                    // primary pointer affordance next to dragging.
                    title={`Move ${card.issue.id} up`}
                    disabled={busy || index === 0}
                    onClick={() => move(card.issue.id, insertSlot(index - 1, index))}
                    className="rounded-sm border border-line px-2 py-1 text-[11px] text-ink-muted disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${card.issue.id} down`}
                    title={`Move ${card.issue.id} down`}
                    disabled={busy || index === pinned.length - 1}
                    // gap = index + 2, not index + 1: at index + 1 td interpolates
                    // between the card and its successor and it keeps its place.
                    onClick={() => move(card.issue.id, insertSlot(index + 2, index))}
                    className="rounded-sm border border-line px-2 py-1 text-[11px] text-ink-muted disabled:opacity-40"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Unpin ${card.issue.id}`}
                    disabled={busy}
                    onClick={() => unpin(card.issue.id)}
                    className="rounded-sm border border-line px-2 py-1 text-[11px] text-ink-muted disabled:opacity-40"
                  >
                    Unpin
                  </button>
                </li>
              </Fragment>
            ))}
            <DropGap {...gapProps(pinned.length)} />
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1.5 border-t border-line-subtle pt-3 text-[11px] uppercase tracking-widest text-ink-faint">
          Ordered by the board query
        </h2>
        {auto.length === 0 ? (
          <p className="text-[11px] text-ink-faint">Every matching issue is pinned.</p>
        ) : (
          <ul aria-label="Ordered by the board query" className="space-y-1.5">
            {auto.map(card => (
              <li
                key={card.issue.id}
                {...dragSourceProps(card.issue.id, { setDragging, endDrag, enabled: !busy })}
                data-testid={`card-${card.issue.id}`}
                className={dim(card.issue.id)}
              >
                <BoardCard issue={card.issue} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/**
 * `idle` — nothing is being dragged. `armed` — a drop would be accepted here,
 * drawn as a hairline so every place a card can land is visible before the
 * cursor finds it. `active` — the cursor is over this gap and the card lands
 * here.
 */
type GapState = 'idle' | 'armed' | 'active'

/**
 * The gap never changes height. Reflowing a 6px strip to make room would move
 * it out from under the cursor mid-drag and set dragleave and dragenter
 * fighting each other, so the marker is painted with box-shadow — which does
 * not affect layout — the way IssueList paints its row hover edge. The active
 * gap reads as 14px: a 6px bar plus a 4px halo on each side.
 */
const GAP_STYLE: Record<GapState, string> = {
  idle: '',
  armed: 'shadow-[inset_0_1px_0_var(--color-line-subtle)]',
  active: 'bg-accent shadow-[0_0_0_4px_var(--color-accent-bg)]',
}

interface DropGapProps {
  gap: number
  state: GapState
  onDrop: (e: DragEvent) => void
  onDragOver: () => void
  onDragLeave: () => void
}

/**
 * A drop target between two pinned cards. Decorative for assistive tech — the
 * keyboard path is the Move up/down buttons, which are real controls with real
 * names — so it is aria-hidden and addressed by test id.
 */
function DropGap({ gap, state, onDrop, onDragOver, onDragLeave }: DropGapProps) {
  return (
    <li
      aria-hidden="true"
      data-testid={`drop-gap-${gap}`}
      data-state={state}
      onDragOver={e => {
        // Without this the browser rejects the drop and no drop event fires.
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        onDragOver()
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`h-1.5 rounded-sm ${GAP_STYLE[state]}`}
    />
  )
}
