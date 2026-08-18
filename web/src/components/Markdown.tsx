import { useSyncExternalStore, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getMode, subscribe } from '../lib/prose'

/**
 * Renders td's long text fields as Markdown.
 *
 * td issue text is written in a terminal and is Markdown in practice: this
 * project's own issues use headings, `-` lists, fenced blocks, backticked
 * identifiers and links. Rendering the source characters costs the one thing a
 * GUI offers over `td show`, which is readable long-form text.
 *
 * Safety here is structural rather than configured. react-markdown emits React
 * elements, so no HTML string exists at any point and there is no
 * `dangerouslySetInnerHTML` in this file. Without `rehype-raw`, raw HTML in the
 * source is never parsed into nodes; it survives as escaped text. Do not add
 * `rehype-raw`: it is the one change that would turn issue text into an
 * injection surface. Markdown.test.tsx pins this against a deliberately unsafe
 * implementation.
 *
 * Line breaks follow CommonMark: a hard-wrapped paragraph is joined and
 * reflowed, and `remark-breaks` is deliberately absent. The wrapping is an
 * artefact of composing text in an eighty-column terminal, not authored
 * structure, and reimposing the author's column inside a wide browser column
 * reproduces the defect instead of the intent.
 *
 * Known limitation: indented terminal output (four spaces or more) survives
 * exactly, as a code block. Pipe-aligned output with no indentation and no GFM
 * delimiter row is reflowed and loses its alignment. Detecting that needs
 * heuristics that misfire on ordinary prose containing a pipe, so the
 * convention is to indent such blocks.
 *
 * Which is also why this file has a second mode. Under `raw` it emits the
 * source characters instead, and the header toggle switches every rendered
 * surface at once. The mode is read here rather than passed in, so no call
 * site opts into it and none can be forgotten. Raw output is a React child
 * too, so the injection surface stays closed on that path as well.
 */

/**
 * The elements `inline` keeps. Everything else is unwrapped to its text, so a
 * block construct degrades to a line instead of nesting a second block inside
 * a list item that is already one.
 */
const INLINE_ELEMENTS = ['a', 'code', 'em', 'strong', 'del']

/*
 * No @tailwindcss/typography. Its `prose` class carries `max-width: 65ch`,
 * which would silently undo the deliberate no-max-width decision on the issue
 * prose column, the one that exists so a pasted table or code block gets the
 * full width. These map the project's own tokens instead.
 */
