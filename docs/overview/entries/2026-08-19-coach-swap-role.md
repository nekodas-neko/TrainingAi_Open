# 2026-08-19 — Q-405: a Coach swap sets the role instead of inheriting it

**Branch:** `feat/coach-swap-role-prompt` · Implementation Lane A · JS/server only, no APK.

## What was wrong

`lib/coach/domains/session-exercise.ts` contained no reference to `exerciseRole` at all. A swap wrote
`exerciseName`, `exerciseId` and `muscleGroups` and left the role alone, so the row kept whatever the
**outgoing** exercise had.

**That is not a badge.** `resolveStyleForExercise` picks the progression style from the role, so the
role decides the prescribed percentages and sets. The owner's Barbell Romanian Deadlift → Barbell
Jefferson Curl swap carried `secondary` across and prescribed **60 kg × 6 at 80%** on a slow
spinal-flexion movement that is normally loaded light.

## What the premise check changed (recorded first in PR #220)

Three things, all measured, and each one changed the design:

1. **`exercise_library` has no default-role column.** The entry's preferred source for a
   recommendation does not exist, so muscles + equipment is the only one.
2. **The owner's exercise was not in the catalogue.** `Barbell Jefferson Curl` returns zero rows, so
   that swap went through `createMissingExercise`, whose muscles are **model-proposed**. Deriving a
   role from those launders model output into a prescription, which CLAUDE.md forbids outright. So
   that path gets `UNCLASSIFIED_EXERCISE_ROLE` — `accessory`, the lightest — and the preview says so.
   Not the outgoing role, which is the defect; not a derived one, which would be the same defect in
   better clothes.
3. **"Compound = ≥2 main muscles" calls Barbell Bench Press an isolation.** 117 of 142 catalogue
   entries carry exactly one `main` muscle. The signal is the **total** count: Bench Press 3, Barbell
   Curl 2, Concentration Curl 1, Deadlift 5.

**The sibling sweep the entry asks for was also run, and it came back clean.** The other writers of
`exercise_role` are the program editor, the config screen, the workout builder, `generate-program`
and the sync/assembler mappers — none of them replaces an exercise in place, so none of them can
inherit a role. The Coach was the only offender, and this is the whole fix rather than the first of
several.

## The recommender, and the validation behind it

`recommendExerciseRole` (`packages/shared/src/workout/exercise-role.ts`): under 3 muscles →
`accessory`; 3 or more with a barbell → `primary`; 3 or more without → `secondary`. Empty muscles →
**`null`, meaning ask** — a caller must not turn that into a default.

**Run against all 142 catalogue rows, not sampled:** 16 primary, 39 secondary, 86 accessory, 1
unrecommendable. Every one of the 16 primaries is a barbell movement a session is built around —
squat, the deadlift variants, bench, overhead press, the barbell rows — with no isolation among them.
**Barbell Preacher Curl and Barbell Wrist Curl land in accessory**, which is the check that matters:
it proves the barbell alone does not promote.

**The known imprecision, stated rather than hidden.** Plank, Side Plank and Mountain Climbers come out
`secondary` on their three listed muscles. Demoting bodyweight wholesale would fix those three and
break Pull-Up, Chin-Up, Push-Up and Inverted Row, which are real compound movements — and
`exercise_type` is not a reliable discriminator either (Glute-Ham Raise is typed `bodyweight` with
`machine` equipment). A plank is also far less likely than a pull-up to be swapped in as a loaded
movement, so the trade runs this way. It is a recommendation the user confirms, not a silent write.

## Asking, without inventing a UI

The Coach already has a preview/confirm step, so the role change is surfaced there rather than behind
a new picker: an `info` line naming the new role, the old one and the fact that it changes the
prescription — or a **`warn`** when nothing is known about the incoming exercise, saying the lightest
role was chosen and to check it. That is the entry's *"ask, with a recommendation pre-selected"* in
the mechanism that already exists.

**Undo restores the role too.** Putting the name back while leaving the role behind would leave the
old exercise under the new exercise's prescription — a different wrong answer, not a fix.

## Verification

`npx tsc --noEmit` clean · `pnpm lint` clean · `pnpm check:rules` **Ran 49 of 49** · full suite
**520 files / 4,259 tests passed**.

- **8 unit tests** on the recommender, including the two that would fail a naive implementation:
  a barbell isolation must not be promoted, and the muscle `role` field must not be what is counted.
- **6 DB-backed tests** on the write path, because inheritance was a write-path defect rather than a
  formula one: no inheritance, demotion to accessory, **the owner's exact case** (an exercise the
  catalogue has never seen → `accessory`), undo restoring the role, and both preview lines.

One of those tests failed first because `createMissingExercise` is **admin-gated** — `exercise_library`
is one shared catalogue, so adding to it is a policy decision the Coach must not route around. The
test user became an admin, which is also how the owner reached that path.

## Not exercised

**The device**, and the prescription end-to-end. These tests prove the stored role changes; that the
*prescribed sets* then change is `resolveStyleForExercise`'s existing, separately-tested behaviour.
The entry's own verification step — swap a compound for an isolation and watch the prescription move
— is the on-device confirmation and is still owed.

**Q-403** (the same flow calls an applied change a "proposal" after the fact) is related and was
deliberately left; it is its own entry.
