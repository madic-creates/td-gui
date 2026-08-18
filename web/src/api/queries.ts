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
  /**
   * A TDQ expression, run through /gui/query rather than /v1/issues.
   *
   * Mutually exclusive with `search` because one input produces one or the
   * other, never both. `undefined` is what says the list is not in query mode
   * — an empty string could not, since an empty TDQ is legal and matches
   * every issue.
   */
  query?: string
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

export interface QueryIdsResponse {
  ids: string[]
}

export const queryKeys = {
  ids: (query: string) => ['tdq', query] as const,
}

/**
 * Runs one ad-hoc TDQ expression and returns the ids it matched.
 *
 * Not a /v1 call. td serve v0.57.0 has no query route at all — it ignores an
 * unknown `q`/`query`/`tdq` parameter and returns the unfiltered list — so
 * td-gui runs `td query` itself and answers under its own /gui/ prefix. See
 * internal/tdquery.
 *
 * Ids, not issues: `td query -o json` is a lossy subset of the API's issue
 * shape (omitempty fields, "" where the API sends null, nanosecond
 * timestamps, no available_transitions). Joining ids against the index the
 * app already holds beats rebuilding those objects.
 */
export function useQueryIds(query: string | undefined) {
  return useQuery({
    queryKey: queryKeys.ids(query ?? ''),
    queryFn: () => apiGet<QueryIdsResponse>(`/gui/query?q=${encodeURIComponent(query ?? '')}`),
    enabled: query !== undefined,
  })
}
