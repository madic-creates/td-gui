import { useQuery, type QueryClient } from '@tanstack/react-query'
import { ApiError, apiGet, encodeId } from './client'
import type {
  About, IssueDetail, IssueListResponse, IssueStatus, IssueType, LabelsResponse, MonitorResponse, Priority, Project,
  SessionsResponse,
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

/**
 * GET /gui/about — what this td-gui process is.
 *
 * Default staleness on purpose. `AppShell` mounts this once for the project
 * name in the header, and `AboutPage` mounts it again on navigation, which
 * refetches — so the one value in the payload that moves, `backend.owned`,
 * is re-read exactly when it is about to be on screen. Anything longer-lived
 * would need a second key to keep that honest.
 */
export function useAbout() {
  return useQuery({
    queryKey: ['about'] as const,
    queryFn: () => apiGet<About>('/gui/about'),
  })
}

export const projectKeys = { capabilities: ['project', 'capabilities'] as const }

/**
 * Whether td reports an optional feature in GET /v1/project: `board_move` for
 * the board move endpoint, `issue_revisions` for If-Match on issue writes.
 * One cache entry serves every capability, read once and then served from it.
 *
 * Read at the moment a write needs it, not by a hook on mount: only a write
 * branches on it, and a page that never writes has no reason to ask.
 *
 * `ensureQueryData` rather than `fetchQuery`: useLiveUpdates invalidates the
 * whole cache on every SSE event, and a capability list does not change
 * because an issue did. It changes with the td binary, and a td that is
 * swapped underneath a running td-gui is no harm either way: a td without
 * revisions ignores If-Match, and a td with them accepts a write without one.
 *
 * td before v0.66.0 has no /v1/project and answers 404. That is an answer,
 * "no capabilities", and is cached as one. Any other failure is not, and
 * reads as no capabilities for this call only, so the caller keeps its older
 * path. No retry: a write should not wait out three backoffs to learn it.
 */
export async function hasCapability(qc: QueryClient, name: string): Promise<boolean> {
  try {
    const capabilities = await qc.ensureQueryData({
      queryKey: projectKeys.capabilities,
      queryFn: async (): Promise<string[]> => {
        try {
          return (await apiGet<Project>('/v1/project')).capabilities ?? []
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) return []
          throw err
        }
      },
      retry: false,
    })
    return capabilities.includes(name)
  } catch {
    return false
  }
}

/**
 * GET /v1/project — td's own account of the project: its name and path, the
 * title bounds from its config, and the optional routes it serves.
 *
 * td before v0.66.0 has no such route, so every reader treats a missing
 * answer as "td did not say" and keeps what it did before. No retry: that 404
 * is an answer, not a hiccup. Default staleness otherwise, so a change to the
 * title bounds in td's config arrives with the next refresh event like
 * everything else.
 *
 * `enabled` lets a component that mounts long before it needs the answer — the
 * edit form, mounted with every detail view — ask only once it is open.
 *
 * A write that branches on a capability reads `projectCapabilitiesQuery`
 * instead, which turns the same 404 into "no optional routes" rather than an
 * error the write would have to handle.
 */
export function useProject({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['project'] as const,
    queryFn: () => apiGet<Project>('/v1/project'),
    retry: false,
    enabled,
  })
}

export const sessionKeys = { all: ['sessions'] as const }

/**
 * GET /v1/sessions: every session td has recorded for the project.
 *
 * td keeps them all, so this list grows for the life of a project (165 in
 * one measured project). The page shows the most recent twenty and offers
 * the rest; nothing is filtered server-side because td serve takes no
 * parameter for it.
 */
export function useSessions() {
  return useQuery({
    queryKey: sessionKeys.all,
    queryFn: () => apiGet<SessionsResponse>('/v1/sessions'),
  })
}

export const monitorKeys = { all: ['monitor'] as const }

/**
 * GET /v1/monitor: td's own snapshot for `td monitor`. The activity page
 * reads `monitor.activity` only: the most recent events, newest first, as
 * many as td chooses to send (50 in v0.66.0). td serve takes no parameter to
 * page or filter them, so there is no "load more".
 */
export function useMonitor() {
  return useQuery({
    queryKey: monitorKeys.all,
    queryFn: () => apiGet<MonitorResponse>('/v1/monitor'),
  })
}
