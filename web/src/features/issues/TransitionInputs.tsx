import type { Attribution } from '../../api/mutations'
import MarkdownHint from '../../components/MarkdownHint'

/**
 * How an approval is attributed. `attributed` and `self` map to td's
 * reviewed_by and self_review, which it rejects together with a 400 — a radio
 * group keeps that state unreachable.
 */
export type ApproveMode = 'independent' | 'attributed' | 'self'

export const approveModes: [ApproveMode, string][] = [
  ['independent', 'I reviewed this independently'],
  ['attributed', 'Reviewed by someone else'],
  ['self', 'I reviewed my own work'],
]

/** Only ever sets one of reviewed_by / self_review — never both. */
export function attributionOf(mode: ApproveMode, reviewedBy: string): Omit<Attribution, 'reason'> {
  if (mode === 'attributed') return { reviewed_by: reviewedBy.trim() }
  if (mode === 'self') return { self_review: true }
  return {}
}

/**
 * td only rejects a whitespace-only reviewed_by (trims to empty but arrives
 * non-empty); a genuinely empty string passes its validation and is recorded
 * as an unattributed review — silently not what "Reviewed by someone else"
 * promised. Blocked here rather than let it round-trip into a mislabeled
 * approval.
 */
export function attributionIncomplete(mode: ApproveMode, reviewedBy: string): boolean {
  return mode === 'attributed' && !reviewedBy.trim()
}

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
