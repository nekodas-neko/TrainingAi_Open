# 2026-09-28 — BF-200: a deload week now lightens an exercise that has no style

The owner, mid-deload on Upper: *"it seems like skull crusher weight is the same as my active
workout."* Four exercises were at 52%; Skull Crusher was at 3 × 30 kg, his working weight.

## How it was found

The entry offered two mechanisms (the pct applied to an inflated PR, or no pct at all) and said the
arithmetic could not separate them. Production could:

| 09-25 deload session | deloaded | style | sets | planned_pct |
|---|---|---|---|---|
| Incline Bench, DB Row, Lateral Raise, Chin-Up | true | set | 2 | 52 |
| **Barbell Skull Crusher** | **false** | **none** | **3 × 30** | **none** |

Skull Crusher has had no progression style since 2026-09-10. On 09-25 the AI prescription was not
driving the load, so each exercise started from its base style, and the Q-185 deload override in
`buildWorkoutExercises` swapped in the deload style. That override required a non-empty
`progressionStyle`. The deload style is built from the goal alone, so the requirement did nothing
except exempt a style-less exercise, which then fell back to 3 sets at target-80: 29.25 → 30 kg.

A third idea, that the prescription's `sessionExerciseId` no longer matched a replaced row, was
checked and refuted: all five ids match.

## The fix

One condition in `packages/shared/src/workout/session-data.ts`. A style-less exercise has nothing to
revert to, so its `preDeloadStyle` stays null and "revert to full weights" restores what it had.

## Verification

- `bf200-styleless-deload.test.ts`, 5 cases: the style-less exercise deloads exactly like the styled
  one; nothing is left to revert; it is untouched outside a deload week; a baseline never deloads;
  a static program is untouched. The first case failed before the fix.
- Mutants: restoring the old condition, and dropping the baseline guard, were both killed. The control
  (operand order) survived.
- All 47 test files around the builder pass (482 tests).
- `pnpm dev`: `/api/workout-data` returns 200 and builds every seeded session. The seed program is not
  AI-dynamic, so this branch is reached only by the unit test.

## Left, and recorded on BF-200 as Keep

How the style came off around 09-10; style-less exercises logging no `planned_pct` on ordinary days
(TN-75); the 57.75 kg PR that still looks inflated. Not exercised: the device.
