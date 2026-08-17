import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { fieldErrorFor, unboundMessage } from '../../api/client'
import { useCreateIssue } from '../../api/mutations'
import type { IssueType, Priority } from '../../api/types'
import ErrorPanel from '../../components/ErrorPanel'
import IssueCombobox from '../../components/IssueCombobox'
import LabelInput from './LabelInput'
import { blankDraft, createBodyFrom } from './issueCreate'
import type { IssueDraft } from './issueDiff'
import { candidatesFor } from './issueIndex'
import { useIssueIndex } from './useIssueIndex'

const types: IssueType[] = ['task', 'feature', 'bug', 'chore', 'epic']
const priorities: Priority[] = ['P0', 'P1', 'P2', 'P3', 'P4']

const fieldClass = 'w-full rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 text-ink'
const legendClass = 'mb-1.5 block text-[11px] uppercase tracking-widest text-ink-muted'

export default function IssueForm() {
  // One draft rather than a state per field, and the same shape the edit form
  // holds — the two forms offer the same fields, so they hold the same object.
  const [draft, setDraft] = useState<IssueDraft>(blankDraft)
  const create = useCreateIssue()
  const navigate = useNavigate()
  const panelError = unboundMessage(create.error, boundFields)

  // The same query IssueList issues, so the parent picker is served from cache
  // rather than costing a request of its own.
  const { issues } = useIssueIndex()

  function set<K extends keyof IssueDraft>(key: K, value: IssueDraft[K]) {
    setDraft(current => ({ ...current, [key]: value }))
  }

  // The submit button disables on create.isPending, but that reads from
  // state and doesn't stop the form's native submit event: two submits
  // landing before a render commits (a fast double-Enter, or two events in
  // the same tick) would otherwise both read isPending as false and each
  // fire a POST, creating two issues. A ref isn't tied to render timing, so
  // it closes that gap regardless of how close together the events land.
  const submitting = useRef(false)

  // No client-side length checks: td's title bounds are per-project config,
  // so any hardcoded value here would eventually be wrong.
  return (
    <form
      className="max-w-3xl space-y-4 px-5 py-4"
      onSubmit={e => {
        e.preventDefault()
        if (submitting.current) return
        submitting.current = true
        // Land on the new issue rather than leaving the form sitting there:
        // without this the fields kept their submitted values with nothing
        // stopping a second click from creating a duplicate, and the only way
        // to reach the issue just created was to go find it in the list.
        create.mutate(createBodyFrom(draft), {
          onSuccess: data => navigate(`/issues/${data.issue.id}`),
          onSettled: () => { submitting.current = false },
        })
      }}
    >
      <div>
        <label htmlFor="new-title" className={legendClass}>Title</label>
        <input
          id="new-title" value={draft.title} onChange={e => set('title', e.target.value)}
          className={fieldClass}
        />
        <FieldError error={create.error} field="title" />
      </div>

      <div>
        <label htmlFor="new-description" className={legendClass}>Description</label>
        <textarea
          id="new-description" rows={5} value={draft.description}
          onChange={e => set('description', e.target.value)}
          className={fieldClass}
        />
        <FieldError error={create.error} field="description" />
      </div>

      <div>
        <label htmlFor="new-acceptance" className={legendClass}>Acceptance criteria</label>
        <textarea
          id="new-acceptance" rows={4} value={draft.acceptance}
          onChange={e => set('acceptance', e.target.value)} className={fieldClass}
        />
        <FieldError error={create.error} field="acceptance" />
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div>
          <label htmlFor="new-type" className={legendClass}>Type</label>
          <select id="new-type" value={draft.type}
            onChange={e => set('type', e.target.value as IssueType)} className={fieldClass}>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <FieldError error={create.error} field="type" />
        </div>
        <div>
          <label htmlFor="new-priority" className={legendClass}>Priority</label>
          <select id="new-priority" value={draft.priority}
            onChange={e => set('priority', e.target.value as Priority)} className={fieldClass}>
            {priorities.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <FieldError error={create.error} field="priority" />
        </div>
        <div>
          {/* No min or max: the accepted values are td config, and it names
              them in the error when a value is rejected. */}
          <label htmlFor="new-points" className={legendClass}>Points</label>
          <input id="new-points" type="number" value={draft.points ?? ''}
            onChange={e => set('points', e.target.value === '' ? null : Number(e.target.value))}
            className={fieldClass} />
          <FieldError error={create.error} field="points" />
        </div>
        <div>
          <label htmlFor="new-sprint" className={legendClass}>Sprint</label>
          <input id="new-sprint" value={draft.sprint}
            onChange={e => set('sprint', e.target.value)} className={fieldClass} />
          <FieldError error={create.error} field="sprint" />
        </div>
      </div>

      <div>
        <LabelInput value={draft.labels} onChange={labels => set('labels', labels)} />
        <FieldError error={create.error} field="labels" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="new-parent" className={legendClass}>Parent</label>
          {/* Nothing to exclude: the issue does not exist yet, so it can be
              neither its own parent nor its own child. candidatesFor still
              earns its place by sorting closed issues last. */}
          <IssueCombobox id="new-parent" value={draft.parent_id}
            onChange={next => set('parent_id', next)}
            candidates={candidatesFor(issues, [])}
            placeholder="td-…" className={fieldClass} />
          <FieldError error={create.error} field="parent_id" />
        </div>
        <div>
          <label htmlFor="new-due" className={legendClass}>Due date</label>
          <input id="new-due" type="date" value={draft.due_date}
            onChange={e => set('due_date', e.target.value)} className={fieldClass} />
          <FieldError error={create.error} field="due_date" />
        </div>
        <div>
          <label htmlFor="new-defer" className={legendClass}>Defer until</label>
          <input id="new-defer" type="date" value={draft.defer_until}
            onChange={e => set('defer_until', e.target.value)} className={fieldClass} />
          <FieldError error={create.error} field="defer_until" />
        </div>
      </div>

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={draft.minor}
          onChange={e => set('minor', e.target.checked)} />
        <span>Minor — self-reviewable</span>
      </label>

      <button type="submit" disabled={create.isPending}
        className="rounded-sm border border-accent px-3 py-1 text-[11px] text-accent disabled:opacity-40">
        Create
      </button>

      {/* This form binds every field it renders; anything else td names, and
          any error carrying no field at all, belongs here. */}
      {panelError && <ErrorPanel message={panelError} />}
    </form>
  )
}

/**
 * Every field with a <FieldError> of its own above. `minor` is deliberately
 * absent — it is the one field without one — so an error naming it, or naming
 * anything td renames later, falls through to the panel instead of rendering
 * nowhere.
 *
 * Exported so the suite can prove each entry really renders at an input: an
 * omission here only duplicates a message, but a stale entry silences one.
 * The same guard IssueEditForm.tsx carries, for the same reason.
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
