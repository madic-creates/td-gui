import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import IssueCombobox, { MAX_OPTIONS } from './IssueCombobox'
import { makeIssue } from '../features/issues/issue.fixture'

// scrollIntoView is stubbed globally in setupTests.ts — jsdom has no layout
// and doesn't implement it, and this component is not the only caller.

const candidates = [
  makeIssue({ id: 'td-a1b2c3', title: 'Defer the storage read', status: 'open' }),
  makeIssue({ id: 'td-d4e5f6', title: 'Share the relation heading', status: 'in_progress' }),
  makeIssue({ id: 'td-999999', title: 'Untrack node_modules', status: 'closed' }),
]

/**
 * Renders the field as its callers do: their own label, and state behind
 * `value`. The state is not decoration — the component is controlled, so a
 * fixed `value` would swallow every keystroke and no filter would ever run.
 */
function renderBox(initial = '', onChange = vi.fn()) {
  function Harness() {
    const [value, setValue] = useState(initial)
    return (
      <>
        <label htmlFor="pick">Depends on</label>
        <IssueCombobox
          id="pick"
          value={value}
          candidates={candidates}
          onChange={next => { setValue(next); onChange(next) }}
        />
      </>
    )
  }
  render(<Harness />)
  return { onChange, input: screen.getByLabelText('Depends on') }
}

describe('IssueCombobox', () => {
  it('offers every candidate with its id, title and status once focused', async () => {
    const { input } = renderBox()

    await userEvent.click(input)

    expect(screen.getAllByRole('option')).toHaveLength(3)
    expect(screen.getByText('td-a1b2c3')).toBeInTheDocument()
    expect(screen.getByText('Defer the storage read')).toBeInTheDocument()
    expect(screen.getByText('closed')).toBeInTheDocument()
  })

  // The point of the whole feature: people remember titles, not ids.
  it('filters by a substring of the title', async () => {
    const { input } = renderBox()

    await userEvent.click(input)
    await userEvent.type(input, 'storage')

    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByText('Defer the storage read')).toBeInTheDocument()
  })

  it('filters by a substring of the id', async () => {
    const { input } = renderBox()

    await userEvent.click(input)
    await userEvent.type(input, 'd4e5')

    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByText('Share the relation heading')).toBeInTheDocument()
  })

  it('matches case-insensitively and ignores surrounding blanks', async () => {
    const { input } = renderBox()

    await userEvent.click(input)
    await userEvent.type(input, '  UNTRACK ')

    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByText('Untrack node_modules')).toBeInTheDocument()
  })

  it('reports the picked id and closes the list', async () => {
    const { onChange, input } = renderBox()

    await userEvent.click(input)
    await userEvent.click(screen.getByText('Share the relation heading'))

    expect(onChange).toHaveBeenCalledWith('td-d4e5f6')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('reports what is typed as it is typed', async () => {
    const { onChange, input } = renderBox()

    await userEvent.type(input, 'td-')

    expect(onChange).toHaveBeenLastCalledWith('td-')
  })

  it('shows no list at all when nothing matches', async () => {
    const { input } = renderBox('td-nothing-like-this')

    await userEvent.click(input)

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false')
  })

  // A thousand issues would otherwise open a thousand rows. The cap is
  // visible rather than silent.
  it('renders at most MAX_OPTIONS rows and says how many it dropped', async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      makeIssue({ id: `td-${i}`, title: `Issue number ${i}` }))
    const onChange = vi.fn()
    render(
      <>
        <label htmlFor="pick">Depends on</label>
        <IssueCombobox id="pick" value="" onChange={onChange} candidates={many} />
      </>,
    )

    await userEvent.click(screen.getByLabelText('Depends on'))

    expect(screen.getAllByRole('option')).toHaveLength(MAX_OPTIONS)
    expect(screen.getByText('20 of 25 matches — keep typing')).toBeInTheDocument()
  })

  it('says nothing about a cap when everything fits', async () => {
    const { input } = renderBox()

    await userEvent.click(input)

    expect(screen.queryByText(/keep typing/)).not.toBeInTheDocument()
  })

  // The list opens on the first row (see the "reopens" case below for the
  // one exception), so two ArrowDown presses from a fresh open land on the
  // third candidate.
  it('moves the active row with the arrow keys and takes it with Enter', async () => {
    const { onChange, input } = renderBox()

    await userEvent.click(input)
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    await userEvent.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('td-999999')
  })

  it('points aria-activedescendant at the active row', async () => {
    const { input } = renderBox()

    await userEvent.click(input)
    await userEvent.keyboard('{ArrowDown}')

    const active = screen.getAllByRole('option')[1]
    expect(active).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', active.id)
  })

  // {ArrowDown}{ArrowDown} lands on the third row, so the ArrowUp that
  // follows must move it back to the second, not just stay put — two
  // ArrowUps from row one (the old version of this test) would pass even if
  // ArrowUp did nothing at all. The bottom clamp is separately defended by
  // activeIndex's own Math.min, so it needs no case of its own.
  it('moves the active row up with the arrow key', async () => {
    const { onChange, input } = renderBox()

    await userEvent.click(input)
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}')
    await userEvent.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('td-d4e5f6')
  })

  // Both call sites sit inside a <form>. Picking a suggestion must not also
  // save the form.
  it('does not submit the surrounding form while the list is open', async () => {
    const onSubmit = vi.fn(event => event.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <label htmlFor="pick">Depends on</label>
        <IssueCombobox id="pick" value="" onChange={vi.fn()} candidates={candidates} />
      </form>,
    )
    const input = screen.getByLabelText('Depends on')

    await userEvent.click(input)
    await userEvent.keyboard('{ArrowDown}{Enter}')

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits the form on Enter once the list is closed', async () => {
    const onSubmit = vi.fn(event => event.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <label htmlFor="pick">Depends on</label>
        <IssueCombobox id="pick" value="" onChange={vi.fn()} candidates={candidates} />
      </form>,
    )
    const input = screen.getByLabelText('Depends on')

    await userEvent.click(input)
    await userEvent.keyboard('{Escape}')
    await userEvent.keyboard('{Enter}')

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  // Both fall out of the single onBlur — this pins the design spec's "click
  // or tab away closes the list" without an assertion for each cause.
  it('closes the list when it loses focus, as by tabbing away', async () => {
    const { input } = renderBox()

    await userEvent.click(input)
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    await userEvent.tab()

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes on Escape without clearing what was typed', async () => {
    const { onChange, input } = renderBox('stor')

    await userEvent.click(input)
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(input).toHaveValue('stor')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reopens the closed list with Arrow Down without selecting anything', async () => {
    const { onChange, input } = renderBox()

    await userEvent.click(input)
    await userEvent.keyboard('{Escape}')
    await userEvent.keyboard('{ArrowDown}')

    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('starts over at the first row when the query changes', async () => {
    const { onChange, input } = renderBox()

    await userEvent.click(input)
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.type(input, 'e')          // re-filters; the active row resets
    await userEvent.keyboard('{Enter}')

    expect(onChange).toHaveBeenLastCalledWith('td-a1b2c3')
  })
})
