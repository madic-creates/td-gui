import { ApiError } from '../../api/client'
import { useTransition } from '../../api/mutations'
import ErrorPanel from '../../components/ErrorPanel'
import type { Transition } from '../../api/types'

const labels: Record<Transition, string> = {
  start: 'Start',
  review: 'Request review',
  approve: 'Approve',
  reject: 'Reject',
  block: 'Block',
  unblock: 'Unblock',
  close: 'Close',
  reopen: 'Reopen',
}

const tone: Partial<Record<Transition, string>> = {
  approve: 'border-success/40 text-success',
  reject: 'border-danger/40 text-danger',
  block: 'border-danger/40 text-danger',
}

interface Props {
  issueId: string
  /** Absent means td did not tell us — render nothing rather than guess. */
  available?: Transition[]
}

export default function TransitionBar({ issueId, available }: Props) {
  const transition = useTransition(issueId)

  if (!available?.length) return null

  return (
    <div className="mt-4 border-t border-line-subtle pt-4">
      <div className="flex flex-wrap gap-1.5">
        {available.map(action => (
          <button
            key={action}
            className={`rounded-sm border px-2.5 py-1 text-[11px] disabled:opacity-40 ${
              tone[action] ?? 'border-line text-ink'
            }`}
            disabled={transition.isPending}
            onClick={() => transition.mutate({ action })}
          >
            {labels[action] ?? action}
          </button>
        ))}
      </div>

      {transition.error && (
        // td phrases policy rejections precisely. Show its message unchanged;
        // a generic "not allowed" would lose the reason.
        <div className="mt-2">
          <ErrorPanel
            label="Transition rejected"
            message={
              transition.error instanceof ApiError
                ? transition.error.message
                : String(transition.error)
            }
          />
        </div>
      )}
    </div>
  )
}
