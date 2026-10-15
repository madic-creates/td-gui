# Activity Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `/activity` page to td-gui that shows td's recent activity feed and the project's agent sessions.

**Architecture:** Frontend only. Two TanStack Query hooks read td's own `GET /v1/monitor` and `GET /v1/sessions` through the existing `/v1/` proxy; three components in `web/src/features/activity/` render them; the existing SSE hook already invalidates every query on change, so live updates need no new code. A contract test pins the two response shapes against a real td.

**Tech Stack:** React 19, react-router, TanStack Query, Tailwind 4, TypeScript, Vitest, Testing Library, msw; Go standard library for the contract test.

**Spec:** `docs/superpowers/specs/2026-10-15-activity-page-design.md`

td issue: td-8939b4

## Global Constraints

- English only: UI strings, code, comments, commit messages, docs.
- td's text is shown verbatim: event `message`, `log_type` and error messages are never reworded.
- No Go server changes, no new `/gui/` route. Both endpoints are td's and already proxied.
- An event links to its issue only when td sent a non-empty `issue_title`. Never infer issue-ness from an id pattern.
- Session label order: `name`, else `agent_type`, else `shortSession(id)`.
- Sessions list shows the first **20**, then a "Show all (N)" button; that state is component state, not persisted, not in the URL.
- No width cap on the page; the view owns its padding (see the comment in `web/src/components/AppShell.tsx`).
- Commits: Conventional Commits with a package scope, e.g. `feat(web):`, `test:`, `docs:`.
- Frontend commands run from `web/`; use `npm test -- --run <filter>`, never bare `npm test`.

## Review Focus

1. **Unparseable or mixed-offset `last_activity`:** sessions still sort newest first by instant, not by string, and an unparseable timestamp sorts last instead of scrambling the list. Pinned in Task 2.
2. **Equal `last_activity`:** order is total (id tiebreak), so an SSE refetch never reshuffles cards under the reader. Pinned in Task 2.
3. **Event with an empty `session_id`:** the byline reads "unknown session" instead of rendering blank. Pinned in Task 1 and Task 3.
4. **Long or multi-line log messages** (decision logs often are): wrap inside the column instead of overflowing it. Pinned in Task 3 by a class assertion.
5. **One query failing:** a failing `/v1/sessions` leaves the feed rendered with short ids, and a failing `/v1/monitor` leaves the session list rendered. Pinned in Task 4.

---

## File Structure

| File | Responsibility |
| ---- | -------------- |
| `web/src/api/types.ts` (modify) | `Session`, `SessionsResponse`, `ActivityItem`, `MonitorResponse` |
| `web/src/api/queries.ts` (modify) | `useSessions()`, `useMonitor()` |
| `web/src/features/activity/sessions.ts` (create) | `sessionLabel`, `labelFor`, `byRecentActivity`: naming and ordering, pure |
| `web/src/features/activity/activity.fixture.ts` (create) | `makeSession`, `makeActivity` test builders |
| `web/src/features/activity/SessionList.tsx` (create) | Right column |
| `web/src/features/activity/ActivityFeed.tsx` (create) | Left column |
| `web/src/features/activity/ActivityPage.tsx` (create) | Heading and two-column layout |
| `web/src/App.tsx` (modify) | Route `/activity` |
| `web/src/components/AppShell.tsx` (modify) | Header link "Activity" |
| `test/contract/contract_test.go` (modify) | `TestActivityContract` |
| `docs/activity.md` (create), `docs/README.md`, `README.md` (modify) | User docs |

---

### Task 1: Types, session naming and ordering

**Files:**
- Modify: `web/src/api/types.ts` (append at the end)
- Create: `web/src/features/activity/sessions.ts`
- Create: `web/src/features/activity/activity.fixture.ts`
- Test: `web/src/features/activity/sessions.test.ts`

**Interfaces:**
- Consumes: `shortSession(id: string): string` from `web/src/lib/format.ts`.
- Produces:
  - types `Session`, `SessionsResponse`, `ActivityItem`, `MonitorResponse`
  - `sessionLabel(session: Session): string`
  - `labelFor(sessions: Session[] | undefined, id: string): string`
  - `byRecentActivity(a: Session, b: Session): number`
  - `makeSession(over?: Partial<Session>): Session`, `makeActivity(over?: Partial<ActivityItem>): ActivityItem`

- [ ] **Step 1: Add the types**

Append to `web/src/api/types.ts`:

