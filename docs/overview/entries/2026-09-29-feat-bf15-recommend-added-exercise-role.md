# BF-15 — a named exercise now starts on a role, and never on Primary

**Branch:** `feat/bf15-recommend-added-exercise-role` · **Version:** 1.485.1

The owner's report: *"some 'isolation' type work will increase to a main level when it should be
accessory sort of — like bicep curls."* Lane A fixed the fallback on 2026-09-28 (a missing role
defaults to `accessory`, and a test fails on any `?? 'primary'`). What was left was to
**recommend** one rather than leave every new exercise on the fallback.

## The entry says "when an exercise is added". It cannot be then.

`addExercise` appends an **empty** slot — `{ key, name: "", styleId }`. Nothing is known about it,
and `recommendAddedExerciseRole` reads the catalogue's muscle count. So the role is recommended in
`selectExerciseName`, the single funnel both the picker and free-text entry already pass through,
where the catalogue `match` is in hand.

This is the same shape as `LB-186` on this very file: an entry naming the add path for a decision
the add path cannot make.

## Two rules, both asserted

- **Never over a role the lifter chose.** Renaming an exercise that already carries a role leaves it
  alone — the recommendation is a starting pill, not a correction.
- **Nothing for a name the catalogue does not hold.** There is no muscle count to reason from, the
  engine's `accessory` default already covers it, and guessing would be a number invented rather
  than read.

## The size gate forced a better shape

`program-editor-sheet.tsx` is a shrink-only hotspot at a 963-line allowance, and the first draft
took it to 973. Rather than golf the comments down, I took the extraction the checker actually asks
for: `musclesForSelectedExercise` moves the main/secondary/muscleGroups mapping into the same helper
module as the role, since both are computed from the same `match` for the same reason. **The file
landed at 961 — one line below `main`**, and the two pure functions are now testable together.

## Verified

- `bf15-recommended-exercise-role.test.ts` — **10 tests**, including the defect asserted directly
  (no muscle count produces `primary`), the single-muscle bicep-curl case, secondary slots filling
  up, a chosen role surviving a rename, and the slot being named excluded from its own count.
- `e2e/lb186-new-exercise-has-a-style.spec.ts` — **3 passing**; it drives this editor's add path,
  which is the surface the change sits on.
- `npx tsc --noEmit` · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors ·
  `pnpm test` **9,551 passed** · `pnpm build`.

## Not exercised

- **The pill rendering pre-selected.** The e2e covers the add path but not the role pill's state
  after naming; the ten unit tests own the decision and the component wiring is a single call.
- **The whole-session rule** remains deliberately unbuilt — see the 2026-09-28 entry. It scored 87%
  against the owner's sessions, below its own 90% bar, by anchoring Legs on the hip thrust over the
  squat, and nothing in the catalogue separates those two.
- **The device.** No native, safe-area or gesture change.
