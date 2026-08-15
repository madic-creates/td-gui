import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { ApiError } from '../../api/client'
import { useDeleteIssue, useSetFocus } from '../../api/mutations'
import type { Issue } from '../../api/types'
import ConfirmButton from '../../components/ConfirmButton'
import ErrorPanel from '../../components/ErrorPanel'

interface Props {
  issue: Issue
  editing: boolean
  onEdit: () => void
}

export default function IssueActions({ issue, editing, onEdit }: Props) {
  const navigate = useNavigate()
  const remove = useDeleteIssue(issue.id)
  const focus = useSetFocus()

  // `focus.isSuccess` never resets on its own, so the acknowledgement is
  // tracked locally and cleared whenever another action starts.
  const [focusAck, setFocusAck] = useState(false)

  // Which action's outcome is currently worth showing. Selecting the error
  // this way rather than calling reset() on the sibling mutation matters:
  // MutationObserver.reset() detaches the observer from a *pending* mutation,
  // so its mutate-level callbacks — the delete's navigate('/') — and its
  // error state never come back. Nothing here touches a live request.
  const [lastAction, setLastAction] = useState<'delete' | 'focus' | null>(null)

  // A transition, an edit, or any other td-reported change bumps
  // `updated_at` — TransitionBar drives that through its own mutations and
  // never calls into this component, so a stale acknowledgement or error
  // needs its own hook to notice the issue changed underneath it. This
  // deliberately resets only what belongs to IssueActions (focusAck and which
  // outcome is shown), not the whole subtree: an earlier version keyed the
  // whole component on `updated_at`, which also reset ConfirmButton's own
  // armed state and silently cancelled an in-progress delete confirmation if
  // the issue changed while it was armed.
  const busy = remove.isPending || focus.isPending
  const lastSeenUpdatedAt = useRef(issue.updated_at)
  useEffect(() => {
    if (lastSeenUpdatedAt.current === issue.updated_at) return
    lastSeenUpdatedAt.current = issue.updated_at
    setFocusAck(false)
    // An action still in flight has no stale outcome yet — its answer, td's
    // wording included, is still owed to the user.
    if (!busy) setLastAction(null)
    // remove/focus are new objects every render; only the update itself
    // should trigger this, not a change in mutation identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue.updated_at])

  // Each mutation's error is only ever current for the action that produced
  // it, so a stale delete failure can't keep rendering next to an unrelated
  // focus success, or vice versa.
  const error = lastAction === 'delete' ? remove.error : lastAction === 'focus' ? focus.error : null

  function handleEdit() {
    setLastAction(null)
    setFocusAck(false)
    onEdit()
  }

  function handleFocus() {
    setLastAction('focus')
    setFocusAck(false)
    focus.mutate(issue.id, { onSuccess: () => setFocusAck(true) })
  }

  function handleDelete() {
    setLastAction('delete')
    setFocusAck(false)
    // Soft delete. The detail route would otherwise keep rendering an
    // issue that a direct GET still returns.
    remove.mutate(undefined, { onSuccess: () => navigate('/') })
  }

  return (
    <div className="mt-3">
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
          disabled={focus.isPending}
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
          disabled={remove.isPending}
          onConfirm={handleDelete}
        />
      </div>

      {error && (
        <div className="mt-2">
          <ErrorPanel
            label="Action rejected"
            message={error instanceof ApiError ? error.message : String(error)}
          />
        </div>
      )}
    </div>
  )
}