```ts
/**
 * One td session, as `GET /v1/sessions` lists it. Only the fields the
 * activity page reads; td sends more (agent_pid, context_id, started_at).
 */
export interface Session {
  id: string
  /** Often empty. td only fills it when a session was named. */
  name: string
  /** e.g. `claude-code_411842`, `web`, or td's literal `unknown`. */
  agent_type: string
  branch: string
  last_activity: string
}

export interface SessionsResponse {
  current_session_id: string
  sessions: Session[]
}

/**
 * One entry of td's activity feed (`monitor.activity`).
 *
 * `issue_id` is not always an issue id: for `create` it is a log id, for
 * `handoff` a handoff id, for `link_file` a file-link id. td fills
 * `issue_title` exactly when the id is an issue, so that field, not the id's
 * shape, decides whether the entry links anywhere.
 */
export interface ActivityItem {
  timestamp: string
  session_id: string
  /** `action`, `log` or `comment`. */
  type: string
  action: string
  /** `progress`, `decision`, `blocker`, …; empty for non-log entries. */
  log_type: string
  message: string
  issue_id: string
  issue_title: string
}

export interface MonitorResponse {
  monitor: { activity: ActivityItem[] }
}
```

- [ ] **Step 2: Add the fixture builders**

Create `web/src/features/activity/activity.fixture.ts`:

```ts
import type { ActivityItem, Session } from '../../api/types'

export function makeSession(over: Partial<Session> = {}): Session {
  return {
    id: 'ses_aaaaaa',
    name: '',
    agent_type: 'claude-code_1',
    branch: 'main',
    last_activity: '2026-10-15T12:00:00Z',
    ...over,
  }
}

export function makeActivity(over: Partial<ActivityItem> = {}): ActivityItem {
  return {
    timestamp: '2026-10-15T12:00:00Z',
    session_id: 'ses_aaaaaa',
    type: 'action',
    action: 'start',
    log_type: '',
    message: 'started work',
    issue_id: 'td-000001',
    issue_title: 'An issue title',
    ...over,
  }
}
```

- [ ] **Step 3: Write the failing tests**

Create `web/src/features/activity/sessions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { byRecentActivity, labelFor, sessionLabel } from './sessions'
import { makeSession } from './activity.fixture'

describe('sessionLabel', () => {
  it('prefers the name td recorded', () => {
    expect(sessionLabel(makeSession({ name: 'planner', agent_type: 'claude-code_1' }))).toBe('planner')
  })

  it('falls back to the agent type', () => {
    expect(sessionLabel(makeSession({ name: '', agent_type: 'claude-code_1' }))).toBe('claude-code_1')
  })

  it('falls back to the short session id', () => {
    expect(sessionLabel(makeSession({ id: 'ses_d87edf', name: '', agent_type: '' }))).toBe('d87e')
  })
})

describe('labelFor', () => {
  const sessions = [makeSession({ id: 'ses_111111', name: 'planner' })]

  it('labels a session it can find', () => {
    expect(labelFor(sessions, 'ses_111111')).toBe('planner')
  })

  it('shows the short id for a session it cannot find', () => {
    expect(labelFor(sessions, 'ses_d87edf')).toBe('d87e')
    expect(labelFor(undefined, 'ses_d87edf')).toBe('d87e')
  })

  it('says so when the event carries no session at all', () => {
    expect(labelFor(sessions, '')).toBe('unknown session')
  })
})

describe('byRecentActivity', () => {
  const order = (...sessions: ReturnType<typeof makeSession>[]) =>
    [...sessions].sort(byRecentActivity).map(s => s.id)

  it('puts the most recently active session first, comparing instants', () => {
    // 12:30+02:00 is 10:30Z, earlier than 11:00Z, although its string sorts later.
    expect(order(
      makeSession({ id: 'ses_a', last_activity: '2026-10-15T12:30:00+02:00' }),
      makeSession({ id: 'ses_b', last_activity: '2026-10-15T11:00:00Z' }),
    )).toEqual(['ses_b', 'ses_a'])
  })

  it('sorts an unparseable timestamp last', () => {
    expect(order(
      makeSession({ id: 'ses_a', last_activity: 'garbage' }),
      makeSession({ id: 'ses_b', last_activity: '2026-01-01T00:00:00Z' }),
    )).toEqual(['ses_b', 'ses_a'])
  })

  it('breaks ties by id so a refetch never reshuffles equal rows', () => {
    const at = '2026-10-15T12:00:00Z'
    expect(order(
      makeSession({ id: 'ses_c', last_activity: at }),
      makeSession({ id: 'ses_a', last_activity: at }),
      makeSession({ id: 'ses_b', last_activity: 'garbage' }),
      makeSession({ id: 'ses_0', last_activity: 'garbage' }),
    )).toEqual(['ses_a', 'ses_c', 'ses_0', 'ses_b'])
  })
})
```

- [ ] **Step 4: Run them and watch them fail**

Run: `cd web && npm test -- --run src/features/activity/sessions`
Expected: FAIL, `Failed to resolve import "./sessions"`.

