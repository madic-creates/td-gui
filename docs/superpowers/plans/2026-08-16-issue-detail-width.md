# Issue Detail Width and Column Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the issue detail view from stacking seven rows above a 68ch column inside an unbounded page, and give it a capped, centred page width with a prose column and a structure/log column side by side.

**Architecture:** Four changes, in dependency order. `AppShell` centres the page at `max-w-[1440px]`. `IssueActions` drops its root element and returns a fragment, so its error panel can span a grid row instead of rendering at button width. `IssueDetail`'s header becomes a four-row band above the body instead of seven rows inside its first column. Finally the body nests a second grid inside today's `1fr` track, splitting it into prose and structure from `xl` (1280px) upward.

**Tech Stack:** React 19, react-router, Tailwind CSS v4 (default breakpoints: `sm` 640, `md` 768, `lg` 1024, `xl` 1280), Vitest + Testing Library, MSW.

Spec: `docs/superpowers/specs/2026-08-16-issue-detail-width-design.md`

## Global Constraints

- **English only.** UI strings, code, comments, commit messages. No i18n layer.
- **Error text from td is displayed verbatim** — never rewritten, never truncated, and never squeezed into a column too narrow to read. This is why Task 2 exists in the shape it does.
- **No hardcoded field limits in the frontend.** Nothing in this plan validates anything; do not add validation.
- **Conventional Commits with a package scope.** Every commit here is `refactor(web):`.
- **Frontend commands run from `web/`.** Bare `npm test` watches in an interactive terminal; always use `npm test -- --run`.
- **`make typecheck` is the fastest check of a frontend edit.** `make test` lints first, and a lint failure stops the run before any test executes.
- **This is layout work.** No mutation, query, cache, or error-handling path may change behaviour. If a step tempts you to touch `useMutation`, `useQuery`, or a `mutate` callback, you have gone off the plan.
- **No test may assert on a Tailwind class name.** A test reading `className` passes on a broken layout and fails on an identical one. Every test below asserts a DOM relationship — shared parents, absent wrappers — or component identity across a state change.
- **Baseline is 384 frontend tests passing.** This plan adds 7, for 391 at the end.

---

### Task 1: Cap and centre the page width

**Files:**
- Modify: `web/src/components/AppShell.tsx:17-51`
- Test: `web/src/components/AppShell.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing later tasks depend on. `AppShell`'s props (`{ connected: boolean, children: ReactNode }`) are unchanged.

Today `AppShell` renders `<main>{children}</main>` with no width bound, so every view stretches to the window. The header's `border-b` must keep spanning the full window while its contents centre with the body — otherwise the rule stops short of the edges and the header reads as a boxed panel rather than the top of the page. That means an inner wrapper inside `<header>`, not a class on `<header>` itself.

`ConnectionBanner` stays full-bleed: it warns about the whole app, and it already renders as an edge-to-edge bar with its own border.

- [ ] **Step 1: Write the failing test**

Add both tests to `web/src/components/AppShell.test.tsx`, inside the existing `describe('AppShell', …)` block. The file already has a `renderShell(connected: boolean)` helper — use it.

```tsx
  // The rule under the header has to reach both window edges while the logo
  // lines up closely with the body below it, so <header> stays full-bleed and only an
  // inner wrapper is capped. A cap on <header> itself would stop the border
  // short and turn the header into a boxed panel.
  it('caps the header contents in a wrapper rather than capping the header', () => {
    renderShell(true)
    const header = screen.getByRole('banner')
    const brand = screen.getByText('td-gui')

    expect(header).toContainElement(brand)
    expect(brand.parentElement).not.toBe(header)
    expect(brand.parentElement?.parentElement).toBe(header)
  })

  // A regression guard rather than a red test: the route content is already in
  // the main landmark, and wrapping <main> in anything that broke that would
  // cost every view its landmark.
  it('keeps the route content inside the main landmark', () => {
    renderShell(true)
    expect(screen.getByRole('main')).toContainElement(screen.getByText('route content'))
  })
