import { Fragment, useState } from 'react'
import type { DragEvent } from 'react'
import { unboundMessage } from '../../api/client'
import { useClearCardPosition, useSetCardPosition } from '../../api/mutations'
import ErrorPanel from '../../components/ErrorPanel'
import BoardCard from './BoardCard'
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
  const message = unboundMessage(setPosition.error ?? clearPosition.error)

  /** No optimistic move: td computes the sort key and may respace the board. */
  const move = (issueId: string, slot: number | null) => {
    if (slot === null) return
    setPosition.mutate({ issueId, slot })
  }

  const [dragging, setDragging] = useState<string | null>(null)

  /** The dragged card's index in the pinned block, or null when unpinned. */
  const pinnedIndexOf = (issueId: string) => {
    const index = pinned.findIndex(c => c.issue.id === issueId)
    return index === -1 ? null : index
  }

  const dropAt = (gap: number) => (event: DragEvent) => {
    event.preventDefault()
    const issueId = event.dataTransfer.getData('text/plain') || dragging
    setDragging(null)
    if (!issueId) return
    move(issueId, insertSlot(gap, pinnedIndexOf(issueId)))
  }

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
              <DropGap gap={0} onDrop={dropAt(0)} />
            </ul>
          </>
        ) : (
          <ul aria-label="Pinned" aria-busy={busy} className="space-y-1.5">
            {pinned.map((card, index) => (
              <Fragment key={card.issue.id}>
                <DropGap gap={index} onDrop={dropAt(index)} />
                <li
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.setData('text/plain', card.issue.id)
                    e.dataTransfer.effectAllowed = 'move'
                    setDragging(card.issue.id)
                  }}
                  onDragEnd={() => setDragging(null)}
                  className="flex items-center gap-1.5"
                >
                  <span className="flex-1"><BoardCard issue={card.issue} /></span>
                  <button
                    type="button"
                    aria-label={`Move ${card.issue.id} up`}
                    disabled={busy || index === 0}
                    onClick={() => move(card.issue.id, insertSlot(index - 1, index))}
                    className="rounded-sm border border-line px-2 py-1 text-[11px] text-ink-muted disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${card.issue.id} down`}
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
                    onClick={() => clearPosition.mutate(card.issue.id)}
                    className="rounded-sm border border-line px-2 py-1 text-[11px] text-ink-muted disabled:opacity-40"
                  >
                    Unpin
                  </button>
                </li>
              </Fragment>
            ))}
            <DropGap gap={pinned.length} onDrop={dropAt(pinned.length)} />
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
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData('text/plain', card.issue.id)
                  e.dataTransfer.effectAllowed = 'move'
                  setDragging(card.issue.id)
                }}
                onDragEnd={() => setDragging(null)}
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
 * A drop target between two pinned cards. Decorative for assistive tech — the
 * keyboard path is the Move up/down buttons, which are real controls with real
 * names — so it is aria-hidden and addressed by test id.
 */
function DropGap({ gap, onDrop }: { gap: number; onDrop: (e: DragEvent) => void }) {
  return (
    <li
      aria-hidden="true"
      data-testid={`drop-gap-${gap}`}
      onDragOver={e => {
        // Without this the browser rejects the drop and no drop event fires.
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={onDrop}
      className="h-1.5 rounded-sm"
    />
  )
}
