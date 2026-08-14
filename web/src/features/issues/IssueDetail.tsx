import { Link, useParams } from 'react-router'
import { useIssue } from '../../api/queries'
import { ApiError } from '../../api/client'
import TransitionBar from './TransitionBar'
import type { Handoff } from '../../api/types'

export default function IssueDetail() {
  const { id = '' } = useParams()
  const { data, error, isPending } = useIssue(id)

  if (isPending) return <p className="p-6 text-neutral-500">Wird geladen …</p>

  if (error) {
    const apiError = error instanceof ApiError ? error : null
    return (
      <div className="p-6">
        <p className="text-red-600" role="alert">
          {apiError?.message ?? String(error)}
        </p>
        {apiError?.code === 'not_found' && (
          <Link to="/" className="mt-3 inline-block underline">Zurück zur Liste</Link>
        )}
      </div>
    )
  }

  const { issue, logs, comments, latest_handoff } = data

  return (
    <div className="p-6">
      <Link to="/" className="text-sm underline">Zurück zur Liste</Link>

      <header className="mt-3">
        <span className="font-mono text-sm text-neutral-500">{issue.id}</span>
        <h1 className="text-2xl font-semibold">{issue.title}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {issue.type} · {issue.priority} · {issue.status}
        </p>
      </header>

      <TransitionBar issueId={issue.id} available={issue.available_transitions} />

      {issue.description && (
        <section className="mt-6">
          <h2 className="font-semibold">Beschreibung</h2>
          <p className="mt-1 whitespace-pre-wrap">{issue.description}</p>
        </section>
      )}

      {latest_handoff && <HandoffPanel handoff={latest_handoff} />}

      <section className="mt-6">
        <h2 className="font-semibold">Verlauf</h2>
        <ul className="mt-1 space-y-1 text-sm">
          {logs.map(log => (
            <li key={log.id}>
              <span className="text-neutral-500">{log.type}</span> — <span>{log.message}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">Kommentare</h2>
        <ul className="mt-1 space-y-2 text-sm">
          {comments.map(comment => (
            <li key={comment.id} className="whitespace-pre-wrap">{comment.text}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function HandoffPanel({ handoff }: { handoff: Handoff }) {
  const sections: [string, string[]][] = [
    ['Erledigt', handoff.done],
    ['Offen', handoff.remaining],
    ['Entscheidungen', handoff.decisions],
    ['Unklar', handoff.uncertain],
  ]
  return (
    <section className="mt-6 rounded border border-neutral-200 p-4">
      <h2 className="font-semibold">Letzter Handoff</h2>
      {sections.filter(([, items]) => items.length > 0).map(([title, items]) => (
        <div key={title} className="mt-2">
          <h3 className="text-sm font-medium text-neutral-600">{title}</h3>
          <ul className="list-disc pl-5 text-sm">
            {items.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </div>
      ))}
    </section>
  )
}
