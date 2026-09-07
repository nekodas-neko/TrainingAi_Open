# 2026-09-07 — an unlabelled exercise was offered to everyone (BF-129)

**Branch:** `fix/catalogue-equipment` · **Lane A** · **Migration 269**

## The defect

22 `exercise_library` rows carried `equipment = '{}'`, and all three equipment filters read an empty
list as an unconditional pass — `ex.equipment.length === 0 || ex.equipment.some(...)`. An unlabelled
row therefore cleared **every** equipment selection anyone could make. Three of the 22 are machines,
which is how an owner who trains at home with a barbell, dumbbells, a cable tower and a pull-up bar
was offered `Machine Chest Press`.

## What the investigation changed

The entry proposed filling the column in, then adding "a check that fails on a new empty-equipment
row". Two things came out of checking that against reality.

**A CI check could not have caught this, and still can't.** `exercise_library` is only partly
seeded: **production held 151 rows against a freshly-migrated 141**. The extra ten were created at
runtime through `POST /api/exercises` — whose `equipment` field is `z.array(z.string()).default([])`.
So every drifted row came in through a write path, and a check against a migrated database would
have passed throughout. That route is the root cause and is now fixed at the gate.

**The trap was visible in the local database.** A first attempt at the CI check failed on
`Snapshot Chin` — an `exercise_library` fixture inserted by `set-log-planned-snapshot.test.ts`. The
Tests job shares one database across the suite, so the same assertion there passes or fails on test
**order**. The check runs in **Migration Check** instead, which has a fresh migrations-only database.

## What shipped, in four layers

1. **Migration 269** — labels the 21 named rows and merges `Dumbbell Lunges` into `Dumbbell Lunge`.
   Values are anchored to a labelled **sibling** wherever one exists rather than invented:
   `Cable Crunch Abs` ← `Cable Crunch` merged *into* it (migration 165) and was `['cable']`;
   `Weighted Dip` ← `Dip` is `['bodyweight','machine']`; `Wrist Extension` ← the wrist-curl pair.
   The nine `exercise_type = 'bodyweight'` rows take `['bodyweight']`, which is what 13 of the 14
   already-labelled bodyweight-typed rows carry. The merge copies migration 165's additive shape —
   the row keeps its id, every FK stays valid, and history is deliberately not rewritten, because
   this is a global catalogue and another account's rows are not a migration's to move.
2. **`POST /api/exercises`** — the create branch now requires at least one equipment value. Only the
   create branch: a merge sends `{name, mergeWithId}` and returns before `createExercise`, so
   requiring it there would break renaming. The message is surfaced to the client (the sheet renders
   `error` straight into its toast); every other validation failure stays generic.
3. **`packages/shared/src/workout/equipment.ts`** — `buildEquipmentSet` existed as **three
   byte-identical copies**. Extracted, with `equipmentEligible` beside it, and an unlabelled row is
   now **excluded** rather than passed. Both API routes import it.
4. **`scripts/check-catalogue-equipment.js`** in Migration Check — holds the seeded rows, and says
   in its own header what it cannot see.

## The one judgement call

`Abs` — a generic name typed `weighted` with no sibling to anchor to. It takes `['bodyweight']`
because its crunch siblings are all bodyweight, and because a wrong minute in the time model is
cheaper than an exercise the lifter cannot perform.

## Deliberately not done

**The time default.** `transitionSecForEquipment([])` still returns `TRANSITION_SEC_BARBELL` (240 s).
The entry recommended treating empty as bodyweight for time, but with every row labelled that branch
is unreachable, and re-tuning the transition constant is **LA-65**'s, on evidence this entry does not
have. Changing it would also stack a second exercise-count increase on top of BF-128's, which shipped
this morning.

**`builder-review.tsx`'s copy** of the filter — the swap sheet, Lane B, as the entry itself said.
Filed as **LA-66** with the two-line change.

## Verification

- **Mutation-tested five ways**: drop the `superRefine`; require equipment on the merge branch too;
  restore the permissive branch in the shared predicate; drop the always-bodyweight floor. **Two
  mutations initially survived** — the first drafts of both the route test and the filter test
  re-declared the rule instead of importing it, which is a test that keeps passing after the code
  stops enforcing anything. Rewritten to exercise the real `POST` handler and the real shared
  predicate; all now fail.
- Migration verified **idempotent** by replay, and by a test asserting a row that already declares
  equipment is not overwritten. Applied to a fresh database: **all 140 selectable rows declare
  equipment**.
- Full suite **6688 passed | 86 skipped**; `tsc` clean; test-typecheck at baseline; Custom Rules
  **68 of 68**.
- **`pnpm dev`, authenticated as an admin**: create with no equipment → **400** with the actionable
  message; with `['bodyweight']` → **201**; an unrelated bad field → generic `Invalid body`. Two
  fresh 60-minute programs against a barbell/dumbbell/cable selection prescribed 21 distinct
  exercises and **no machine movement**.

**Not exercised:** the S25. Server-side filtering and a migration, no native path — but the
add-exercise sheet's new 400 was not seen on device, and the sheet still lets a user submit with no
equipment chips selected rather than disabling the button (the Lane B half of the same guard).