- [ ] **Step 5: Implement**

Create `web/src/features/activity/sessions.ts`:

```ts
import { shortSession } from '../../lib/format'
import type { Session } from '../../api/types'

/** What a session is called on the page: td's name, its agent, or its id. */
export function sessionLabel(session: Session): string {
  return session.name || session.agent_type || shortSession(session.id)
}

/**
 * The byline for a feed entry. A session missing from the list (still
 * loading, failed, or not listed by td) falls back to its short id, so the
 * feed never waits on or breaks with the sessions request.
 */
export function labelFor(sessions: Session[] | undefined, id: string): string {
  if (id === '') return 'unknown session'
  const session = sessions?.find(s => s.id === id)
  return session ? sessionLabel(session) : shortSession(id)
}

/** Unparseable sorts last; NaN would otherwise make the sort order arbitrary. */
function instant(iso: string): number {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? -Infinity : t
}

/**
 * Newest first, by instant rather than by string: td writes local offsets
 * (`+02:00`), and those do not sort lexically. Two unparseable values
 * subtract to NaN, which is falsy, so they fall through to the id like equal
 * ones do. The tiebreak makes the order total.
 */
export function byRecentActivity(a: Session, b: Session): number {
  return instant(b.last_activity) - instant(a.last_activity) || a.id.localeCompare(b.id)
}
```

- [ ] **Step 6: Run them and watch them pass**

Run: `cd web && npm test -- --run src/features/activity/sessions`
Expected: PASS, 9 tests.

- [ ] **Step 7: Commit**

```bash
git add web/src/api/types.ts web/src/features/activity/sessions.ts web/src/features/activity/sessions.test.ts web/src/features/activity/activity.fixture.ts
git commit -m "feat(web): name and order td sessions for the activity page"
```

---

### Task 2: Session list

**Files:**
- Modify: `web/src/api/queries.ts`
- Create: `web/src/features/activity/SessionList.tsx`
- Test: `web/src/features/activity/SessionList.test.tsx`

**Interfaces:**
- Consumes: `Session`, `SessionsResponse`, `sessionLabel`, `byRecentActivity`, `makeSession` (Task 1); `apiGet`, `ApiError` from `web/src/api/client.ts`; `relativeTime` from `web/src/lib/format.ts`; `EmptyState`, `ErrorPanel`, `SkeletonRows` from `web/src/components/`.
- Produces: `useSessions()` (query key `['sessions']`), `sessionKeys.all`; default export `SessionList` (no props).

- [ ] **Step 1: Write the failing tests**

Create `web/src/features/activity/SessionList.test.tsx`:

```tsx
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import SessionList from './SessionList'
import { makeSession } from './activity.fixture'
import type { Session } from '../../api/types'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderList(sessions: Session[]) {
  server.use(http.get('/v1/sessions', () =>
    HttpResponse.json({ ok: true, data: { current_session_id: 'ses_web', sessions } })))
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><SessionList /></MemoryRouter>
    </QueryClientProvider>,
  )
}

/** The labels of the rendered cards, in order. */
async function labels() {
  const list = await screen.findByRole('list', { name: 'Agent sessions' })
  return within(list).getAllByRole('listitem').map(li => li.querySelector('strong')?.textContent)
}

const many = (n: number) => Array.from({ length: n }, (_, i) => makeSession({
  id: `ses_${String(i).padStart(6, '0')}`,
  name: `s${i}`,
  // Older as i grows, so s0 is the most recent.
  last_activity: new Date(Date.UTC(2026, 9, 15, 12) - i * 60_000).toISOString(),
}))

describe('SessionList', () => {
  it('lists sessions newest first with their id, branch and last activity', async () => {
    renderList([
      makeSession({ id: 'ses_old111', name: 'old', branch: 'main', last_activity: '2026-10-01T00:00:00Z' }),
      makeSession({ id: 'ses_new222', name: 'new', branch: 'feat/x', last_activity: '2026-10-15T00:00:00Z' }),
    ])

    expect(await labels()).toEqual(['new', 'old'])
    expect(screen.getByText('ses_new222')).toBeInTheDocument()
    expect(screen.getByText('feat/x')).toBeInTheDocument()
  })

  it('shows the total in the heading', async () => {
    renderList(many(3))
    expect(await screen.findByRole('heading', { name: 'Agent sessions 3' })).toBeInTheDocument()
  })

  it('says that a timestamp is not a liveness check', async () => {
    renderList(many(1))
    expect(await screen.findByText('Last recorded activity, not process health.')).toBeInTheDocument()
  })

  it('shows the 20 most recent and offers the rest behind a button', async () => {
    renderList(many(25))

    const shown = await labels()
    expect(shown).toHaveLength(20)
    expect(shown[0]).toBe('s0')
    expect(shown[19]).toBe('s19')

    await userEvent.click(screen.getByRole('button', { name: 'Show all (25)' }))

    expect(await labels()).toHaveLength(25)
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument()
  })

  it('offers no button when everything already fits', async () => {
    renderList(many(20))
    expect(await labels()).toHaveLength(20)
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument()
  })

  it('says so when td has recorded no sessions', async () => {
    renderList([])
    expect(await screen.findByText('No agent sessions recorded.')).toBeInTheDocument()
  })

  it("shows td's error verbatim", async () => {
    server.use(http.get('/v1/sessions', () => HttpResponse.json(
      { ok: false, error: { code: 'internal', message: 'database is locked' } }, { status: 500 })))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}><MemoryRouter><SessionList /></MemoryRouter></QueryClientProvider>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('database is locked')
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && npm test -- --run src/features/activity/SessionList`
Expected: FAIL, `Failed to resolve import "./SessionList"`.