```

- [ ] **Step 2: Run the tests to verify the first one fails**

```bash
cd web && npm test -- --run src/components/AppShell.test.tsx
```

Expected: `caps the header contents in a wrapper rather than capping the header` FAILS on `expect(brand.parentElement).not.toBe(header)` — today the brand link is a direct child of `<header>`. The second test passes; it is the stated guard, not a red test.

- [ ] **Step 3: Add the width cap**

Replace the entire `return (…)` block in `web/src/components/AppShell.tsx` (lines 17-51) with:

```tsx
  return (
    <div className="min-h-screen bg-surface text-ink">
      {/* The border spans the window; only the contents centre. A cap on the
          <header> itself would stop the rule short of both edges and read as a
          boxed panel rather than the top of the page. */}
      <header className="border-b border-line bg-surface-inset">
        <div className="mx-auto flex w-full max-w-[1440px] items-center gap-2.5 px-4 py-2.5">
          <Link to="/" className="font-mono font-semibold tracking-widest text-accent">td-gui</Link>
          <span className="flex-1" />
          <span className="flex items-center gap-1.5 text-[11px] text-ink-muted">
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-success' : 'bg-warn'}`}
            />
            {connected ? 'connected' : 'disconnected'}
          </span>
          <ThemeToggle />
          <Link
            to="/boards"
            data-button
            className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted"
          >
            Boards
          </Link>
          <Link
            to="/new"
            data-button
            className="rounded-sm border border-accent px-2.5 py-1 text-[11px] text-accent"
          >
            New issue
          </Link>
        </div>
      </header>

      {/* Full-bleed on purpose: this warns about the whole app, not about the
          view inside the capped column. */}
      <ConnectionBanner connected={connected} />

      <main className="mx-auto w-full max-w-[1440px]">{children}</main>
    </div>
  )
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd web && npm test -- --run src/components/AppShell.test.tsx
```

Expected: PASS, every test in the file.

- [ ] **Step 5: Check the whole suite and the types**

```bash
make typecheck && cd web && npm test -- --run
```

Expected: `tsc -b` silent, **386 tests passed**.

`SwimlaneView` already scrolls horizontally (`web/src/features/boards/SwimlaneView.tsx:89`, `overflow-x-auto`), so the narrower container makes it scroll sooner rather than break. If a board test fails here, stop and report — that would mean something else assumed an unbounded page.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/AppShell.tsx web/src/components/AppShell.test.tsx
git commit -m "refactor(web): cap and centre the page at 1440px"
```

---

### Task 2: Let IssueActions lay out in its host's grid

**Files:**
- Modify: `web/src/features/issues/IssueActions.tsx:80-119`
- Test: `web/src/features/issues/IssueActions.test.tsx`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `IssueActions` renders **no root element** — it returns a fragment whose first child is the button row `<div>` and whose optional second child is the error panel wrapper carrying `col-span-full`. Task 3 places the component directly inside a two-column grid and depends on exactly this. Props are unchanged: `{ issue: Issue, editing: boolean, onEdit: () => void }`.

The component currently wraps everything in `<div className="mt-3">`. Task 3 puts the button row in the right-hand cell of a header grid, beside the tag row. With the wrapper in place the whole component would be one grid item, and the `ErrorPanel` beneath the buttons would render at the width of three buttons — td's rejection wording folded into a sliver. Dropping the root makes both parts direct grid items, so the panel can claim a full row.

`mt-3` goes with the root: the spacing between header rows becomes the grid's `gap-y`, owned by the parent in Task 3.

- [ ] **Step 1: Write the failing test**

Add to `web/src/features/issues/IssueActions.test.tsx`, inside the existing `describe('IssueActions', …)` block. The file already has a `renderActions(over = {})` helper that spreads Testing Library's utils, so `container` is available from it.

```tsx
  // td phrases action rejections precisely and the GUI shows them unchanged,
  // which includes giving them room to be read. This component renders no root
  // element of its own so its host can put the buttons in one grid cell while
  // the rejection panel spans a full row underneath them.
  it('renders no wrapper element of its own', async () => {
    const { container } = renderActions()
    const edit = await screen.findByRole('button', { name: 'Edit' })

    expect(edit.parentElement?.parentElement).toBe(container)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && npm test -- --run src/features/issues/IssueActions.test.tsx
```

Expected: FAIL — today the chain is button → `div.flex` → `div.mt-3` → container, so `edit.parentElement.parentElement` is the `mt-3` wrapper, not the container.

- [ ] **Step 3: Drop the root element**

Replace the `return (…)` block in `web/src/features/issues/IssueActions.tsx` (lines 80-119) with:

