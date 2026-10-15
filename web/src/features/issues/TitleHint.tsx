import type { Project } from '../../api/types'

/**
 * The title bounds td reports for this project, as a pair, or null when td
 * reported none. A hint only: the form never refuses a title on these — td
 * validates, and its refusal is what the author is shown. The two forms read
 * this to decide whether the input points at the hint at all, which is why it
 * is a function of the answer rather than a hook of its own.
 */
// oxlint-disable-next-line react/only-export-components
export function titleBounds(project: Project | undefined): [number, number] | null {
  if (!project?.title_min_length || !project.title_max_length) return null
  return [project.title_min_length, project.title_max_length]
}

/**
 * Sits under the title input, styled like MarkdownHint under the long text
 * fields. `id` is required for the same reason it is there: the hint only
 * reaches a screen reader through the input's aria-describedby.
 */
export default function TitleHint({ id, bounds: [min, max] }: {
  id: string
  bounds: [number, number]
}) {
  return (
    <p id={id} className="mt-1.5 text-[11px] text-ink-faint">
      Between {min} and {max} characters.
    </p>
  )
}
