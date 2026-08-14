# td-gui Visual Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give td-gui a deliberate terminal-adjacent visual identity — dense, monospace-forward, dark-first with a light counterpart — plus the UI structure that identity needs, without adding features or endpoints.

**Architecture:** All colour lives in semantic CSS custom properties declared once in `web/src/index.css` and mapped to Tailwind utility names via `@theme inline`. Light values sit on `:root`; a `prefers-color-scheme: dark` block overrides the same variable names. No component ever writes a literal colour. Presentational primitives (status tag, priority tag, error panel, empty state, skeleton rows) become small single-purpose components so the feature files stay about behaviour.

**Tech Stack:** React 19, React Router 8, TanStack Query 5, Tailwind CSS v4 (CSS-first, no config file), Vitest + Testing Library + MSW, TypeScript.

**Source spec:** `docs/superpowers/specs/2026-08-14-td-gui-visual-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **English is the only language.** UI strings, code, comments, commit messages. No i18n layer, no locale switcher, no translated fallbacks.
- **td's wording is never rewritten.** Validation errors and review-policy rejections from `td serve` render verbatim. `web/src/api/client.test.ts` and `web/src/features/issues/IssueDetail.test.tsx` pin this.
- **No hardcoded field limits.** Title length and similar bounds are per-project td config; the server validates, the form displays the server's answer.
- **Transitions come only from td.** Render exactly what `available_transitions` reports, and render nothing when the field is absent.
- **No new API calls, endpoints, routes or screens.** This is a visual pass.
- **Never write a literal colour or a stock Tailwind palette class** (`neutral-500`, `red-600`, …) in a component. Use the semantic tokens from Task 1.
- **Preserve every visible string, `role`, `aria-label` and form-label text** except where a task explicitly changes it. The existing tests query by role, label and text — never by class — so they stay green only under this rule.
- Run frontend commands from `web/`. Use `npm test -- --run` (bare `npm test` watches).
- Commit with Conventional Commits and a package scope: `feat(web):`, `refactor(web):`, `test(web):`, `docs:`.

### Deliberate copy changes

Two approved changes to visible text. They are intentional, not drift:

1. **Status is displayed as td's raw enum** — `in_progress`, not `In progress` — in the list, the detail header and the filter chips. td's vocabulary is authoritative and the CLI shows the same tokens. This deletes the `statusLabels` map in `IssueList.tsx` and the `label` field in `IssueFilters.tsx`.
2. **The "New issue" action moves from the list body into the application header**, so it is reachable from every route.

### Deviation from the spec

The spec named the formatting module `lib/time.ts`. It becomes **`lib/format.ts`**, because it holds two formatters — relative time and session-id shortening — and a file called `time.ts` that shortens session ids would be misnamed.

The spec said a shortened session id is "the first four characters". Real ids look like `ses_d87edf`, so the first four characters are the constant prefix `ses_` and carry no information. Corrected rule: **strip a leading `ses_` if present, then take four characters** — `ses_d87edf` renders as `d87e`.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `web/src/lib/format.ts` | ISO timestamp → relative string; session id → short form |
| `web/src/lib/format.test.ts` | tests for both formatters |
| `web/src/components/AppShell.tsx` | header, brand, connection indicator, "New issue", main region |
| `web/src/components/AppShell.test.tsx` | connected/disconnected rendering |
| `web/src/components/StatusTag.tsx` | status string → token colour |
| `web/src/components/PriorityTag.tsx` | priority string → token colour and weight |
| `web/src/components/StatusTag.test.tsx` | known and unknown status rendering |
| `web/src/components/ErrorPanel.tsx` | labelled danger frame around a verbatim message |
| `web/src/components/ErrorPanel.test.tsx` | verbatim rendering |
| `web/src/components/EmptyState.tsx` | centred message plus optional hint |
| `web/src/components/SkeletonRows.tsx` | placeholder rows at list row height |

**Modified:** `web/src/index.css`, `web/index.html`, `web/src/App.tsx`, `web/src/components/ConnectionBanner.tsx`, `web/src/features/issues/IssueList.tsx`, `IssueFilters.tsx`, `IssueDetail.tsx`, `TransitionBar.tsx`, `CommentForm.tsx`, `IssueForm.tsx`

**Deleted:** `web/src/App.css` (2.8 KB of Vite scaffold; nothing imports it)

---

## Task 1: Formatters

Pure functions with no UI dependency — the natural TDD starting point, and Task 8 depends on them.

**Files:**
- Create: `web/src/lib/format.ts`
- Test: `web/src/lib/format.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `relativeTime(iso: string, now?: Date): string`
  - `shortSession(id: string): string`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { relativeTime, shortSession } from './format'

const now = new Date('2026-08-14T12:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('relativeTime', () => {
  it('calls anything under a minute "just now"', () => {
    expect(relativeTime(ago(0), now)).toBe('just now')
    expect(relativeTime(ago(59 * SECOND), now)).toBe('just now')
  })

  it('switches to minutes at 60 seconds', () => {
    expect(relativeTime(ago(MINUTE), now)).toBe('1m ago')
    expect(relativeTime(ago(59 * MINUTE), now)).toBe('59m ago')
  })

  it('switches to hours at 60 minutes', () => {
    expect(relativeTime(ago(HOUR), now)).toBe('1h ago')
    expect(relativeTime(ago(23 * HOUR), now)).toBe('23h ago')
  })

  it('switches to days at 24 hours', () => {
    expect(relativeTime(ago(DAY), now)).toBe('1d ago')
    expect(relativeTime(ago(6 * DAY), now)).toBe('6d ago')
  })

  it('falls back to an absolute date from seven days out', () => {
    expect(relativeTime(ago(7 * DAY), now)).toBe('2026-08-07')
  })

  it('returns an empty string for an unparseable timestamp', () => {
    expect(relativeTime('not a date', now)).toBe('')
    expect(relativeTime('', now)).toBe('')
  })

  it('treats a future timestamp as "just now" rather than negative', () => {
    expect(relativeTime(new Date(now.getTime() + HOUR).toISOString(), now)).toBe('just now')
  })
})

