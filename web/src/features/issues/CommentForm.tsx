import { useRef, useState } from 'react'
import { unboundMessage } from '../../api/client'
import { useAddComment } from '../../api/mutations'
import ErrorPanel from '../../components/ErrorPanel'
import FieldError, { fieldAria } from '../../components/FieldError'
import MarkdownHint from '../../components/MarkdownHint'

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
        {...fieldAria(add.error, 'text', 'comment', 'comment-hint')}
      />
      <MarkdownHint id="comment-hint" />
      <FieldError error={add.error} field="text" inputId="comment" />
      {/* Everything td says that the textarea above is not already showing.
          ErrorPanel is heavier than this three-row form would pick on its own,
          and that weight is the point: a response can carry a text field error
          and something unbound at once, and the two channels have to be told
          apart by eye, not only by role=alert. Every other form draws the same
          line the same way. */}
      {panelError && (
        <div className="mt-2">
          <ErrorPanel label="Comment rejected" message={panelError} />
        </div>
      )}
      <button type="submit" disabled={add.isPending}
        className="mt-2 rounded-sm border border-accent px-3 py-1 text-[11px] text-accent disabled:opacity-40">
        Add comment
      </button>
    </form>
  )
}