- [ ] **Step 3: Add the hook**

In `web/src/api/queries.ts`, extend the type import to include `SessionsResponse`:

```ts
import type {
  About, IssueDetail, IssueListResponse, IssueStatus, IssueType, LabelsResponse, Priority,
  SessionsResponse,
} from './types'
```

Append:

```ts
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
```

- [ ] **Step 4: Implement the component**

Create `web/src/features/activity/SessionList.tsx`:

```tsx
import { useState } from 'react'
import { ApiError } from '../../api/client'
import { useSessions } from '../../api/queries'
import EmptyState from '../../components/EmptyState'
import ErrorPanel from '../../components/ErrorPanel'
import SkeletonRows from '../../components/SkeletonRows'
import { relativeTime } from '../../lib/format'
import { byRecentActivity, sessionLabel } from './sessions'

/** How many sessions show before "Show all". Most of a project's are weeks old. */
const VISIBLE = 20

/**
 * The project's agent sessions, most recently active first.
 *
 * "Seen" is the last time a session wrote to td, which is all td records. A
 * session seen a minute ago may have exited since, and one seen a week ago
 * may still be running idle, hence the note under the heading.
 */
export default function SessionList() {
  const { data, isPending, error } = useSessions()
  // Component state: which half of a long list is open is a reading posture,
  // not something worth a URL or a stored preference.
  const [showAll, setShowAll] = useState(false)

  const sessions = [...(data?.sessions ?? [])].sort(byRecentActivity)
  const shown = showAll ? sessions : sessions.slice(0, VISIBLE)

  return (
    <section aria-labelledby="sessions-heading" className="min-w-0">
      <h2 id="sessions-heading" className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-ink-muted">
        Agent sessions
        {data && <span className="rounded-sm border border-line px-1.5 font-mono normal-case tracking-normal">{sessions.length}</span>}
      </h2>
      <p className="mt-1 text-[11px] text-ink-faint">Last recorded activity, not process health.</p>

      {isPending ? (
        <SkeletonRows rows={3} label="Loading sessions" />
      ) : error ? (
        <div className="mt-3">
          <ErrorPanel message={error instanceof ApiError ? error.message : String(error)} />
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState message="No agent sessions recorded." />
      ) : (
        <>
          <ul aria-label="Agent sessions" className="mt-3 divide-y divide-line">
            {shown.map(session => (
              <li key={session.id} className="flex flex-col gap-0.5 py-2.5">
                <strong className="truncate font-semibold text-ink">{sessionLabel(session)}</strong>
                <span className="font-mono text-[11px] text-ink-muted">{session.id}</span>
                <span className="truncate text-[11px] text-ink-muted">{session.branch || 'no branch'}</span>
                <span className="text-[11px] text-ink-faint" title={session.last_activity}>
                  Seen {relativeTime(session.last_activity)}
                </span>
              </li>
            ))}
          </ul>
          {!showAll && sessions.length > VISIBLE && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-2 rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted"
            >
              Show all ({sessions.length})
            </button>
          )}
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd web && npm test -- --run src/features/activity/SessionList`
Expected: PASS, 7 tests. If the heading test fails on the accessible name, check the rendered name with `screen.debug()`; it must be exactly `Agent sessions 3`.

- [ ] **Step 6: Typecheck**

Run: `make typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add web/src/api/queries.ts web/src/features/activity/SessionList.tsx web/src/features/activity/SessionList.test.tsx
git commit -m "feat(web): list td's agent sessions, most recent first"
```

---

### Task 3: Activity feed

**Files:**
- Modify: `web/src/api/queries.ts`
- Create: `web/src/features/activity/ActivityFeed.tsx`
- Test: `web/src/features/activity/ActivityFeed.test.tsx`

