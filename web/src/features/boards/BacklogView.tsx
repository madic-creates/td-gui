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

  return (
    <div className="space-y-4 p-4">
      {message && <ErrorPanel message={message} />}

      <section>
        <h2 className="mb-1.5 text-[11px] uppercase tracking-widest text-ink-muted">Pinned</h2>
        {pinned.length === 0 ? (
          <p className="text-[11px] text-ink-faint">
            Nothing is pinned. Drag a card up here to give it a stored position.
          </p>
        ) : (
          <ul aria-label="Pinned" aria-busy={busy} className="space-y-1.5">
            {pinned.map((card, index) => (
              <li key={card.issue.id} className="flex items-center gap-1.5">
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
            ))}
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
              <li key={card.issue.id}><BoardCard issue={card.issue} /></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
