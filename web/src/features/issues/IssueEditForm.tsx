import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fieldErrorFor, unboundMessage } from '../../api/client'
import { useUpdateIssue } from '../../api/mutations'
import type { Issue, IssueType, Priority } from '../../api/types'
import ErrorPanel from '../../components/ErrorPanel'
import IssueCombobox from '../../components/IssueCombobox'
import LabelInput from './LabelInput'
import { diffIssue, draftFrom, isEmptyPatch, type IssueDraft } from './issueDiff'
import { candidatesFor, childrenOf } from './issueIndex'
import { useIssueIndex } from './useIssueIndex'

const types: IssueType[] = ['task', 'feature', 'bug', 'chore', 'epic']
const priorities: Priority[] = ['P0', 'P1', 'P2', 'P3', 'P4']

const fieldClass = 'w-full rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 text-ink'
const legendClass = 'mb-1.5 block text-[11px] uppercase tracking-widest text-ink-muted'
const titleClass = 'mt-0.5 mb-2 text-xl font-semibold leading-snug tracking-tight text-ink'

interface Props {
  issue: Issue
  editing: boolean
  onDone: () => void
  /**
   * Where to put Save and Cancel. They belong after everything the editor can
   * change, and the dependency panel is part of that while living outside this
   * form — so the caller hands over a node down there and the buttons portal
   * into it. Omit it and they render in place, at the foot of the fields.
   *
   * A portal rather than the caller owning the buttons: they read
   * `update.isPending` and the rejection message off the mutation in here, and
   * a portal moves the DOM without moving the React tree that holds it.
   *
   * `null` is the caller's slot before its first commit, and renders nothing —
   * the buttons must not appear inside the form for a frame and then jump.
   */
  footerSlot?: HTMLElement | null
}

/**
 * No client-side bounds anywhere: title length and the points enum are
 * per-project td config, so the server validates and this renders its answer.
 * The dates use type="date" because it emits td's YYYY-MM-DD exactly.
 *
 * Mounted whether or not the editor is open, rendering the title as a heading
 * while it is closed. That is what lets the title be edited where it is read.
 *
 * This form used to host the action bar in a `children` slot, so that opening
 * the editor could not move it — a move is a remount, and react-query stops
 * calling a mutation's mutate-level callbacks the moment its observer loses
 * its listeners, so a delete in flight would lose the navigate('/') that
 * follows it. IssueActions is now a sibling instead, at a position that does
 * not depend on `editing` at all, which satisfies the same constraint without
 * a slot: the editor hides it with the `hidden` attribute rather than
 * unmounting it. That also lets it share a row with TransitionBar, which was
 * impossible while it lived in here — TransitionBar renders its own <form>
 * for the reason, and nesting forms is invalid HTML.
 */
