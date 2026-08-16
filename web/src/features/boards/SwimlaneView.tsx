import { useState } from 'react'
import type { DragEvent } from 'react'
import BoardCard from './BoardCard'
import BoardTransitionPanel, { STATUS_LABEL } from './BoardTransitionPanel'
import type { BoardCard as Card, IssueStatus } from '../../api/types'

/** Without include_closed td filters the board to the first four. */
const COLUMNS: IssueStatus[] = ['open', 'in_progress', 'blocked', 'in_review', 'closed']

/**
 * The board as status columns.
 *
 * Reordering is deliberately absent: td stores one position sequence per board,
 * so an order written inside a column would also order that card against every
 * card in every other column. Dragging here means one thing only — a status
 * change — and even that is proposed rather than performed.
 */
export default function SwimlaneView({ cards }: { cards: Card[] }) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [pending, setPending] = useState<{ issueId: string; status: IssueStatus } | null>(null)

  const columns = COLUMNS.filter(
    status => status !== 'closed' || cards.some(c => c.issue.status === 'closed'),
  )

  const dropOn = (status: IssueStatus) => (event: DragEvent) => {
    event.preventDefault()
    const issueId = event.dataTransfer.getData('text/plain') || dragging
    setDragging(null)
    if (!issueId) return
    const card = cards.find(c => c.issue.id === issueId)
    // A drop inside the card's own column has nothing to propose.
    if (!card || card.issue.status === status) return
    setPending({ issueId, status })
  }

  return (
    <div>
      <div className="flex gap-2.5 overflow-x-auto p-4">
        {columns.map(status => (
          <section
            key={status}
            role="region"
            aria-label={STATUS_LABEL[status]}
            onDragOver={e => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
            }}
            onDrop={dropOn(status)}
            className="w-64 shrink-0 rounded-sm border border-line p-2"
          >
            <h2 className="mb-1.5 text-[11px] uppercase tracking-widest text-ink-muted">
              {STATUS_LABEL[status]}
            </h2>
            <ul className="space-y-1.5">
              {cards.filter(c => c.issue.status === status).map(card => (
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
          </section>
        ))}
      </div>

      {pending && (
        <BoardTransitionPanel
          issueId={pending.issueId}
          droppedOn={pending.status}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  )
}
