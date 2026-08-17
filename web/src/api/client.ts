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

// Neither the browser's fetch nor the Go proxy's reverse-proxy transport time
// out on their own — the server's WriteTimeout is deliberately 0 so an SSE
// stream can stay open indefinitely, and that same handler serves every /v1
// call. Without a bound here, a td serve that hangs (a lock, a stuck query)
// leaves a form's mutate/query pending forever with no error to show and no
// way out short of reloading the page.
const REQUEST_TIMEOUT_MS = 20_000

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // Resolve against the current origin. In the browser td-gui serves the SPA
  // and proxies /v1 from the same origin; under jsdom this turns the relative
  // path into the absolute URL Node's fetch requires.
  const url = new URL(path, window.location.origin).toString()

  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error(
        `${method} ${path} timed out after ${REQUEST_TIMEOUT_MS / 1000}s — td serve is not responding`,
      )
    }
    throw err
  }

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

export function apiSend<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  return request<T>(method, path, body)
}

/**
 * Encodes a value for use as a single path segment, e.g. an issue or board
 * id interpolated into a `/v1/...` path.
 *
 * react-router's useParams returns route segments already decoded, and an id
 * typed into a combobox (DependencyPanel's "depends on" entry) is raw user
 * input — neither is safe to splice into a template string unescaped. A
 * decoded `/` in either would change how many path segments the request
 * carries, hitting a different route than the one this call intends.
 */
export function encodeId(id: string): string {
  return encodeURIComponent(id)
}

/** Returns the server's message for a field, if the error carries one. */
export function fieldErrorFor(error: unknown, field: string): string | undefined {
  if (!(error instanceof ApiError)) return undefined
  return error.fields.find(f => f.field === field)?.message
}

/**
 * What a form's error panel still has to say, given the fields it already
 * renders a message against. `null` means everything has been said elsewhere.
 *
 * This is the single predicate for every form. It defaults to speaking, and
 * three cases depend on that default:
 *
 * - a non-ApiError — `fetch` rejects with a TypeError when the connection
 *   drops, and nothing catches it;
 * - an ApiError carrying no fields — td's JSON type errors are
 *   `validation_error` with no `details.fields`;
 * - field errors naming something the form does not bind, including anything
 *   td renames later.
 *
 * Earlier code guarded panels with `code !== 'validation_error'`, which
 * swallowed the first two silently. Per CLAUDE.md td's wording is
 * authoritative, so the rule is inverted here: show it unless it is already
 * on screen.
 *
 * `boundFields` must list the fields the caller renders a message for. An
 * omission is safe — the message merely appears twice. A stale entry is not:
 * it re-creates exactly the silence this replaces, so callers pin theirs with
 * a test that the field really renders at its input.
 */
export function unboundMessage(error: unknown, boundFields: string[] = []): string | null {
  if (!error) return null
  if (!(error instanceof ApiError)) return String(error)
  if (error.fields.length === 0) return error.message
  const unbound = error.fields.filter(f => !boundFields.includes(f.field))
  if (unbound.length === 0) return null
  return unbound.map(f => f.message).join(' — ')
}
