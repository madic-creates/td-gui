import { describe, expect, it, beforeEach } from 'vitest'
import { isViewMode, readStoredView, storeView } from './viewMode'

beforeEach(() => localStorage.clear())

describe('viewMode', () => {
  it("recognises only td's two modes", () => {
    expect(isViewMode('backlog')).toBe(true)
    expect(isViewMode('swimlanes')).toBe(true)
    expect(isViewMode('kanban')).toBe(false)
    expect(isViewMode(null)).toBe(false)
  })

  it('stores a preference per board', () => {
    storeView('bd-1', 'swimlanes')
    storeView('bd-2', 'backlog')
    expect(readStoredView('bd-1')).toBe('swimlanes')
    expect(readStoredView('bd-2')).toBe('backlog')
  })

  it('has no preference for a board never toggled', () => {
    expect(readStoredView('bd-unknown')).toBeNull()
  })

  it('ignores a stored value that is not a mode', () => {
    localStorage.setItem('td-gui.board-view.bd-1', 'kanban')
    expect(readStoredView('bd-1')).toBeNull()
  })
})
