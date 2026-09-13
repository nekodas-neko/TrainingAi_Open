# RV-41 — the Coach could write goal numbers the user's own screens refuse

**Branch:** `lane-a/rv41-coach-write-bounds` · **Lane A** · no migration, no native change.

## The defect

One column, two validators, and the looser one was the model's. The Coach's patch schema carried a
single `max(100_000)` across all seven numeric goal fields while the user's own routes enforced their
own limits — up to **50× tighter** on the macros. `PUT /api/nutrition/targets {"calories":26000}`
answered `400 expected number to be <=20000`; the same value through `/api/coach/apply` returned 200
and stored 26,000.

The patch schema's own comment named the case it did not catch: *"'set my calories to 26000' should
be refused by the schema rather than survive to a confirmation card that looks legitimate."* It
survived, and the card read **"Calories 0 kcal → 26,000 kcal"**.

`stepsGoal` diverged in *type* as well — `z.number().int()` on the user route, a plain number in the
patch schema — so `8000.5` was a clean 400 on one path and a 500 on the other.

## What shipped

`packages/shared/src/validation/goal-bounds.ts`: `GOAL_BOUNDS` plus `goalBoundSchema(field)`. All
three schemas build from it — both user routes and the patch schema — so the numbers exist once.
`int` lives in the bound rather than beside it, because the type divergence was half the defect.

**The numbers are the user routes' own, unchanged**, per the entry's instruction to fix the
divergence rather than pick new constants by hand.

## The one field this LOOSENS, and why I shipped it rather than asked

`stepsGoal` is the exception the entry's own table flagged: its Coach bound (100,000) was *tighter*
than the form's (200,000). Importing the form's bound therefore raises what the Coach may write.

Shipped that way deliberately. The entry's rule is one source of truth and that source is the user
routes; the 200,000 ceiling is what the owner's own screen has always allowed, so this is not new
exposure — a person could already type it. The alternative, keeping 100,000 for the Coach alone, is
exactly the "restating a bound" shape that caused the drift. **It is one line to reverse if the
owner wants the Coach held tighter**, and the entry's closing question — *"whether any Coach bound
should legitimately differ from the form's"* — is still open and is theirs.

Every other field tightens, between 3.3× and 50×.

## Two things worth carrying

**The obvious regression guard was wrong, and its being wrong is the finding.** "No bound exceeds
100,000" looks like the right assertion and fails immediately on `stepsGoal`. A value assertion here
would have to carve out that exception and would then be pinning the numbers rather than the thing
that actually broke — two schemas each matching its own copy. The guard is a source check instead:
`patch.ts` must declare no numeric bound of its own.

**`check-numeric-bounds.js` matches per line**, so `const base = z.number(); return base.max(…)`
reads as unbounded to it. The helper carries `.min`/`.max` in both branches rather than chaining onto
a shared base — duplication that is load-bearing, noted in the code. The same line-scoping bit the
test: `100_000` appearing in a *comment* failed the source guard until it stripped comment lines.

## Verification

28 tests. Mutation pass: the calories bound restored to 100,000, `int` dropped from `stepsGoal`, and
`patch.ts` restating its own bound — **three mutants, all killed**; an equivalent control
(`min`/`max` → `gte`/`lte`) survived.

Driven against `pnpm dev`: `calories` 26,000, `proteinG` 5,000 and `waterGoalMl` 50,000 now answer
**400** through `/api/coach/apply` where they previously stored, and `stepsGoal` 8,000.5 answers 400
where it previously 500'd. Legitimate writes still land — `calories` 2,400 → 2,500 and `stepsGoal`
12,000 → 150,000 both returned 200 and read back from Postgres. The user routes are unchanged: 400
for over-bound, 200 for legitimate.

## Not exercised

No device path and no APK — schema validation on server routes.
