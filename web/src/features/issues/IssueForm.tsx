import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { unboundMessage } from '../../api/client'
import { useCreateIssue } from '../../api/mutations'
import ErrorPanel from '../../components/ErrorPanel'
import FieldError, { fieldAria } from '../../components/FieldError'
import IssueFields, { boundFields, fieldClass, legendClass } from './IssueFields'
import { blankDraft, createBodyFrom } from './issueCreate'
import type { IssueDraft } from './issueDiff'
import { candidatesFor } from './issueIndex'
import { useIssueIndex } from './useIssueIndex'

export default function IssueForm() {
  // One draft rather than a state per field, and the same shape the edit form
  // holds — the two forms offer the same fields, so they hold the same object.
  const [draft, setDraft] = useState<IssueDraft>(blankDraft)
  const create = useCreateIssue()
  const navigate = useNavigate()
  const panelError = unboundMessage(create.error, boundFields)

  // Of the two queries this fires, the open one is what IssueList already
  // issues and so is served from cache; the closed one is not, and costs a
  // real request of its own — see useIssueIndex's docstring for why.
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
          {...fieldAria(create.error, 'title', 'new-title')}
        />
        <FieldError error={create.error} field="title" inputId="new-title" />
      </div>

      <IssueFields
        idPrefix="new" error={create.error} draft={draft} set={set}
        // Nothing to exclude: the issue does not exist yet, so it can be
        // neither its own parent nor its own child. candidatesFor still earns
        // its place by sorting closed issues last.
        parentCandidates={candidatesFor(issues, [])}
      />

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
