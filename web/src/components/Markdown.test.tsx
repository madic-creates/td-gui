import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import Markdown from './Markdown'
import { setMode } from '../lib/prose'

describe('Markdown', () => {
  it('renders an unordered list as a list, not as literal dashes', () => {
    const { container } = render(<Markdown>{'- first\n- second'}</Markdown>)

    const items = container.querySelectorAll('li')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('first')
    expect(screen.queryByText(/- first/)).toBeNull()
  })
})

describe('Markdown links', () => {
  it('opens links in a new tab with a safe rel', () => {
    render(<Markdown>{'[td](https://example.com/td)'}</Markdown>)

    const link = screen.getByRole('link', { name: 'td' })
    expect(link).toHaveAttribute('href', 'https://example.com/td')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})

describe('Markdown variants', () => {
  const source = '# heading\n\n- item\n\n```\ncode\n```\n\nwith `tick` and *stress*'

  it('renders block constructs in the default variant', () => {
    const { container } = render(<Markdown>{source}</Markdown>)

    expect(container.querySelector('h1, h2, h3')).not.toBeNull()
    expect(container.querySelector('ul')).not.toBeNull()
    expect(container.querySelector('pre')).not.toBeNull()
  })

  it('flattens block constructs in the inline variant but keeps inline ones', () => {
    const { container } = render(<Markdown variant="inline">{source}</Markdown>)

    expect(container.querySelector('h1, h2, h3')).toBeNull()
    expect(container.querySelector('ul')).toBeNull()
    expect(container.querySelector('li')).toBeNull()
    expect(container.querySelector('pre')).toBeNull()

    expect(container.querySelector('code')).not.toBeNull()
    expect(container.querySelector('em')).not.toBeNull()
    expect(container).toHaveTextContent('heading')
  })
})

/*
 * These pin a property of the renderer rather than of our own code: without
 * rehype-raw, react-markdown never parses raw HTML into nodes, so it cannot
 * reach the DOM as markup. They are regression guards. Each one was checked
 * against a deliberately unsafe implementation to confirm it fails there.
 */
describe('Markdown does not let issue text become markup', () => {
  it('renders a script tag as text and never as an element', () => {
    const { container } = render(
      <Markdown>{'before <script>window.pwned = true</script> after'}</Markdown>,
    )

    expect(container.querySelector('script')).toBeNull()
    expect(document.querySelector('script')).toBeNull()
    expect(container).toHaveTextContent('window.pwned = true')
    expect((window as unknown as { pwned?: boolean }).pwned).toBeUndefined()
  })

  it('never turns an event-handler attribute into a live handler', () => {
    const { container } = render(
      <Markdown>{'<img src="x" onerror="window.pwned = true">'}</Markdown>,
    )

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[onerror]')).toBeNull()
  })

  it('does not produce a live href for a javascript: url', () => {
    const { container } = render(<Markdown>{'[click](javascript:alert(1))'}</Markdown>)

    // Assert the anchor exists before asserting about its href: with an
    // optional chain and a default the check passes when nothing rendered at
    // all, which is exactly the case a broken renderer produces.
    const link = container.querySelector('a')
    expect(link).not.toBeNull()
    expect(link?.getAttribute('href') ?? '').not.toMatch(/^javascript:/i)
  })
})

describe('Markdown and text written in a terminal', () => {
  it('joins a hard-wrapped paragraph into one paragraph', () => {
    const { container } = render(
      <Markdown>{'This description was\nwrapped by its author\nat eighty columns.'}</Markdown>,
    )

    const paragraphs = container.querySelectorAll('p')
    expect(paragraphs).toHaveLength(1)
    expect(paragraphs[0].textContent).toBe(
      'This description was\nwrapped by its author\nat eighty columns.',
    )
    expect(container.querySelector('br')).toBeNull()
  })

  it('keeps a blank-line-separated paragraph break', () => {
    const { container } = render(<Markdown>{'First para.\n\nSecond para.'}</Markdown>)

    expect(container.querySelectorAll('p')).toHaveLength(2)
  })

  it('preserves indented terminal output as a code block', () => {
    const { container } = render(
      <Markdown>{'Output:\n\n    NAME     STATUS\n    td-1     open'}</Markdown>,
    )

    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre?.textContent).toContain('NAME     STATUS')
  })

  it('renders prose containing no markdown as plain text', () => {
    const source = 'A plain sentence with no formatting in it at all.'
    const { container } = render(<Markdown>{source}</Markdown>)

    expect(container.querySelectorAll('p')).toHaveLength(1)
    expect(container.textContent).toBe(source)
  })
})

describe('Markdown GFM constructs', () => {
  it('renders a nested list', () => {
    const { container } = render(<Markdown>{'- outer\n    - inner'}</Markdown>)

    expect(container.querySelector('li ul li')).not.toBeNull()
    expect(container.querySelector('li ul li')).toHaveTextContent('inner')
  })

  it('renders an ordered list', () => {
    const { container } = render(<Markdown>{'1. one\n2. two'}</Markdown>)

    expect(container.querySelectorAll('ol > li')).toHaveLength(2)
  })

  it('renders a table', () => {
    const { container } = render(
      <Markdown>{'| id | status |\n| --- | --- |\n| td-1 | open |'}</Markdown>,
    )

    expect(container.querySelector('table')).not.toBeNull()
    expect(container.querySelectorAll('th')).toHaveLength(2)
    expect(container.querySelectorAll('tbody td')).toHaveLength(2)
  })

  it('renders a blockquote', () => {
    const { container } = render(<Markdown>{'> quoted reasoning'}</Markdown>)

    expect(container.querySelector('blockquote')).toHaveTextContent('quoted reasoning')
  })

  it('renders inline code and emphasis', () => {
    const { container } = render(<Markdown>{'call `td serve` **now** and *soon*'}</Markdown>)

    expect(container.querySelector('code')).toHaveTextContent('td serve')
    expect(container.querySelector('strong')).toHaveTextContent('now')
    expect(container.querySelector('em')).toHaveTextContent('soon')
  })

  it('renders a fenced code block and keeps its own line breaks', () => {
    const { container } = render(<Markdown>{'```go\nif err != nil {\n\treturn err\n}\n```'}</Markdown>)

    const pre = container.querySelector('pre')
    expect(pre?.textContent).toBe('if err != nil {\n\treturn err\n}\n')
  })
})

describe('Markdown fits the page it sits on', () => {
  it('demotes headings so issue text cannot outrank the section heading above it', () => {
    const { container } = render(<Markdown>{'# top\n\n## second'}</Markdown>)

    expect(container.querySelector('h1')).toBeNull()
    expect(container.querySelector('h3')).toHaveTextContent('top')
    expect(container.querySelector('h4')).toHaveTextContent('second')
  })

  it('gives a table its own horizontal scroll box', () => {
    const { container } = render(
      <Markdown>{'| id | status |\n| --- | --- |\n| td-1 | open |'}</Markdown>,
    )

    const table = container.querySelector('table')
    expect(table?.parentElement?.className).toContain('overflow-x-auto')
  })

  it('strips the inline-code chrome from code inside a fence', () => {
    // Inline code carries a background, padding and 0.9em. A fenced block
    // already draws all three on the pre, so without these resets it renders
    // the inset twice and shrinks each line against the pre's own size.
    const { container } = render(<Markdown>{'```\nplain\n```'}</Markdown>)

    const pre = container.querySelector('pre')?.className ?? ''
    expect(pre).toContain('[&_code]:bg-transparent')
    expect(pre).toContain('[&_code]:p-0')
    expect(pre).toContain('[&_code]:[font-size:1em]')
  })

  it('gives a fenced code block its own horizontal scroll box', () => {
    const { container } = render(<Markdown>{'```\na very wide line\n```'}</Markdown>)

    expect(container.querySelector('pre')?.className).toContain('overflow-x-auto')
  })

  it('tightens spacing in the compact variant without dropping block constructs', () => {
    const block = render(<Markdown>{'- item'}</Markdown>).container.querySelector('ul')
    const compact = render(<Markdown variant="compact">{'- item'}</Markdown>).container
      .querySelector('ul')

    expect(compact).not.toBeNull()
    expect(compact?.className).not.toBe(block?.className)
  })
})

describe('Markdown link safety holds in every variant', () => {
  it.each(['block', 'compact', 'inline'] as const)(
    'applies target and rel in the %s variant',
    variant => {
      const { container } = render(
        <Markdown variant={variant}>{'[td](https://example.com)'}</Markdown>,
      )

      const link = container.querySelector('a')
      expect(link).not.toBeNull()
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    },
  )
})

/*
 * The raw mode is a second reading of the same text, not a debug view: what
 * the author typed, with their line breaks and their alignment intact. It is
 * read from the store inside Markdown, so no call site opts into it and none
 * can miss it.
 */
describe('Markdown in raw mode', () => {
  const source = '# heading\n\n- item\n\n| a  | bb |\n| -- | -- |'

  beforeEach(() => {
    setMode('raw')
  })

  afterEach(() => {
    setMode('markdown')
  })

  it('shows the source characters instead of rendering them', () => {
    const { container } = render(<Markdown>{source}</Markdown>)

    expect(container.querySelector('h1, h2, h3')).toBeNull()
    expect(container.querySelector('ul')).toBeNull()
    expect(container.querySelector('table')).toBeNull()
    expect(container.textContent).toBe(source)
  })

  it('keeps the author line breaks and indentation of the source', () => {
    const { container } = render(<Markdown>{source}</Markdown>)

    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre?.className).toContain('whitespace-pre-wrap')
    expect(pre?.className).toContain('font-mono')
  })

  it('emits no block element in the inline variant, which sits inside an li', () => {
    const { container } = render(<Markdown variant="inline">{source}</Markdown>)

    expect(container.querySelector('pre')).toBeNull()
    expect(container.querySelector('div')).toBeNull()
    expect(container.textContent).toBe(source)
  })

  it('still renders a script tag as text and never as an element', () => {
    const { container } = render(
      <Markdown>{'before <script>window.pwned = true</script> after'}</Markdown>,
    )

    expect(container.querySelector('script')).toBeNull()
    expect(document.querySelector('script')).toBeNull()
    expect((window as unknown as { pwned?: boolean }).pwned).toBeUndefined()
  })
})

/* The wiring proof: nothing is passed down, so a mounted Markdown has to
   follow the store on its own. */
describe('Markdown follows the mode store', () => {
  afterEach(() => {
    setMode('markdown')
  })

  it('re-renders when the mode changes under it', () => {
    const { container } = render(<Markdown>{'# heading'}</Markdown>)
    expect(container.querySelector('h3')).not.toBeNull()

    act(() => setMode('raw'))

    expect(container.querySelector('h3')).toBeNull()
    expect(container.textContent).toBe('# heading')
  })
})
