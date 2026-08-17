import { useRef, useState } from 'react'
import { unboundMessage } from '../../api/client'
import { useAddComment } from '../../api/mutations'
import FieldError from '../../components/FieldError'

const boundFields = ['text']

export default function CommentForm({ issueId }: { issueId: string }) {
  const [text, setText] = useState('')
  const add = useAddComment(issueId)
  const panelError = unboundMessage(add.error, boundFields)

  // The submit button disables on add.isPending, but that reads from state
  // and doesn't stop the form's native submit event: two submits landing
  // before a render commits (a fast double-Enter, or two events in the same
  // tick) would otherwise both read isPending as false and each post the
  // comment, creating a duplicate. Same fix as IssueForm.tsx's create submit.
  const submitting = useRef(false)

  return (
    <form
      // Its label is styled exactly like the section headings above it, so it
      // reads as one of them and has to sit the same distance below whatever
      // precedes it — `mt-6`, the gap every section opens with.
      className="mt-6"
      onSubmit={e => {
        e.preventDefault()
        if (submitting.current) return
        submitting.current = true
        add.mutate({ text }, {
          onSuccess: () => setText(''),
          onSettled: () => { submitting.current = false },
        })
      }}
    >
      <label htmlFor="comment" className="mb-1.5 block text-[11px] uppercase tracking-widest text-ink-muted">Comment</label>
      <textarea
        id="comment" rows={3} value={text} onChange={e => setText(e.target.value)}
        className="w-full rounded-sm border border-line bg-surface-inset px-2.5 py-2 text-ink"
      />
      <FieldError error={add.error} field="text" />
      {/* Everything td says that the textarea above is not already showing. */}
      {panelError && (
        <p className="mt-1.5 text-[11px] text-danger" role="alert">{panelError}</p>
      )}
      <button type="submit" disabled={add.isPending}
        className="mt-2 rounded-sm border border-accent px-3 py-1 text-[11px] text-accent disabled:opacity-40">
        Add comment
      </button>
    </form>
  )
}
