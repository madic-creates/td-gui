import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { fieldErrorFor, unboundMessage } from '../../api/client'
import { useCreateIssue } from '../../api/mutations'
import type { IssueType, Priority } from '../../api/types'
import ErrorPanel from '../../components/ErrorPanel'
import { blankDraft, createBodyFrom } from './issueCreate'
import type { IssueDraft } from './issueDiff'

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
      className="max-w-xl space-y-4 px-5 py-4"
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
        <label htmlFor="title" className={legendClass}>Title</label>
        <input
          id="title" value={draft.title} onChange={e => set('title', e.target.value)}
          className={fieldClass}
        />
        <FieldError error={create.error} field="title" />
      </div>

      <div>
        <label htmlFor="description" className={legendClass}>Description</label>
        <textarea
          id="description" rows={5} value={draft.description}
          onChange={e => set('description', e.target.value)}
          className={fieldClass}
        />
        <FieldError error={create.error} field="description" />
      </div>

      <div className="flex gap-4">
        <div>
          <label htmlFor="type" className={legendClass}>Type</label>
          <select
            id="type" value={draft.type} onChange={e => set('type', e.target.value as IssueType)}
            className="rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 text-ink"
          >
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="priority" className={legendClass}>Priority</label>
          <select
            id="priority" value={draft.priority} onChange={e => set('priority', e.target.value as Priority)}
            className="rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 text-ink"
          >
            {priorities.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      <button type="submit" disabled={create.isPending}
        className="rounded-sm border border-accent px-3 py-1 text-[11px] text-accent disabled:opacity-40">
        Create
      </button>

      {/* This form binds title and description; anything else td names, and
          any error carrying no field at all, belongs here. */}
      {panelError && <ErrorPanel message={panelError} />}
    </form>
  )
}

const boundFields = ['title', 'description']

function FieldError({ error, field }: { error: unknown; field: string }) {
  const message = fieldErrorFor(error, field)
  if (!message) return null
  return <p className="mt-1.5 text-[11px] text-danger">{message}</p>
}
