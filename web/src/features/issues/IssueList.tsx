import { useState } from 'react'
import { Link } from 'react-router'
import { useIssues, type IssueListParams } from '../../api/queries'
import { ApiError } from '../../api/client'
import IssueFilters from './IssueFilters'

const PAGE_SIZE = 50

const statusLabels: Record<string, string> = {
  open: 'Offen',
  in_progress: 'In Arbeit',
  in_review: 'Im Review',
  blocked: 'Blockiert',
  closed: 'Geschlossen',
}

export default function IssueList() {
  const [params, setParams] = useState<IssueListParams>({ limit: PAGE_SIZE, offset: 0 })
  const { data, error, isPending } = useIssues(params)

  if (isPending) return <p className="p-6 text-neutral-500">Wird geladen …</p>

  if (error) {
    const message = error instanceof ApiError ? error.message : String(error)
    return <p className="p-6 text-red-600" role="alert">{message}</p>
  }

  return (
    <div className="p-6">
      <Link to="/new" className="mb-4 inline-block rounded border px-3 py-1 text-sm">
        Neues Issue
      </Link>

      <IssueFilters
        params={params}
        onChange={next => setParams({ ...next, offset: 0 })}
      />

      {data.issues.length === 0 ? (
        <p className="mt-8 text-neutral-500">Keine Issues gefunden.</p>
      ) : (
        <ul className="mt-4 divide-y divide-neutral-200">
          {data.issues.map(issue => (
            <li key={issue.id} className="py-3">
              <Link to={`/issues/${issue.id}`} className="flex items-baseline gap-3 hover:underline">
                <span className="font-mono text-sm text-neutral-500">{issue.id}</span>
                <span className="flex-1">{issue.title}</span>
                <span className="text-sm text-neutral-500">{issue.priority}</span>
                <span className="text-sm text-neutral-500">
                  {statusLabels[issue.status] ?? issue.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex items-center gap-4 text-sm">
        <button
          className="rounded border px-3 py-1 disabled:opacity-40"
          disabled={params.offset === 0}
          onClick={() => setParams(p => ({ ...p, offset: Math.max(0, p.offset - PAGE_SIZE) }))}
        >
          Zurück
        </button>
        <span className="text-neutral-500">
          {data.offset + 1}–{data.offset + data.issues.length} von {data.total}
        </span>
        <button
          className="rounded border px-3 py-1 disabled:opacity-40"
          disabled={!data.has_more}
          onClick={() => setParams(p => ({ ...p, offset: p.offset + PAGE_SIZE }))}
        >
          Weiter
        </button>
      </div>
    </div>
  )
}
