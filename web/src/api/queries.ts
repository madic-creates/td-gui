import { useQuery } from '@tanstack/react-query'
import { apiGet } from './client'
import type {
  IssueDetail, IssueListResponse, IssueStatus, IssueType, Priority,
} from './types'

export interface IssueListParams {
  status?: IssueStatus[]
  type?: IssueType[]
  priority?: Priority[]
  search?: string
  limit: number
  offset: number
}

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
  q.set('offset', String(params.offset))
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
    queryFn: () => apiGet<IssueDetail>(`/v1/issues/${id}`),
    enabled: id !== '',
  })
}
