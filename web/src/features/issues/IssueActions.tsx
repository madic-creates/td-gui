import { useState } from 'react'
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

  // `focus.isSuccess` never resets on its own, and this component is never
  // unmounted by toggling edit mode or by a status transition — so the
  // acknowledgement is tracked locally and cleared whenever another action
  // starts, rather than left to display for the rest of the session.
  const [focusAck, setFocusAck] = useState(false)

  // Each mutation's error is only ever current for the action that produced
  // it — reset the sibling before starting a new one so a stale delete
  // failure can't keep rendering next to an unrelated focus success, or vice
  // versa.
  const error = remove.error ?? focus.error

  function handleEdit() {
    focus.reset()
    setFocusAck(false)
    onEdit()
  }

  function handleFocus() {
    remove.reset()
    setFocusAck(false)
    focus.mutate(issue.id, { onSuccess: () => setFocusAck(true) })
  }

  function handleDelete() {
    focus.reset()
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