describe('shortSession', () => {
  it('strips the ses_ prefix before shortening', () => {
    expect(shortSession('ses_d87edf')).toBe('d87e')
  })

  it('shortens an id that has no prefix', () => {
    expect(shortSession('4f2a91bc')).toBe('4f2a')
  })

  it('returns short input unchanged', () => {
    expect(shortSession('ab')).toBe('ab')
    expect(shortSession('')).toBe('')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && npm test -- --run src/lib/format.test.ts
```

Expected: FAIL — `Failed to resolve import "./format"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/lib/format.ts`:

```ts
const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

/**
 * Renders an ISO timestamp as a relative string, falling back to an absolute
 * date once it is a week old. Returns '' for anything unparseable so a bad
 * timestamp shows as nothing rather than "Invalid Date".
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''

  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000)
  if (seconds < MINUTE) return 'just now'
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m ago`
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h ago`
  if (seconds < WEEK) return `${Math.floor(seconds / DAY)}d ago`
  return then.toISOString().slice(0, 10)
}

/** td session ids look like `ses_d87edf`; the prefix carries no information. */
export function shortSession(id: string): string {
  return id.replace(/^ses_/, '').slice(0, 4)
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd web && npm test -- --run src/lib/format.test.ts
```

Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/format.ts web/src/lib/format.test.ts
git commit -m "feat(web): add relative time and session id formatters"
```

---

## Task 2: Design tokens and base layer

**Files:**
- Modify: `web/src/index.css` (currently one line: `@import "tailwindcss";`)
- Modify: `web/index.html:6` (`<title>web</title>`)
- Delete: `web/src/App.css`

**Interfaces:**
- Consumes: nothing
- Produces: Tailwind utility names used by every later task — `bg-surface`, `bg-surface-raised`, `bg-surface-inset`, `bg-surface-hover`, `border-line`, `border-line-subtle`, `text-ink`, `text-ink-muted`, `text-ink-faint`, `text-accent`, `bg-accent-bg`, `text-danger`, `text-success`, `text-warn`, and `text-st-open` / `text-st-progress` / `text-st-review` / `text-st-blocked` / `text-st-closed`. Every `--color-*` name also yields `bg-*`, `text-*` and `border-*` variants.

**This task has no unit test.** Tailwind utilities and `prefers-color-scheme` are not resolvable in jsdom — there is nothing meaningful to assert. Its gate is a clean build plus a look at the running app. That is stated here so the absence is a decision, not an oversight.

- [ ] **Step 1: Confirm `App.css` is genuinely unreferenced before deleting it**

```bash
cd web && grep -rn "App.css" src/ index.html
```

Expected: no output. If anything is printed, stop and report it instead of deleting.

- [ ] **Step 2: Write the token layer**

Replace the entire contents of `web/src/index.css`:

```css
@import "tailwindcss";

/* `inline` is required: the values are references to other custom properties,
   which plain `@theme` would freeze at their light-mode value. */
@theme inline {
  --color-surface: var(--td-surface);
  --color-surface-raised: var(--td-surface-raised);
  --color-surface-inset: var(--td-surface-inset);
  --color-surface-hover: var(--td-surface-hover);

  --color-line: var(--td-line);
  --color-line-subtle: var(--td-line-subtle);

  --color-ink: var(--td-ink);
  --color-ink-muted: var(--td-ink-muted);
  --color-ink-faint: var(--td-ink-faint);

  --color-accent: var(--td-accent);
  --color-accent-bg: var(--td-accent-bg);
  --color-danger: var(--td-danger);
  --color-success: var(--td-success);
  --color-warn: var(--td-warn);

  --color-st-open: var(--td-st-open);
  --color-st-progress: var(--td-st-progress);
  --color-st-review: var(--td-st-review);
  --color-st-blocked: var(--td-st-blocked);
  --color-st-closed: var(--td-st-closed);

  --font-mono: ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, Consolas, monospace;
  --font-sans: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

:root {
  --td-surface: #fdfdfc;
  --td-surface-raised: #f6f8fa;
  --td-surface-inset: #f6f7f8;
  --td-surface-hover: #f2f4f6;

  --td-line: #e3e5e8;
  --td-line-subtle: #eff1f2;

  --td-ink: #1f2328;
  --td-ink-muted: #57606a;
  --td-ink-faint: #6e7781;

  --td-accent: #9a6700;
  --td-accent-bg: #fff8e6;
  --td-danger: #cf222e;
  --td-success: #1a7f37;
  --td-warn: #9a6700;

  --td-st-open: #0969da;
  --td-st-progress: #9a6700;
  --td-st-review: #8250df;
  --td-st-blocked: #cf222e;
  --td-st-closed: #57606a;
}

@media (prefers-color-scheme: dark) {
  :root {
    --td-surface: #0d1117;
    --td-surface-raised: #0f141b;
    --td-surface-inset: #010409;
    --td-surface-hover: #161b22;

    --td-line: #21262d;
    --td-line-subtle: #161b22;

    --td-ink: #e6edf3;
    --td-ink-muted: #8b949e;
    --td-ink-faint: #7d8590;

    --td-accent: #d29922;
    --td-accent-bg: #1c1710;
    --td-danger: #f85149;
    --td-success: #3fb950;
    --td-warn: #e3b341;

    --td-st-open: #58a6ff;
    --td-st-progress: #d29922;
    --td-st-review: #a371f7;
    --td-st-blocked: #f85149;
    --td-st-closed: #8b949e;
  }
}

@layer base {
  body {
    background-color: var(--color-surface);
    color: var(--color-ink);
    font-family: var(--font-mono);
    font-size: 0.75rem;
    line-height: 1.5;
  }

  /* The app previously had no focus styling at all — tab navigation was
     invisible. This is the single global fix. */
  :focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
}
```

- [ ] **Step 3: Fix the page title**

In `web/index.html`, change line 6 from `<title>web</title>` to:

```html
    <title>td-gui</title>
```

- [ ] **Step 4: Delete the dead scaffold**

```bash
git rm web/src/App.css
```

- [ ] **Step 5: Verify the build and the existing suite**

```bash
cd web && npm run build && npm test -- --run
```

Expected: build succeeds; all existing tests still pass. The app will look half-styled at this point — later tasks apply the tokens.

- [ ] **Step 6: Commit**

```bash
git add web/src/index.css web/index.html
git commit -m "feat(web): add semantic colour tokens and light/dark themes"
```

---

## Task 3: Status and priority tags

**Files:**
- Create: `web/src/components/StatusTag.tsx`, `web/src/components/PriorityTag.tsx`
- Test: `web/src/components/StatusTag.test.tsx`

**Interfaces:**
- Consumes: token utilities from Task 2
- Produces:
  - `<StatusTag status={string} />` — default export of `StatusTag.tsx`
  - `<PriorityTag priority={string} />` — default export of `PriorityTag.tsx`

Both take a plain `string`, not the `IssueStatus` / `Priority` unions, so a status td adds in a future version renders instead of crashing the list.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/StatusTag.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import StatusTag from './StatusTag'

describe('StatusTag', () => {
  it("renders td's raw status token", () => {
    render(<StatusTag status="in_progress" />)
    expect(screen.getByText('in_progress')).toBeInTheDocument()
  })

  it('renders an unknown status verbatim instead of throwing', () => {
    render(<StatusTag status="archived_by_future_td" />)
    expect(screen.getByText('archived_by_future_td')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && npm test -- --run src/components/StatusTag.test.tsx
```

Expected: FAIL — `Failed to resolve import "./StatusTag"`.

- [ ] **Step 3: Write both components**

Create `web/src/components/StatusTag.tsx`:

```tsx
const statusColor: Record<string, string> = {
  open: 'text-st-open',
  in_progress: 'text-st-progress',
  in_review: 'text-st-review',
  blocked: 'text-st-blocked',
  closed: 'text-st-closed',
}

/**
 * Takes a plain string rather than IssueStatus: a status td adds later should
 * render, not crash the list.
 */
export default function StatusTag({ status }: { status: string }) {
  return (
    <span className={`text-[10px] tracking-wider ${statusColor[status] ?? 'text-ink-muted'}`}>
      {status}
    </span>
  )
}
```

Create `web/src/components/PriorityTag.tsx`:

```tsx
export default function PriorityTag({ priority }: { priority: string }) {
  const urgent = priority === 'P0' || priority === 'P1'
  return (
    <span className={urgent ? 'font-semibold text-danger' : 'text-ink-muted'}>
      {priority}
    </span>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd web && npm test -- --run src/components/StatusTag.test.tsx
```

Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/StatusTag.tsx web/src/components/PriorityTag.tsx web/src/components/StatusTag.test.tsx
git commit -m "feat(web): add status and priority tag components"
```

---

## Task 4: State primitives

**Files:**
- Create: `web/src/components/ErrorPanel.tsx`, `web/src/components/EmptyState.tsx`, `web/src/components/SkeletonRows.tsx`
- Test: `web/src/components/ErrorPanel.test.tsx`

**Interfaces:**
- Consumes: token utilities from Task 2
- Produces:
  - `<ErrorPanel message={string} label?={string} />` — `label` defaults to `'Request failed'`
  - `<EmptyState message={string} hint?={string} />`
  - `<SkeletonRows rows?={number} />` — `rows` defaults to `5`

`ErrorPanel` carries `role="alert"`, which is what the existing `IssueList` and `IssueDetail` error paths already use.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/ErrorPanel.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import ErrorPanel from './ErrorPanel'

describe('ErrorPanel', () => {
  // td phrases validation and policy errors precisely. The panel frames the
  // message; it must never reword, truncate or prettify it.
  it("renders td's message character for character", () => {
    const message = 'title too short (2 chars, min 15)'
    render(<ErrorPanel message={message} />)
    expect(screen.getByText(message)).toBeInTheDocument()
  })

  it('exposes itself as an alert', () => {
    render(<ErrorPanel message="database is locked" />)
    expect(screen.getByRole('alert')).toHaveTextContent('database is locked')
  })

  it('shows a default label and accepts an override', () => {
    const { rerender } = render(<ErrorPanel message="boom" />)
    expect(screen.getByText('Request failed')).toBeInTheDocument()

    rerender(<ErrorPanel message="boom" label="Transition rejected" />)
    expect(screen.getByText('Transition rejected')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && npm test -- --run src/components/ErrorPanel.test.tsx
```

Expected: FAIL — `Failed to resolve import "./ErrorPanel"`.

- [ ] **Step 3: Write the three components**

Create `web/src/components/ErrorPanel.tsx`:

```tsx
interface Props {
  /** Rendered verbatim. Never reword what td sent. */
  message: string
  label?: string
}

export default function ErrorPanel({ message, label = 'Request failed' }: Props) {
  return (
    <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 px-3.5 py-3">
      <p className="mb-1.5 text-[10px] uppercase tracking-widest text-danger">{label}</p>
      <p className="text-danger">{message}</p>
    </div>
  )
}
```

Create `web/src/components/EmptyState.tsx`:

```tsx
export default function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="px-4 py-11 text-center">
      <p className="text-ink-muted">{message}</p>
      {hint && <p className="mt-1.5 text-[11px] text-ink-faint">{hint}</p>}
    </div>
  )
}
```

Create `web/src/components/SkeletonRows.tsx`:

```tsx
/** Placeholder rows at the real row height, so nothing jumps when data lands. */
export default function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading issues">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="flex items-center gap-3 border-b border-line-subtle px-4 py-2"
        >
          <span className="h-[11px] w-[74px] rounded-sm bg-surface-hover" />
          <span className="h-[11px] flex-1 rounded-sm bg-surface-hover" />
          <span className="h-[11px] w-5 rounded-sm bg-surface-hover" />
          <span className="h-[11px] w-[66px] rounded-sm bg-surface-hover" />
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd web && npm test -- --run src/components/ErrorPanel.test.tsx
```

Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ErrorPanel.tsx web/src/components/EmptyState.tsx web/src/components/SkeletonRows.tsx web/src/components/ErrorPanel.test.tsx
git commit -m "feat(web): add error, empty and skeleton state components"
```

---

## Task 5: Application shell

**Files:**
- Create: `web/src/components/AppShell.tsx`
- Test: `web/src/components/AppShell.test.tsx`
- Modify: `web/src/App.tsx`, `web/src/components/ConnectionBanner.tsx`

**Interfaces:**
- Consumes: token utilities from Task 2
- Produces: `<AppShell connected={boolean}>{children}</AppShell>` — renders the header, the connection banner and a `<main>` wrapping `children`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/AppShell.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import AppShell from './AppShell'

function renderShell(connected: boolean) {
  return render(
    <MemoryRouter>
      <AppShell connected={connected}><p>route content</p></AppShell>
    </MemoryRouter>,
  )
}

describe('AppShell', () => {
  it('renders the brand, the New issue action and its children', () => {
    renderShell(true)
    expect(screen.getByText('td-gui')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New issue' })).toHaveAttribute('href', '/new')
    expect(screen.getByText('route content')).toBeInTheDocument()
  })

  it('reports the connected state in the header', () => {
    renderShell(true)
    expect(screen.getByText('connected')).toBeInTheDocument()
    expect(screen.queryByText(/may be out of date/)).not.toBeInTheDocument()
  })

  it('warns about stale data when disconnected', () => {
    renderShell(false)
    expect(screen.getByText('disconnected')).toBeInTheDocument()
    expect(
      screen.getByText('Backend disconnected — the data shown may be out of date.'),
    ).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && npm test -- --run src/components/AppShell.test.tsx
```

Expected: FAIL — `Failed to resolve import "./AppShell"`.

- [ ] **Step 3: Write the shell**

Create `web/src/components/AppShell.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import ConnectionBanner from './ConnectionBanner'

/**
 * Connection state is shown twice on purpose: the header dot is the ambient
 * state, the banner is the consequence — the data may be stale.
 */
export default function AppShell({
  connected,
  children,
}: {
  connected: boolean
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-surface text-ink">
      <header className="flex items-center gap-2.5 border-b border-line bg-surface-inset px-4 py-2.5">
        <Link to="/" className="font-semibold tracking-widest text-accent">td-gui</Link>
        <span className="flex-1" />
        <span className="flex items-center gap-1.5 text-[11px] text-ink-muted">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-success' : 'bg-warn'}`}
          />
          {connected ? 'connected' : 'disconnected'}
        </span>
        <Link
          to="/new"
          className="rounded-sm border border-accent px-2.5 py-1 text-[11px] text-accent"
        >
          New issue
        </Link>
      </header>

      <ConnectionBanner connected={connected} />

      <main>{children}</main>
    </div>
  )
}
```

- [ ] **Step 4: Restyle the banner, keeping its text and role**

Replace `web/src/components/ConnectionBanner.tsx`:

```tsx
export default function ConnectionBanner({ connected }: { connected: boolean }) {
  if (connected) return null
  return (
    <div
      role="status"
      className="border-b border-warn/30 bg-warn/10 px-4 py-1.5 text-[11px] text-warn"
    >
      Backend disconnected — the data shown may be out of date.
    </div>
  )
}
```

- [ ] **Step 5: Wire the shell into the router**

Replace `web/src/App.tsx`:

```tsx
import { Route, Routes } from 'react-router'
import IssueList from './features/issues/IssueList'
import IssueDetail from './features/issues/IssueDetail'
import IssueForm from './features/issues/IssueForm'
import AppShell from './components/AppShell'
import { useLiveUpdates } from './api/useLiveUpdates'

export default function App() {
  const { connected } = useLiveUpdates()
  return (
    <AppShell connected={connected}>
      <Routes>
        <Route path="/" element={<IssueList />} />
        <Route path="/new" element={<IssueForm />} />
        <Route path="/issues/:id" element={<IssueDetail />} />
      </Routes>
    </AppShell>
  )
}
```

- [ ] **Step 6: Run the full suite**

```bash
cd web && npm test -- --run
```

Expected: PASS, including the three new `AppShell` tests.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/AppShell.tsx web/src/components/AppShell.test.tsx web/src/components/ConnectionBanner.tsx web/src/App.tsx
git commit -m "feat(web): add application shell with header and connection state"
```

---

## Task 6: Issue list and filters

**Files:**
- Modify: `web/src/features/issues/IssueList.tsx`, `web/src/features/issues/IssueFilters.tsx`

**Interfaces:**
- Consumes: `StatusTag`, `PriorityTag` (Task 3); `ErrorPanel`, `EmptyState`, `SkeletonRows` (Task 4); `AppShell` now owns the "New issue" link (Task 5)
- Produces: nothing later tasks depend on

The existing `IssueList.test.tsx` must stay green untouched. It asserts `getByText('td-6a0883')`, `findByText(/no issues/i)` and `findByText(/database is locked/)` — so the id keeps its own element, the empty state keeps the words "No issues", and the error message renders verbatim.

- [ ] **Step 1: Run the existing list tests to establish the baseline**

```bash
cd web && npm test -- --run src/features/issues/IssueList.test.tsx
```

Expected: PASS — 3 tests. These are the regression gate for this task; do not modify them.

- [ ] **Step 2: Rewrite the filters as chips**

Replace `web/src/features/issues/IssueFilters.tsx`:

```tsx
import type { IssueListParams } from '../../api/queries'
import type { IssueStatus } from '../../api/types'

// td's own vocabulary — no separate display labels.
const statuses: IssueStatus[] = ['open', 'in_progress', 'in_review', 'blocked', 'closed']

interface Props {
  params: IssueListParams
  onChange: (next: IssueListParams) => void
}

export default function IssueFilters({ params, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5">
      <input
        type="search"
        aria-label="Search"
        placeholder="search …"
        className="flex-1 rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 text-ink placeholder:text-ink-faint"
        defaultValue={params.search ?? ''}
        onChange={e => onChange({ ...params, search: e.target.value || undefined })}
      />
      {statuses.map(status => {
        const active = params.status?.includes(status) ?? false
        return (
          <label
            key={status}
            className={`cursor-pointer rounded-sm border px-2.5 py-1 text-[11px] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${
              active ? 'border-accent bg-accent-bg text-accent' : 'border-line text-ink-muted'
            }`}
          >
            {/* Stays a real checkbox: a button would cost keyboard behaviour,
                screen-reader semantics and the existing tests. */}
            <input
              type="checkbox"
              className="sr-only"
              checked={active}
              onChange={() => {
                const current = params.status ?? []
                const next = active
                  ? current.filter(v => v !== status)
                  : [...current, status]
                onChange({ ...params, status: next.length ? next : undefined })
              }}
            />
            {status}
          </label>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Rewrite the list**

Replace `web/src/features/issues/IssueList.tsx`:

```tsx
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useIssues, type IssueListParams } from '../../api/queries'
import { ApiError } from '../../api/client'
import IssueFilters from './IssueFilters'
import StatusTag from '../../components/StatusTag'
import PriorityTag from '../../components/PriorityTag'
import ErrorPanel from '../../components/ErrorPanel'
import EmptyState from '../../components/EmptyState'
import SkeletonRows from '../../components/SkeletonRows'

const PAGE_SIZE = 50

export default function IssueList() {
  const [params, setParams] = useState<IssueListParams>({ limit: PAGE_SIZE, offset: 0 })
  const { data, error, isPending } = useIssues(params)

  // Assigned rather than early-returned so the filters stay mounted in every
  // state — the empty-state hint tells the user to clear them.
  let body: ReactNode
  if (isPending) {
    body = <SkeletonRows />
  } else if (error) {
    body = (
      <div className="p-4">
        <ErrorPanel message={error instanceof ApiError ? error.message : String(error)} />
      </div>
    )
  } else if (data.issues.length === 0) {
    body = (
      <EmptyState
        message="No issues found."
        hint="Try clearing the status filters, or create the first issue."
      />
    )
  } else {
    body = (
      <>
        <ul>
          {data.issues.map(issue => (
            <li key={issue.id} className="border-b border-line-subtle">
              <Link
                to={`/issues/${issue.id}`}
                className="flex items-center gap-3 px-4 py-2 hover:bg-surface-hover hover:shadow-[inset_2px_0_0_var(--color-accent)]"
              >
                <span className="w-[74px] shrink-0 text-ink-faint">{issue.id}</span>
                <span className="flex-1 truncate text-ink">{issue.title}</span>
                <PriorityTag priority={issue.priority} />
                <span className="w-[74px] shrink-0 text-right">
                  <StatusTag status={issue.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-3.5 px-4 py-2.5 text-[11px] text-ink-muted">
          <button
            className="rounded-sm border border-line px-2.5 py-1 disabled:opacity-40"
            disabled={params.offset === 0}
            onClick={() => setParams(p => ({ ...p, offset: Math.max(0, p.offset - PAGE_SIZE) }))}
          >
            prev
          </button>
          <span>
            {data.offset + 1}–{data.offset + data.issues.length} of {data.total}
          </span>
          <button
            className="rounded-sm border border-line px-2.5 py-1 disabled:opacity-40"
            disabled={!data.has_more}
            onClick={() => setParams(p => ({ ...p, offset: p.offset + PAGE_SIZE }))}
          >
            next
          </button>
        </div>
      </>
    )
  }

  return (
    <div>
      <IssueFilters params={params} onChange={next => setParams({ ...next, offset: 0 })} />
      {body}
    </div>
  )
}
```

- [ ] **Step 4: Run the list tests plus a typecheck**

```bash
cd web && npm test -- --run src/features/issues/IssueList.test.tsx && npx tsc -b
```

Expected: PASS — 3 tests, no type errors. If TypeScript complains that `data` is possibly `undefined`, the `if / else if` chain has been rearranged — restore the exact order above, which is what lets TanStack Query's result union narrow.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/issues/IssueList.tsx web/src/features/issues/IssueFilters.tsx
git commit -m "feat(web): restyle issue list rows, filter chips and states"
```

---

## Task 7: Issue detail header, transitions and handoff

**Files:**
- Modify: `web/src/features/issues/IssueDetail.tsx`, `web/src/features/issues/TransitionBar.tsx`

**Interfaces:**
- Consumes: `StatusTag`, `PriorityTag`, `ErrorPanel` (Tasks 3–4)
- Produces: nothing later tasks depend on

Activity and comments are deliberately left alone in this task — Task 8 rewrites them once the formatters are wired in. `IssueDetail.test.tsx` asserts `getByText('A description')` and `getByText('done bits')`, so the description text and handoff items must keep rendering as their own elements.

- [ ] **Step 1: Run the existing detail tests to establish the baseline**

```bash
cd web && npm test -- --run src/features/issues/IssueDetail.test.tsx
```

Expected: PASS. Do not modify this file.

- [ ] **Step 2: Restyle the transition bar**

Replace `web/src/features/issues/TransitionBar.tsx`:

```tsx
import { ApiError } from '../../api/client'
import { useTransition } from '../../api/mutations'
import ErrorPanel from '../../components/ErrorPanel'
import type { Transition } from '../../api/types'

const labels: Record<Transition, string> = {
  start: 'Start',
  review: 'Request review',
  approve: 'Approve',
  reject: 'Reject',
  block: 'Block',
  unblock: 'Unblock',
  close: 'Close',
  reopen: 'Reopen',
}

const tone: Partial<Record<Transition, string>> = {
  approve: 'border-success/40 text-success',
  reject: 'border-danger/40 text-danger',
  block: 'border-danger/40 text-danger',
}

interface Props {
  issueId: string
  /** Absent means td did not tell us — render nothing rather than guess. */
  available?: Transition[]
}

export default function TransitionBar({ issueId, available }: Props) {
  const transition = useTransition(issueId)

  if (!available?.length) return null

  return (
    <div className="mt-4 border-t border-line-subtle pt-4">
      <div className="flex flex-wrap gap-1.5">
        {available.map(action => (
          <button
            key={action}
            className={`rounded-sm border px-2.5 py-1 text-[11px] disabled:opacity-40 ${
              tone[action] ?? 'border-line text-ink'
            }`}
            disabled={transition.isPending}
            onClick={() => transition.mutate({ action })}
          >
            {labels[action] ?? action}
          </button>
        ))}
      </div>

      {transition.error && (
        // td phrases policy rejections precisely. Show its message unchanged;
        // a generic "not allowed" would lose the reason.
        <div className="mt-2">
          <ErrorPanel
            label="Transition rejected"
            message={
              transition.error instanceof ApiError
                ? transition.error.message
                : String(transition.error)
            }
          />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Restyle the detail header, description and handoff**

In `web/src/features/issues/IssueDetail.tsx`, add these imports below the existing ones:

```tsx
import StatusTag from '../../components/StatusTag'
import PriorityTag from '../../components/PriorityTag'
import ErrorPanel from '../../components/ErrorPanel'
```

Replace the error branch (currently lines 14–26) with:

```tsx
  if (error) {
    const apiError = error instanceof ApiError ? error : null
    return (
      <div className="p-4">
        <ErrorPanel message={apiError?.message ?? String(error)} />
        {apiError?.code === 'not_found' && (
          <Link to="/" className="mt-3 inline-block text-[11px] text-ink-muted underline">
            back to list
          </Link>
        )}
      </div>
    )
  }
```

Replace the loading branch (currently line 12) with:

```tsx
  if (isPending) return <p className="p-4 text-ink-muted">Loading …</p>
```

Replace the wrapper `<div className="p-6">` and the `<header>` block (currently lines 31–40) with:

```tsx
    <div className="px-5 py-4 pb-6">
      <Link to="/" className="text-[11px] text-ink-muted">← back to list</Link>

      <header className="mt-3">
        <span className="block text-[11px] text-ink-faint">{issue.id}</span>
        <h1 className="mb-2 mt-0.5 font-sans text-xl font-semibold leading-snug tracking-tight text-ink">
          {issue.title}
        </h1>
        <div className="flex items-center gap-2 text-[10.5px]">
          <span className="rounded-sm border border-line px-1.5 py-0.5 text-ink-muted">
            {issue.type}
          </span>
          <span className="rounded-sm border border-line px-1.5 py-0.5">
            <PriorityTag priority={issue.priority} />
          </span>
          <span className="rounded-sm border border-line px-1.5 py-0.5">
            <StatusTag status={issue.status} />
          </span>
        </div>
      </header>
```

Replace the description section (currently lines 44–49) with:

```tsx
      {issue.description && (
        <section className="mt-6">
          <h2 className="mb-2 text-[10px] uppercase tracking-widest text-ink-muted">Description</h2>
          <p className="max-w-[68ch] whitespace-pre-wrap font-sans text-[13px] leading-relaxed">
            {issue.description}
          </p>
        </section>
      )}
```

Replace the whole `HandoffPanel` function (currently lines 77–97) with:

```tsx
const handoffTone: Record<string, string> = {
  Done: 'text-success',
  Remaining: 'text-accent',
  Decisions: 'text-ink-muted',
  Uncertain: 'text-st-review',
}

function HandoffPanel({ handoff }: { handoff: Handoff }) {
  const sections: [string, string[]][] = [
    ['Done', handoff.done],
    ['Remaining', handoff.remaining],
    ['Decisions', handoff.decisions],
    ['Uncertain', handoff.uncertain],
  ]
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[10px] uppercase tracking-widest text-ink-muted">Latest handoff</h2>
      <div className="rounded-md border border-line bg-surface-raised px-4 py-3.5">
        <div className="grid gap-x-5 gap-y-3.5 sm:grid-cols-2">
          {sections.filter(([, items]) => items.length > 0).map(([title, items]) => (
            <div key={title}>
              <h3 className={`mb-1.5 text-[10px] uppercase tracking-widest ${handoffTone[title]}`}>
                {title}
              </h3>
              <ul className="list-disc pl-4 font-sans text-[12.5px] leading-relaxed">
                {items.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Run the detail tests and typecheck**

```bash
cd web && npm test -- --run src/features/issues/IssueDetail.test.tsx && npx tsc -b
```

Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/issues/IssueDetail.tsx web/src/features/issues/TransitionBar.tsx
git commit -m "feat(web): restyle issue detail header, transitions and handoff panel"
```

---

## Task 8: Activity and comments with timestamps

This is the one task that puts new information on screen rather than restyling existing information. It was approved explicitly.

**Files:**
- Modify: `web/src/features/issues/IssueDetail.tsx`

**Interfaces:**
- Consumes: `relativeTime`, `shortSession` from `web/src/lib/format.ts` (Task 1)
- Produces: nothing later tasks depend on

- [ ] **Step 1: Write the failing test**

Append this block to `web/src/features/issues/IssueDetail.test.tsx`, inside the existing top-level `describe`. Read the file first: reuse its existing render helper and MSW fixtures rather than duplicating them, and match the fixture's shape for `logs` and `comments`.

```tsx
  it('shows a relative time and short session id for comments', async () => {
    // The fixture's comment carries created_at and session_id, both of which
    // were previously dropped on the floor.
    renderDetail()
    expect(await screen.findByText(/session /)).toBeInTheDocument()
  })
```

If the existing fixture has no comment, add one to it with `session_id: 'ses_d87edf'` and a `created_at` a few hours in the past, then assert `screen.findByText('session d87e')`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && npm test -- --run src/features/issues/IssueDetail.test.tsx
```

Expected: FAIL — the session text is not rendered yet.

- [ ] **Step 3: Add the import**

In `web/src/features/issues/IssueDetail.tsx`:

```tsx
import { relativeTime, shortSession } from '../../lib/format'
```

- [ ] **Step 4: Rewrite the activity section**

Replace the activity `<section>` with:

```tsx
      <section className="mt-6">
        <h2 className="mb-2 text-[10px] uppercase tracking-widest text-ink-muted">Activity</h2>
        <ul>
          {logs.map(log => (
            <li
              key={log.id}
              className="flex items-baseline gap-2.5 border-b border-line-subtle py-1.5 last:border-b-0"
            >
              <span className="w-[66px] shrink-0 text-[10px] tracking-wide text-ink-muted">
                {log.type}
              </span>
              <span className="flex-1 font-sans text-[12.5px]">{log.message}</span>
              <span className="shrink-0 text-[10px] text-ink-faint">
                {relativeTime(log.timestamp)}
              </span>
            </li>
          ))}
        </ul>
      </section>
```

- [ ] **Step 5: Rewrite the comments section**

Replace the comments `<section>` with:

```tsx
      <section className="mt-6">
        <h2 className="mb-2 text-[10px] uppercase tracking-widest text-ink-muted">Comments</h2>
        <ul>
          {comments.map(comment => (
            <li
              key={comment.id}
              className="mb-2 rounded-md border border-line bg-surface-raised px-3 py-2.5"
            >
              <div className="mb-1.5 flex gap-2 text-[10px] text-ink-faint">
                <span>session {shortSession(comment.session_id)}</span>
                <span>·</span>
                <span>{relativeTime(comment.created_at)}</span>
              </div>
              <p className="whitespace-pre-wrap font-sans text-[12.5px] leading-relaxed">
                {comment.text}
              </p>
            </li>
          ))}
        </ul>
        <CommentForm issueId={issue.id} />
      </section>
```

- [ ] **Step 6: Run the detail tests**

```bash
cd web && npm test -- --run src/features/issues/IssueDetail.test.tsx
```

Expected: PASS, including the new test.

- [ ] **Step 7: Commit**

```bash
git add web/src/features/issues/IssueDetail.tsx web/src/features/issues/IssueDetail.test.tsx
git commit -m "feat(web): show timestamps and session ids on activity and comments"
```

---

## Task 9: Forms

**Files:**
- Modify: `web/src/features/issues/IssueForm.tsx`, `web/src/features/issues/CommentForm.tsx`

**Interfaces:**
- Consumes: `ErrorPanel` (Task 4)
- Produces: nothing later tasks depend on

`IssueForm.test.tsx` uses `getByLabelText('Title')` and `getByLabelText('Priority')`, so the visible label text and its `htmlFor`/`id` pairing must survive exactly. No client-side length validation is introduced — td owns those bounds.

- [ ] **Step 1: Run the existing form tests to establish the baseline**

```bash
cd web && npm test -- --run src/features/issues/IssueForm.test.tsx
```

Expected: PASS. Do not modify this file.

- [ ] **Step 2: Restyle the issue form**

In `web/src/features/issues/IssueForm.tsx`, add the import:

```tsx
import ErrorPanel from '../../components/ErrorPanel'
```

Apply these class replacements, leaving all label text, `id` and `htmlFor` values untouched:

| Element | New `className` |
|---|---|
| `<form>` | `max-w-xl space-y-4 px-5 py-4` |
| every `<label>` | `mb-1.5 block text-[10px] uppercase tracking-widest text-ink-muted` |
| `<input id="title">` | `w-full rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 text-ink` |
| `<textarea id="description">` | `w-full rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 font-sans text-[12.5px] text-ink` |
| both `<select>` | `rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 text-ink` |
| submit `<button>` | `rounded-sm border border-accent px-3 py-1 text-[11px] text-accent disabled:opacity-40` |

Replace the success line with:

```tsx
      {create.isSuccess && <p className="text-success">Issue created.</p>}
```

Replace the non-validation error line with:

```tsx
      {create.error instanceof ApiError && create.error.code !== 'validation_error' && (
        <ErrorPanel message={create.error.message} />
      )}
```

Replace the `FieldError` helper's return with:

```tsx
  return <p className="mt-1.5 text-[11px] text-danger">{message}</p>
```

- [ ] **Step 3: Restyle the comment form**

In `web/src/features/issues/CommentForm.tsx`, apply the same treatment:

| Element | New `className` |
|---|---|
| `<form>` | `mt-3` |
| `<label htmlFor="comment">` | `mb-1.5 block text-[10px] uppercase tracking-widest text-ink-muted` |
| `<textarea id="comment">` | `w-full rounded-sm border border-line bg-surface-inset px-2.5 py-2 font-sans text-[12.5px] text-ink` |
| field-error `<p>` | `mt-1.5 text-[11px] text-danger` |
| alert `<p>` | `mt-1.5 text-[11px] text-danger` |
| submit `<button>` | `mt-2 rounded-sm border border-accent px-3 py-1 text-[11px] text-accent disabled:opacity-40` |

- [ ] **Step 4: Run the full suite and typecheck**

```bash
cd web && npm test -- --run && npx tsc -b
```

Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/issues/IssueForm.tsx web/src/features/issues/CommentForm.tsx
git commit -m "feat(web): restyle issue and comment forms"
```

---

## Task 10: Verification

The design is only done when it has been looked at and measured. Nothing here is optional.

**Files:** none modified unless a check fails

- [ ] **Step 1: Run the whole gate**

```bash
cd /home/mne-adm/Git/personal/github.com/td-gui && make test
```

Expected: lint clean, Go tests pass, frontend suite passes.

**Check the output for `--- SKIP` in `test/contract`.** That package drives a real `td` binary and skips silently when `td` is not on PATH, so a green run is weaker than it looks. `td` was not on PATH when this plan was written. Report which of the two happened.

- [ ] **Step 2: Build and run the app**

```bash
make build && ./td-gui
```

- [ ] **Step 3: Verify both themes by eye**

Open the printed URL. Check the list, a detail page and the new-issue form in both themes — switch the OS appearance setting, or use the browser devtools rendering panel to emulate `prefers-color-scheme`.

Confirm: no unstyled area, no invisible text, no element that keeps a light background in dark mode.

- [ ] **Step 4: Verify contrast**

For each text token against the surface it sits on, in both themes, confirm ≥4.5:1 using the devtools colour picker or any contrast checker. The pairs to check:

| Text | On | Both themes |
|---|---|---|
| `ink` | `surface` | required |
| `ink-muted` | `surface` | required |
| `ink-faint` | `surface` and `surface-inset` | required |
| `accent` | `surface-inset` and `accent-bg` | required |
| `danger` | `surface` | required |
| each `st-*` | `surface` and `surface-hover` | required |

Any pair below 4.5:1 gets its token darkened (light) or lightened (dark) in `web/src/index.css`, and the value corrected in the spec's token table.

- [ ] **Step 5: Verify keyboard focus**

Tab through the list, the filter chips, the pagination, a detail page and the form. Every interactive element must show the accent focus ring — including the filter chips, whose real checkbox is `sr-only` and relies on `focus-within` on the label.

- [ ] **Step 6: Commit any corrections**

```bash
git add -A
git commit -m "fix(web): correct contrast and focus issues found in review"
```

Skip this step if nothing needed fixing.

---

## Self-Review Notes

Checked against `docs/superpowers/specs/2026-08-14-td-gui-visual-design.md`:

- **Typography rule** — Task 2 sets mono as the body default; every prose element in Tasks 7–9 carries an explicit `font-sans`. Covered.
- **Colour tokens** — Task 2, complete table, both themes. Covered.
- **Theme mechanism** — Task 2, `@theme inline` with the reason stated in a comment. Covered.
- **Density and focus** — Task 2 base layer plus `py-2` on rows in Task 6 (8px on an 18px line box = 34px). Covered.
- **Application shell** — Task 5. Covered.
- **Issue list, filters, four states** — Task 6. Covered.
- **Issue detail, transitions, handoff** — Task 7. Covered.
- **Activity and comments metadata** — Task 8. Covered.
- **Forms** — Task 9. Covered.
- **Components table** — Tasks 1, 3, 4, 5 create all seven, with `lib/time.ts` renamed to `lib/format.ts` as documented above.
- **`App.css` deletion and title fix** — Task 2. Covered.
- **Testing section** — format tests (Task 1), `StatusTag` unknown-value test (Task 3), `ErrorPanel` verbatim test (Task 4). Covered.
- **Contrast and focus verification** — Task 10, with the exact pairs listed. Covered.
- **Risks** — the jsdom limitation is stated in Task 2; the contract-test skip in Task 10; row density is one token, noted in Task 2.

Type consistency: `relativeTime` / `shortSession` are named identically in Tasks 1 and 8. `<StatusTag status>` and `<PriorityTag priority>` match between Tasks 3, 6 and 7. `<ErrorPanel message label>` matches between Tasks 4, 6, 7 and 9. `<EmptyState message hint>` and `<SkeletonRows rows>` match between Tasks 4 and 6. `<AppShell connected>` matches between Tasks 5 and its own usage in `App.tsx`.
