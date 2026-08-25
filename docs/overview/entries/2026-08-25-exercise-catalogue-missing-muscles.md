# 2026-08-25 — five catalogue rows get the muscles their sibling movement already had (BF-16a)

**Branch:** `fix/exercise-catalogue-missing-muscles` · **Lane A** · migration **216**, v1.370.2.

The owner's report was *"hip thrusts and dumbbell shoulder press should be able to be a secondary"*.
That reads as a threshold complaint and is not one. The role rule reads muscle counts, and BF-15's
anchor rule wants a catalogued exercise with **≥ 3 muscles** — so a row seeded with two can never be
classified above accessory whatever the thresholds say. Five rows were seeded short.

| Exercise | Recorded | Added | Established by |
|---|---|---|---|
| Cable Chest Dips | chest(m), triceps(s) | shoulders(s) | `Dip`, `Weighted Dip`, `Barbell Bench Press`, `Machine Chest Press` all carry shoulders on the same pressing pattern |
| Dumbbell Shoulder Press | shoulders(m), triceps(s) | traps(s) | `Barbell Overhead Press` |
| Cable Pulldown | lats(m), biceps(s) | upper back(s) | `Close Grip Lat Pulldown`, `Chin-Up`; `Pull-Up` carries it as a main |
| Barbell Hip Thrust | glutes(m), hamstrings(s) | quads(s), lower back(s), adductors(s) | no in-catalogue precedent — anatomical, per BF-16a |
| Barbell Shrug | traps(m) | upper back(s), forearms(s) | `Farmer's Walk` for forearms, the other grip-loaded traps movement; upper back has no precedent |

All five now sit at ≥ 3, which is the threshold the entry existed to clear. BF-16a's *rhomboids* is
written as `upper back` because `normalizeMuscle()` folds it there.

## The entry's premise was wrong in one way that mattered

BF-16a says *"Surface: production data. Not reproducible against the local seed — the dev database is
seeded correct."* It is not. The short lists were written by the seeds themselves (migrations 008 and
032) and are identical everywhere: fingerprinting all **140 seeded rows** (`merged_into IS NULL`,
`created_by IS NULL`) in the local dev DB against production, the `muscles` column **matches on every
one** — the only differences in the whole table are a sort-collation artefact and one row named
`Cable Crunch` locally against `Cable Crunch Abs` in production.

That is the difference between "correct a drifted production row" and "correct a defective seed", and
it is good news: the defect reproduces locally, so the fix could be exercised through the real route
instead of reasoned about.

## What shipped

Migration **216**, an idempotent append. Each statement adds one assignment and skips when the row
already names that muscle, compared **case-insensitively** — the catalogue carries a few Title Case
values (`Barbell Jefferson Curl` records "Lower Back", `Dumbbell Fly` records "Chest"), and without
the fold a row that already named the muscle in another case would get a duplicate, which every
weighted-set tally would then count twice.

Nothing else changed. Array order is not load-bearing: every consumer filters on `role`
(`lib/coach/tools.ts`, `lib/local-store/program-assembler.ts`, the two raw-SQL tallies) and none
indexes the array, so appending is safe.

**This retroactively changes past weeks' numbers, and that is intended.** `weekly-muscle-sets` reads
`exercise_library.muscles` in a live subquery rather than from a stored per-muscle total, so history
re-derives against the corrected catalogue the moment the migration lands.

## Scope — the five named rows only

Scanning the whole live catalogue for the same shape found **eight more rows**. They are filed as
**LA-24** rather than folded in, because they split into two kinds that want different handling:
five where another family member already records the muscle (propagating the catalogue's own answer —
`Dumbbell Overhead Press`, `Machine Shoulder Press`, `Arnold Press`, `Lat Pulldown`,
`Decline Bench Press`), and three families where BF-16a's own additions have no precedent, so
extending them means originating anatomy five more times. That second half wants an owner answer, and
it is cheap to defer: a catalogue UPDATE is reversible by another UPDATE.

Fixing the five does create a fresh inconsistency — `Barbell Shrug` at 3 while `Dumbbell Shrug` and
`Machine Shrug` sit at 1 — which LA-24 records rather than leaves implicit.

## Verified

- **Through the live route, before and after.** Seeded two sets of `Barbell Hip Thrust` against the
  dev DB and called `/api/weekly-muscle-sets` as the test user: `glutes 2, hamstrings 1` with the
  catalogue row put back to its pre-fix value, and `glutes 2, hamstrings 1, quads 1, lower back 1,
  adductors 1` after re-running 216 — the secondary half-weight showing correctly (2 sets × 0.5).
  Fixtures deleted afterwards; the tally is back to its seeded state.
- `/api/exercise-library` serves all five at their corrected counts (141 rows).
  `/api/muscle-recovery` 200, unchanged in shape.
- `lib/data/postgres/__tests__/exercise-catalogue-missing-muscles-migration.test.ts` — **5 passed**,
  covering the additions, the ≥ 3 threshold, idempotency across three runs, the case-insensitive
  guard, and an untouched neighbouring row.
- **Mutation-proven, both directions.** Dropping the `lower()` fold fails the duplicate case;
  dropping one row from the VALUES list fails two others. Re-running 216 twice more against the dev
  DB leaves the whole table's fingerprint unchanged.
- `pnpm check:rules` — **Ran 56 of 56**. `pnpm lint` — 0 errors.

## Not exercised

- **Nothing ran on the S25.** No APK is needed — the device's local `exercise_library` mirror is
  hydrated from `/api/workout-data` in `workout-screen.tsx:421` and upserted with
  `muscles=excluded.muscles`, so a corrected catalogue reaches the device on the next workout-screen
  load through the normal path. That reasoning is from source, not from a device.
- **The migration has not run against production.** It is idempotent and narrow, but the five
  production rows were read, not written, this session.
- The AI periodization engine's own weighting copy
  (`lib/data/postgres/slices/periodization.ts getWeeklySetsByMuscleGroup`) was not exercised; it
  reads the same column through the same shape and takes the correction for free, unverified.
