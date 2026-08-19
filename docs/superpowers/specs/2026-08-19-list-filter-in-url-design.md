# The issue list filter lives in the URL

The list's search text, TDQ query, status chips and sort order move out of
component state and into the query string, so opening an issue and coming back
lands on the list the reader left.

## The problem

`IssueList` holds both pieces of its state locally:

```tsx
const [params, setParams] = useState<IssueListParams>({ limit: FETCH_LIMIT })
const [sort, setSort] = useState<Sort>(DEFAULT_SORT)
```

Navigating to `/issues/:id` unmounts the list, and both are gone. Coming back
through the `← back to list` link, the browser's back button or any other
route rebuilds the component with its defaults. A reader who narrowed a
hundred issues down to three with a TDQ query, opened one of them and returned
is looking at all hundred again, with the query gone from the box.

The same loss hits a reload of the list and a link sent to someone else: there
is nothing in the address bar to reload or send. `/` is the only address the
list has, whatever is on screen.

The precedent for the fix is already in the tree. `BoardView` keeps its view
mode in `useSearchParams` (`web/src/features/boards/BoardView.tsx:15`), for
the same reason: a choice the reader made should outlive the component that
collected it.

## The shape of the URL

| Parameter | Meaning | Example |
| --- | --- | --- |
| `search` | full-text search, td's own `search` parameter | `/?search=oauth` |
| `q` | a TDQ expression, without the box's leading `?` | `/?q=type+%3D+bug` |
| `status` | repeatable, one value per chip | `/?status=open&status=in_progress` |
| `sort` | `key:direction`, omitted while it is the default | `/?sort=updated:desc` |

Defaults are omitted rather than written out, so an unfiltered list stays
exactly `/` and the address bar is empty of anything the reader did not ask
for. It also means the URL reads as the set of decisions actually made.

`search` and `q` are mutually exclusive, which is what `IssueListParams`
already models: one box produces one or the other, never both. A URL carrying
both is not something the app can write, so it can only be hand-made or
stale; `q` wins, because it is the more specific request. `limit` stays out
of the URL — it is `FETCH_LIMIT`, not a setting.

A URL is user input. Values are validated on the way in: a status the app does
not know is dropped rather than forwarded to td serve, and an unparseable
`sort` falls back to `DEFAULT_SORT`. The status vocabulary is already
hardcoded in `IssueFilters`; that list stays the single source and is exported
rather than copied. This is not the frontend second-guessing td's validation —
these are the app's own view parameters, and td never sees them.

## What changes

**New: `web/src/features/issues/listUrl.ts`.** Two pure functions and nothing
else, so the whole encoding is testable without rendering a router:

```ts
readListUrl(search: URLSearchParams): { params: IssueListParams; sort: Sort }
writeListUrl(params: IssueListParams, sort: Sort): URLSearchParams
```

**`IssueList`** swaps its two `useState` calls for `useSearchParams` and keeps
its current shape:

```tsx
const [search, setSearch] = useSearchParams()
const { params, sort } = useMemo(() => readListUrl(search), [search])
const apply = (p: IssueListParams, s: Sort) => setSearch(writeListUrl(p, s), { replace: true })
```

**`IssueFilters`, `IssueRows` and `QueryResults`** keep their props exactly as
they are. They are controlled components already, and the controller is what
changed, not the contract. Their tests stay green untouched.

**The back link** carries the filter. `IssueRows` attaches
`state={{ from: location.search }}` to each row link when the search is not
empty, and `IssueDetail` builds its `← back to list` target from that,
falling back to `/` when there is no state.

This is deliberately narrow. Only list rows set `from`. A jump from one detail
to another through `RelatedIssues` or `MetaPanel` does not carry it further,
and the link there means the whole list again. The `navigate('/')` after a
delete stays unfiltered too: the issue the reader was filtering their way back
to no longer exists.

## History

Every write uses `replace`. The debounced full-text search fires once per
typing pause, and pushing those would bury the detail page under a stack of
half-typed searches — back would need five presses to reach it. Replacing
keeps back meaning "the page before the list", and the filters are on screen,
so undoing one is a matter of looking at it rather than guessing at history.

The consequence, accepted: a filter change is not individually undoable with
the back button.

## A known edge, left alone

`IssueFilters` seeds its text box from `params` once, in a `useState`
initializer. If the URL changed while the list stayed mounted, the box would
not follow.

With `replace` that cannot happen from inside the list, and every other route
into it is a remount, which re-seeds the box from the URL. No synchronisation
is built for a case that cannot occur; if pushing is ever introduced, this is
the thing that breaks and this paragraph is the warning.

## Tests

- `listUrl.test.ts` — round trip; defaults omitted; an unknown status dropped;
  `q` beating `search`; an unparseable `sort` falling back to the default.
- `IssueList.test.tsx` — `/?q=…` enters the query path on mount and calls
  `/gui/query` rather than `/v1/issues`; toggling a status chip lands in the
  URL. The render helper grows an optional initial entry.
- `IssueDetail.test.tsx` — the back link points at `/?…` with `state.from`
  present, and at `/` without it.
- `App.test.tsx` — the reported bug, literally: filter the list, open an
  issue, click back, the filter is still applied.

No server-side change: no new route, no Go code, and nothing new reaches td.
