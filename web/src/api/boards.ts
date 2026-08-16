import { useQuery } from '@tanstack/react-query'
import { apiGet } from './client'
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
 */
export function useBoard(id: string, includeClosed = false) {
  return useQuery({
    queryKey: boardKeys.detail(id, includeClosed),
    queryFn: () => apiGet<BoardResponse>(
      `/v1/boards/${id}${includeClosed ? '?include_closed=true' : ''}`,
    ),
    enabled: id !== '',
  })
}