**Interfaces:**
- Consumes: `ActivityItem`, `MonitorResponse`, `labelFor`, `makeActivity`, `makeSession` (Task 1); `useSessions` (Task 2); `apiGet`, `ApiError`; `relativeTime`; `EmptyState`, `ErrorPanel`, `SkeletonRows`.
- Produces: `useMonitor()` (query key `['monitor']`), `monitorKeys.all`; default export `ActivityFeed` (no props).

- [ ] **Step 1: Write the failing tests**

Create `web/src/features/activity/ActivityFeed.test.tsx`:

```tsx
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import ActivityFeed from './ActivityFeed'
import { makeActivity, makeSession } from './activity.fixture'
import type { ActivityItem, Session } from '../../api/types'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderFeed(activity: ActivityItem[], sessions: Session[] = []) {
  server.use(
    http.get('/v1/monitor', () => HttpResponse.json({ ok: true, data: { monitor: { activity } } })),
    http.get('/v1/sessions', () =>
      HttpResponse.json({ ok: true, data: { current_session_id: 'ses_web', sessions } })),
  )
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><ActivityFeed /></MemoryRouter>
    </QueryClientProvider>,
  )
}

const entries = async () =>
  within(await screen.findByRole('list', { name: 'Recent activity' })).getAllByRole('listitem')

describe('ActivityFeed', () => {
  it("shows td's message verbatim and links the issue td named", async () => {
    renderFeed([makeActivity({ message: 'submitted for review', issue_id: 'td-6f5475', issue_title: 'Require the same Go version' })])

    expect(await screen.findByText('submitted for review')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Require the same Go version' }))
      .toHaveAttribute('href', '/issues/td-6f5475')
  })

  // td puts a log, handoff or file-link id in issue_id for these, and says so
  // by leaving issue_title empty. A link would lead to a 404.
  it.each([
    ['create', 'lg-540c0e41', 'created issue'],
    ['handoff', 'ho-3b2d54a5', 'handoff'],
    ['link_file', 'ifl_743118747f285583', 'linked file'],
  ])('does not link a %s entry, whose id is not an issue', async (action, id, message) => {
    renderFeed([makeActivity({ action, issue_id: id, issue_title: '', message })])

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('tags a log entry with its kind', async () => {
    renderFeed([makeActivity({ type: 'log', log_type: 'decision', message: 'Use JWT' })])
    const [entry] = await entries()
    expect(within(entry).getByText('decision')).toBeInTheDocument()
  })

  it('names the session that wrote each entry', async () => {
    renderFeed(
      [
        makeActivity({ session_id: 'ses_111111', message: 'one' }),
        makeActivity({ session_id: 'ses_d87edf', message: 'two' }),
        makeActivity({ session_id: '', message: 'three' }),
      ],
      [makeSession({ id: 'ses_111111', name: '', agent_type: 'claude-code_445451' })],
    )

    // The first byline resolves once /v1/sessions lands; findByText waits for it.
    expect(await screen.findByText('claude-code_445451')).toBeInTheDocument()
    const [, second, third] = await entries()
    expect(within(second).getByText('d87e')).toBeInTheDocument()
    expect(within(third).getByText('unknown session')).toBeInTheDocument()
  })

  it('keeps td order, newest first, as td sent it', async () => {
    renderFeed([makeActivity({ message: 'newer' }), makeActivity({ message: 'older' })])
    const items = await entries()
    expect(items.map(li => li.querySelector('p')?.textContent)).toEqual(['newer', 'older'])
  })

  it('wraps a long multi-line message inside the column', async () => {
    renderFeed([makeActivity({ message: 'line one\nline two' })])
    const text = await screen.findByText(/line one/)
    expect(text).toHaveClass('whitespace-pre-line', 'break-words')
  })

  it('offers the exact time on hover', async () => {
    renderFeed([makeActivity({ timestamp: '2026-10-15T12:00:00Z' })])
    const [entry] = await entries()
    expect(within(entry).getByTitle('2026-10-15T12:00:00Z')).toBeInTheDocument()
  })

  it('says so when td has nothing to show', async () => {
    renderFeed([])
    expect(await screen.findByText('No recent activity.')).toBeInTheDocument()
  })

  it("shows td's error verbatim", async () => {
    server.use(
      http.get('/v1/monitor', () => HttpResponse.json(
        { ok: false, error: { code: 'internal', message: 'database is locked' } }, { status: 500 })),
      http.get('/v1/sessions', () =>
        HttpResponse.json({ ok: true, data: { current_session_id: 'ses_web', sessions: [] } })),
    )
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}><MemoryRouter><ActivityFeed /></MemoryRouter></QueryClientProvider>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('database is locked')
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && npm test -- --run src/features/activity/ActivityFeed`
Expected: FAIL, `Failed to resolve import "./ActivityFeed"`.

