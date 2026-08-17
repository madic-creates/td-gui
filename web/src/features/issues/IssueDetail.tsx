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
  // The node IssueEditForm portals Save and Cancel into — see the slot below.
  const [editorFooter, setEditorFooter] = useState<HTMLElement | null>(null)
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

      {/* Row 2. The title, and while the editor is open every field with it.
          The type, priority and status markers used to sit under here as tag
          chips; they are rows in MetaPanel now, which leaves the header as the
          title and one row of controls. */}
      <header className="mt-2">
        <IssueEditForm issue={issue} editing={editing} onDone={() => setEditing(false)}
          footerSlot={editorFooter} />
      </header>

      {/* Row 3. One continuous bar of controls: what td offers to do with the
          issue, then what this GUI offers.

          The two come from different components because they answer to
          different things, and they are siblings rather than nested because
          TransitionBar renders its own <form> for a transition's reason while
          IssueEditForm is a <form> too — nesting them would be invalid HTML,
          which is what kept these on separate rows until IssueActions moved
          out of the edit form.

          Neither renders a wrapper, so this grid receives their parts
          directly: both button rows pin themselves to columns 1 and 2 of the
          first row, and the reason form and both rejection panels take
          full-width rows underneath, where td's wording has room to be read.
          The third track is filler that absorbs the leftover width so the
          buttons keep their own size and stay left.

          `grid-flow-row-dense` is what holds the bar together. The parts
          arrive in component order — transition buttons, reason form,
          transition error, action buttons — so without dense packing the
          action buttons would be placed after the full-width rows and drop
          below them the moment a reason form opened. Dense back-fills column
          2 of the first row instead, which is free, so the seven buttons stay
          on one line in every state.

          `hidden` rather than an unmount while editing: react-query stops
          calling a mutation's mutate-level callbacks once its observer loses
          its listeners, so unmounting mid-delete would lose the navigate('/').
          The editor has its own Save and Cancel, so nothing here is needed
          while it is open. */}
      <div
        hidden={editing}
        className="mt-3 grid grid-flow-row-dense grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-1.5"
      >
        <TransitionBar issueId={issue.id} available={issue.available_transitions} />
        <IssueActions issue={issue} editing={editing} onEdit={() => setEditing(!editing)} />
      </div>

      {/* Two columns and no more: the content the issue is made of, and the
          facts about it. An earlier revision split the content column again at
          xl, prose on the left and relations plus the log on the right, with
          the assignment fixed so a missing field could not reshuffle it. Fixed
          is exactly what made it fail — most issues have a long description and
          almost no relations, so the right column sat near-empty while the
          prose was squeezed into 68ch beside it. No top margin: the sections
          own their mt-6. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          {/* No max-width on the prose. td descriptions are written in a
              terminal and arrive hard-wrapped by their author, so the line
              breaks that matter are already in the text; a measure imposed
              here only re-wraps what the author wrapped, and it truncates the
              one thing that genuinely needs the width — a table or a code
              block pasted into the description. */}
          {!editing && issue.description && (
            <section className="mt-6">
              <h2 className="mb-2 text-[11px] uppercase tracking-widest text-ink-muted">Description</h2>
              <p className="whitespace-pre-wrap leading-relaxed">
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
              <p className="whitespace-pre-wrap leading-relaxed">
                {issue.acceptance}
              </p>
            </section>
          )}

          {!editing && latest_handoff && <HandoffPanel handoff={latest_handoff} />}

          <DependencyPanel
            issueId={issue.id} dependencies={dependencies} blockedBy={blocked_by} />

          {!editing && <RelatedIssues title="Blocks" items={blocks} />}
          {!editing && <RelatedIssues title="Tasks" items={tasks} />}

          {/* Where Save and Cancel land while the editor is open. They close
              the editor, so they come after every part of it — the fields
              above and the dependency panel, which saves itself but is still
              something the open editor changes. Everything else on this
              column is read-only and hidden while editing, so the buttons are
              the last thing on the page, which is where a form's commit
              controls are looked for.

              Rendered whether or not the editor is open, and empty when it is
              not: a slot that appears with `editing` would only exist from the
              commit after the one that opened the editor, and the buttons
              would paint at the foot of the fields for that frame and then
              jump down here. */}
          <div ref={setEditorFooter} />

          {/* Both sections gone while the editor is open, like the description
              and the acceptance criteria above. Neither is editable, and the
              comment box in particular does not belong under an open form: it
              posts on its own, so a person who types into it and then presses
              Save has written two unrelated things and only knows about one.
              What is left below the form is the dependency panel, which the
              editor can actually change.

              Unmounted rather than `hidden`, unlike the control row above.
              That row uses `hidden` because IssueActions holds a delete whose
              mutate-level callback navigates away and would be dropped by an
              unmount mid-flight; the delete here is a comment delete, and
              react-query still runs the useMutation-level onSuccess that
              invalidates the query after its observer goes away. */}
          {!editing && (<>
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
          </>)}
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
      {/* @container: the two-column switch below has to key off this card's
          own width, not the viewport's. From lg up the card sits in the 1fr
          content column, with the 260px sidebar and the gap taken out of the
          window beside it, so it runs roughly 300px narrower than the
          viewport — a viewport breakpoint would read a wide window and split
          a card that is not wide. */}
      <div className="@container rounded-md border border-line bg-surface-raised px-4 py-3.5">
        {/* @2xl (42rem/672px) rather than @sm (24rem/384px): below lg the grid
            collapses and the card does span the page, but a 640px window still
            leaves it a ~566px content box, which @sm would call "wide enough"
            and cut into two ~273px columns — the exact bug this fixes. @2xl
            needs a window past ~1030px, where two columns are wide enough to
            read. */}
        <div className="grid gap-x-5 gap-y-3.5 @2xl:grid-cols-2">
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
