# 2026-09-18 — RV-51: the two exercises that looked hidden were duplicates, and two that were leaking went unnoticed

**Branch:** `lane-a/rv51-excluded-exercises` · **Lane A** · **no migration** · unversioned

## What the entry asked for

RV-51 found that `equipmentEligible`'s header justifies excluding an unlabelled exercise with *"an
empty list should not occur"*, and that production holds **two rows that do**: `Cable Lat Pulldown`
and `Dumbbell Lunges`. Since `equipmentEligible` is `.some(...)`, and `.some()` on `[]` is always
false, it concluded those two exercises are invisible to every program generator for every user, and
prescribed a **migration to label them**, with the pass test *"a generated full-gym program can offer
both names."*

Both measurements are correct. The conclusion inverts the situation, and the prescription would have
made it worse.

## Both rows are merged duplicates

One column the entry did not select settles it:

| row | equipment | `merged_into` |
|---|---|---|
| `Cable Lat Pulldown` | `[]` | → **Cable Pulldown** |
| `Dumbbell Lunges` | `[]` | → **Dumbbell Lunge** |

They are not hidden exercises. They are duplicates that migration 269 deliberately merged — 269's own
comment says so for `Dumbbell Lunges`, in the section below the backfill: *"a duplicate of `Dumbbell
Lunge`, so it wants a merge rather than an equipment value."* Their canonical rows are offered, and
the lifter loses nothing. Labelling them would have **un-hidden two duplicates**, and the entry's
pass test — offering both names — is the outcome to avoid.

## The real defect is the mirror of the reported one

`listExerciseLibrary` is **deliberately unfiltered**: `exercise_library` is global, and other
consumers resolve metadata for rows another user may still have logged. `mergedInto` is exposed so
each **picker** filters it. `components/workout-builder/builder-review.tsx:178` does. **`generate-program`
and `builder-chat` did not** — they were excluding merged rows only by the accident that these two
carry an empty equipment list.

Production holds **four** merged rows, and the accident covers only half of them:

| merged row | equipment | canonical | status before this PR |
|---|---|---|---|
| `Cable Crunch` | `['cable']` | Cable Crunch Abs | **being offered** |
| `Straight Arm Pulldown` | `['cable']` | Cable Pulldown | **being offered** |
| `Cable Lat Pulldown` | `[]` | Cable Pulldown | hidden, by accident |
| `Dumbbell Lunges` | `[]` | Dumbbell Lunge | hidden, by accident |

So the review noticed the two rows that were **harmless** and missed the two that were **live**. The
same query that produced the finding would have shown all four; it was one column short.

## What shipped

`if (ex.mergedInto) return false` in `app/api/generate-program/route.ts`, and `!ex.mergedInto` added
to the filter in `app/api/builder-chat/route.ts` — matching `builder-review.tsx`, which already had
it. **No migration.** The two unlabelled rows stay unlabelled, which is correct for a merged
duplicate.

## The open question the entry raised, answered

RV-51 asked whether migration 269 **missed** these two or something **wrote** them afterwards, noting
that `exercise_library` has no `created_at` — and that if it is the latter, the `POST /api/exercises`
guard has a hole and labelling two rows fixes nothing.

Neither. The guard is at `app/api/exercises/route.ts:39` and reads
`if (!body.mergeWithId && body.equipment.length === 0)` — **a merge request is deliberately exempt
from requiring equipment**, and both rows are merge-path rows. The guard is sound and the rows are
behaving as designed. No hole, nothing written around it.

## The header that caused this

`equipmentEligible`'s comment claimed *"an empty list should not occur"*. Two do. That sentence is
what sent the review looking for a data defect, and it is now corrected in place — it states the
counter-examples, says they are merged duplicates, and says outright that **a merged row is not this
function's job to exclude**, so nobody relies on the accident again.

A justification stated more strongly than its data supports is worse than no justification: this one
aimed a review at the wrong target and would have had it ship a migration that un-hid two duplicates.

## Verification

Two new files, **4 tests each**, asserting on the **prompt the model actually receives** — the shape
the sibling `injury-exclusion.test.ts` in both directories uses, and for its stated reason: an
instruction not to program a duplicate would pass a helper-level test and still let the model return
one.

The merged fixture row **carries equipment on purpose**. An unlabelled one passes against the unfixed
route and proves nothing — which is precisely the trap the production data laid.

| case | against unfixed route |
|---|---|
| merged duplicate that IS equipment-eligible is not offered | **fails** |
| the canonical row it was merged into is still offered | passes |
| merged duplicate with no equipment stays excluded (**deliberately equivalent control**) | passes |
| an ordinary exercise is still offered (**over-filtering guard**) | passes |

Mutation pass run separately per route; each killed exactly the first case. Both pre-existing
`injury-exclusion` suites still pass unchanged — **17 tests across the four files**.

Gate: Custom Rules 75 of 75, `tsc --noEmit` clean.

## Not exercised

- **The S25 device.** Server-side only; reaches the phone through a Railway deploy with no APK.
- **A real generation against production data.** The fixtures mirror the four production rows but no
  program was generated against the live catalogue; the change can only remove names from a list, so
  the failure mode would be over-filtering, which the fourth test guards.
- **`Cable Crunch` and `Straight Arm Pulldown` disappearing from a live program.** They will stop
  being offered. Nothing re-writes existing programs, so anything already containing them keeps them
  — which is correct, and is why `listExerciseLibrary` stays unfiltered.