- [ ] **Step 3: Add the hook**

In `web/src/api/queries.ts`, add `MonitorResponse` to the type import:

```ts
import type {
  About, IssueDetail, IssueListResponse, IssueStatus, IssueType, LabelsResponse, MonitorResponse,
  Priority, SessionsResponse,
} from './types'
```

then append:

```ts
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
```

- [ ] **Step 4: Implement the component**

Create `web/src/features/activity/ActivityFeed.tsx`:

```tsx
import { Link } from 'react-router'
import { ApiError } from '../../api/client'
import { useMonitor, useSessions } from '../../api/queries'
import EmptyState from '../../components/EmptyState'
import ErrorPanel from '../../components/ErrorPanel'
import SkeletonRows from '../../components/SkeletonRows'
import { relativeTime } from '../../lib/format'
import { labelFor } from './sessions'

/**
 * td's recent activity across every session, in td's order and td's words.
 *
 * Sessions are read for bylines only. Their request failing or still loading
 * costs a name, never the feed: `labelFor` falls back to the short id.
 */
export default function ActivityFeed() {
  const { data, isPending, error } = useMonitor()
  const { data: sessions } = useSessions()

  const activity = data?.monitor.activity ?? []

  return (
    <section aria-labelledby="activity-heading" className="min-w-0">
      <h2 id="activity-heading" className="text-[11px] uppercase tracking-widest text-ink-muted">
        Recent activity
      </h2>

      {isPending ? (
        <SkeletonRows rows={5} label="Loading activity" />
      ) : error ? (
        <div className="mt-3">
          <ErrorPanel message={error instanceof ApiError ? error.message : String(error)} />
        </div>
      ) : activity.length === 0 ? (
        <EmptyState message="No recent activity." hint="Logs, handoffs and issue changes appear here." />
      ) : (
        <ul aria-label="Recent activity" className="mt-3 divide-y divide-line">
          {activity.map((item, i) => (
            // td sends no event id. Position plus timestamp is unique within
            // one response, and the whole list is replaced on each refetch.
            <li key={`${i}-${item.timestamp}`} className="flex flex-col gap-1 py-3">
              <div className="flex items-baseline gap-2 text-[11px]">
                <span className="font-semibold text-ink">{labelFor(sessions?.sessions, item.session_id)}</span>
                <span className="flex-1" />
                <time dateTime={item.timestamp} title={item.timestamp} className="text-ink-faint">
                  {relativeTime(item.timestamp)}
                </time>
              </div>
              <p className="whitespace-pre-line break-words text-ink">{item.message}</p>
              {(item.issue_title || item.log_type) && (
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  {/* td fills issue_title only when issue_id is an issue. */}
                  {item.issue_title && (
                    <Link to={`/issues/${item.issue_id}`} className="text-accent hover:underline">
                      {item.issue_title}
                    </Link>
                  )}
                  {item.log_type && (
                    <span className="rounded-sm border border-line px-1.5 font-mono text-ink-muted">
                      {item.log_type}
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd web && npm test -- --run src/features/activity/ActivityFeed`
Expected: PASS, 11 tests (the `it.each` counts three).

- [ ] **Step 6: Typecheck**

Run: `make typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add web/src/api/queries.ts web/src/features/activity/ActivityFeed.tsx web/src/features/activity/ActivityFeed.test.tsx
git commit -m "feat(web): show td's recent activity feed"
```

---

### Task 4: Page, route and header link

**Files:**
- Create: `web/src/features/activity/ActivityPage.tsx`
- Modify: `web/src/App.tsx` (import list and `<Routes>`)
- Modify: `web/src/components/AppShell.tsx` (header, before the Epics link)
- Test: `web/src/features/activity/ActivityPage.test.tsx`
- Test: `web/src/components/AppShell.test.tsx`

**Interfaces:**
- Consumes: `ActivityFeed` (Task 3), `SessionList` (Task 2), `makeActivity`, `makeSession` (Task 1).
- Produces: default export `ActivityPage`; route `/activity`; header link "Activity".

- [ ] **Step 1: Write the failing tests**

Create `web/src/features/activity/ActivityPage.test.tsx`:

