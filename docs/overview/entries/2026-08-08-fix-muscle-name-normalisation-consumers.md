## 2026-08-08 — weekly muscle volume stops splitting one muscle into two rows (Q-120)

**Branch:** `fix/muscle-name-normalisation-consumers` · **Domain:** `workouts`

### What was wrong

`computeDefaultVolumeTargets` writes **normalised** muscle names into
`program_volume_targets.muscle_group` — `normalizeMuscle` folds `core→abs`, `quadriceps→quads`,
`pecs→chest`, `deltoids→shoulders`, `trapezius→traps`. The surfaces that read logged sets keyed
them by the **raw** exercise-library label instead, with nothing more than a `LOWER()`. The seeded
library ships `"core"` on 14 rows, so the two sides could never line up.

The user-visible result on Health → Weekly Muscle Sets was one muscle drawn as two rows: a red
`Abs 0/16` (the card reddens `sets < target × 0.6`) sitting next to an untargeted `Core 12`. The
`MuscleHeatmap` directly above it *does* normalise, so the picture and the list beneath it
disagreed with each other. The AI engine was already correct and carries a comment about this exact
hazard — so the engine's reasoning and the card the user reads disagreed about the same metric.

### What shipped

Normalisation moved to where the data is produced rather than being re-applied per consumer:

- **`getWeeklySetsByMuscleGroup`** (`lib/data/postgres/slices/periodization.ts`) now returns
  canonical keys, and the two row loops it used to run separately fold into one.
- **`signals.ts`** drops its own re-normalisation pass over the logged map — the repo function now
  guarantees what that loop was compensating for. Its target-side and `programSession.exercises`
  normalisation stay, since those still arrive raw.
- **`ai-periodization/weekly-volume/route.ts`** normalises its target keys, so a hand-edited target
  row carrying a synonym still lines up with logged sets.
- **`weekly-muscle-sets/route.ts`** — which runs its own SQL rather than calling the repo function
  (it counts across all programs, not one) — normalises both the logged tally and the target map,
  replacing the two `.toLowerCase()` calls that were standing in for it.
- **`muscle-tonnage-trend/route.ts`** was not in the backlog entry but has the same defect and is a
  user-visible per-muscle trend: it would draw `core` and `abs` as two separate lines. Swept in the
  same PR per the sibling-surface rule.

### Verification

- `tsc --noEmit` clean · `pnpm lint` 0 errors · `vitest run` 3219/3220.
- The single failure is the known seeded-DB harness problem in `scale-ble-multi-reading.test.ts`
  (filed by me as Q-141 — a number already claimed by open PR #1143; correctly refiled as **Q-146**, and since fixed by #1160), which reproduces on a clean `origin/main` and does not occur on CI's
  unseeded database.
- **Reproduced the bug and then the fix against the local DB**, rather than reasoning about it.
  Logged three sets of `Ab Wheel` (a `"core"`-tagged library exercise) into the current week and
  gave the seeded program an `abs` target of 16:
  - on `origin/main`: `{"muscle":"abs","sets":0,"target":16}, {"muscle":"core","sets":3}` — the
    split row, exactly as described;
  - on this branch: `{"muscle":"abs","sets":3,"target":16}` — one row, target attached.

  `/api/ai-periodization/weekly-volume` moved from `logged:{"core":3}` to `logged:{"abs":3}` against
  `targets:{"abs":16}`. The fixture rows and the temporary volume targets were deleted afterwards;
  the seed is back to its original state.

### Not exercised

No device run — server-side query/aggregation only, no native, safe-area, gesture or notification
path. Only the `core→abs` fold was exercised with real data; the other synonym pairs
(`quadriceps`, `pecs`, `deltoids`, `trapezius`, `forearm`, `external oblique`, `rhomboids`) share
one code path and `normalizeMuscle`'s own unit tests, but no seeded exercise uses them. Production
rows were not inspected — a user whose `program_volume_targets` predate
`computeDefaultVolumeTargets`' normalisation now gets those folded too, which is the intended
behaviour but was not verified against real data.
