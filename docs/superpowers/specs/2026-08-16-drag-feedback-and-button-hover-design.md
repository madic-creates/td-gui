# Drag feedback in the backlog, and a hover state for buttons

Two gaps the whole-branch review of the boards feature found, tracked as
td-885e52 (drag feedback) and td-ca5912 (button hover). Both are about the
same thing from two directions: a control that does not visibly answer the
pointer reads as not clickable.

## Findings

**1. `surface-hover` reaches rows but not buttons.** The token is used in
three places — `IssueList` rows, `BoardCard`, `ThemeToggle` — and nowhere
else. Twenty-two of the app's twenty-four `<button>`s have no hover treatment
at all; the two that do are `ThemeToggle` and the sort headers.

**2. The buttons are already uniform.** Twenty-two of them share one class
shape: `rounded-sm border border-{line|accent|danger/40} px-{2|2.5|3} py-1
text-[11px] text-{ink-muted|accent|ink|danger}`, plus `disabled:opacity-40`
where the control can be disabled. The shape is duplicated across fourteen
files, but it does not vary.

**3. No button carries a background utility.** The "selected" states —
`BoardView`'s view switcher, `TransitionBar`'s `tone` map — signal with
border and text colour only. Nothing in the utility layer would win over a
background set in `@layer base`.

**4. No button uses `aria-disabled`.** Every disabled control uses the real
attribute, so a `:not(:disabled)` selector is a complete description of
"enabled" in this codebase.

**5. The app has no `transition` and no `prefers-reduced-motion` rule.**
This change introduces both, so it also sets the precedent.

**6. `dragging` in `BacklogView` is a data fallback, never a style.** It
exists so a drop whose `text/plain` payload is missing can still name the
card. Nothing reads it to draw anything.

**7. The dimming clause was specified and then lost.** The boards design
doc says: "While the mutation is in flight the list is `aria-busy` and the
moved card is dimmed." The implementation plan dropped the second clause, so
no task owned it and no task-scoped review could notice it was missing. The
list does carry `aria-busy`.

## Button hover

One rule in `index.css`, in `@layer base` beside `:focus-visible`, which
carries the same "this is the single global fix" rationale:

```css
button { transition: background-color 120ms ease; }
button:not(:disabled):hover { background-color: var(--color-surface-hover); }
@media (prefers-reduced-motion: reduce) { button { transition: none; } }
```

`transition` sits on the base selector, not inside `:hover`. Inside `:hover`
it fades in and snaps back out; on the base selector it is symmetric.

Disabled buttons are inert by construction rather than by convention —
finding 4 is what makes `:not(:disabled)` sufficient. `disabled:opacity-40`
is untouched, and so is the global `:focus-visible` outline: an outline and a
background compose, so hovering a focused button shows both.

Rejected: a `<Button>` component, and a `hover:` utility on each of the
twenty-two call sites. The first is a fourteen-file refactor with its own
test churn, for an issue that asks for a hover state. The second is
twenty-two chances to forget, which is how the app arrived here.

### The three exceptions

Bare text buttons, where a background with no padding paints a cramped
rectangle around the glyph.

| File | Change | Why |
|---|---|---|
| `IssueListHeader.tsx` | add `hover:bg-transparent` | Sort headers are unpadded text and already answer hover with `hover:text-ink-muted`. |
| `LabelInput.tsx` | add `rounded-sm px-1` to the `×` | Gives the background a shape, and makes the remove target discoverable — which is the point of the issue. |
| `ThemeToggle.tsx` | drop `hover:bg-surface-hover` | Redundant with the global rule, at the same value. No visual change. |

Links are out of scope. The issue says buttons; the rule says `button`.

## Drag feedback

### The moved card is dimmed

No new state. The mutation already carries which card it is about:

```ts
const movingId = setPosition.isPending ? setPosition.variables.issueId
  : clearPosition.isPending ? clearPosition.variables
  : null
```

Applied in both blocks. A card can be moved from the pinned block or dragged
up out of the query-ordered one, and because there is no optimistic reorder
(the sort key is computed server-side and may respace the board) the card is
still rendered in its old place for the whole flight. `opacity-40` — the same
figure as `disabled:opacity-40`, which is the app's one "this is not live
right now" value.

### The gaps become visible

`DropGap` gets `data-state`, one of:

- `idle` — no drag in progress. Transparent, as today.
- `armed` — a card from this board is being dragged and a drop would be
  accepted. A hairline in `line-subtle`, so every place a drop can land is
  visible before the cursor finds it.
- `active` — the cursor is over this gap. A solid `accent` bar with a soft
  halo: this is where the card lands.

`armed` is `dragging !== null && !busy`, not just `dragging !== null`.
`dropAt` already refuses while a position write is in flight; a gap that lit
up anyway would advertise a drop the handler silently discards.

State lives in `BacklogView` as `overGap: number | null`, set in the gap's
`onDragOver` (React bails out on a set to the same value, so the continuous
event costs nothing) and cleared on `drop`, on `dragleave`, and on the source
card's `onDragEnd` — otherwise a drag cancelled with Escape leaves a gap lit.

**The gap grows visually, not in layout.** Reflowing a 6px strip to 14px
mid-drag moves it out from under the cursor and thrashes
`dragenter`/`dragleave`. The box stays `h-1.5` and the marker is painted with
`box-shadow` and `outline`, neither of which affects layout — the idiom
`IssueList` already uses for its row hover edge
(`inset 2px 0 0 var(--color-accent)`).

Putting the state in the DOM rather than only in a class string is what makes
it assertable in jsdom, where no stylesheet is loaded.

## Testing

New in `BacklogView.test.tsx`:

- the moved card is dimmed while a position write is in flight, and the cards
  around it are not
- unpinning dims the card too
- `dragstart` on a card arms every gap
- `dragover` marks exactly one gap active, and `dragend` clears it

**The hover rule gets no unit test.** jsdom loads no stylesheet, so an
assertion could only re-read the class string this document specifies. It is
verified by `make build` and by eye. Writing a test that proves nothing would
be worse than saying so.

## Out of scope

`BoardList` rows have no hover, while `IssueList` rows and `BoardCard` do.
That is rows, not buttons, and belongs to whichever issue owns board list
polish.
