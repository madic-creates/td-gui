import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { ApiError, apiGet, apiSend } from './client'
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
