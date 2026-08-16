# 2026-08-03 — the third bodyweight-as-kg site, and why the first sweep missed it

_Branch `fix/bodyweight-target-preview-sheet` · v1.252.5 · domain `workouts` · closes backlog Q-55_

## What was wrong

`components/overview-screen.tsx:484` — the workout-preview sheet's **Target** column — rendered

```tsx
{ex.target80 != null ? `${snapWeight(ex.target80)} kg` : "—"}
```

with no `exerciseType` guard. `target80` is `estimated1rm * 0.8`, and for a bodyweight exercise
`estimated1rm` is a `BW_REF`(100)-relative index, not kilograms. So opening the preview for a session
containing a bodyweight lift printed a weight the lifter has never moved.

The correctly-guarded version sat **70 lines above, in the same file** (`:409-414`).

## Why v1.252.4 missed it

v1.252.4 fixed this class on the Year-in-Review and the deload sheet. Its sibling sweep grepped for
1RM renders carrying a `kg` suffix — and this one renders `target80`, a *derived* field, not
`estimated1rm`. The search term was too narrow. Found by a separate cross-domain review the same day.

Worth recording as the lesson rather than the fix: when sweeping for a unit bug, sweep for the
**derived** fields too, not just the stored one.

## The fix, and the sweep re-run

The guard now mirrors the `:409-414` block byte for byte, so the two cannot drift.

Task 2 of the plan asked for the sibling sweep to be re-confirmed. Every other `target80` render was
checked and all are safe — two of them by a route the grep alone would not have shown:

| Site | Guarded by |
|---|---|
| `overview-screen.tsx:409` | explicit `exerciseType === "bodyweight"` |
| `active-workout-screen.tsx:468` | an **earlier `isBodyweight ? null :` short-circuit** in the same ternary chain — the `target80` branch is unreachable for bodyweight |
| `exercise-stats-sheet.tsx:93` | its render site (`:181`) branches, and `:121` handles the bodyweight rep-max case explicitly |
| `workout-screen.tsx:70` | `computeInitialWeights` **returns all zeros for bodyweight before reaching the line** |

So `:484` really was the last one. The two short-circuit cases are why a grep for `exerciseType`
near a `target80` render would have reported false positives — they need reading, not matching.

## Verification

The failing case was reproduced end to end on the dev server. The seed program has no bodyweight
exercise, so one was created (`Bicep Curl` → a `bodyweight` library row, linked, with a logged
`target_80` of 94.4). `/api/workout-data?tab=<pull>` then returned exactly the shape the bug needs:

```
Bicep Curl   type=bodyweight  target80=94.4
```

Before the fix that renders **"94 kg"**. After, `repMaxFromOneRm(94.4)` → **"1 reps"**. The dev
database was restored afterwards.

Typecheck clean, lint at baseline.

## A smaller finding this surfaced — not fixed here

**"1 reps" is a weak reading in its own right.** `target80` is 0.8 × a BW_REF(100)-relative index, so
for a bodyweight exercise it lands *below* BW_REF and inverts to 1. Both blocks now agree and neither
fabricates a weight — which is the whole of Q-55 — but what a "target" should mean for a bodyweight
lift is a product question nobody has answered. Filed as a `projectOverview.md` note rather than
silently shipping a number that reads oddly.

Deliberately not addressed here: changing it would make this block disagree with `:409-414`, and the
plan's own instruction was to mirror that block exactly.

## Not verified

The rendered sheet. Its data is fetched client-side, and this repo has no React render-test setup
(`vitest` runs in the `node` environment, no `@testing-library`). What is proven is the payload, the
branch, and both rendered strings computed directly.
