import type { DragEvent } from 'react'

/**
 * The half of a board card's drag behaviour that both views share: the issue
 * id goes out on text/plain, and the view records which card it is holding so
 * that its drop targets can light up.
 *
 * text/plain is the only channel the drop handlers read. `dragging` is for the
 * affordance and nothing else — neither handler falls back on it, because the
 * spec puts the drag data store in read-only mode for drop. Protected mode,
 * where getData returns '', covers dragover and dragenter instead, so the
 * payload set here is always readable where a drop reads it.
 *
 * Only this half is shared. The drop handlers stay with their views and are
 * deliberately not folded in here — the backlog computes a slot in td's stored
 * position sequence, the swimlanes propose a status change, and the one thing
 * they have in common is where they read the id from.
 *
 * `enabled` exists for the backlog, which refuses to start a drag while a
 * position write is in flight: nothing is reordered optimistically, so the
 * block on screen is the one td is about to replace and a gap measured against
 * it would name a different place by the time td applied it. The swimlanes
 * write nothing on drag, so they leave it alone.
 */
export function dragSourceProps(
  issueId: string,
  { setDragging, endDrag, enabled = true }: {
    setDragging: (issueId: string) => void
    endDrag: () => void
    enabled?: boolean
  },
) {
  return {
    draggable: enabled,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.setData('text/plain', issueId)
      event.dataTransfer.effectAllowed = 'move'
      setDragging(issueId)
    },
    onDragEnd: endDrag,
  }
}
