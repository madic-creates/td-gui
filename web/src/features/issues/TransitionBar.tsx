import { ApiError } from '../../api/client'
import { useTransition } from '../../api/mutations'
import type { Transition } from '../../api/types'

const labels: Record<Transition, string> = {
  start: 'Starten',
  review: 'Zum Review',
  approve: 'Freigeben',
  reject: 'Ablehnen',
  block: 'Blockieren',
  unblock: 'Entblockieren',
  close: 'Schließen',
  reopen: 'Wieder öffnen',
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
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        {available.map(action => (
          <button
            key={action}
            className="rounded border px-3 py-1 text-sm disabled:opacity-40"
            disabled={transition.isPending}
            onClick={() => transition.mutate({ action })}
          >
            {labels[action] ?? action}
          </button>
        ))}
      </div>

      {transition.error && (
        // td phrases policy rejections precisely. Show its message unchanged;
        // a generic "nicht erlaubt" would lose the reason.
        <p className="mt-2 text-sm text-red-600" role="alert">
          {transition.error instanceof ApiError
            ? transition.error.message
            : String(transition.error)}
        </p>
      )}
    </div>
  )
}
