import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useIssue } from '../../api/queries'
import { ApiError } from '../../api/client'
import TransitionBar from './TransitionBar'
import CommentForm from './CommentForm'
import IssueActions from './IssueActions'
import IssueEditForm from './IssueEditForm'
import DependencyPanel from './DependencyPanel'
import type { Handoff } from '../../api/types'
import { relativeTime, shortSession } from '../../lib/format'
import StatusTag from '../../components/StatusTag'
import PriorityTag from '../../components/PriorityTag'
import ErrorPanel from '../../components/ErrorPanel'

export default function IssueDetail() {
  const [editing, setEditing] = useState(false)
  const { id = '' } = useParams()
  const { data, error, isPending } = useIssue(id)

  if (isPending) return <p className="p-4 text-ink-muted">Loading …</p>

  if (error) {
    const apiError = error instanceof ApiError ? error : null
    return (
      <div className="p-4">
        <ErrorPanel message={apiError?.message ?? String(error)} />
        {apiError?.code === 'not_found' && (
          <Link to="/" className="mt-3 inline-block text-[11px] text-ink-muted underline">
            back to list
          </Link>
        )}
      </div>
    )
  }

  const { issue, logs, comments, dependencies, latest_handoff } = data

  return (
    <div className="px-5 py-4 pb-6">
      <Link to="/" className="text-[11px] text-ink-muted">← back to list</Link>

      <header className="mt-3">
        <span className="block font-mono text-[11px] text-ink-faint">{issue.id}</span>
        <h1 className="mb-2 mt-0.5 text-xl font-semibold leading-snug tracking-tight text-ink">
          {issue.title}
        </h1>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="rounded-sm border border-line px-1.5 py-0.5 font-mono text-ink-muted">
            {issue.type}
          </span>
          <span className="rounded-sm border border-line px-1.5 py-0.5">
            <PriorityTag priority={issue.priority} />
          </span>
          <span className="rounded-sm border border-line px-1.5 py-0.5">
            <StatusTag status={issue.status} />
          </span>
        </div>
      </header>

      <IssueActions issue={issue} editing={editing} onEdit={() => setEditing(!editing)} />

      {editing && <IssueEditForm issue={issue} onDone={() => setEditing(false)} />}

      <TransitionBar issueId={issue.id} available={issue.available_transitions} />

      {!editing && issue.description && (
        <section className="mt-6">
          <h2 className="mb-2 text-[11px] uppercase tracking-widest text-ink-muted">Description</h2>
          <p className="max-w-[68ch] whitespace-pre-wrap leading-relaxed">
            {issue.description}
          </p>
        </section>
      )}

      {latest_handoff && <HandoffPanel handoff={latest_handoff} />}

      <DependencyPanel issueId={issue.id} dependencies={dependencies} />

      <section className="mt-6">
        <h2 className="mb-2 text-[11px] uppercase tracking-widest text-ink-muted">Activity</h2>
        <ul>
          {logs.map(log => (
            <li
              key={log.id}
              className="flex items-baseline gap-2.5 border-b border-line-subtle py-1.5 last:border-b-0"
            >
              <span className="w-[66px] shrink-0 font-mono text-[11px] tracking-wide text-ink-muted">
                {log.type}
              </span>
              <span className="flex-1">{log.message}</span>
              <span className="shrink-0 font-mono text-[11px] text-ink-faint">
                {relativeTime(log.timestamp)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-[11px] uppercase tracking-widest text-ink-muted">Comments</h2>
        <ul>
          {comments.map(comment => (
            <li
              key={comment.id}
              className="mb-2 rounded-md border border-line bg-surface-raised px-3 py-2.5"
            >
              <div className="mb-1.5 flex gap-2 font-mono text-[11px] text-ink-faint">
                <span>session {shortSession(comment.session_id)}</span>
                <span>·</span>
                <span>{relativeTime(comment.created_at)}</span>
              </div>
              <p className="whitespace-pre-wrap leading-relaxed">
                {comment.text}
              </p>
            </li>
          ))}
        </ul>
        <CommentForm issueId={issue.id} />
      </section>
    </div>
  )
}

const handoffTone: Record<string, string> = {
  Done: 'text-success',
  Remaining: 'text-accent',
  Decisions: 'text-ink-muted',
  Uncertain: 'text-st-review',
}

function HandoffPanel({ handoff }: { handoff: Handoff }) {
  const sections: [string, string[]][] = [
    ['Done', handoff.done],
    ['Remaining', handoff.remaining],
    ['Decisions', handoff.decisions],
    ['Uncertain', handoff.uncertain],
  ]
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[11px] uppercase tracking-widest text-ink-muted">Latest handoff</h2>
      <div className="rounded-md border border-line bg-surface-raised px-4 py-3.5">
        <div className="grid gap-x-5 gap-y-3.5 sm:grid-cols-2">
          {sections.filter(([, items]) => items.length > 0).map(([title, items]) => (
            <div key={title}>
              <h3 className={`mb-1.5 text-[11px] uppercase tracking-widest ${handoffTone[title]}`}>
                {title}
              </h3>
              <ul className="list-disc pl-4 leading-relaxed">
                {items.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
