import { useQuery } from '@tanstack/react-query'
import { apiGet, encodeId } from './client'
import type {
  IssueDetail, IssueListResponse, IssueStatus, IssueType, LabelsResponse, Priority,
} from './types'

export interface IssueListParams {
  status?: IssueStatus[]
  type?: IssueType[]
  priority?: Priority[]
  search?: string
  limit: number
}

/* td validates `limit` as 1-1000 and rejects anything larger, so this is the
   most one request can carry rather than a number we picked. Sorting and
   dependency resolution both need the whole result set, so both callers ask
   for it. */
export const FETCH_LIMIT = 1000

export const issueKeys = {
  all: ['issues'] as const,
  list: (params: IssueListParams) => ['issues', 'list', params] as const,
  detail: (id: string) => ['issues', 'detail', id] as const,
}

function toQueryString(params: IssueListParams): string {
  const q = new URLSearchParams()
  params.status?.forEach(v => q.append('status', v))
  params.type?.forEach(v => q.append('type', v))
  params.priority?.forEach(v => q.append('priority', v))
  if (params.search) q.set('search', params.search)
  q.set('limit', String(params.limit))
  return q.toString()
}

export function useIssues(params: IssueListParams) {
  return useQuery({
    queryKey: issueKeys.list(params),
    queryFn: () => apiGet<IssueListResponse>(`/v1/issues?${toQueryString(params)}`),
  })
}

export function useIssue(id: string) {
  return useQuery({
    queryKey: issueKeys.detail(id),
    // Review history always rides along: expanding it then needs no second
    // request, no extra loading state, and no second cache entry per issue.
    queryFn: () => apiGet<IssueDetail>(`/v1/issues/${encodeId(id)}?with=reviews`),
    enabled: id !== '',
  })
}

export const labelKeys = { all: ['labels'] as const }

/** Backs label autocomplete. Labels are not validated by td. */
export function useLabels() {
  return useQuery({
    queryKey: labelKeys.all,
    queryFn: () => apiGet<LabelsResponse>('/v1/labels'),
  })
}
