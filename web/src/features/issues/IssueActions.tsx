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

  const error = remove.error ?? focus.error

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onEdit}
          className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink"
        >
          {editing ? 'Close editor' : 'Edit'}
        </button>

        <button
          type="button"
          disabled={focus.isPending}
          onClick={() => focus.mutate(issue.id)}
          className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted disabled:opacity-40"
        >
          Focus
        </button>

        {/* An acknowledgement of the request, not a reading of focus state:
            td exposes no GET for it, so the GUI cannot know what is focused. */}
        {focus.isSuccess && <span className="text-[11px] text-success">focus set</span>}

        <ConfirmButton
          label="Delete"
          question="Delete this issue?"
          disabled={remove.isPending}
          // Soft delete. The detail route would otherwise keep rendering an
          // issue that a direct GET still returns.
          onConfirm={() => remove.mutate(undefined, { onSuccess: () => navigate('/') })}
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
