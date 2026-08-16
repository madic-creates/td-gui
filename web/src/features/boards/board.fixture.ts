import type { Board, BoardCard, Issue } from '../../api/types'
import { makeIssue } from '../issues/issue.fixture'

/** A complete, boring Board. Tests override only what they care about. */
export function makeBoard(over: Partial<Board> = {}): Board {
  return {
    id: 'bd-sprint1',
    name: 'Sprint 1',
    query: 'priority <= P1',
    is_builtin: false,
    view_mode: 'backlog',
    last_viewed_at: null,
    created_at: '2026-08-16T09:00:00Z',
    updated_at: '2026-08-16T09:00:00Z',
    ...over,
  }
}

/**
 * A card. `position` defaults to a plausible sort key rather than an index, so
 * a test that mistakes one for the other fails loudly.
 */
export function makeCard(
  issue: Partial<Issue> = {},
  over: Partial<Omit<BoardCard, 'issue'>> = {},
): BoardCard {
  return {
    issue: makeIssue(issue),
    board_id: 'bd-sprint1',
    position: 1000,
    has_position: true,
    ...over,
  }
}
