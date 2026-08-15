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

  // Guards the async focus callback below: if Delete resolves and navigates
  // away before a slower Focus response comes back, this component has
  // already unmounted and must not touch state.
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  // A transition, an edit, or any other td-reported change bumps
  // `updated_at` — TransitionBar drives that through its own mutations and
  // never calls into this component, so a stale acknowledgement or error
  // needs its own hook to notice the issue changed underneath it. This
  // deliberately resets only what belongs to IssueActions (focusAck and both
  // mutations' error state), not the whole subtree: an earlier version keyed
  // the whole component on `updated_at`, which also reset ConfirmButton's
  // own armed state and silently cancelled an in-progress delete
  // confirmation if the issue changed while it was armed.
  const lastSeenUpdatedAt = useRef(issue.updated_at)
  useEffect(() => {
    if (lastSeenUpdatedAt.current === issue.updated_at) return
    lastSeenUpdatedAt.current = issue.updated_at
    setFocusAck(false)
    remove.reset()
    focus.reset()
    // remove/focus are new objects every render; only the update itself
    // should trigger this, not a change in mutation identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue.updated_at])

  // Each mutation's error is only ever current for the action that produced
  // it — reset the sibling before starting a new one so a stale delete
  // failure can't keep rendering next to an unrelated focus success, or vice
  // versa.
  const error = remove.error ?? focus.error

  function handleEdit() {
    remove.reset()
    focus.reset()
    setFocusAck(false)
    onEdit()
  }

  function handleFocus() {
    remove.reset()
    setFocusAck(false)
    focus.mutate(issue.id, {
      onSuccess: () => {
        if (mounted.current) setFocusAck(true)
      },
    })
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
