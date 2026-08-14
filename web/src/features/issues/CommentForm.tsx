import { useState } from 'react'
import { ApiError, fieldErrorFor } from '../../api/client'
import { useAddComment } from '../../api/mutations'

export default function CommentForm({ issueId }: { issueId: string }) {
  const [text, setText] = useState('')
  const add = useAddComment(issueId)

  return (
    <form
      className="mt-3"
      onSubmit={e => {
        e.preventDefault()
        add.mutate({ text }, { onSuccess: () => setText('') })
      }}
    >
      <label htmlFor="comment" className="block text-sm font-medium">Kommentar</label>
      <textarea
        id="comment" rows={3} value={text} onChange={e => setText(e.target.value)}
        className="mt-1 w-full rounded border px-3 py-1"
      />
      {fieldErrorFor(add.error, 'text') && (
        <p className="mt-1 text-sm text-red-600">{fieldErrorFor(add.error, 'text')}</p>
      )}
      {add.error instanceof ApiError && add.error.code !== 'validation_error' && (
        <p className="mt-1 text-sm text-red-600" role="alert">{add.error.message}</p>
      )}
      <button type="submit" disabled={add.isPending}
        className="mt-2 rounded border px-3 py-1 text-sm disabled:opacity-40">
        Kommentieren
      </button>
    </form>
  )
}
