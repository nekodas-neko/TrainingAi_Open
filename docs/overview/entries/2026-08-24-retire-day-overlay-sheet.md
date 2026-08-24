# The day-overlay sheet is gone, and two of its three affordances came with it (LB-3)

**Branch:** `feat/retire-day-overlay-sheet` · **Lane B** · v1.347.0

## What was there

Since Q-110 (2026-08-08) the calendar's day-tap has opened `/health/day`, not the bottom sheet.
`day-overlay-sheet.tsx` survived anyway, and the reason it survived is worth stating: it was the
**only** thing that could open `ExerciseHistorySheet` and `ActivityDetailSheet`, both still rendered
by `health-content.tsx`. So `historyExercise` and `selectedActivity` there could only ever be `null`
— three capabilities gone for a fortnight with no report, which is why LB-1 declined to delete the
file silently.

## The three decisions

**1. Tap an exercise name → its history. PORTED.** The strongest case, as the entry judged: it is
the only route from a logged lift to its 1RM trend outside Stats.

**2. Tap an activity → its detail sheet. PORTED.** The day screen's activity row shows distance,
kcal, pace, HR and steps, but not the HR chart, the route map, or the scrub — those live only in
`ActivityDetailSheet`.

**3. Expand a session → per-session HR recovery chart. DROPPED.** `HrRecoveryChart` is still reached
from `done-screen` immediately after a workout, which is the moment HR recovery means anything; the
day screen already carries `DayHrTrace` (the whole day) and `EnergyTimelineChart`. Porting it meant
bringing `loadSessionHr` with its retry-on-sentinel logic and a `/api/oura/hr-sync` round trip for a
third HR visualisation on one screen. It is the one the entry itself ranked last.

## The layout question the entry flagged

> the row already carries two 48dp controls, so a third target needs a layout decision rather than
> another icon

The answer is not to add a target: **the name becomes one.** In `TrainingSection` the exercise name
already occupies `min-w-0 flex-1` — the half of the row nothing else claims — and the row is ≥48dp
tall because of the icon buttons beside it, so a `<button>` filling that space inherits the height.
Same in `ActivitySection` for the activity title. Both are underlined so the affordance is not
carried by position alone, and both are real `<button>`s that are *siblings* of the delete control,
never nested inside it — the WebView rule.

Both props are optional (`onExerciseTap`, `onSelectActivity`), so a section rendered without them
falls back to the plain `<span>` it had before, matching how `DayEntryControls` already works.

## What was deleted

`components/health/day-overlay-sheet.tsx`, and from `health-content.tsx`: `dayOverlay`,
`fetchDayOverlay`, `refreshDayOverlay`, `overlayDate`, `sessionHrData`, `loadSessionHr`,
`historyExercise`, `selectedActivity`, `activityTypes` and its warm fetch, the `DayOverlayDialogs`
block, both sheet renders, and six now-unused imports. **`health-content.tsx` goes 811 → 644 lines**,
off the component-size hotspot list.

`useDayEntryMutations` is untouched — `/health/day` is now its only caller, which is what LB-1 was
aiming at.

## Verification

- `pnpm dev` — `/health/day` renders; tapping an exercise name opens the history sheet, tapping an
  activity title opens the detail sheet, and `/health` renders with the overlay wiring gone.
- **`e2e/day-detail-sheets.spec.ts` is new** — 4 passed. It taps each target by its *accessible
  name*, so a plain `<span>` (the shape this shipped as before) has no role and fails rather than
  passing quietly. **Mutation-checked separately**, since serial mode hides the second failure
  behind the first: reverting only the exercise name fails the exercise test, reverting only the
  activity title fails the activity test. The activity assertion also checks a fact the row does
  *not* render (`18.2` km), so it cannot pass on the row showing through an unopened sheet.
- `e2e/day-entry-edit-delete.spec.ts` — 6 passed; the existing guard on the edit/delete controls
  this change sits beside.
- `pnpm check:rules` — Ran 55 of 55. Typecheck and lint clean.
- `scripts/check-timezone-rendering.js` lost its grandfathered entry for the deleted file, and
  `scripts/check-component-size.js` is unaffected (`health-content.tsx` only shrank).

## Not exercised

**Not verified on the S25.** Both new tap targets are ordinary buttons in an existing row, so the
risk is a touch-target one — the 48dp floor here comes from the row's icon buttons rather than from
the button's own padding, and that is a reading of the layout, not a measurement on the device.
