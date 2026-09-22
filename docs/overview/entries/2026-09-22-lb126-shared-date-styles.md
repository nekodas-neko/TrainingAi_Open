# 2026-09-22 — LB-126: four weekday labels onto the shared formatter

**Branch:** `feat/lb126-shared-date-styles` · **Lane:** Implementation B · **Version:** 1.465.4

## What shipped

LB-125 (#1404, Lane A) gave `formatDateDisplay` the `weekday`, `weekday-date` and
`weekday-date-long` styles. These are the call sites that were spelling those option bags
themselves — the four RV-91 closed with as *"noted, not filed"* and that LB-126 was filed to carry:

| site | was | now |
|---|---|---|
| `weekly-nutrition-chart.tsx:50` | `{ weekday: 'short' }` | `formatDateDisplay(date, 'weekday')` |
| `recommendation-card.tsx:36` | `{ weekday: 'short' }` | `formatDateDisplay(maxDate, 'weekday')` |
| `week-day-sheet.tsx:13` | `{ weekday: 'long', day, month: 'short' }` | `'weekday-date-long'` |
| `nutrition-content.tsx:88` | `{ weekday: 'short', day, month: 'short' }` | `'weekday-date'` |

**Equivalence was checked before the swap, not after:** `Tue`, `Tue, 15 Sept` and
`Tuesday 15 Sept` come out byte-identical, and the helper accepts either separator — so
`recommendation-card`'s own `.replace(/\//g, "-")` went with its option bag.

## The fifth site the entry named is not one

`calendar-widget.tsx:109` renders a **month and year** from `(viewYear, viewMonth - 1, 1)`.
`formatDateDisplay` takes a `YYYY-MM-DD` **string** and has no month-year style, so it cannot take
this at all; converting it would need a new style, which is Lane A's. **I wrote that entry, and it
was wrong to list the site** — the test now asserts the calendar keeps its option bag, so the next
sweep does not re-file it.

## An unpredicted consequence, caught by CI rather than by me

All four converted files were `REVIEWED_BENIGN` rows in `scripts/check-timezone-rendering.js` —
triaged in 2026-08-08 as benign because each built its Date from calendar components or a
local-noon string. Routing them through the helper means they **no longer call `toLocale*String` at
all**, so the check failed with *"These files no longer call toLocale*String without a timeZone —
remove them from GRANDFATHERED"*. That is the script's own shrink-only rule working exactly as
designed, and it means this change also removes four sites from the timezone bug class that CLAUDE.md
devotes a section to. `calendar-widget` keeps its row, now annotated with why it was left.

## Verification

- `pnpm check:rules` — **Ran 75 of 75** (it was step 18, *No device-local date/time rendering*, that
  failed until the four rows came out). `tsc --noEmit` clean; lint clean apart from a pre-existing
  warning.
- **Controlled: 2 of the test's 4 cases go red** against the unfixed tree — the two source-shape
  ones. The other two assert the shared styles' literal output and that the calendar is *not*
  converted; both hold either way by design, and the first is what justified the swap at all.
- The repo-wide sweep filters the extension in JS and skips `__tests__`, for the two reasons RV-98
  wrote down the hard way: `git ls-files a b -- '*.tsx'` unions its pathspecs rather than filtering,
  and a test stating a rule has to quote the thing it bans.

**Not exercised:** no device sitting. Four label strings whose output is asserted identical to what
they replaced, so there is nothing new to see at 412px.
