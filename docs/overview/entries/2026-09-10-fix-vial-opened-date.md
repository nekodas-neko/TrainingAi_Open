# 2026-09-10 — the vial's opened date, and the half of the report it does not fix (BF-136, LB-99)

**PR:** `fix/vial-opened-date` · **Lane B** · `components/nutrition/reta/vial-sheet.tsx`,
`vial-date.ts` + `vial-opened-note.tsx` (new).

The owner: *"its saying no weights taken; but i weigh my self every day. so its been over 5 days
since first dose"*. BF-136 traced it — `vial-sheet.tsx:88` sent `openedOn: todayInTz(tz)`, a
constant, and the sheet rendered no date control. `WeightResponseCard` windows on
`p.date >= openedOn`, so a vial entered five days late drops five days of weigh-ins and the card
correctly reports that it has one.

## What shipped

- **An `Opened on` date on the sheet, defaulting to today**, bounded to `[today − 180 days, today]`.
  The POST sends it instead of the constant. Both routes already accepted the field — the backend
  was built to be told and the form never asked.
- **The bound is not decoration.** A mistyped year does not error, it moves the window, and the
  failure surfaces as a true-sounding message rather than a rejection — the shape that produced this
  report. `vial-date.ts` holds it, compared as strings because `YYYY-MM-DD` sorts in date order and
  a `new Date('2026-09-10')` here would parse as UTC midnight and shift the day west of UTC.
- **The stored date is now visible and correctable in place.**

## Correcting in place is required, not a convenience

`listSupplementVials` orders by `openedOn DESC` and the sheet reads `vials[0]`. A second vial dated
*earlier* than the wrong one therefore sorts **below** it and the card keeps using the wrong date —
so "save a new vial with the right date" is not a workaround, and without the correction control the
owner's existing vial could not be fixed from the UI at all.

The correction is deliberately separate from the new-vial form, and the form's date defaults to
**today** rather than to the current vial. The reconstitution numbers above it *are* prefilled from
the last vial because they are stable; a date is not, and inheriting it would reproduce this defect
one vial along, silently. A source test pins that.

## The report is not closed, and the entry says so

With the bug state reproduced locally — 14 daily weigh-ins, vial stamped today — the date corrected
to five days back, and `/api/body-metadata` answering with exactly the six in-window rows
(`2026-09-05 … 2026-09-10`), **`WeightResponseCard` still read "Not enough weigh-ins yet"** after six
settled seconds. The note beside it had already re-rendered as *"Measured from 5 Sept"*, so
`sinceDate` was correct and the card's own read is what did not complete.

Pre-existing and independent of this change, but it means what shipped here is **the cause, not the
observed symptom**. Filed as **LB-99** with the ruled-out branches (the payload shape matches
`WeightPoint`; the arithmetic is unit-tested) and the live suspect: the effect takes
`getLocalStore(userId)` first and only falls through to `cachedFetch` when that is null, so a web
build returning a store object rather than null would resolve `[]` and never fetch — LB-98's class,
and this would be its first live instance.

## Verification

Driven through the Playwright harness at 412 px against the local non-prod database, with the owner's
state seeded and then removed:

- The date field renders with `min=2026-03-14 max=2026-09-10`, matching `openedOnBounds` exactly.
- A future date is refused (*"cannot be opened in the future"*), and last year's is refused with
  *"check the year"*.
- The correction **PATCHed 200** and the row moved to `2026-09-05` in the database.
- The note re-rendered as *"Measured from 5 Sept, when this vial was opened."*
- The new-vial field read `2026-09-10` — today, not the corrected vial's date.

16 unit cases on the bounds and a source guard that the POST cannot go back to a constant. Full
`pnpm check:rules` — **Ran 73 of 73**.

**Not exercised:** the S25. The date control is a native `<input type="date">`, so the picker itself
is the device's and has not been opened on one; and the symptom above needs the device precisely
because the local-store branch is the suspect and the sandbox cannot take it.
