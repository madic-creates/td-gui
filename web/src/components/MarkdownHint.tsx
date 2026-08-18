/**
 * Tells the author that a long text field is rendered as Markdown, and which
 * dialect. Sits under the textarea, styled like the TDQ hint in BoardForm.
 *
 * Naming the flavour is the point. "Markdown supported" leaves the two things
 * people actually get wrong unanswered: whether tables work (GFM: yes,
 * CommonMark: no) and whether a single newline breaks the line (it does not,
 * in both). The link settles the rest without us restating a spec.
 *
 * `id` is required rather than optional because the hint is only useful to a
 * screen reader if the field points at it with aria-describedby, and an
 * optional id makes forgetting that the default.
 */
export default function MarkdownHint({ id }: { id: string }) {
  return (
    <p id={id} className="mt-1.5 text-[11px] text-ink-faint">
      GitHub Flavored Markdown, rendered when displayed. See the{' '}
      <a
        href="https://github.github.com/gfm/"
        target="_blank" rel="noreferrer"
        className="text-ink-muted underline"
      >
        GFM spec
      </a>.
    </p>
  )
}
