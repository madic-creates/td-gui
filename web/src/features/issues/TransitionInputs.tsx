import MarkdownHint from '../../components/MarkdownHint'
import { approveModes, type ApproveMode } from './transitions'

interface AttributionProps {
  /**
   * Namespaces the ids and the radio group's name. Two hosts render these
   * fields on the issue detail page at once — the transition bar and the edit
   * form's status change — and a shared radio name would make one group's
   * click clear the other's.
   */
  idPrefix: string
  mode: ApproveMode
  onMode: (mode: ApproveMode) => void
  reviewedBy: string
  onReviewedBy: (value: string) => void
  /** Extra controls belonging to the host, rendered inside the fieldset. */
  children?: React.ReactNode
}

/** The attribution question td's trusted mode asks before an approval. */
export function AttributionFieldset({
  idPrefix, mode, onMode, reviewedBy, onReviewedBy, children,
}: AttributionProps) {
  const reviewerId = `${idPrefix}-reviewed-by`
  return (
    <fieldset className="mb-3">
      <legend className="mb-1.5 text-[11px] uppercase tracking-widest text-ink-muted">
        Attribution
      </legend>
      {approveModes.map(([value, label]) => (
        <label key={value} className="flex items-center gap-2 py-0.5">
          <input
            type="radio"
            name={`${idPrefix}-approve-mode`}
            value={value}
            checked={mode === value}
            onChange={() => onMode(value)}
          />
          <span>{label}</span>
        </label>
      ))}
      {mode === 'attributed' && (
        <div className="mt-2">
          <label
            htmlFor={reviewerId}
            className="mb-1.5 block text-[11px] uppercase tracking-widest text-ink-muted"
          >
            Reviewer
          </label>
          {/* A single-line input rules out the newlines td rejects.
              The length cap is an affordance only — td validates. */}
          <input
            id={reviewerId}
            type="text"
            maxLength={120}
            value={reviewedBy}
            onChange={e => onReviewedBy(e.target.value)}
            className="w-full rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 text-ink"
          />
        </div>
      )}
      {children}
    </fieldset>
  )
}

interface ReasonProps {
  idPrefix: string
  value: string
  onChange: (value: string) => void
}

/**
 * The note td appends as a progress log entry on a reject, block or close,
 * and keeps as the review summary on an approve.
 */
export function ReasonField({ idPrefix, value, onChange }: ReasonProps) {
  const id = `${idPrefix}-reason`
  return (
    <>
      <label
        htmlFor={id}
        className="mb-1.5 block text-[11px] uppercase tracking-widest text-ink-muted"
      >
        Reason
      </label>
      <textarea
        id={id}
        rows={2}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-sm border border-line bg-surface-inset px-2.5 py-2 text-ink"
        aria-describedby={`${id}-hint`}
      />
      {/* On an approve or a reject this becomes the review summary, which
          ReviewPanel renders as Markdown, so the hint belongs here too even
          though the box is small and transient. */}
      <MarkdownHint id={`${id}-hint`} />
    </>
  )
}
