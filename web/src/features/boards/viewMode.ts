import type { BoardViewMode } from '../../api/types'

const PREFIX = 'td-gui.board-view.'

const MODES: BoardViewMode[] = ['backlog', 'swimlanes']

export function isViewMode(value: unknown): value is BoardViewMode {
  return MODES.includes(value as BoardViewMode)
}

/**
 * The user's own choice for this board, or null when they have not made one —
 * in which case the caller falls back to td's board.view_mode.
 *
 * Reading localStorage throws outright in some sandboxed contexts, so an
 * unreadable or unrecognised value degrades to "no preference", as in
 * lib/theme.ts.
 */
export function readStoredView(boardId: string): BoardViewMode | null {
  try {
    const stored = localStorage.getItem(PREFIX + boardId)
    return isViewMode(stored) ? stored : null
  } catch {
    return null
  }
}

export function storeView(boardId: string, view: BoardViewMode): void {
  try {
    localStorage.setItem(PREFIX + boardId, view)
  } catch {
    /* A preference that survives only this tab still beats a crash. */
  }
}
