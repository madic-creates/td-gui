import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiSend, encodeId, isConflict } from './client'
import { hasCapability, issueKeys } from './queries'
import { boardKeys } from './boards'
import type {
  BoardCreateResponse, Issue, IssueCreateResponse, IssueStatus, IssueType, IssuePatch, Priority,
  Transition,
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
 * The If-Match header for a write to an issue, or none.
 *
 * `revision` is the issue as the user last saw it, which is the caller's to
 * know: a form that has been open for a while holds an older one than the
 * cache. td compares it and answers 409 `conflict` if the issue changed since,
 * so a write never silently overwrites one it did not see. Sent only when td
 * reports `issue_revisions`, and only when the caller has a revision to send.
 */
async function ifMatch(qc: QueryClient, revision: string | undefined) {
  if (!revision || !(await hasCapability(qc, 'issue_revisions'))) return undefined
  return { 'If-Match': `"${revision}"` }
}

/**
 * What a write to an issue does when td refuses it as a conflict: the issue
 * changed under the user, so what is on screen is stale and is refetched.
 * The error itself still reaches the caller, td's sentence included — the
 * GUI renders the conflict, td is the one that detected it.
 */
function refetchOnConflict(qc: QueryClient) {
  return (error: unknown) => {
    if (isConflict(error)) void invalidateIssueData(qc)
  }
}

/** A write's variables: what it sends, plus the revision it was based on. */
export interface Revisioned {
  revision?: string
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

export interface TransitionInput extends Attribution, Revisioned {
  action: Transition
}

/** td answers a write to an issue with the issue as it now is. */
export interface IssueWriteResponse {
  issue: Issue
}

/**
 * Transitions go through td's own endpoints (start, review, approve, …) rather
 * than a raw status PATCH, so the review policy and action log stay intact.
 */
export function useTransition(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ action, revision, ...body }: TransitionInput) =>
      apiSend<IssueWriteResponse>(
        'POST', `/v1/issues/${encodeId(id)}/${action}`, body, await ifMatch(qc, revision)),
    onSuccess: () => invalidateIssueData(qc),
    onError: refetchOnConflict(qc),
  })
}

/**
 * Sets a status td serve has no route for.
 *
 * Not a raw status PATCH — there is no such thing: PATCH /v1/issues/{id}
 * answers ok and silently ignores a status field, and POST .../unstart is a
 * 404. /gui/status is td-gui's own route, which runs td's CLI, and it is used
 * only for the three jumps td's transitions cannot express. Everything td
 * reports in available_transitions still goes through useTransition.
 *
 * No revision: the CLI takes no If-Match, so this one write is unconditional.
 */
export function useSetStatus(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ status }: { status: IssueStatus }) =>
      apiSend('POST', '/gui/status', { id, status }),
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
    mutationFn: async (
      { summary, revision, ...rest }: Omit<Attribution, 'reason'> & Revisioned & { summary: string },
    ) =>
      apiSend('POST', `/v1/issues/${encodeId(id)}/reviews`, {
        decision: 'approved',
        summary,
        ...rest,
      }, await ifMatch(qc, revision)),
    onSuccess: () => invalidateIssueData(qc),
    onError: refetchOnConflict(qc),
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

/**
 * A create body. Only `title` is required; every other field is omitted when
 * the form left it empty, so td applies its own defaults rather than storing
 * a blank — see issueCreate.ts. `depends_on` and `blocks` are deliberately
 * absent: td's CLI takes them at create time but this endpoint ignores them,
 * and dependencies are added from the detail view instead.
 */
export interface IssueInput {
  title: string
  description?: string
  acceptance?: string
  type?: IssueType
  priority?: Priority
  points?: number
  sprint?: string
  labels?: string[]
  parent_id?: string
  due_date?: string
  defer_until?: string
  minor?: boolean
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
    mutationFn: async ({ patch, revision }: Revisioned & { patch: IssuePatch }) =>
      apiSend<IssueWriteResponse>(
        'PATCH', `/v1/issues/${encodeId(id)}`, patch, await ifMatch(qc, revision)),
    onSuccess: () => invalidateIssueData(qc),
    onError: refetchOnConflict(qc),
  })
}

/**
 * A soft delete: the issue leaves the list but a direct GET still returns it.
 * The variable is the revision the user decided to delete.
 */
export function useDeleteIssue(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (revision: string | undefined) =>
      apiSend('DELETE', `/v1/issues/${encodeId(id)}`, undefined, await ifMatch(qc, revision)),
    onSuccess: () => invalidateIssueData(qc),
    onError: refetchOnConflict(qc),
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

export interface CardMove {
  issueId: string
  /** The card to land before, `''` for the end of the board. */
  beforeId: string
}

/**
 * Moves a card on a board.
 *
 * td takes the move as "before this card" through POST /v1/boards/{id}/move,
 * resolved against the same list GET /v1/boards/{id} returned, hence
 * `includeClosed`. Which card that is comes from features/boards/position.ts.
 *
 * A 409 means the card, or the one it should land before, has left the board
 * since it was drawn. The board is refetched so the next attempt is made
 * against what td has, and td's message is left on the error to be shown.
 */
export function useMoveCard(boardId: string, includeClosed: boolean) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ issueId, beforeId }: CardMove) =>
      apiSend('POST', `/v1/boards/${encodeId(boardId)}/move`, {
        issue_id: issueId,
        before_id: beforeId,
        include_closed: includeClosed,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: boardKeys.all }),
    onError: error => {
      if (isConflict(error)) {
        return qc.invalidateQueries({ queryKey: boardKeys.all })
      }
    },
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
