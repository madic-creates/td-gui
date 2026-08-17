import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiSend, encodeId } from './client'
import { issueKeys } from './queries'
import { boardKeys } from './boards'
import type {
  BoardCreateResponse, IssueCreateResponse, IssueType, IssuePatch, Priority, Transition,
} from './types'

/**
 * What every mutation that touches issue data invalidates.
 *
 * The rule, for the next mutation added here: a board is a projection of
 * issues — its cards ARE issues and its membership is a query over them — so
 * anything that changes an issue's fields, or which issues match a query,
 * leaves the board cache stale too. Invalidating only issueKeys leaves the
 * repair to useLiveUpdates' blanket invalidation on td's SSE refresh, and that
 * stream is not guaranteed; AppShell renders a "disconnected" banner precisely
 * because it can drop.
 *
 * Comment mutations are the exception and scope to issueKeys.detail: no board
 * card renders a comment. Board mutations are the mirror image and invalidate
 * boardKeys alone — none of them changes an issue.
 */
function invalidateIssueData(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: issueKeys.all }),
    qc.invalidateQueries({ queryKey: boardKeys.all }),
  ])
}

/**
 * Review attribution, as td models it: `reviewed_by` names who actually
 * reviewed when that is not the calling session, `self_review` acknowledges
 * reviewing your own work. td rejects the two together with a 400, so the two
 * fields are never both set.
 */
export interface Attribution {
  reason?: string
  reviewed_by?: string
  self_review?: true
}

export interface TransitionInput extends Attribution {
  action: Transition
}

/**
 * Transitions go through td's own endpoints (start, review, approve, …) rather
 * than a raw status PATCH, so the review policy and action log stay intact.
 */
export function useTransition(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ action, ...body }: TransitionInput) =>
      apiSend('POST', `/v1/issues/${encodeId(id)}/${action}`, body),
    onSuccess: () => invalidateIssueData(qc),
  })
}

/**
 * Records an approval without closing the issue, so a reviewer can attest and
 * let someone else close. td names the note `summary` here (not `reason`) and
 * requires it.
 */
export function useRecordReview(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ summary, ...rest }: Omit<Attribution, 'reason'> & { summary: string }) =>
      apiSend('POST', `/v1/issues/${encodeId(id)}/reviews`, {
        decision: 'approved',
        summary,
        ...rest,
      }),
    onSuccess: () => invalidateIssueData(qc),
  })
}

/** The request field is `text`, not `body`. */
export function useAddComment(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ text }: { text: string }) =>
      apiSend('POST', `/v1/issues/${encodeId(id)}/comments`, { text }),
    onSuccess: () => qc.invalidateQueries({ queryKey: issueKeys.detail(id) }),
  })
}

export interface IssueInput {
  title: string
  description?: string
  type?: IssueType
  priority?: Priority
}

export function useCreateIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: IssueInput) => apiSend<IssueCreateResponse>('POST', '/v1/issues', input),
    onSuccess: () => invalidateIssueData(qc),
  })
}

/**
 * A partial update. The body carries only edited fields — see issueDiff.ts for
 * how clearing is encoded, which is not what the field types suggest.
 */
export function useUpdateIssue(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: IssuePatch) => apiSend('PATCH', `/v1/issues/${encodeId(id)}`, patch),
    onSuccess: () => invalidateIssueData(qc),
  })
}

/** A soft delete: the issue leaves the list but a direct GET still returns it. */
export function useDeleteIssue(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiSend('DELETE', `/v1/issues/${encodeId(id)}`),
    onSuccess: () => invalidateIssueData(qc),
  })
}

export function useDeleteComment(issueId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (commentId: string) =>
      apiSend('DELETE', `/v1/issues/${encodeId(issueId)}/comments/${encodeId(commentId)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: issueKeys.detail(issueId) }),
  })
}

/**
 * Dependency errors carry a message and no details.fields — "cannot add
 * dependency: would create circular dependency", "issue not found: td-zzzzzz".
 * Callers must show the message, not bind it to a field.
 */
export function useAddDependency(issueId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dependsOn: string) =>
      apiSend('POST', `/v1/issues/${encodeId(issueId)}/dependencies`, { depends_on: dependsOn }),
    onSuccess: () => invalidateIssueData(qc),
  })
}

export function useRemoveDependency(issueId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (depId: string) =>
      apiSend('DELETE', `/v1/issues/${encodeId(issueId)}/dependencies/${encodeId(depId)}`),
    onSuccess: () => invalidateIssueData(qc),
  })
}

/**
 * td exposes no GET for focus — /v1/focus answers 405 — so this sets and never
 * reads. The UI can acknowledge the request but must not claim to know which
 * issue is currently focused.
 */
export function useSetFocus() {
  return useMutation({
    mutationFn: (issueId: string | null) => apiSend('PUT', '/v1/focus', { issue_id: issueId }),
  })
}

export interface BoardInput {
  name: string
  query: string
}

export function useCreateBoard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BoardInput) =>
      apiSend<BoardCreateResponse>('POST', '/v1/boards', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: boardKeys.all }),
  })
}

/** td answers 403 `cannot modify builtin board` for is_builtin boards. */
export function useUpdateBoard(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BoardInput) =>
      apiSend<BoardCreateResponse>('PATCH', `/v1/boards/${encodeId(id)}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: boardKeys.all }),
  })
}

export function useDeleteBoard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiSend('DELETE', `/v1/boards/${encodeId(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: boardKeys.all }),
  })
}

/**
 * Pins a card at a slot.
 *
 * `slot` is td's 1-based insert position among the cards that ALREADY have a
 * position — not the index of a rendered row, and not the `position` read back
 * from the board, which is a sparse sort key. features/boards/position.ts owns
 * that conversion.
 */
export function useSetCardPosition(boardId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ issueId, slot }: { issueId: string; slot: number }) =>
      apiSend('POST', `/v1/boards/${encodeId(boardId)}/issues`, {
        issue_id: issueId,
        position: slot,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: boardKeys.all }),
  })
}

/** Unpins a card: it falls back below every positioned card, in query order. */
export function useClearCardPosition(boardId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (issueId: string) =>
      apiSend('DELETE', `/v1/boards/${encodeId(boardId)}/issues/${encodeId(issueId)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: boardKeys.all }),
  })
}