```tsx
  return (
    // No wrapper element on purpose. The host — IssueDetail's header — is a
    // grid, and this returns two grid items rather than one: the button row
    // takes a cell beside the tag row, and the panel below takes a row of its
    // own. Wrapped, td's rejection wording would render at the width of three
    // buttons. Vertical spacing is the grid's gap, not a margin here.
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={handleEdit}
          className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink"
        >
          {editing ? 'Close editor' : 'Edit'}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={handleFocus}
          className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted disabled:opacity-40"
        >
          Focus
        </button>

        {/* An acknowledgement of the request, not a reading of focus state:
            td exposes no GET for it, so the GUI cannot know what is focused. */}
        {focusAck && <span className="text-[11px] text-success">focus set</span>}

        <ConfirmButton
          label="Delete"
          question="Delete this issue?"
          disabled={busy}
          onConfirm={handleDelete}
        />
      </div>

      {/* Nothing here binds a field, so every message td sends belongs here.
          `col-span-full` is inert outside a grid, so this degrades to a plain
          block if the component is ever hosted somewhere else. */}
      {panelError && (
        <div className="col-span-full">
          <ErrorPanel label="Action rejected" message={panelError} />
        </div>
      )}
    </>
  )
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd web && npm test -- --run src/features/issues/IssueActions.test.tsx src/features/issues/IssueDetail.test.tsx
```

Expected: PASS in both files. `IssueDetail.test.tsx:251` asserts that opening the editor does not remount `IssueActions` — it must stay green here and in Task 3.

The view is visibly wrong at this point: the buttons have lost their top margin and nothing has given it back yet. That is expected, and Task 3 supplies it. **Do not add a margin to compensate.**

- [ ] **Step 5: Commit**

```bash
git add web/src/features/issues/IssueActions.tsx web/src/features/issues/IssueActions.test.tsx
git commit -m "refactor(web): let IssueActions lay out in its host's grid"
```

---

### Task 3: Condense the header from seven rows to four

**Files:**
- Modify: `web/src/features/issues/IssueDetail.tsx:73-103`
- Modify: `web/src/features/issues/TransitionBar.tsx:159`
- Test: `web/src/features/issues/IssueDetail.test.tsx`

**Interfaces:**
- Consumes: `IssueActions` from Task 2 — no root element, two fragment children, the second carrying `col-span-full`.
- Produces: the header is a band above the body grid, and the grid's first cell is a plain `<div>` holding every section. Task 4 splits that `<div>` into two columns and must not move the header back inside it.

Today seven rows stack above the description: back link, mono id, title, tag row, action bar, a horizontal rule, and the transitions. The target is four:

| Row | Content |
| --- | --- |
| 1 | `← back to list` · the mono issue id, on one baseline |
| 2 | The title (`IssueEditForm` renders it) |
| 3 | The tag row left, the action buttons right |
| 4 | The transition buttons, with no rule above them |

`IssueActions` moves one level deeper in the tree — from a direct child of `IssueEditForm`'s `children` to a child of the new grid. `IssueEditForm`'s documented constraint is that *a move is a remount*, and that constraint is about a remount within a live session, caused by `editing` toggling. The new structure is identical in both editing states, so nothing remounts while the page is open. `IssueDetail.test.tsx:251` is the guard.

- [ ] **Step 1: Write the failing tests**

Add both to `web/src/features/issues/IssueDetail.test.tsx`, inside the existing `describe('IssueDetail', …)` block. The file has a `renderDetail()` helper and a `detail` fixture whose issue is `td-6a0883` / `Probe issue for API shape` / `A description`.

```tsx
  // The back link and the id share a row rather than stacking — one of the
  // merges that got seven header rows down to four. Asserting on the shared
  // parent, not on classes: a class assertion passes on a layout that renders
  // stacked anyway.
  it('puts the back link and the issue id on one row', async () => {
    server.use(http.get('/v1/issues/td-6a0883', () =>
      HttpResponse.json({ ok: true, data: detail })))

    renderDetail()
    const back = await screen.findByRole('link', { name: '← back to list' })

    expect(back.parentElement).toBe(screen.getByText('td-6a0883').parentElement)
  })

  // The header is a band above the body, not the body column's first child.
  // The open editor's field grid is sm:grid-cols-4 and needs the page width,
  // not the 68ch prose column Task 4 introduces.
  it('lifts the header out of the body column', async () => {
    server.use(http.get('/v1/issues/td-6a0883', () =>
      HttpResponse.json({ ok: true, data: detail })))

    renderDetail()
    const title = await screen.findByRole('heading', { name: 'Probe issue for API shape' })
    const header = title.closest('header')
    const descriptionSection = screen.getByText('A description').closest('section')

    expect(header).not.toBeNull()
    expect(header?.parentElement).not.toBe(descriptionSection?.parentElement)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd web && npm test -- --run src/features/issues/IssueDetail.test.tsx
```

