import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiSend } from './client'
import { issueKeys } from './queries'
import type { IssueType, Priority, Transition } from './types'

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
      apiSend('POST', `/v1/issues/${id}/${action}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: issueKeys.all }),
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
      apiSend('POST', `/v1/issues/${id}/reviews`, {
        decision: 'approved',
        summary,
        ...rest,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: issueKeys.all }),
  })
}

/** The request field is `text`, not `body`. */
export function useAddComment(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ text }: { text: string }) =>
      apiSend('POST', `/v1/issues/${id}/comments`, { text }),
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
    mutationFn: (input: IssueInput) => apiSend('POST', '/v1/issues', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: issueKeys.all }),
  })
}

export function useUpdateIssue(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Partial<IssueInput>) => apiSend('PATCH', `/v1/issues/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: issueKeys.all }),
  })
}
