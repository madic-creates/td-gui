import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useIssue } from '../../api/queries'
import { useDeleteComment } from '../../api/mutations'
import { ApiError } from '../../api/client'
import TransitionBar from './TransitionBar'
import CommentForm from './CommentForm'
import IssueActions from './IssueActions'
import IssueEditForm from './IssueEditForm'
import DependencyPanel from './DependencyPanel'
import RelatedIssues from './RelatedIssues'
import MetaPanel from './MetaPanel'
import ReviewPanel from './ReviewPanel'
import { useIssueIndex } from './useIssueIndex'
import { childrenOf, resolve } from './issueIndex'
import type { Handoff } from '../../api/types'
import { relativeTime, shortSession } from '../../lib/format'
import StatusTag from '../../components/StatusTag'
import PriorityTag from '../../components/PriorityTag'
import ErrorPanel from '../../components/ErrorPanel'
import ConfirmButton from '../../components/ConfirmButton'

/**
 * Keyed on the id, which is load-bearing rather than cosmetic. The route
 * element is the same component at the same position for every `:id`, so React
 * reuses the instance when one detail view navigates to another — and a
 * dependency link does exactly that. Everything seeded once from the issue
 * (`editing` here, the edit form's draft, TransitionBar's reason) would
 * otherwise survive the change and end up pointed at the wrong issue: Save
 * would PATCH the issue now on screen with the values of the one left behind.
 * The `Loading …` early return is no defence — a cached target renders
 * synchronously.
 */
export default function IssueDetail() {
  const { id = '' } = useParams()
  return <IssueDetailView key={id} id={id} />
}

function IssueDetailView({ id }: { id: string }) {
  const [editing, setEditing] = useState(false)
  const { data, error, isPending } = useIssue(id)
  const deleteComment = useDeleteComment(id)
  // Called unconditionally, alongside the other hooks above: the isPending
  // and error early returns below would otherwise make this a conditional
  // hook call the moment the issue itself finishes loading.
  const { index, issues } = useIssueIndex()

  if (isPending) return <p className="p-4 text-ink-muted">Loading …</p>

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

  const { issue, logs, comments, dependencies, blocked_by, latest_handoff } = data

  // `blocked_by` holds the rows where this issue is the one being waited for,
  // so it answers "what does this block" — the opposite of what its name says.
  const blocks = resolve(blocked_by, index, 'issue_id')
  const tasks = issue.type === 'epic'
    ? childrenOf(issues, issue.id).map(child => ({ id: child.id, issue: child }))
    : []

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
        {/* One track below xl — today's stacking, untouched. From 1280px the
            main column splits: what a person wrote about the issue on the
            left, what it is connected to and what happened to it on the right.
            Nested rather than a flat three-column grid, which at lg would wrap
            the sidebar under the first column. The prose track takes exactly
            its 68ch measure and the log column takes the remainder, so neither
            carries slack. Row gaps stay with the sections' own mt-6. */}
        <div className="grid content-start gap-x-6 xl:grid-cols-[minmax(0,68ch)_minmax(0,1fr)]">
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
        <aside>
          <MetaPanel issue={issue} />
          <ReviewPanel active={issue.active_review} history={issue.reviews} />
        </aside>
      </div>
    </div>
  )
}

/**
 * What a section says when it has nothing to list. Not the boxed `EmptyState`
 * the board and list views use: those own a whole viewport, while these sit in
 * a dense column of sections and a centred block per empty one would shout
 * over the issue itself. One muted line keeps each section the same shape
 * whether or not it has rows — a heading with a void under it reads as a view
 * that failed to load, and it collapses the rhythm between the headings.
 */
function EmptyLine({ children }: { children: string }) {
  return <p className="text-ink-muted">{children}</p>
}

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
      <h2 className="mb-2 text-[11px] uppercase tracking-widest text-ink-muted">Latest handoff</h2>
      <div className="rounded-md border border-line bg-surface-raised px-4 py-3.5">
        <div className="grid gap-x-5 gap-y-3.5 sm:grid-cols-2">
          {sections.filter(([, items]) => items.length > 0).map(([title, items]) => (
            <div key={title}>
              <h3 className={`mb-1.5 text-[11px] uppercase tracking-widest ${handoffTone[title]}`}>
                {title}
              </h3>
              <ul className="list-disc pl-4 leading-relaxed">
                {items.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