function componentsFor(compact: boolean): Components {
  const gap = compact ? 'mt-1.5' : 'mt-3'

  /**
   * Headings render two levels down from their source level: an `#` in a
   * description becomes an `h3`, one step below the `h2` that labels the
   * section it sits in. Issue text must not outrank the page structure it sits
   * inside, and a document with two `h1`s is also simply wrong.
   */
  const heading = (level: number) => {
    const Tag = `h${Math.min(level + 2, 6)}` as 'h3' | 'h4' | 'h5' | 'h6'
    const size = compact ? 'text-[11px]' : level === 1 ? 'text-[15px]' : 'text-[13px]'
    return ({ children }: { children?: ReactNode }) => (
      <Tag className={`${compact ? 'mt-2.5' : 'mt-4'} mb-1 font-semibold ${size} first:mt-0`}>
        {children}
      </Tag>
    )
  }

  return {
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline">
        {children}
      </a>
    ),

    p: ({ children }) => <p className={`${gap} leading-relaxed first:mt-0`}>{children}</p>,

    h1: heading(1),
    h2: heading(2),
    h3: heading(3),
    h4: heading(4),
    h5: heading(5),
    h6: heading(6),

    ul: ({ children }) => (
      <ul className={`${gap} list-disc pl-5 leading-relaxed first:mt-0`}>{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className={`${gap} list-decimal pl-5 leading-relaxed first:mt-0`}>{children}</ol>
    ),
    // A nested list sits inside an li and must not repeat the top gap, or each
    // level of nesting adds another blank line above itself.
    li: ({ children }) => <li className="[&>ul]:mt-1 [&>ol]:mt-1">{children}</li>,

    blockquote: ({ children }) => (
      <blockquote className={`${gap} border-l-2 border-line pl-3 text-ink-muted first:mt-0`}>
        {children}
      </blockquote>
    ),

    /* The fenced block scrolls inside its own box rather than stretching the
       column. The `[&_code]` resets undo the inline-code chrome below for the
       code element a pre always wraps: without them a fenced block draws the
       inset background twice and pads every line. Keying off the parent this
       way is more reliable than sniffing the child's language class, which a
       bare ``` fence does not carry. */
    pre: ({ children }) => (
      <pre
        className={`${gap} overflow-x-auto rounded-md border border-line bg-surface-inset px-3 py-2.5 font-mono text-[12px] leading-relaxed first:mt-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit [&_code]:[font-size:1em]`}
      >
        {children}
      </pre>
    ),
    code: ({ children }) => (
      <code className="rounded bg-surface-inset px-1 py-0.5 font-mono text-[0.9em]">
        {children}
      </code>
    ),

    /* w-max, not w-full: the point of the scroll box is that a wide table keeps
       its natural column widths and scrolls, instead of being squeezed to fit. */
    table: ({ children }) => (
      <div className={`${gap} overflow-x-auto first:mt-0`}>
        <table className="w-max border-collapse text-left">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border border-line bg-surface-inset px-2.5 py-1.5 font-semibold">
        {children}
      </th>
    ),
    td: ({ children }) => <td className="border border-line px-2.5 py-1.5">{children}</td>,

    hr: () => <hr className={`${gap} border-line`} />,
  }
}

const BLOCK_COMPONENTS = componentsFor(false)
const COMPACT_COMPONENTS = componentsFor(true)

/* `inline` drops the block styling but keeps the link override: target and rel
   are a safety property of every rendered link, not a decoration of the block
   variants. A test asserts this for all three variants, because passing no
   components at all here is the obvious shortcut and silently loses it. */
const INLINE_COMPONENTS: Components = { a: BLOCK_COMPONENTS.a }

interface Props {
  children: string
  /**
   * `block` for the description and acceptance criteria. `compact` is the same
   * renderer on a tighter vertical rhythm, for comment bodies and review
   * summaries. `inline` keeps only inline constructs, for handoff bullets,
   * which are already list items inside a list.
   */
  variant?: 'block' | 'compact' | 'inline'
}

export default function Markdown({ children, variant = 'block' }: Props) {
  const mode = useSyncExternalStore(subscribe, getMode)
  const inline = variant === 'inline'

  if (mode === 'raw') {
    /* `whitespace-pre-wrap`, not `pre`: the author's line breaks and
       indentation are the content here, so they stay, but an overlong line
       wraps instead of scrolling the page sideways. Monospace, or the columns
       of pasted terminal output would not line up, which is one of the reasons
       to look at the source at all. No border and no inset background, unlike
       a fenced block: here the whole text is the block, and a box drawn round
       every description says nothing.

       `block` and `compact` are the same in this mode. Their difference is the
       vertical rhythm between blocks, and raw text has none.

       The inline variant is a handoff bullet, already an li inside a ul, so it
       stays a span: a pre there would nest a block in a list item, which is
       the layout bug that variant exists to avoid. */
    return inline ? (
      <span className="whitespace-pre-wrap break-words font-mono">{children}</span>
    ) : (
      <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed">
        {children}
      </pre>
    )
  }

  const components = variant === 'compact' ? COMPACT_COMPONENTS : BLOCK_COMPONENTS
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={inline ? INLINE_COMPONENTS : components}
      allowedElements={inline ? INLINE_ELEMENTS : undefined}
      unwrapDisallowed={inline}
    >
      {children}
    </ReactMarkdown>
  )
}
