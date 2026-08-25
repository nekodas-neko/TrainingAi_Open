# 2026-08-25 — five more catalogue rows get what their family already recorded (LA-24 Kind 1)

**Branch:** `fix/catalogue-sibling-muscles` · **Lane A** · migration **219**.

BF-16a corrected the five rows the owner's report named. Scanning the whole live catalogue for the
same shape found eight more, in two kinds. **This ships the kind that needs no judgement**: another
member of the same movement family already records the muscle being added, so it propagates the
catalogue's own answer rather than originating one.

| Row | Records | Added | Established by |
|---|---|---|---|
| Dumbbell Overhead Press | shoulders(m), triceps(s) | traps(s) | `Barbell Overhead Press` |
| Machine Shoulder Press | shoulders(m), triceps(s) | traps(s) | ditto |
| Arnold Press | shoulders(m), triceps(s) | traps(s) | ditto |
| Lat Pulldown | lats(m), biceps(s) | upper back(s) | `Close Grip Lat Pulldown`, `Chin-Up`; `Pull-Up` carries it as a main |
| Decline Bench Press | chest(m), triceps(s) | shoulders(s) | `Decline Dumbbell Press`, `Incline Bench Press`, `Machine Chest Press` |

All five sat at 2 muscles, so BF-15's anchor rule (≥ 3) barred them exactly as it barred BF-16a's.

## Verified against production, not the local seed

Every "before" and every precedent above was read from **production** on 2026-08-25, after migration
216 had applied there. That matters twice over:

- **It confirms 216 reached production.** `Barbell Hip Thrust` reads 5 muscles there,
  `Barbell Shrug` and `Cable Chest Dips` 3. BF-16a's Known-Issues row said the migration had not run
  against production; that half is now false and is struck.
- **The five targets are still at 2 there**, and the five precedent rows still carry the muscle being
  propagated — so this is not a correction derived from a dev fixture.

## What is deliberately NOT here

The other three families. BF-16a took `Barbell Shrug` to traps + upper back + forearms and
`Barbell Hip Thrust` to five muscles **from anatomy, with no in-catalogue precedent** — so extending
that to `Dumbbell Shrug`, `Machine Shrug` and the three glute-bridge rows means making the same call
five more times unasked. A machine shrug's handles may be supported where a barbell shrug's grip is
not; a bodyweight glute bridge does not load the quads the way a loaded hip thrust does.

LA-24 is now **only** that question, `Gate: owner`, phrased in one line for an answer rather than an
implementer.

## Verified

- `catalogue-sibling-muscles-migration.test.ts` — **5 passed**: the additions, the ≥ 3 threshold,
  idempotency across three runs, the case-insensitive guard, and `Barbell Overhead Press` — the row
  that *establishes* the traps addition — asserted untouched.
- **Mutation-proven:** dropping the `lower()` fold fails the duplicate case; dropping the Arnold
  Press row fails the additions and the threshold cases.
- `pnpm check:rules` **Ran 56 of 56**. `tsc --noEmit` clean.

## Not exercised

- **Nothing on the device**, and no APK is needed — the local `exercise_library` mirror re-hydrates
  from `/api/workout-data`, the same path BF-16a's row already describes.
- **Migration 219 has not run against production.** 216 had, by the time this was written, which is
  what made the verification above possible; 219 lands on the next deploy.
- The correction is retroactive by design: `weekly-muscle-sets` reads the catalogue in a live
  subquery, so past weeks re-derive.
