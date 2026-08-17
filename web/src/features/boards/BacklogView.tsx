import { Fragment, useState } from 'react'
import type { DragEvent } from 'react'
import { unboundMessage } from '../../api/client'
import { useClearCardPosition, useSetCardPosition } from '../../api/mutations'
import ErrorPanel from '../../components/ErrorPanel'
import { ArrowDownIcon, ArrowUpIcon, UnpinIcon } from '../../components/Icon'
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
  /**
   * Where a drop would land right now: a gap index for an exact slot, or
   * `'section'` for the coarse fallback the pinned block as a whole offers.
   * One state and not two, so the section and a gap can never both be lit and
   * claim the same drop.
   */
  const [over, setOver] = useState<number | 'section' | null>(null)

  /**
   * A drag that a card on this board started, which a drop would accept. Foreign
   * payloads leave `dragging` null and `dropAt` refuses them, so the gaps stay
   * dark rather than advertise a drop that is discarded without a word — the
   * same reason they stay dark while `busy`.
   */
  const armed = dragging !== null && !busy

  const endDrag = () => {
    setDragging(null)
    setOver(null)
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
    state: (!armed ? 'idle' : over === gap ? 'active' : 'armed') as GapState,
    onDrop: dropAt(gap),
    // Set on dragover rather than dragenter: dragover repeats for as long as
    // the cursor is held over the gap, so a dragenter the browser skipped on a
    // 6px strip still resolves. Re-setting the same value is a no-op in React.
    onDragOver: () => setOver(gap),
    // Only if it is still this gap's turn: the gap being left reports dragleave
    // after the gap being entered has already reported dragover.
    onDragLeave: () => setOver(current => (current === gap ? null : current)),
  })

  /**
   * The pinned block as one drop target.
   *
   * A gap is 6px tall, which is no target at all for a dragged card. So the
   * whole section takes the drop and resolves it to the end of the block. The
   * gaps sit inside and keep their exact placement; this is the fallback for a
   * drop that missed all of them.
   *
   * With nothing pinned there are no gaps, and the section is the only target
   * — a heading and one line of prose telling the user to drag a card "up
   * here", which is now the whole of "here".
   */
  const sectionState: GapState = !armed ? 'idle' : over === 'section' ? 'active' : 'armed'

  const sectionProps = {
    'data-testid': 'pinned-dropzone',
    'data-state': sectionState,
    onDragOver: (event: DragEvent) => {
      // Without this the browser rejects the drop and no drop event fires.
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setOver('section')
    },
    onDragLeave: (event: DragEvent) => {
      // dragleave bubbles out of everything inside the section — every gap,
      // every card — so clearing on each of them would unmark the section that
      // the dragover about to follow immediately marks again, a flicker on
      // every row the cursor crosses. Same guard as SwimlaneView's columns.
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
      setOver(current => (current === 'section' ? null : current))
    },
    onDrop: dropAt(pinned.length),
  }

  /**
   * A pinned card's own row, made inert to the drag.
   *
   * The section takes the drop for the chrome around the block — its heading,
   * its prose, the space beside the cards. The rows are not chrome: a row is
   * where a card already is, so a drop on one names no new place, and left to
   * bubble it would reach the section and append. That turns the standard
   * cancel gesture — pick a card up, put it back down where it was — into a
   * silent write that sends the card to the bottom of the block, defeating the
   * guard `insertSlot` documents. So the row answers the drag the way it did
   * before the section became a target: not at all.
   *
   * dragover is stopped without `preventDefault`, which is how a browser is
   * told the drop is refused here — it then fires no drop event at all. `onDrop`
   * stops it anyway, for the same reason `DropGap` does: it is the one place
   * that decides, and a synthetic event must not reach past it either.
   */
  const inertRowProps = {
    onDragOver: (event: DragEvent) => {
      event.stopPropagation()
      // The section is still armed — a drop is accepted in this block, just not
      // on this row — but nothing may read as "the card lands here".
      setOver(null)
    },
    onDrop: (event: DragEvent) => event.stopPropagation(),
  }

  /** Dims the card a write is currently about. */
  const dim = (issueId: string) => (movingId === issueId ? 'opacity-40' : '')

  return (
    <div className="space-y-4 p-4">
      {message && <ErrorPanel message={message} />}

      {/* The padding is what gives the drop tint room to read as a region
          rather than a box drawn tight around the words. Sideways it costs
          nothing: `-mx-2` cancels it against the container's own `p-4`, so the
          section's contents stay exactly where they were and only the painted
          area grows. Vertically it is real, and permanent — which is the part
          that matters, since a section that grew only while armed would reflow
          the gaps out from under the cursor mid-drag. */}
      <section {...sectionProps} className={`-mx-2 rounded-sm p-2 ${SECTION_STYLE[sectionState]}`}>
        <h2 className="mb-1.5 text-[11px] uppercase tracking-widest text-ink-muted">Pinned</h2>
        {pinned.length === 0 ? (
          // No list and no gap. A gap marks the boundary between two pinned
          // cards, and with none there is no boundary to mark — the strip drawn
          // where one would go was a second drop target inside the first,
          // offering the very slot the sentence above it offers. The section
          // is the whole target here.
          <p className="text-[11px] text-ink-faint">
            Nothing is pinned. Drag a card up here to give it a stored position.
          </p>
        ) : (
          <ul aria-label="Pinned" aria-busy={busy} className="space-y-1.5">
            {pinned.map((card, index) => (
              <Fragment key={card.issue.id}>
                <DropGap {...gapProps(index)} />
                <li
                  {...dragSourceProps(card.issue.id, { setDragging, endDrag, enabled: !busy })}
                  {...inertRowProps}
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
                  {/* Three icons and no words. Unpin used to be the one
                      label here, beside two arrow glyphs of the same size —
                      a row that was half symbol and half sentence. Every one
                      of them names itself through aria-label and title: a
                      drawing names nothing on its own, and these are the
                      primary pointer affordance next to dragging. */}
                  <button
                    type="button"
                    aria-label={`Move ${card.issue.id} up`}
                    title={`Move ${card.issue.id} up`}
                    disabled={busy || index === 0}
                    onClick={() => move(card.issue.id, insertSlot(index - 1, index))}
                    className="inline-flex items-center rounded-sm border border-line p-1.5 text-ink-muted disabled:opacity-40"
                  >
                    <ArrowUpIcon />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${card.issue.id} down`}
                    title={`Move ${card.issue.id} down`}
                    disabled={busy || index === pinned.length - 1}
                    // gap = index + 2, not index + 1: at index + 1 td interpolates
                    // between the card and its successor and it keeps its place.
                    onClick={() => move(card.issue.id, insertSlot(index + 2, index))}
                    className="inline-flex items-center rounded-sm border border-line p-1.5 text-ink-muted disabled:opacity-40"
                  >
                    <ArrowDownIcon />
                  </button>
                  <button
                    type="button"
                    aria-label={`Unpin ${card.issue.id}`}
                    title={`Unpin ${card.issue.id}`}
                    disabled={busy}
                    onClick={() => unpin(card.issue.id)}
                    className="inline-flex items-center rounded-sm border border-line p-1.5 text-ink-muted disabled:opacity-40"
                  >
                    <UnpinIcon />
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

/**
 * The pinned section under the same three states, and for the same reason
 * painted with nothing that occupies space: only the background changes, so a
 * region that lights up mid-drag cannot reflow the gaps inside it.
 *
 * The two vocabularies are SwimlaneView's — `bg-surface-inset` for a region
 * that would take the drop, `bg-accent-bg` for the one it would land in — so
 * the two board views say the same thing the same way.
 */
const SECTION_STYLE: Record<GapState, string> = {
  idle: '',
  armed: 'bg-surface-inset',
  active: 'bg-accent-bg',
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
 *
 * Every handler stops the event here. The gap sits inside the section, which is
 * a drop target of its own, and an unstopped drop would run both — appending
 * the card the gap had just placed at an exact slot. The gap is the more
 * specific answer, so it is the only one that gets to answer.
 */
function DropGap({ gap, state, onDrop, onDragOver, onDragLeave }: DropGapProps) {
  return (
    <li
      aria-hidden="true"
      data-testid={`drop-gap-${gap}`}
      data-state={state}
      onDragOver={e => {
        e.stopPropagation()
        // Without this the browser rejects the drop and no drop event fires.
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        onDragOver()
      }}
      onDragLeave={e => {
        e.stopPropagation()
        onDragLeave()
      }}
      onDrop={e => {
        e.stopPropagation()
        onDrop(e)
      }}
      className={`h-1.5 rounded-sm ${GAP_STYLE[state]}`}
    />
  )
}
