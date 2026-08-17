import { useQuery } from '@tanstack/react-query'
import { apiGet, encodeId } from './client'
import type { BoardListResponse, BoardResponse } from './types'

export const boardKeys = {
  all: ['boards'] as const,
  list: () => ['boards', 'list'] as const,
  detail: (id: string, includeClosed: boolean) =>
    ['boards', 'detail', id, includeClosed] as const,
}

export function useBoards() {
  return useQuery({
    queryKey: boardKeys.list(),
    queryFn: () => apiGet<BoardListResponse>('/v1/boards'),
  })
}

/**
 * Without `include_closed` td filters the board to open, in_progress, blocked
 * and in_review — so a closed card is genuinely absent, not merely hidden.
 *
 * includeClosed is part of the query key, so ticking the box lands on a key
 * with nothing cached and would otherwise put the whole view back into
 * isPending — unmounting the very checkbox the user just pressed. Holding the
 * previous answer keeps BoardView's chrome mounted across the refetch.
 *
 * Scoped to the same board on purpose: /boards/:id keeps BoardView mounted
 * when only the id changes, so an unscoped keepPreviousData would show one
 * board's name and cards under another board's url until the fetch landed.
 */
export function useBoard(id: string, includeClosed = false) {
  return useQuery({
    queryKey: boardKeys.detail(id, includeClosed),
    queryFn: () => apiGet<BoardResponse>(
      `/v1/boards/${encodeId(id)}${includeClosed ? '?include_closed=true' : ''}`,
    ),
    enabled: id !== '',
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === id ? previous : undefined,
  })
}