```tsx
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import ActivityPage from './ActivityPage'
import { makeActivity, makeSession } from './activity.fixture'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const failing = (message: string) => () =>
  HttpResponse.json({ ok: false, error: { code: 'internal', message } }, { status: 500 })

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/activity']}><ActivityPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ActivityPage', () => {
  it('shows both columns under one heading', async () => {
    server.use(
      http.get('/v1/monitor', () => HttpResponse.json({ ok: true, data: { monitor: { activity: [makeActivity({ message: 'started work' })] } } })),
      http.get('/v1/sessions', () => HttpResponse.json({ ok: true, data: { current_session_id: 'x', sessions: [makeSession({ name: 'planner' })] } })),
    )
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Activity' })).toBeInTheDocument()
    expect(await screen.findByText('started work')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Agent sessions' })).toHaveTextContent('planner')
  })

  it('keeps the feed when the sessions request fails', async () => {
    server.use(
      http.get('/v1/monitor', () => HttpResponse.json({ ok: true, data: { monitor: { activity: [makeActivity({ session_id: 'ses_d87edf', message: 'started work' })] } } })),
      http.get('/v1/sessions', failing('sessions are broken')),
    )
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('sessions are broken')
    expect(await screen.findByText('started work')).toBeInTheDocument()
    expect(screen.getByText('d87e')).toBeInTheDocument()
  })

  it('keeps the sessions when the monitor request fails', async () => {
    server.use(
      http.get('/v1/monitor', failing('monitor is broken')),
      http.get('/v1/sessions', () => HttpResponse.json({ ok: true, data: { current_session_id: 'x', sessions: [makeSession({ name: 'planner' })] } })),
    )
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('monitor is broken')
    expect(await screen.findByText('planner')).toBeInTheDocument()
  })
})
```

Add to `web/src/components/AppShell.test.tsx`, inside `describe('AppShell', …)`:

```tsx
  it('links to the activity page from the header', () => {
    renderShell(true)
    expect(screen.getByRole('link', { name: 'Activity' })).toHaveAttribute('href', '/activity')
  })
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd web && npm test -- --run src/features/activity/ActivityPage src/components/AppShell`
Expected: FAIL. ActivityPage: unresolved import. AppShell: `Unable to find an accessible element with the role "link" and name "Activity"`.

- [ ] **Step 3: Implement the page**

Create `web/src/features/activity/ActivityPage.tsx`:

```tsx
import ActivityFeed from './ActivityFeed'
import SessionList from './SessionList'

/**
 * What has happened in the project lately, and which sessions did it.
 *
 * Both columns read td directly (`/v1/monitor`, `/v1/sessions`) and fail
 * independently. No width cap: see the comment in AppShell.
 */
export default function ActivityPage() {
  return (
    <div>
      <div className="flex items-center gap-2.5 border-b border-line bg-surface-inset px-4 py-2">
        <h1 className="text-[11px] uppercase tracking-widest text-ink-muted">Activity</h1>
      </div>
      <div className="grid gap-8 px-4 py-4 min-[900px]:grid-cols-[minmax(0,1fr)_20rem]">
        <ActivityFeed />
        <SessionList />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add the route**

In `web/src/App.tsx`, add the import after the `EpicList` import:

```tsx
import ActivityPage from './features/activity/ActivityPage'
```

and the route directly before `<Route path="/epics" …>` (above its comment block):

```tsx
          <Route path="/activity" element={<ActivityPage />} />
```

- [ ] **Step 5: Add the header link**

In `web/src/components/AppShell.tsx`, directly before the `<Link to="/epics" …>` element, add:

```tsx
        <Link
          to="/activity"
          data-button
          className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted"
        >
          Activity
        </Link>
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd web && npm test -- --run src/features/activity src/components/AppShell`
Expected: PASS, all activity tests and all AppShell tests.

- [ ] **Step 7: Typecheck**

Run: `make typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add web/src/features/activity/ActivityPage.tsx web/src/features/activity/ActivityPage.test.tsx web/src/App.tsx web/src/components/AppShell.tsx web/src/components/AppShell.test.tsx
git commit -m "feat(web): add the activity page at /activity"
```

---

### Task 5: Contract test for the two shapes

**Files:**
- Modify: `test/contract/contract_test.go` (append a test; reuse `newProject` and `getJSON`, already in the file)

**Interfaces:**
- Consumes: `newProject(t) (frontURL, issueID string)`, `getJSON(t, url, into)`.
- Produces: `TestActivityContract`.

- [ ] **Step 1: Write the test**

Append to `test/contract/contract_test.go`:

```go
// TestActivityContract pins the two shapes the activity page reads straight
// from td: monitor.activity and sessions are arrays, and their entries carry
// the fields the page renders. td owns both routes; if it renames a field,
// the page goes blank silently, so this is where that shows up instead.
func TestActivityContract(t *testing.T) {
	front, _ := newProject(t)

	var monitor struct {
		OK   bool `json:"ok"`
		Data struct {
			Monitor struct {
				Activity json.RawMessage `json:"activity"`
			} `json:"monitor"`
		} `json:"data"`
	}
	getJSON(t, front+"/v1/monitor", &monitor)
	if !monitor.OK {
		t.Error("monitor ok = false, want true")
	}
	assertArrayOfObjectsWith(t, "monitor.activity", monitor.Data.Monitor.Activity,
		"timestamp", "session_id", "type", "message", "issue_id", "issue_title", "log_type")

	var sessions struct {
		OK   bool `json:"ok"`
		Data struct {
			Sessions json.RawMessage `json:"sessions"`
		} `json:"data"`
	}
	getJSON(t, front+"/v1/sessions", &sessions)
	if !sessions.OK {
		t.Error("sessions ok = false, want true")
	}
	assertArrayOfObjectsWith(t, "sessions", sessions.Data.Sessions,
		"id", "name", "agent_type", "branch", "last_activity")
}

