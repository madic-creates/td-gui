import { describe, expect, it } from 'vitest'
import { listPathFrom, listStateFor, readListUrl, writeListUrl } from './listUrl'
import { FETCH_LIMIT } from '../../api/queries'
import { DEFAULT_SORT } from './ordering'

const read = (search: string) => readListUrl(new URLSearchParams(search))
const write = (...args: Parameters<typeof writeListUrl>) => writeListUrl(...args).toString()

describe('readListUrl', () => {
  it('reads an empty query string as the unfiltered list', () => {
    const { params, sort } = read('')
    expect(params).toEqual({ limit: FETCH_LIMIT })
    expect(sort).toEqual(DEFAULT_SORT)
  })

  it('reads a full-text search', () => {
    expect(read('search=oauth').params.search).toBe('oauth')
  })

  it('reads a TDQ query', () => {
    expect(read('q=type+%3D+bug').params.query).toBe('type = bug')
  })

  it('collects a repeated status parameter into the filter', () => {
    expect(read('status=open&status=in_progress').params.status).toEqual(['open', 'in_progress'])
  })

  it('drops a status td does not have rather than forwarding it', () => {
    expect(read('status=open&status=nonsense').params.status).toEqual(['open'])
  })

  it('leaves the status filter unset when the url names none it knows', () => {
    expect(read('status=nonsense').params.status).toBeUndefined()
  })

  it('reads the sort key and direction', () => {
    expect(read('sort=updated:desc').sort).toEqual({ key: 'updated', direction: 'desc' })
  })

  it('falls back to the default sort when the url names one it cannot read', () => {
    expect(read('sort=sideways:desc').sort).toEqual(DEFAULT_SORT)
    expect(read('sort=updated:sideways').sort).toEqual(DEFAULT_SORT)
    expect(read('sort=updated').sort).toEqual(DEFAULT_SORT)
  })

  it('lets the query win over a search the app could never have written beside it', () => {
    const { params } = read('q=type+%3D+bug&search=oauth')
    expect(params.query).toBe('type = bug')
    expect(params.search).toBeUndefined()
  })

  it('reads an empty query as query mode, since an empty TDQ matches everything', () => {
    expect(read('q=').params.query).toBe('')
  })

  it('reads an empty search as no search at all', () => {
    expect(read('search=').params.search).toBeUndefined()
  })
})

describe('writeListUrl', () => {
  it('writes nothing for the unfiltered list, so it stays at /', () => {
    expect(write({ limit: FETCH_LIMIT }, DEFAULT_SORT)).toBe('')
  })

  it('keeps the fetch limit out of the url', () => {
    expect(write({ limit: FETCH_LIMIT, search: 'oauth' }, DEFAULT_SORT)).toBe('search=oauth')
  })

  it('writes one status parameter per chip', () => {
    expect(write({ limit: FETCH_LIMIT, status: ['open', 'blocked'] }, DEFAULT_SORT))
      .toBe('status=open&status=blocked')
  })

  it('writes the sort only once it differs from the default', () => {
    expect(write({ limit: FETCH_LIMIT }, { key: 'updated', direction: 'desc' }))
      .toBe('sort=updated%3Adesc')
  })

  it('writes the query without the box prefix', () => {
    expect(write({ limit: FETCH_LIMIT, query: 'type = bug' }, DEFAULT_SORT))
      .toBe('q=type+%3D+bug')
  })

  it('writes an empty query, which is a query and not an absent one', () => {
    expect(write({ limit: FETCH_LIMIT, query: '' }, DEFAULT_SORT)).toBe('q=')
  })
})

describe('the two together', () => {
  it('round trips a fully specified list', () => {
    const params = { limit: FETCH_LIMIT, query: 'type = bug AND priority <= P1', status: ['open' as const] }
    const sort = { key: 'title' as const, direction: 'desc' as const }
    expect(readListUrl(writeListUrl(params, sort))).toEqual({ params, sort })
  })

  it('round trips a full-text search', () => {
    const params = { limit: FETCH_LIMIT, search: 'oauth' }
    expect(readListUrl(writeListUrl(params, DEFAULT_SORT))).toEqual({ params, sort: DEFAULT_SORT })
  })
})

describe('carrying the list into a detail view', () => {
  it('hands the filtered list on as router state', () => {
    expect(listStateFor('?status=open')).toEqual({ from: '?status=open' })
  })

  it('hands on nothing when there is no filter to carry', () => {
    expect(listStateFor('')).toBeUndefined()
  })

  it('reads the way back out of the state', () => {
    expect(listPathFrom({ from: '?status=open&sort=updated%3Adesc' }))
      .toBe('/?status=open&sort=updated%3Adesc')
  })

  it('falls back to the whole list for state it did not write', () => {
    expect(listPathFrom(null)).toBe('/')
    expect(listPathFrom({})).toBe('/')
    expect(listPathFrom({ from: 42 })).toBe('/')
    // Not a query string, so not something this app put there.
    expect(listPathFrom({ from: 'https://example.com' })).toBe('/')
  })
})