export default function IssueEditForm({ issue, editing, onDone, footerSlot }: Props) {
  // Seeded when the editor opens, not on mount, since the component outlives
  // a single editing session. Not re-synced while it is open: useLiveUpdates
  // invalidates the detail query on every SSE event, and re-seeding would
  // wipe whatever is being typed. `original` is the issue as it was at that
  // same moment, and the diff is against it rather than against the live
  // prop: another session's background change to a field the user never
  // touched would otherwise read as an edit and get overwritten with the
  // draft's stale copy.
  const [original, setOriginal] = useState(issue)
  const [draft, setDraft] = useState<IssueDraft>(() => draftFrom(issue))
  const update = useUpdateIssue(issue.id)
  // Names the form so the portalled Save can point back at it.
  const formId = useId()
  // The same query the detail view already has in cache — the parent picker
  // costs no request of its own. The form is mounted while the editor is
  // closed too, which is why this sits with the other unconditional hooks.
  const { issues } = useIssueIndex()

  // Adjusting state during render rather than in an effect, so the freshly
  // opened editor never paints the previous session's abandoned draft first.
  const [wasEditing, setWasEditing] = useState(editing)
  if (editing !== wasEditing) {
    setWasEditing(editing)
    if (editing) {
      setOriginal(issue)
      setDraft(draftFrom(issue))
    }
  }

  // The submit button disables on update.isPending, but that reads from
  // state and doesn't stop the form's native submit event: two submits
  // landing before a render commits (a fast double-Enter, or two events in
  // the same tick) would otherwise both read isPending as false and each
  // fire a PATCH. A ref isn't tied to render timing, so it closes that gap —
  // same fix as IssueForm.tsx's create submit.
  const submitting = useRef(false)

  // A rejected save used to die with the form. It now has to be cleared by
  // hand, on close rather than on open, so that a stale field error cannot
  // paint for a frame on top of a draft that no longer produced it. Resetting
  // a still-pending PATCH detaches it from its callbacks — including the
  // onSettled below that clears `submitting`, so a Cancel while a save is
  // still in flight has to clear that ref itself or Save never works again.
  useEffect(() => {
    if (!editing) {
      update.reset()
      submitting.current = false
    }
    // `update` is a new object every render; only closing should run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  function set<K extends keyof IssueDraft>(key: K, value: IssueDraft[K]) {
    setDraft(current => ({ ...current, [key]: value }))
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting.current) return
    const patch = diffIssue(original, draft)
    // Nothing changed — close rather than issue an empty PATCH.
    if (isEmptyPatch(patch)) {
      onDone()
      return
    }
    submitting.current = true
    update.mutate(patch, {
      onSuccess: onDone,
      onSettled: () => { submitting.current = false },
    })
  }

  const panelError = unboundMessage(update.error, boundFields)

  // Still the form's submit button once it portals out of the <form>: the
  // `form` attribute is what associates a control with a form it does not sit
  // inside. Keeping it a real submit button rather than a plain one that calls
  // the handler is not cosmetic — a form with no submit button of its own has
  // no default button, and Enter in a text field stops saving.
  const footer = (
    <div className="mt-4 space-y-4">
      <div className="flex gap-1.5">
        <button type="submit" form={formId} disabled={update.isPending}
          className="rounded-sm border border-accent px-3 py-1 text-[11px] text-accent disabled:opacity-40">
          Save changes
        </button>
        <button type="button" onClick={onDone}
          className="rounded-sm border border-line px-3 py-1 text-[11px] text-ink-muted">
          Cancel
        </button>
      </div>

      {panelError && <ErrorPanel label="Update rejected" message={panelError} />}
    </div>
  )

  return (
    <>
    <form id={formId} onSubmit={submit}>
      {/* The heading and the field are the same line of the page. The field
          carries an aria-label rather than a visible legend: a TITLE caption
          above the issue title would read as part of the issue. */}
      {editing ? (
        <div className="mt-0.5 mb-2">
          <input aria-label="Title" value={draft.title}
            onChange={e => set('title', e.target.value)}
            className={`${fieldClass} text-xl font-semibold leading-snug tracking-tight`} />
          <FieldError error={update.error} field="title" />
        </div>
      ) : (
        <h1 className={titleClass}>{issue.title}</h1>
      )}

      {editing && (
        <div className="mt-4 space-y-4 border-t border-line-subtle pt-4">
          <div>
            <label htmlFor="edit-description" className={legendClass}>Description</label>
            <textarea id="edit-description" rows={6} value={draft.description}
              onChange={e => set('description', e.target.value)} className={fieldClass} />
            <FieldError error={update.error} field="description" />
          </div>

          <div>
            <label htmlFor="edit-acceptance" className={legendClass}>Acceptance criteria</label>
            <textarea id="edit-acceptance" rows={4} value={draft.acceptance}
              onChange={e => set('acceptance', e.target.value)} className={fieldClass} />
            <FieldError error={update.error} field="acceptance" />
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <label htmlFor="edit-type" className={legendClass}>Type</label>
              <select id="edit-type" value={draft.type}
                onChange={e => set('type', e.target.value as IssueType)} className={fieldClass}>
                {types.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <FieldError error={update.error} field="type" />
            </div>
            <div>
              <label htmlFor="edit-priority" className={legendClass}>Priority</label>
              <select id="edit-priority" value={draft.priority}
                onChange={e => set('priority', e.target.value as Priority)} className={fieldClass}>
                {priorities.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <FieldError error={update.error} field="priority" />
            </div>
            <div>
              {/* No min or max: the accepted values are td config, and it names
                  them in the error when a value is rejected. */}
              <label htmlFor="edit-points" className={legendClass}>Points</label>
              <input id="edit-points" type="number" value={draft.points ?? ''}
                onChange={e => set('points', e.target.value === '' ? null : Number(e.target.value))}
                className={fieldClass} />
              <FieldError error={update.error} field="points" />
            </div>
            <div>
              <label htmlFor="edit-sprint" className={legendClass}>Sprint</label>
              <input id="edit-sprint" value={draft.sprint}
                onChange={e => set('sprint', e.target.value)} className={fieldClass} />
              <FieldError error={update.error} field="sprint" />
            </div>
          </div>

          <div>
            <LabelInput value={draft.labels} onChange={labels => set('labels', labels)} />
            <FieldError error={update.error} field="labels" />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="edit-parent" className={legendClass}>Parent</label>
              <IssueCombobox id="edit-parent" value={draft.parent_id}
                onChange={next => set('parent_id', next)}
                // Excludes the issue itself (it cannot be its own parent) and
                // its own children — picking one would only earn a rejection
                // from td, since the child's existing parent_id already makes
                // that edge a cycle. Longer cycles through a grandchild stay
                // td's to catch, same as DependencyPanel's dependency picker.
                candidates={candidatesFor(issues, [issue.id, ...childrenOf(issues, issue.id).map(c => c.id)])}
                placeholder="td-…" className={fieldClass} />
              <FieldError error={update.error} field="parent_id" />
            </div>
            <div>
              <label htmlFor="edit-due" className={legendClass}>Due date</label>
              <input id="edit-due" type="date" value={draft.due_date}
                onChange={e => set('due_date', e.target.value)} className={fieldClass} />
              <FieldError error={update.error} field="due_date" />
            </div>
            <div>
              <label htmlFor="edit-defer" className={legendClass}>Defer until</label>
              <input id="edit-defer" type="date" value={draft.defer_until}
                onChange={e => set('defer_until', e.target.value)} className={fieldClass} />
              <FieldError error={update.error} field="defer_until" />
            </div>
          </div>

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={draft.minor}
              onChange={e => set('minor', e.target.checked)} />
            <span>Minor — self-reviewable</span>
          </label>

          {/* The form's default button, and nothing else — it is what makes
              Enter in a text field save, and Save itself is no longer here to
              be it. The spec resolves the default button from the form's
              associated elements, so the portalled Save ought to serve, but
              jsdom only looks at the form's descendants and the suite is
              where that behaviour is pinned. `hidden` keeps it out of the
              layout and out of the accessible tree; both buttons run the same
              onSubmit, so which one wins the tie does not matter. */}
          <button type="submit" hidden tabIndex={-1} aria-hidden="true" />

        </div>
      )}
    </form>
    {editing && (footerSlot === undefined ? footer : footerSlot && createPortal(footer, footerSlot))}
    </>
  )
}

/**
 * Every field with a <FieldError> of its own above. `minor` is deliberately
 * absent — it is the one editable field without one — so an error naming it,
 * or naming anything td renames later, falls through to the panel instead of
 * rendering nowhere.
 *
 * Exported so the suite can prove each entry really renders at an input: an
 * omission here only duplicates a message, but a stale entry silences one.
 * That guard is worth one file's fast-refresh granularity, and the list has to
 * stay in this file — it describes the FieldError placements above and would
 * rot the moment it moved away from them.
 */
// oxlint-disable-next-line react/only-export-components
export const boundFields = [
  'title', 'description', 'acceptance', 'type', 'priority', 'points', 'sprint',
  'labels', 'parent_id', 'due_date', 'defer_until',
]

function FieldError({ error, field }: { error: unknown; field: string }) {
  const message = fieldErrorFor(error, field)
  if (!message) return null
  return <p className="mt-1.5 text-[11px] text-danger">{message}</p>
}
