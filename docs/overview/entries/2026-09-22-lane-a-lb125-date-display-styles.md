# 2026-09-22 — the comment that got quoted as evidence, and the two counts under it

**Branch:** `lane-a/lb125-date-display-comment-and-weekday` · **Agent:** Implementation (Lane A) ·
**Code + docs.** No user-visible change, so no version bump.

LB-125 exists because RV-91 read `formatDateDisplay`'s header comment and reported its strings as
what a screen rendered. The entry's instruction was to correct the comment and add a `weekday`
style. Both done — and since the entry's own premise is "somebody quoted this instead of running
it", I ran everything, which turned up three more things.

## The comment was wrong, and so was its neighbour

Measured on node 22 with full ICU, resolved locale `en-AU`:

| | claimed | actual |
|---|---|---|
| `formatDateDisplay(_, 'short')` | `Jan 5` | `15 Sept` |
| `formatDateDisplay(_, 'long')` | `Monday, 5 January` | `Tuesday 15 September` |
| `formatDayShort('2026-07-06')` | `Jul 6` | `6 July` |

**The third row is not in the entry.** `formatDayShort` sits directly below, carries a
byte-identical copy of the `'short'` option bag, and its docstring made the same two errors against
its own example date. Fixing one comment and leaving the other is the half-done sibling sweep this
repo keeps relearning, so it is folded in — and rather than correct a duplicate implementation,
`formatDayShort` is now a named alias that delegates. That is the entry's own subject: a
hand-rolled option bag sitting beside the shared formatter, in the shared file itself.

## Why the strings are wrong in a way that is hard to guess

Three properties of `en-AU`, each pinned in a test:

- **Day-first.** The month never leads, so `Jan 5` was never reachable.
- **`month: 'short'` is not a uniform three-letter abbreviation.** Across twelve:
  `Jan | Feb | Mar | Apr | May | June | July | Aug | Sept | Oct | Nov | Dec`. June, July and Sept
  are four characters — so a column of these labels is ragged-width, which is worth knowing before
  putting one in a `tabular-nums` layout.
- **It emits a comma after a SHORT weekday and none after a long one.** `Tue, 15 Sept` but
  `Tuesday 15 Sept`. This is almost certainly where `Monday, 5 January` came from: the comma is
  real, just not on the style the comment attached it to.

## The open question, answered from the call sites rather than left open

The entry asked whether a `weekday` style should thread `DEFAULT_TZ` like the other date helpers or
stay device-local. **Device-local, and adding a `timeZone` would be actively wrong here.** Every
call site passes a date *string* — a calendar day already resolved in the user's timezone by
whoever produced it — not an instant, so there is nothing left to convert. Re-rendering the
component-wise local `Date` under an explicit zone would reintroduce Q-130 rather than prevent it:
on a device ahead of that zone, local midnight falls on the previous day there. Written into the
function's header so the next reader does not re-open it.

## Two corrections handed to Lane B

LB-126 owns the call sites and inherited LB-125's counts, which do not survive measurement:

- **Two sites are a bare `{ weekday: 'short' }`, not three.** The two the entry filed as
  unrelated one-offs are the same shape at different weekday widths, and each now has a style.
- **`calendar-widget.tsx:109` is not convertible at all.** It is a `{ month: 'long', year:
  'numeric' }` month-and-year label built from `(viewYear, viewMonth)` numbers;
  `formatDateDisplay` takes a `YYYY-MM-DD` string and renders a day. Routing it would mean
  inventing a day-of-month to discard. So LB-126 is four sites, not five, and its entry now says
  so rather than leaving Lane B to discover it mid-PR.

## Verification

- 5 new test cases, all styles pinned to exact strings. Suite: **9,319 passed, 87 skipped**.
- Re-run under `TZ=America/New_York`, `Pacific/Auckland` and `Australia/Brisbane` — 48/48 in each.
  The Q-130 guard only bites west of UTC, so a UTC-only run proves nothing about it.
- **4 mutations caught, 1 equivalent control** (reordering keys in the options record — correctly
  not caught). The Q-130 mutation, parsing as UTC instead of component-wise, fails 4 cases under
  New York and none under UTC, which is the point of running it there.
- `pnpm check:rules` **75 of 75**; `tsc --noEmit` clean; test-typecheck none above baseline.

**No user-visible change ships here.** The delegation newly accepts slash-separated input and
passes a non-date through, and no current caller does either; the new styles have no call site
until LB-126. Nothing was verified on device, and nothing in this diff reaches one.
