# 2026-08-12 — a deload week now lightens every exercise, not just the prescribed ones (Q-185)

**Branch:** `fix/ai-dynamic-deload-covers-all-exercises`

## What was wrong

Every deload reduction lived inside `if (aiDrivesLoad)` and then keyed off a prescription entry
(`aiPrescription.exercises.find(...)`). An exercise the AI does not name never reached one.

Measured on the running dev server before the fix, not inferred: with a deload week confirmed and a
prescription covering two of a session's three exercises, `/api/workout-data` returned the two
prescribed lifts at **50% / 2 sets** beside an accessory unchanged at its base style, **75% / 3
sets**. The worse case was a whole session whose prescription is missing or expired — `aiDrivesLoad`
false, so nothing reached the branch at all and every exercise came back at full base-style load
with `isDeloadActive: true` on its own phase status.

## Owner decision

Asked whether to lighten accessories too, leave them (deload is for main lifts only), or reduce them
by a smaller amount, the owner chose **lighten them too**, having been told this is the largest
behaviour change of the three and that deload weeks will feel noticeably easier than they do now.

## The fix

A branch after the AI block applies `deloadOverrideForGoal` to whatever style the exercise resolved
to, when a deload is active and nothing has already deloaded it.

**Static programs are deliberately excluded**, and that exclusion is the load-bearing part. They
have `ProgramPhase` rows, so `deloadAwareStylePhase` has already swapped in the deload phase's style
further up — reducing again here would compound the two. An `ai_dynamic` program has no phase rows
and therefore nothing to swap to, which is exactly why only it needs this. That is also the reason
Q-185 was not a Q-175 regression: it predates it and both entry points shared it.

Added `deloadStyleForGoal()` to `deload-constants.ts` so the "N sets of the per-goal deload numbers"
shape exists once. The AI branch previously built it by spreading over a prescription entry
(`prescriptionStyleForExercise({...p, sets, reps, pct, restSec, deloaded: true})`), which an
un-prescribed accessory has nothing to spread over. Both paths now call the same helper; the output
is identical, since that spread set `useFor1rm: !presc.deloaded`, always false there.

`preDeloadStyle`/`preDeloadSets` are carried the same way as the existing paths, so the
revert-to-full-weights UI (`DeloadInfoSheet`) works for these exercises too.

## Mutation-verified

| mutation | failing tests |
|---|---|
| remove the whole new branch | 5 |
| drop the static-program exclusion | 1 — *"does NOT reduce a static program"* |
| drop the already-deloaded guard | 5 — the compounding cases |
| stop carrying `preDeloadStyle` | 1 |

## One test changed meaning, and one guard turned out to be dead

**`does not raise a base-style accessory to its target RPE mid-deload`** (Q-175) asserted the
accessory's base **60%**. Its intent — don't push an un-prescribed accessory *up* during a deload —
still holds and is now stronger, since it comes *down* to 50%. Updated to assert
`toBeLessThanOrEqual(60)` alongside the concrete new value, so the original concern stays guarded
rather than being replaced by a bare number swap.

**A `!isBaselinePhase` clause I wrote was unreachable, and mutation is what said so.** Deleting it
failed **zero** tests. Two paths make it dead: a baseline phase sets `progressionStyle` to null, so
an un-prescribed exercise is stopped by the length check; and a *prescribed* one has already been
deloaded by the AI branch above, so `!deloaded` stops it. Removed rather than left in as decorative
intent — a condition no test can fail is the thing this project's mutation discipline exists to
catch.

## A pre-existing finding that fell out of it (filed, not fixed)

Chasing that dead clause surfaced something real: **the AI branch's own deload has no baseline
carve-out**, so a confirmed deload week reduces a *prescribed baseline lift* to 50% / 2 sets.
Meanwhile `estimateOneRm` and `shouldCountTowardPr` both special-case baseline as "a genuine
max-effort attempt even during an otherwise-active deload window". So the app prescribes half weight
and then treats the result as a real max test.

Pre-existing, and changing it is a load-changing decision beyond this entry's scope — filed as
**Q-211**. A test in this file records the current behaviour explicitly (`expect(ex.deloaded).toBe(true)`)
so the next reader finds the finding instead of rediscovering it.

## Verified end-to-end, on the same fixture that shows the bug

Put the seeded program into the reported state — `phase_mode = 'ai_dynamic'` with
`early_deload_week_start = CURRENT_DATE`, and no stored prescription, which is the
missing/expired shape (`aiDrivesLoad` false) that read worst. Same fixture, same dev server,
`/api/workout-data?tab=all`, all nine exercises across all three sessions:

| | every exercise |
|---|---|
| `origin/main` | **75% / 3 sets**, `deloaded: false` — a confirmed deload week reducing nothing at all |
| this branch | **50% / 2 sets**, `deloaded: true` |

## Not exercised

- **Not verified on device.** No safe-area or native surface changed, but prescribed weights are
  what the workout screen renders, so a deload week is worth a look on the S25.
- **Not exercised against a real AI prescription.** The partially-covered case — some exercises
  prescribed, some not — was verified through `buildWorkoutExercises` with fixture prescriptions,
  not by generating one from the model. The end-to-end run above covers the no-prescription shape.
