import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiSend } from './client'
import { issueKeys } from './queries'
import type { IssueType, Priority, Transition } from './types'

/**
 * Transitions go through td's own endpoints (start, review, approve, …) rather
 * than a raw status PATCH, so the review policy and action log stay intact.
 */
export function useTransition(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ action, reason }: { action: Transition; reason?: string }) =>
      apiSend('POST', `/v1/issues/${id}/${action}`, reason ? { reason } : {}),
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
