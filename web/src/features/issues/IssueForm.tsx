import { useState } from 'react'
import { ApiError, fieldErrorFor } from '../../api/client'
import { useCreateIssue } from '../../api/mutations'
import type { IssueType, Priority } from '../../api/types'

const types: IssueType[] = ['task', 'feature', 'bug', 'chore', 'epic']
const priorities: Priority[] = ['P0', 'P1', 'P2', 'P3', 'P4']

export default function IssueForm() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<IssueType>('task')
  const [priority, setPriority] = useState<Priority>('P2')
  const create = useCreateIssue()

  // No client-side length checks: td's title bounds are per-project config,
  // so any hardcoded value here would eventually be wrong.
  return (
    <form
      className="max-w-xl space-y-4 p-6"
      onSubmit={e => {
        e.preventDefault()
        create.mutate({ title, description: description || undefined, type, priority })
      }}
    >
      <div>
        <label htmlFor="title" className="block text-sm font-medium">Titel</label>
        <input
          id="title" value={title} onChange={e => setTitle(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-1"
        />
        <FieldError error={create.error} field="title" />
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium">Beschreibung</label>
        <textarea
          id="description" rows={5} value={description}
          onChange={e => setDescription(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-1"
        />
        <FieldError error={create.error} field="description" />
      </div>

      <div className="flex gap-4">
        <div>
          <label htmlFor="type" className="block text-sm font-medium">Typ</label>
          <select
            id="type" value={type} onChange={e => setType(e.target.value as IssueType)}
            className="mt-1 rounded border px-3 py-1"
          >
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="priority" className="block text-sm font-medium">Priorität</label>
          <select
            id="priority" value={priority} onChange={e => setPriority(e.target.value as Priority)}
            className="mt-1 rounded border px-3 py-1"
          >
            {priorities.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      <button type="submit" disabled={create.isPending}
        className="rounded border px-4 py-1 disabled:opacity-40">
        Anlegen
      </button>

      {create.isSuccess && <p className="text-green-700">Issue angelegt.</p>}

      {create.error instanceof ApiError && create.error.code !== 'validation_error' && (
        <p className="text-red-600" role="alert">{create.error.message}</p>
      )}
    </form>
  )
}

function FieldError({ error, field }: { error: unknown; field: string }) {
  const message = fieldErrorFor(error, field)
  if (!message) return null
  return <p className="mt-1 text-sm text-red-600">{message}</p>
}