Expected: `puts the back link and the issue id on one row` and `lifts the header out of the body column` both FAIL; every other test in the file passes. Today the back link sits in the outer `div` while the id sits inside `<header>`, and `<header>` shares its parent with every section.

(Vitest's `-t` takes a single pattern — a second `-t` replaces the first rather than adding to it, so run the file and read the two failures.)

- [ ] **Step 3: Restructure the header**

In `web/src/features/issues/IssueDetail.tsx`, replace lines 73-103 — from `return (` through the `<TransitionBar … />` line — with:

```tsx
  return (
    <div className="px-5 py-4 pb-6">
      {/* Row 1. The id is the page's other name for what the title says, so it
          belongs on the navigation line rather than owning a row of its own. */}
      <div className="flex items-baseline gap-2 text-[11px]">
        <Link to="/" className="text-ink-muted">← back to list</Link>
        <span aria-hidden="true" className="text-ink-faint">·</span>
        <span className="font-mono text-ink-faint">{issue.id}</span>
      </div>

      {/* Rows 2 and 3. The title is the edit form's first field, so the form
          owns it in both states and the tag row and action bar are nested
          inside — the one arrangement that edits the title where it is read
          without moving IssueActions, whose place in the tree is load-bearing
          (see IssueEditForm). The band sits above the body grid rather than in
          its first cell: the open editor's field grid is sm:grid-cols-4 and
          would be unusable inside a 68ch column. */}
      <header className="mt-2">
        <IssueEditForm issue={issue} editing={editing} onDone={() => setEditing(false)}>
          {/* Two columns, so the tags and the action buttons share row 3.
              IssueActions renders no wrapper of its own: its button row takes
              the right-hand cell, and a rejection panel spans a full row
              underneath rather than rendering at button width. */}
          <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2">
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="rounded-sm border border-line px-1.5 py-0.5 font-mono text-ink-muted">
                {issue.type}
              </span>
              <span className="rounded-sm border border-line px-1.5 py-0.5">
                <PriorityTag priority={issue.priority} />
              </span>
              <span className="rounded-sm border border-line px-1.5 py-0.5">
                <StatusTag status={issue.status} />
              </span>
            </div>

            <IssueActions issue={issue} editing={editing} onEdit={() => setEditing(!editing)} />
          </div>
        </IssueEditForm>
      </header>

      {/* Row 4. */}
      <TransitionBar issueId={issue.id} available={issue.available_transitions} />

      {/* No top margin here: the sections inside own their mt-6, which is the
          same distance the description already kept from the header. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div>
```

Everything from the old line 105 (`{!editing && issue.description && (`) onward stays exactly as it is, closing tags included — the replacement re-opens the grid and its first cell, so the brackets stay balanced. Task 4 restructures that part.

- [ ] **Step 4: Remove the rule above the transitions**

In `web/src/features/issues/TransitionBar.tsx`, change line 159 from:

```tsx
  return (
    <div className="mt-4 border-t border-line-subtle pt-4">
```

to:

```tsx
  return (
    /* No rule above the buttons: mt-2 is a small gap from whatever the host
       puts above this bar, not a section boundary. A rule here would split
       one control bar into two; each host explains what sits above and
       carries its own separator if it wants one — see IssueDetail's header
       band and BoardTransitionPanel's wrapper. */
    <div className="mt-2">
```

A plain `/* … */` block comment, not a JSX `{/* … */}` one: this sits directly
inside `return (`, in expression position rather than JSX-children position,
so a curly-braced comment there would parse as an empty object literal
followed by a second, unrelated expression — two children in a return, a
syntax error.

`TransitionBar` is also mounted by `BoardTransitionPanel`. Check what that host gives it:

```bash
grep -n "TransitionBar" web/src/features/boards/BoardTransitionPanel.tsx
```

If the panel relied on the rule to separate the bar from what sits above it, add the separator **there**, not back here.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd web && npm test -- --run src/features/issues src/features/boards
```

Expected: PASS. Watch `IssueDetail.test.tsx:251` (opening the editor must not remount `IssueActions`) and `BoardTransitionPanel.test.tsx` in particular.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/issues/IssueDetail.tsx web/src/features/issues/IssueDetail.test.tsx web/src/features/issues/TransitionBar.tsx
git commit -m "refactor(web): condense the issue header from seven rows to four"
```

---

### Task 4: Split the body into a prose column and a structure column

**Files:**
- Modify: `web/src/features/issues/IssueDetail.tsx` — the body grid's first cell
- Test: `web/src/features/issues/IssueDetail.test.tsx`

**Interfaces:**
- Consumes: Task 3's header band and re-opened body grid.
- Produces: the final structure. Nothing follows.

The outer grid stays exactly as Task 3 left it — `lg:grid-cols-[minmax(0,1fr)_260px]`, main column and sidebar. A second grid nests inside the `1fr` track and splits it, from `xl` (1280px) upward only:

```
grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]
  ├ grid gap-x-6 xl:grid-cols-[minmax(0,68ch)_minmax(0,1fr)]
  │   ├ prose      Description · Acceptance criteria · Latest handoff ·
  │   │            Comments and the comment form
  │   └ structure  Depends on / Resolved and the add-dependency form ·
  │                Blocks · Tasks · Activity
  └ aside          MetaPanel · ReviewPanel
```

Nested rather than a flat three-column grid: a flat `grid-cols-3` with three children would wrap the sidebar under the first column at `lg`, where only two tracks exist. Nesting leaves the outer grid untouched and subdivides one track.

Track sizing is `[minmax(0,68ch) minmax(0,1fr)]`, not two equal halves: the prose track takes exactly the measure the paragraphs already use, and everything left over goes to the log column, so no track carries slack. Below `xl` the inner grid is single-column — today's stacking. Sections keep their own `mt-6`, so the grid takes `gap-x-6` only and no row gap.

Stacked, Comments now reads just after the handoff rather than last. That is the accepted cost of putting it in the prose column; **do not add ordering utilities to work around it.**

- [ ] **Step 1: Write the failing tests**

Add both to `web/src/features/issues/IssueDetail.test.tsx`, inside the existing `describe('IssueDetail', …)` block.

```tsx
  // Prose and machine record are separate columns from 1280px up, so what a
  // person wrote about the issue and what happened to it can be read side by
  // side. Asserting on the grouping rather than the breakpoint: the columns are
  // the same two elements at every width, and only the track count changes.
  it('groups the prose apart from the activity log', async () => {
    server.use(http.get('/v1/issues/td-6a0883', () =>
      HttpResponse.json({ ok: true, data: detail })))

    renderDetail()
    const description = await screen.findByText('A description')
    const proseColumn = description.closest('section')?.parentElement
    const structureColumn = screen.getByText('Activity').closest('section')?.parentElement

    expect(proseColumn).toBeTruthy()
    expect(proseColumn).not.toBe(structureColumn)
    expect(proseColumn?.parentElement).toBe(structureColumn?.parentElement)
  })

  // The comment form travels with the comments, into the prose column — it is
  // the other half of what a person writes about an issue.
  it('keeps the comment form with the comments', async () => {
    server.use(http.get('/v1/issues/td-6a0883', () =>
      HttpResponse.json({ ok: true, data: detail })))

    renderDetail()
    const comment = await screen.findByText(
      'The handoff panel should collapse past ten items per group.')
    const submit = screen.getByRole('button', { name: 'Add comment' })

    expect(comment.closest('section')).toBe(submit.closest('section'))
  })
```

- [ ] **Step 2: Run the tests to verify the first one fails**

```bash
cd web && npm test -- --run src/features/issues/IssueDetail.test.tsx -t 'groups the prose'
```

Expected: FAIL on `expect(proseColumn).not.toBe(structureColumn)` — every section is a child of the same single `<div>` today.

- [ ] **Step 3: Split the column**

In `web/src/features/issues/IssueDetail.tsx`, replace the body grid's first cell — the `<div>` opened at the end of Task 3, through its closing `</div>` just before `<aside>` — with the following. Every section body below is the current file's, moved unchanged.

```tsx
        {/* One track below xl — today's stacking, untouched. From 1280px the
            main column splits: what a person wrote about the issue on the
            left, what it is connected to and what happened to it on the right.
            Nested rather than a flat three-column grid, which at lg would wrap
            the sidebar under the first column. The prose track takes exactly
            its 68ch measure and the log column takes the remainder, so neither
            carries slack. Row gaps stay with the sections' own mt-6. */}
        <div className="grid gap-x-6 xl:grid-cols-[minmax(0,68ch)_minmax(0,1fr)]">
          <div>
            {!editing && issue.description && (
              <section className="mt-6">
                <h2 className="mb-2 text-[11px] uppercase tracking-widest text-ink-muted">Description</h2>
                <p className="max-w-[68ch] whitespace-pre-wrap leading-relaxed">
                  {issue.description}
                </p>
              </section>
            )}

            {/* Verbatim, like the description: td stores one text field, and the
                leading dashes the CLI writes are the author's, not a list this view
                gets to re-render as markup. */}
            {!editing && issue.acceptance && (
              <section className="mt-6">
                <h2 className="mb-2 text-[11px] uppercase tracking-widest text-ink-muted">
                  Acceptance criteria
                </h2>
                <p className="max-w-[68ch] whitespace-pre-wrap leading-relaxed">
                  {issue.acceptance}
                </p>
              </section>
            )}

            {latest_handoff && <HandoffPanel handoff={latest_handoff} />}

            <section className="mt-6">
              <h2 className="mb-2 text-[11px] uppercase tracking-widest text-ink-muted">Comments</h2>
              {comments.length === 0 && <EmptyLine>No comments yet.</EmptyLine>}
              <ul>
                {comments.map(comment => (
                  <li
                    key={comment.id}
                    className="mb-2 rounded-md border border-line bg-surface-raised px-3 py-2.5"
                  >
                    <div className="mb-1.5 flex items-center gap-2 font-mono text-[11px] text-ink-faint">
                      <span>session {shortSession(comment.session_id)}</span>
                      <span>·</span>
                      <span>{relativeTime(comment.created_at)}</span>
                      <span className="ml-auto">
                        <ConfirmButton
                          label="Delete comment"
                          question="Delete this comment?"
                          disabled={deleteComment.isPending}
                          onConfirm={() => deleteComment.mutate(comment.id)}
                        />
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap leading-relaxed">
                      {comment.text}
                    </p>
                  </li>
                ))}
              </ul>
              {/* deleteComment is one shared mutation for every comment in the
                  list, so its error is not scoped to a single row — surfacing it
                  once here (rather than per-row, which would wrongly imply every
                  comment failed) still puts td's message where it can be read,
                  instead of dropping it. */}
              {deleteComment.error && (
                <div className="mt-3">
                  <ErrorPanel
                    label="Delete failed"
                    message={deleteComment.error instanceof ApiError
                      ? deleteComment.error.message
                      : String(deleteComment.error)}
                  />
                </div>
              )}
              <CommentForm issueId={issue.id} />
            </section>
          </div>

          <div>
            <DependencyPanel
              issueId={issue.id} dependencies={dependencies} blockedBy={blocked_by} />

            <RelatedIssues title="Blocks" items={blocks} />
            <RelatedIssues title="Tasks" items={tasks} />

            <section className="mt-6">
              <h2 className="mb-2 text-[11px] uppercase tracking-widest text-ink-muted">Activity</h2>
              {logs.length === 0 && <EmptyLine>No activity yet.</EmptyLine>}
              <ul>
                {logs.map(log => (
                  <li
                    key={log.id}
                    className="flex items-baseline gap-2.5 border-b border-line-subtle py-1.5 last:border-b-0"
                  >
                    <span className="w-[66px] shrink-0 font-mono text-[11px] tracking-wide text-ink-muted">
                      {log.type}
                    </span>
                    <span className="flex-1">{log.message}</span>
                    <span className="shrink-0 font-mono text-[11px] text-ink-faint">
                      {relativeTime(log.timestamp)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
```

- [ ] **Step 4: Run the detail tests**

```bash
cd web && npm test -- --run src/features/issues/IssueDetail.test.tsx
```

Expected: PASS, every test in the file — including the three empty-state tests this branch builds on (`says so when the issue has no activity`, `says so when the issue has no comments`, `drops both empty states once the sections have rows`).

- [ ] **Step 5: Verify no section was lost in the move**

```bash
grep -n "Description\|Acceptance criteria\|Activity\|Comments\|CommentForm\|HandoffPanel\|DependencyPanel\|RelatedIssues\|MetaPanel\|ReviewPanel\|EmptyLine" web/src/features/issues/IssueDetail.tsx
```

Expected: each section appears exactly once in the JSX (plus its import and, for `HandoffPanel` and `EmptyLine`, their definitions lower in the file). Moving JSX by hand is where a section quietly goes missing, and the tests only cover the ones they name.

- [ ] **Step 6: Full check**

```bash
make test
```

Expected: lint clean, `tsc -b` silent, every Go package `ok`, **391 frontend tests passed**. If the count differs, reconcile it before committing rather than assuming.

Check the Go output for `--- SKIP`: `test/contract` drives a real `td` binary and skips itself when `td` is not on PATH, and a skipped contract package still prints `ok`.

- [ ] **Step 7: Commit**

```bash
git add web/src/features/issues/IssueDetail.tsx web/src/features/issues/IssueDetail.test.tsx
git commit -m "refactor(web): split the issue body into prose and structure columns"
```

---

### Task 5: Verify in the running app

**Files:** none modified unless a defect is found.

**Interfaces:**
- Consumes: Tasks 1-4, all committed.
- Produces: nothing.

Every preceding task asserts DOM relationships, which is all a test can honestly assert about layout. Whether the result reads well at a given width is not something jsdom can answer, so it gets checked in a browser.

- [ ] **Step 1: Build and run**

```bash
make build && ./td-gui
```

If the binary name or invocation differs, read the `Makefile` for the real target rather than guessing. The server binds `127.0.0.1` only.

- [ ] **Step 2: Check a content-rich issue at roughly 1600px**

Open an issue that has a description, dependencies, activity and at least one comment — `td list` will name candidates. Confirm:

- The header is four rows: back link and id together, title, tags beside the action buttons, transitions with no rule above them.
- The content stops at 1440px and is centred, while the header's bottom border still reaches both window edges.
- Description and Activity sit side by side, and Activity is above the fold.
- The metadata sidebar is the rightmost of three columns.

- [ ] **Step 3: Check the two widths that change behaviour**

Resize to roughly 1200px (below `xl`): the body falls back to one main column plus the sidebar, stacked description → acceptance → handoff → comments → dependencies → blocks → tasks → activity. Then roughly 900px (below `lg`): everything stacks in one column with the sidebar last.

- [ ] **Step 4: Check the open editor**

Click `Edit`. The field grid — `sm:grid-cols-4`, type, priority, points, and the rest — must lay out across the page width, not inside a ~506px column. Close the editor without saving.

- [ ] **Step 5: Check an error path at width**

Trigger a rejected transition: `Approve` on an issue this session implemented earns td's `you implemented this issue, so you cannot approve it`. The message must render at readable width, not squeezed into the right-hand header cell. Do the same for a rejected dependency — adding `td-zzzzzz` earns an `issue not found` from td.

- [ ] **Step 6: Check both themes**

Toggle the theme. Nothing here touches colour tokens, so this checks that no hardcoded surface slipped into the new wrappers.

- [ ] **Step 7: Record the outcome**

```bash
td log "Verified the new issue detail layout in the browser at 1600, 1200 and 900px, both themes, editor open, with a rejected transition and a rejected dependency on screen"
```

If any step failed, fix it, add a test that would have caught it where one honestly can, and commit before moving on.

---

## Finishing

```bash
td link td-5d10d5 web/src/components/AppShell.tsx web/src/features/issues/IssueDetail.tsx web/src/features/issues/IssueActions.tsx web/src/features/issues/TransitionBar.tsx
td handoff td-5d10d5 \
  --done "1440px page cap in AppShell, issue header condensed from seven rows to four, body split into prose and structure columns from xl up" \
  --remaining "Nothing — verified in the browser at three widths and both themes" \
  --decision "Actions and transitions stay on separate rows: TransitionBar renders its own form and IssueEditForm is a form, so nesting them would be invalid HTML. IssueActions dropped its root element instead, so its rejection panel spans the header grid rather than rendering at button width."
td review td-5d10d5
```

Do not run `td approve` — this session implemented the work, and routing writes through td's review policy is the point.
