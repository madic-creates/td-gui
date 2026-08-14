import type { ApiErrorCode, FieldError } from './types'

/** A td API error, carrying the server's own code, message and field errors. */
export class ApiError extends Error {
  // Declared as plain fields rather than constructor parameter properties,
  // which tsconfig's erasableSyntaxOnly forbids.
  readonly code: ApiErrorCode
  readonly status: number
  readonly fields: FieldError[]

  constructor(
    code: ApiErrorCode,
    message: string,
    status: number,
    fields: FieldError[] = [],
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.fields = fields
  }
}

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: { code: ApiErrorCode; message: string; details?: { fields?: FieldError[] } }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // Resolve against the current origin. In the browser td-gui serves the SPA
  // and proxies /v1 from the same origin; under jsdom this turns the relative
  // path into the absolute URL Node's fetch requires.
  const url = new URL(path, window.location.origin).toString()

  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  let envelope: Envelope<T> | null = null
  try {
    envelope = await res.json() as Envelope<T>
  } catch {
    // Not our envelope — a proxy error page or a dead backend.
  }

  if (!res.ok || !envelope?.ok) {
    // The server's message is authoritative. td phrases review-policy
    // rejections precisely; replacing them with a generic string would make
    // the GUI strictly worse than the CLI.
    const err = envelope?.error
    throw new ApiError(
      err?.code ?? 'internal',
      err?.message ?? `HTTP ${res.status}`,
      res.status,
      err?.details?.fields ?? [],
    )
  }

  return envelope.data as T
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>('GET', path)
}

export function apiSend<T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  return request<T>(method, path, body)
}
