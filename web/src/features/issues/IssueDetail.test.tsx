import { Fragment, StrictMode } from 'react'
import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import IssueDetail from './IssueDetail'
import { issueKeys } from '../../api/queries'

const server = setupServer(
  // The edit form's label autocomplete. Registered once so opening the editor
  // does not trip onUnhandledRequest in every test that clicks Edit.
  http.get('/v1/labels', () =>
    HttpResponse.json({ ok: true, data: { default_workflow: 'standard', labels: [] } })),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const detail = {
  issue: {
    id: 'td-6a0883', title: 'Probe issue for API shape', description: 'A description',
    status: 'in_progress', type: 'feature', priority: 'P1', points: 0, labels: [],
    parent_id: null, acceptance: '', sprint: '', implementer_session: 'ses_d87edf',
    creator_session: 'ses_d87edf', reviewer_session: null,
    review_requested_by_session: null, closed_by_session: null,
    created_at: '2026-08-14T15:01:46+02:00', updated_at: '2026-08-14T15:04:10+02:00',
    reviewed_at: null, closed_at: null, deleted_at: null, minor: false,
    created_branch: null, defer_until: null, due_date: null, defer_count: 0,
    available_transitions: ['review', 'block', 'close'],
  },
  logs: [{
    id: 'lg-a9e03af6', issue_id: 'td-6a0883', session_id: 'ses_d87edf',
    work_session_id: '', message: 'Started work', type: 'progress',
    timestamp: '2026-08-14T15:04:10+02:00',
  }],
  comments: [{
    id: 'cm-1f0a2b3c', issue_id: 'td-6a0883', session_id: 'ses_d87edf',
    text: 'The handoff panel should collapse past ten items per group.',
    created_at: '2026-08-14T15:04:10+02:00',
  }],
  dependencies: [],
  blocked_by: [],
  latest_handoff: {
    id: 'ho-22111a5e', issue_id: 'td-6a0883', session_id: 'ses_d87edf',
    done: ['done bits'], remaining: ['remaining bits'],
    decisions: ['a decision'], uncertain: ['an open question'],
    timestamp: '2026-08-14T15:04:10+02:00',
  },
}

/**
 * `strict` mirrors main.tsx, which wraps the app in StrictMode: React mounts,
 * runs every effect's cleanup, then mounts again. Anything that only sets up
 * once and tears down on cleanup is dead from the second mount on — which is
 * what `npm run dev` actually runs.
 */
function renderDetail({ strict = false } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const Wrapper = strict ? StrictMode : Fragment
  return { qc, ...render(
    <Wrapper>
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/issues/td-6a0883']}>
        <Routes>
          <Route path="/issues/:id" element={<IssueDetail />} />
          {/* A stand-in for the list route, so a delete's navigate('/') has
              somewhere distinguishable to land — proving navigation actually
              fired, not just that the DELETE request went out. */}
          <Route path="/" element={<p>issue list stand-in</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
    </Wrapper>,
  ) }
}

describe('IssueDetail', () => {
  it('reads the issue from the nested `issue` key', async () => {
    server.use(http.get('/v1/issues/td-6a0883', () =>
      HttpResponse.json({ ok: true, data: detail })))

    renderDetail()
    expect(await screen.findByText('Probe issue for API shape')).toBeInTheDocument()
    expect(screen.getByText('A description')).toBeInTheDocument()
    expect(screen.getByText('Started work')).toBeInTheDocument()
    expect(screen.getByText('done bits')).toBeInTheDocument()
  })

  // The editor has always been able to write them, so a view that never shows
  // them hides a field the user just filled in.
  it('renders the acceptance criteria', async () => {
    const issue = { ...detail.issue, acceptance: '- The panel collapses past ten items' }
    server.use(http.get('/v1/issues/td-6a0883', () =>
      HttpResponse.json({ ok: true, data: { ...detail, issue } })))

    renderDetail()
    expect(await screen.findByText('Acceptance criteria')).toBeInTheDocument()
    expect(screen.getByText('- The panel collapses past ten items')).toBeInTheDocument()
  })

  it('omits the acceptance section when the issue has none', async () => {
    server.use(http.get('/v1/issues/td-6a0883', () =>
      HttpResponse.json({ ok: true, data: detail })))

    renderDetail()
    await screen.findByText('Probe issue for API shape')
    expect(screen.queryByText('Acceptance criteria')).not.toBeInTheDocument()
  })

  // The UI must render exactly what td permits, never a status-based guess.
  it('renders only the available transitions', async () => {
    server.use(http.get('/v1/issues/td-6a0883', () =>
      HttpResponse.json({ ok: true, data: detail })))

    renderDetail()
    expect(await screen.findByRole('button', { name: 'Request review' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Block' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('shows no transition buttons when the field is absent', async () => {
    const issue = { ...detail.issue }
    delete (issue as Partial<typeof detail.issue>).available_transitions
    server.use(http.get('/v1/issues/td-6a0883', () =>
      HttpResponse.json({ ok: true, data: { ...detail, issue } })))

    renderDetail()
    await screen.findByText('Probe issue for API shape')
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  })

  // The load-bearing error case: td's policy wording must reach the user.
  it("shows td's policy rejection verbatim when a transition is refused", async () => {
    const rejection = 'you implemented this issue, so you cannot approve it'
    server.use(
      http.get('/v1/issues/td-6a0883', () => HttpResponse.json({ ok: true, data: detail })),
      http.post('/v1/issues/td-6a0883/close', () =>
        HttpResponse.json({ ok: false, error: { code: 'forbidden', message: rejection } },
          { status: 403 })),
    )

    renderDetail()
    // Close takes an optional reason, so it confirms through the form.
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm close' }))
    expect(await screen.findByText(rejection)).toBeInTheDocument()
  })

  // session_id and created_at already arrive from td but were previously
  // dropped. The id is shortened by stripping td's constant `ses_` prefix.
  it('shows a shortened session id on each comment', async () => {
    server.use(http.get('/v1/issues/td-6a0883', () =>
      HttpResponse.json({ ok: true, data: detail })))

    renderDetail()
    expect(await screen.findByText('session d87e')).toBeInTheDocument()
    expect(screen.getByText(/handoff panel should collapse/)).toBeInTheDocument()
  })

  it('deletes the issue after a confirmation and leaves the detail view', async () => {
    let deleted = false
    server.use(
      http.get('/v1/issues/td-6a0883', () => HttpResponse.json({ ok: true, data: detail })),
      http.delete('/v1/issues/td-6a0883', () => {
        deleted = true
        return HttpResponse.json({ ok: true, data: { deleted: true } })
      }),
      http.get('/v1/issues', () => HttpResponse.json({
        ok: true, data: { issues: [], limit: 50, offset: 0, total: 0, has_more: false },
      })),
    )
    renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(deleted).toBe(true))
    // The detail route unmounts and the stand-in list route renders — proof
    // that navigate('/') actually fired, not just that the DELETE went out.
    expect(await screen.findByText('issue list stand-in')).toBeInTheDocument()
    expect(screen.queryByText('Probe issue for API shape')).not.toBeInTheDocument()
  })

  it('sets focus and acknowledges the request without claiming to read it', async () => {
    let body: unknown
    server.use(
      http.get('/v1/issues/td-6a0883', () => HttpResponse.json({ ok: true, data: detail })),
      http.put('/v1/focus', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ ok: true, data: { focused_issue_id: 'td-6a0883' } })
      }),
    )
    renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: 'Focus' }))

    await waitFor(() => expect(body).toEqual({ issue_id: 'td-6a0883' }))
    expect(await screen.findByText('focus set')).toBeInTheDocument()
  })

  // The acknowledgement *is* the feature — td exposes no focus state to read
  // back — so a guard that goes permanently false after StrictMode's second
  // mount makes Focus silently do nothing visible under `npm run dev`.
  it('acknowledges focus under StrictMode too', async () => {
    server.use(
      http.get('/v1/issues/td-6a0883', () => HttpResponse.json({ ok: true, data: detail })),
      http.put('/v1/focus', () => HttpResponse.json({ ok: true, data: { focused_issue_id: 'td-6a0883' } })),
    )
    renderDetail({ strict: true })

    await userEvent.click(await screen.findByRole('button', { name: 'Focus' }))

    expect(await screen.findByText('focus set')).toBeInTheDocument()
  })

  it('opens the edit form seeded with the current values', async () => {
    server.use(http.get('/v1/issues/td-6a0883', () => HttpResponse.json({ ok: true, data: detail })))
    renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))

    expect(screen.getByLabelText('Title')).toHaveValue('Probe issue for API shape')
  })

  // The editor turns the heading itself into the field. A second title field
  // below the untouched heading puts the same value on screen twice, and only
  // one of the two is the one that gets saved.
  it('edits the title in place of the heading', async () => {
    server.use(http.get('/v1/issues/td-6a0883', () => HttpResponse.json({ ok: true, data: detail })))
    renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))

    expect(screen.queryByRole('heading', { name: 'Probe issue for API shape' }))
      .not.toBeInTheDocument()
    expect(screen.getAllByLabelText('Title')).toHaveLength(1)
    expect(screen.getByLabelText('Title')).toHaveValue('Probe issue for API shape')
  })

  // Opening the editor must not remount IssueActions. react-query stops
  // calling a mutation's mutate-level callbacks as soon as its observer loses
  // its listeners, so an unmount mid-delete strands the navigate('/') that
  // takes the user off the issue they just deleted.
  it('leaves the view when a delete lands after the editor was opened', async () => {
    let release = () => {}
    const inFlight = new Promise<void>(resolve => { release = resolve })
    server.use(
      http.get('/v1/issues/td-6a0883', () => HttpResponse.json({ ok: true, data: detail })),
      http.delete('/v1/issues/td-6a0883', async () => {
        await inFlight
        return HttpResponse.json({ ok: true, data: { deleted: true } })
      }),
    )
    renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))

    await act(async () => { release() })

    expect(await screen.findByText('issue list stand-in')).toBeInTheDocument()
  })

  // A stale error from one action must not bleed into a later, unrelated one.
  it('drops a failed delete error once a later focus action succeeds', async () => {
    server.use(
      http.get('/v1/issues/td-6a0883', () => HttpResponse.json({ ok: true, data: detail })),
      http.delete('/v1/issues/td-6a0883', () =>
        HttpResponse.json({ ok: false, error: { code: 'forbidden', message: 'cannot delete' } },
          { status: 403 })),
      http.put('/v1/focus', () => HttpResponse.json({ ok: true, data: { focused_issue_id: 'td-6a0883' } })),
    )
    renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    expect(await screen.findByText('cannot delete')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Focus' }))
    await screen.findByText('focus set')
    expect(screen.queryByText('cannot delete')).not.toBeInTheDocument()
  })

  // The acknowledgement has no persistent meaning once another action starts —
  // IssueActions is never unmounted, so `focus.isSuccess` alone would stick
  // around forever and start reading like a claim about current focus state.
  it('clears the focus acknowledgement once another action starts', async () => {
    server.use(
      http.get('/v1/issues/td-6a0883', () => HttpResponse.json({ ok: true, data: detail })),
      http.put('/v1/focus', () => HttpResponse.json({ ok: true, data: { focused_issue_id: 'td-6a0883' } })),
    )
    renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: 'Focus' }))
    expect(await screen.findByText('focus set')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.queryByText('focus set')).not.toBeInTheDocument()
  })

  // Opening the editor is itself "another action starting" — a stale delete
  // failure must not keep rendering next to the now-open edit form.
  it('drops a failed delete error when opening the editor', async () => {
    server.use(
      http.get('/v1/issues/td-6a0883', () => HttpResponse.json({ ok: true, data: detail })),
      http.delete('/v1/issues/td-6a0883', () =>
        HttpResponse.json({ ok: false, error: { code: 'forbidden', message: 'cannot delete' } },
          { status: 403 })),
    )
    renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    expect(await screen.findByText('cannot delete')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.queryByText('cannot delete')).not.toBeInTheDocument()
  })

  // IssueActions is never remounted by IssueActions's own controls when a
  // transition happens — TransitionBar owns a separate mutation and never
  // calls into IssueActions. The issue itself changing underneath the
  // component (its `updated_at` bumping on refetch) is what has to clear a
  // stale acknowledgement here, not a click on one of IssueActions's buttons.
  it('clears the focus acknowledgement once a transition changes the issue', async () => {
    let fetches = 0
    server.use(
      http.get('/v1/issues/td-6a0883', () => {
        fetches += 1
        const issue = fetches === 1
          ? detail.issue
          : { ...detail.issue, updated_at: '2026-08-14T16:00:00+02:00' }
        return HttpResponse.json({ ok: true, data: { ...detail, issue } })
      }),
      http.put('/v1/focus', () => HttpResponse.json({ ok: true, data: { focused_issue_id: 'td-6a0883' } })),
      http.post('/v1/issues/td-6a0883/review', () => HttpResponse.json({ ok: true, data: detail.issue })),
    )
    renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: 'Focus' }))
    expect(await screen.findByText('focus set')).toBeInTheDocument()

    // "Request review" takes no reason, so it fires immediately.
    await userEvent.click(screen.getByRole('button', { name: 'Request review' }))

    await waitFor(() => expect(screen.queryByText('focus set')).not.toBeInTheDocument())
  })

  // A previous fix keyed the whole IssueActions subtree on `updated_at` to
  // clear the focus acknowledgement — but that also reset ConfirmButton's own
  // armed state, silently cancelling an in-progress delete confirmation the
  // moment the issue changed underneath it. The reset must be scoped to
  // IssueActions's own state, not the whole subtree.
  it('keeps an armed delete confirmation across an unrelated issue change', async () => {
    let fetches = 0
    server.use(
      http.get('/v1/issues/td-6a0883', () => {
        fetches += 1
        const issue = fetches === 1
          ? detail.issue
          : { ...detail.issue, updated_at: '2026-08-14T16:00:00+02:00' }
        return HttpResponse.json({ ok: true, data: { ...detail, issue } })
      }),
      http.post('/v1/issues/td-6a0883/review', () => HttpResponse.json({ ok: true, data: detail.issue })),
    )
    renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeInTheDocument()

    // "Request review" takes no reason, so it fires immediately and bumps
    // updated_at on refetch — an issue change unrelated to the armed delete.
    await userEvent.click(screen.getByRole('button', { name: 'Request review' }))

    await waitFor(() => expect(fetches).toBeGreaterThan(1))
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeInTheDocument()
  })

  // The route element is the same component at the same position for every
  // `:id`, so React reuses the instance across a navigation between two
  // issues. With `editing` and the once-seeded draft surviving that, Save
  // would PATCH the issue now on screen with the values of the one left
  // behind. The dependency links make the navigation a single click.
  it('does not carry an open editor across a navigation to another issue', async () => {
    const other = {
      ...detail,
      issue: { ...detail.issue, id: 'td-ffe762', title: 'The issue the link leads to' },
    }
    const withDependency = {
      ...detail,
      dependencies: [{
        dep_id: 'dep_f7585e15', issue_id: 'td-6a0883',
        depends_on_id: 'td-ffe762', relation_type: 'depends_on',
      }],
    }
    server.use(
      http.get('/v1/issues/td-6a0883', () => HttpResponse.json({ ok: true, data: withDependency })),
      http.get('/v1/issues/td-ffe762', () => HttpResponse.json({ ok: true, data: other })),
    )
    const { qc } = renderDetail()
    // Already in the cache, as it would be after visiting it earlier in the
    // session — so useIssue answers synchronously and the `Loading …` early
    // return never unmounts the form for us.
    qc.setQueryData(issueKeys.detail('td-ffe762'), other)

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Title')).toHaveValue('Probe issue for API shape')

    await userEvent.click(screen.getByRole('link', { name: 'td-ffe762' }))

    expect(await screen.findByRole('heading', { name: 'The issue the link leads to' }))
      .toBeInTheDocument()
    expect(screen.queryByDisplayValue('Probe issue for API shape')).not.toBeInTheDocument()
  })

  // A concurrent td session bumps `updated_at`, useLiveUpdates invalidates
  // everything, and the refetch lands mid-delete. Resetting the delete
  // mutation there detaches its observer, so the mutate-level onSuccess — the
  // navigate — is silently dropped and the user sits on a deleted issue.
  it('still leaves the detail view when a refresh lands mid-delete', async () => {
    let release = () => {}
    const inFlight = new Promise<void>(resolve => { release = resolve })
    let fetches = 0
    server.use(
      http.get('/v1/issues/td-6a0883', () => {
        fetches += 1
        const issue = fetches === 1
          ? detail.issue
          : { ...detail.issue, updated_at: '2026-08-14T16:00:00+02:00' }
        return HttpResponse.json({ ok: true, data: { ...detail, issue } })
      }),
      http.delete('/v1/issues/td-6a0883', async () => {
        await inFlight
        return HttpResponse.json({ ok: true, data: { deleted: true } })
      }),
      http.get('/v1/issues', () => HttpResponse.json({
        ok: true, data: { issues: [], limit: 50, offset: 0, total: 0, has_more: false },
      })),
    )
    const { qc } = renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await act(async () => { await qc.invalidateQueries({ queryKey: issueKeys.all }) })
    await waitFor(() => expect(fetches).toBeGreaterThan(1))

    release()

    expect(await screen.findByText('issue list stand-in')).toBeInTheDocument()
  })

  // History is always loaded, so expanding it needs no second request and no
  // second cache entry for the same issue.
  it('requests the review history with the issue', async () => {
    let seen: URL | undefined
    server.use(http.get('/v1/issues/td-6a0883', ({ request }) => {
      seen = new URL(request.url)
      return HttpResponse.json({ ok: true, data: detail })
    }))

    renderDetail()
    await screen.findByText('Probe issue for API shape')
    expect(seen?.searchParams.get('with')).toBe('reviews')
  })

  it('deletes a comment after confirming', async () => {
    let deleted = ''
    server.use(
      http.get('/v1/issues/td-6a0883', () => HttpResponse.json({ ok: true, data: detail })),
      http.delete('/v1/issues/td-6a0883/comments/:commentId', ({ params }) => {
        deleted = String(params.commentId)
        return HttpResponse.json({ ok: true, data: { deleted: true } })
      }),
    )
    renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: 'Delete comment' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete comment' }))

    await waitFor(() => expect(deleted).toBe('cm-1f0a2b3c'))
  })
})
