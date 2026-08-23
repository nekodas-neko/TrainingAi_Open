# 2026-08-23 — "I've finished logging", and the counter that makes it mean something (Q-387)

**Branch:** `feat/food-logging-complete` · **Lane B** · v1.337.0

Q-387's Lane A half shipped on 2026-08-19: the column, the route, the sync, and
`estimateMaintenance` filtering on a completeness flag instead of `intakeKcal > 0`. **Nothing could
set that flag**, so every day was excluded and the calibration could never leave `source: 'formula'`.
This is the control.

## Why the flag exists

The maintenance estimate averages the intake of every logged day, and a day abandoned after lunch is
byte-for-byte identical to a completed light one. Measured on the Lane A half: 14 days at a true
2,600 maintenance, six stopping at 1,400, estimated **2,086** — 514 kcal low, at
`confidence: 'medium'`, with nothing flagged. That figure reaches `targetFromMaintenance`, so the
error lands on the recommended daily target with a cut's deficit on top.

## What shipped

`components/nutrition/food-logging-complete.tsx`, rendered as the **last** element of the Nutrition
day's scroll. That placement is the entry's, and it is right: "I have finished logging" is a claim
about the whole day, so it belongs after everything the day contains rather than in the header beside
a running total.

- **The button becomes a receipt with an Undo.** A day marked by accident has to be reversible —
  the whole premise is that a wrong day poisons the estimate.
- **The counter ships with it, not after.** "N of 10 days marked · M more to calibrate", or the
  calibrated wording once it clears. The button feeds something otherwise invisible, and that
  invisibility is why this reached the owner as a question about the model rather than a bug report.
- **The copy says what *not* pressing it does**, which is the half that matters: an unmarked day is
  ignored, not counted badly.
- **Past days can be marked, and that is the common case.** Today is excluded from the calibration
  window entirely, so a control that only ever marked today could never move the estimate on the day
  you pressed it.

## Decisions

**`day-checkin:` was added to `invalidateNutritionWrite()`** rather than given its own group. The
flag is the only field this component reads, and finishing a day's food logging is the **only**
writer of it — the check-in sheets `COALESCE` that column rather than setting it — so no other path
can make the key stale. `lib/cache-groups.ts` is a Lane A path; this one line is claimed in the
baton with that reasoning.

**Q-359 is closed out in the same PR.** Its shell half finished in v1.325.9 with the can-bite group
at zero; the twelve remaining sites all unmount on navigate, so they are latent by definition, and
`scripts/check-fetch-once-effects.js` freezes them shrink-only. Converting them would add refetches
with no reader waiting — the entry's own "this is not a codemod" applies to its own remainder.

## Verification

The guard asserts the flag **in the database**, not the UI's own state: the control flips
optimistically, so a button wired to nothing looks identical on screen. It also asserts the counter,
because a control that wrote the flag and told the user nothing would pass a button-only test.

| mutant | result |
|---|---|
| the write is skipped, UI flips anyway | ✗ failed |
| the counter renders nothing | ✗ failed |

**A harness lesson worth carrying:** `toBeVisible()` does not mean "in the viewport". This control is
the last element of a long scroll, so its bounding box was off-screen and `touchscreen.tap()` landed
on whatever happened to be at those coordinates — the flag never moved and it read exactly like a
dead button. `scrollIntoViewIfNeeded()` before taking the box fixes it. (The `.click()` mouse path
does not work on this screen at all — Q-354.)

Gates: `pnpm check:rules` 52 of 52 · full unit suite · full e2e suite · build clean.

## Not verified

**Nothing ran on the S25.** The button clears the 48dp floor by assertion, but it sits at the end of
a scroll above the tab bar, so its clearance under the gesture bar is exactly the thing the sandbox
renders as zero. The offline path is also unexercised: this write has no outbox domain, so marking a
day complete with no network fails visibly rather than queueing — acceptable for a once-a-day action
whose value is in the calibration window rather than in the moment, but untested on a real device.