// assertArrayOfObjectsWith fails unless raw is a JSON array whose every
// element has each of keys. An empty array passes: a fresh project may have
// recorded nothing yet, and the shape is what is being pinned.
func assertArrayOfObjectsWith(t *testing.T, name string, raw json.RawMessage, keys ...string) {
	t.Helper()
	if !strings.HasPrefix(strings.TrimSpace(string(raw)), "[") {
		t.Fatalf("%s = %s, want a JSON array", name, raw)
	}
	var items []map[string]json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil {
		t.Fatalf("decode %s: %v", name, err)
	}
	for i, item := range items {
		for _, key := range keys {
			if _, ok := item[key]; !ok {
				t.Errorf("%s[%d] has no %q field", name, i, key)
			}
		}
	}
}
```

- [ ] **Step 2: Run it against a real td**

Run: `go test ./test/contract/ -run TestActivityContract -v`
Expected: `--- PASS: TestActivityContract`. A `--- SKIP` means td is not on PATH and nothing was verified; install td v0.57.0+ and rerun. If a field assertion fails, td's shape differs from the spec's measurement: stop and report rather than loosening the test.

- [ ] **Step 3: Commit**

```bash
git add test/contract/contract_test.go
git commit -m "test: pin the monitor and sessions shapes the activity page reads"
```

---

### Task 6: User documentation

**Files:**
- Create: `docs/activity.md`
- Modify: `docs/README.md` (table, after the Boards row)
- Modify: `README.md` (documentation table, after the Boards row)

- [ ] **Step 1: Write `docs/activity.md`**

```markdown
# Activity

**Activity** in the header opens `/activity`: what has happened in the
project lately, and which agent sessions did it.

## Recent activity

The left column is td's own activity feed, the same one `td monitor` shows:
the most recent events across every session, newest first. Each entry names
the session that wrote it, says when, and shows td's message as td wrote it.

- An entry about an issue links to that issue.
- Some entries are about something else, such as a log line, a handoff or a
  linked file. Those show as text without a link.
- Log entries carry their kind as a tag: `progress`, `decision`, `blocker`.

td decides how many events the feed holds; td-gui shows all of them and
cannot load older ones.

## Agent sessions

The right column lists the sessions td has recorded, most recently active
first, with their id, branch and when they were last seen. The twenty most
recent show; **Show all** reveals the rest.

"Seen" is the last time a session wrote to td. It is not a liveness check: a
session seen a minute ago may have exited, and one seen last week may still
be running idle.

## Live updates

Both columns refresh by themselves whenever anything in the project changes,
like every other page. If one of them cannot be loaded, it shows td's error
and the other keeps working.
```

- [ ] **Step 2: Link it from both indexes**

In `docs/README.md`, after the `| [Boards](boards.md) | … |` row, add:

```markdown
| [Activity](activity.md) | The recent activity feed across sessions, the agent session list |
```

In `README.md`, after the `| [Boards](docs/boards.md) | … |` row, add:

```markdown
| [Activity](docs/activity.md) | The recent activity feed across sessions, the agent session list |
```

- [ ] **Step 3: Commit**

```bash
git add docs/activity.md docs/README.md README.md
git commit -m "docs: describe the activity page"
```

---

### Task 7: Full verification

- [ ] **Step 1: Run the whole suite**

Run: `make test`
Expected: lint clean, `go test ./...` ok, frontend suite passes. Check the Go output for `--- SKIP` in `test/contract`; a skip there means the contract was not verified.

- [ ] **Step 2: Build the binary**

Run: `make build`
Expected: exit 0, and `git status` shows `internal/web/dist/.gitkeep` unchanged.

- [ ] **Step 3: Look at it**

Run `./td-gui --no-open` in this repository, open the printed URL, click **Activity**. Check: the feed shows recent td events with session names; issue entries link; the session list shows 20 plus "Show all"; narrowing the window below 900px stacks the columns without horizontal scroll.

- [ ] **Step 4: Record it in td**

```bash
td link td-8939b4 web/src/features/activity/* web/src/api/queries.ts web/src/api/types.ts web/src/App.tsx web/src/components/AppShell.tsx test/contract/contract_test.go docs/activity.md
td review td-8939b4
```
