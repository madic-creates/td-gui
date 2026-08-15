import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { ApiError, apiGet, apiSend, unboundMessage } from './client'
import type { IssueListResponse } from './types'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('apiGet', () => {
  it('unwraps the success envelope', async () => {
    server.use(http.get('/v1/issues', () =>
      HttpResponse.json({
        ok: true,
        data: { issues: [], limit: 50, offset: 0, total: 0, has_more: false },
      })))

    const data = await apiGet<IssueListResponse>('/v1/issues')
    expect(data.total).toBe(0)
    expect(data.issues).toEqual([])
  })

  it('maps validation errors to field errors', async () => {
    server.use(http.post('/v1/issues', () =>
      HttpResponse.json({
        ok: false,
        error: {
          code: 'validation_error',
          message: 'Validation failed',
          details: {
            fields: [{
              field: 'title', rule: 'min_length', value: 'ab', expected: 15,
              message: 'title too short (2 chars, min 15)',
            }],
          },
        },
      }, { status: 400 })))

    const err = await apiSend('POST', '/v1/issues', { title: 'ab' }).catch((e: unknown) => e) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('validation_error')
    expect(err.fields).toHaveLength(1)
    expect(err.fields[0].field).toBe('title')
    expect(err.fields[0].message).toBe('title too short (2 chars, min 15)')
  })

  it("preserves td's policy rejection message verbatim on 403", async () => {
    const rejection = 'you implemented this issue, so you cannot approve it'
    server.use(http.post('/v1/issues/td-1/approve', () =>
      HttpResponse.json({
        ok: false,
        error: { code: 'forbidden', message: rejection },
      }, { status: 403 })))

    const err = await apiSend('POST', '/v1/issues/td-1/approve', {}).catch((e: unknown) => e) as ApiError
    expect(err.code).toBe('forbidden')
    expect(err.message).toBe(rejection)
  })

  it('reports not_found with the server message', async () => {
    server.use(http.get('/v1/issues/td-nope', () =>
      HttpResponse.json({
        ok: false,
        error: { code: 'not_found', message: 'issue not found: td-nope' },
      }, { status: 404 })))

    const err = await apiGet('/v1/issues/td-nope').catch((e: unknown) => e) as ApiError
    expect(err.code).toBe('not_found')
    expect(err.status).toBe(404)
  })

  it('falls back to a generic error when the body is not our envelope', async () => {
    server.use(http.get('/v1/issues', () =>
      new HttpResponse('502 Bad Gateway', { status: 502 })))

    const err = await apiGet('/v1/issues').catch((e: unknown) => e) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('internal')
    expect(err.status).toBe(502)
  })
})

/**
 * The one predicate every form uses to decide what its panel still has to say.
 * The default is to speak: silence is earned only by a message already
 * rendered against its own input.
 */
describe('unboundMessage', () => {
  const withFields = (...fields: string[]) =>
    new ApiError(
      'validation_error',
      'Validation failed',
      400,
      fields.map(field => ({
        field, rule: 'required', value: '', expected: '',
        message: `${field} is required`,
      })),
    )

  it('says nothing when there is no error', () => {
    expect(unboundMessage(null, ['title'])).toBeNull()
    expect(unboundMessage(undefined, ['title'])).toBeNull()
  })

  // fetch rejects with a TypeError when the connection drops, and nothing
  // catches it. The old `error instanceof ApiError &&` guards rendered nothing
  // at all for this — the user saw a dead form.
  it('reports a non-ApiError through String()', () => {
    expect(unboundMessage(new TypeError('Failed to fetch'), [])).toBe('TypeError: Failed to fetch')
  })

  // td's JSON type errors are validation_error with no details.fields. The old
  // `code !== 'validation_error'` guard swallowed them completely.
  it("reports a validation error that names no field", () => {
    const error = new ApiError('validation_error', 'json: cannot unmarshal string into field points of type int', 400)
    expect(unboundMessage(error, ['title'])).toBe(
      'json: cannot unmarshal string into field points of type int')
  })

  it('stays silent when every field error is already shown at its input', () => {
    expect(unboundMessage(withFields('title', 'description'), ['title', 'description'])).toBeNull()
  })

  // The dangerous direction: a field td names that this form does not bind
  // would otherwise render nowhere.
  it('reports the field errors no input claims', () => {
    expect(unboundMessage(withFields('title', 'minor'), ['title'])).toBe('minor is required')
  })

  it('joins several unclaimed field errors', () => {
    expect(unboundMessage(withFields('minor', 'sprint'), [])).toBe(
      'minor is required — sprint is required')
  })

  // A form that binds nothing passes no list; every field error is unclaimed.
  it('treats an omitted list as binding nothing', () => {
    expect(unboundMessage(withFields('text'))).toBe('text is required')
  })

  it("keeps td's policy rejection verbatim", () => {
    const rejection = 'you implemented this issue, so you cannot approve it'
    expect(unboundMessage(new ApiError('forbidden', rejection, 403))).toBe(rejection)
  })
})
