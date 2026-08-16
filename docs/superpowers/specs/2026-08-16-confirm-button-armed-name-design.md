# Naming the armed ConfirmButton controls

td-e69134. Follows td-e0bdb9 (DependencyPanel) and td-217d88 (BoardList).

## The defect

Those two issues gave the *resting* control a per-row accessible name —
`Remove td-a1b2`, `Delete Sprint 1` — by passing `ariaLabel` to
`ConfirmButton`. Neither touched the armed state.

Once clicked, `ConfirmButton` replaces the trigger with a question and a
confirm/cancel pair. Neither of those two buttons carries an accessible name
of its own, so both fall back to their visible text. Each `ConfirmButton`
owns its armed state independently, so two rows can be armed at once — and
then the accessibility tree holds two buttons named `Confirm remove` and two
named `Cancel`. That is the same ambiguity the earlier issues set out to
fix, one interaction later.

The issue text names only the confirm control. Cancel has the identical
defect and is fixed here too: half a named armed state is not a fix, it is
the next follow-up issue.

## The fix

In `ConfirmButton` itself, so every caller gets it without opting in. A
per-call-site prop was considered and rejected — a call site that forgets it
is silently ambiguous again, which is exactly how this issue came to exist.

Derive both armed names from the `ariaLabel` the resting control already
takes:

```tsx
const armedName = (verb: string) =>
  ariaLabel && `${verb} ${ariaLabel[0].toLowerCase()}${ariaLabel.slice(1)}`
```

- `Remove td-a1b2` → `Confirm remove td-a1b2` / `Cancel remove td-a1b2`
- `Delete Sprint 1` → `Confirm delete Sprint 1` / `Cancel delete Sprint 1`

Only the first character is lowered. The existing `confirmLabel` default
lowercases its whole string (`Confirm ${label.toLowerCase()}`), which is
safe for a fixed word like `Delete` but would mangle a board name into
`sprint 1`. `ariaLabel` carries user data; `label` does not.

Without `ariaLabel` no `aria-label` is emitted and the visible text stays
the accessible name, exactly as today. Callers that never had the ambiguity
— `IssueActions`, which renders one delete button per page — are unchanged.

## Carried along

- `confirmLabel`'s doc comment claims it is the "accessible name of the
  confirm control". It is the visible text. The comment was already wrong
  and the derivation makes it actively misleading.
- `BoardList` passes `confirmLabel="Confirm delete"`, which is character for
  character what the default produces from `label="Delete"`. Removed.

## Tests

`ConfirmButton.test.tsx` carries the component-level contract:

- Two instances with different `ariaLabel`, both armed, each confirm and
  each cancel addressable by its own name. This fails today with testing
  library's "found multiple elements".
- No `ariaLabel` → no `aria-label` on either armed button.

`DependencyPanel.test.tsx` and `BoardList.test.tsx` each get one regression
test for two armed rows, because those are the two call sites the issue
names and the ones a future refactor would break.

## Out of scope

The comment list in `IssueDetail` renders a `ConfirmButton` per comment with
no `ariaLabel` at all, so several comments expose several buttons named
`Delete comment` — ambiguous already at rest, before anything is armed.
Same defect, a call site neither td-e0bdb9 nor td-217d88 covered. The change
here does not help it; naming those rows needs a decision about what
identifies a comment to a screen reader. Filed separately.
