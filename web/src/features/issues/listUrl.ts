import { FETCH_LIMIT, type IssueListParams } from '../../api/queries'
import {
  DEFAULT_SORT,
  SORT_DIRECTIONS,
  SORT_KEYS,
  STATUS_ORDER,
  type Sort,
  type SortDirection,
  type SortKey,
} from './ordering'
import type { IssueStatus } from '../../api/types'

/**
 * The issue list's state, as a query string.
 *
 * Two pure functions rather than a hook, so the encoding is testable without
 * a router and `IssueList` stays as thin as it was when the same state lived
 * in `useState`.
 *
 * Defaults are written as absence: an unfiltered list is `/` with nothing
 * behind it, so the url only ever names decisions someone actually made.
 *
 * A url is user input — hand-edited, bookmarked before a rename, sent by
 * someone running a different td. Everything read here is checked against
 * what the app knows and dropped when it does not fit. This is not the
 * frontend second-guessing td's validation: these are the list's own view
 * parameters, and td never sees them.
 */

const isStatus = (value: string): value is IssueStatus =>
  (STATUS_ORDER as string[]).includes(value)

const isSortKey = (value: string): value is SortKey =>
  (SORT_KEYS as readonly string[]).includes(value)

const isDirection = (value: string): value is SortDirection =>
  (SORT_DIRECTIONS as readonly string[]).includes(value)

function readSort(value: string | null): Sort {
  const [key = '', direction = ''] = (value ?? '').split(':')
  if (!isSortKey(key) || !isDirection(direction)) return DEFAULT_SORT
  return { key, direction }
}

export function readListUrl(search: URLSearchParams): { params: IssueListParams; sort: Sort } {
  const params: IssueListParams = { limit: FETCH_LIMIT }

  // `q` is read with `get`, not truthiness: an empty TDQ is legal and matches
  // every issue, so `?q=` is query mode with an empty query, while an empty
  // `?search=` is no search at all. A url carrying both is one the app cannot
  // write — hand-made or stale — and the query is the more specific request.
  const query = search.get('q')
  if (query !== null) params.query = query
  else {
    const text = search.get('search')
    if (text) params.search = text
  }

  const status = search.getAll('status').filter(isStatus)
  if (status.length) params.status = status

  return { params, sort: readSort(search.get('sort')) }
}

/**
 * The url for a list state. `limit` stays out — it is `FETCH_LIMIT`, not a
 * setting — and so do `type` and `priority`, which no control sets today;
 * when one does, it belongs here beside the status chips.
 */
export function writeListUrl(params: IssueListParams, sort: Sort): URLSearchParams {
  const search = new URLSearchParams()

  if (params.query !== undefined) search.set('q', params.query)
  else if (params.search) search.set('search', params.search)

  params.status?.forEach(status => search.append('status', status))

  if (sort.key !== DEFAULT_SORT.key || sort.direction !== DEFAULT_SORT.direction) {
    search.set('sort', `${sort.key}:${sort.direction}`)
  }

  return search
}

/**
 * The way back from a detail view to the list it was opened from.
 *
 * The filter is carried as router history state rather than looked up
 * somewhere global: the link means "back to the list you came from", and only
 * the click that left the list knows which one that was. A detail view opened
 * from a bookmark, a board card or a dependency link carries nothing, and
 * there the link honestly means the whole list.
 */
export const listStateFor = (search: string) => (search ? { from: search } : undefined)

export function listPathFrom(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from
  // Nothing but a query string this app wrote is followed. History state is
  // same-origin, but it also survives a rename of these parameters and a
  // reload onto a version that spells them differently.
  if (typeof from !== 'string' || !from.startsWith('?')) return '/'
  return `/${from}`
}
