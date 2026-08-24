# 2026-08-24 — the AMRAP band correction now applies to unprescribed high-rep sets (Q-304)

**Branch:** `claude/implementation-lane-a-setup-p3f5zk` · **Lane A** · no migration, no APK.

`amrapScaleFactor` (0.97 at 6–8 reps, 0.93 at 9–12, 0.88 at 13–20, 0.82 at 21+) exists to correct
for AMRAP-set formula inflation and was already applied by `calcAmrap1RM` for bodyweight/baseline
sets — but `estimateOneRm`'s ordinary path calls `calculate1RM`, which never applied it. Measured
against production: 29 sets at 13+ reps fed the 1RM estimate un-discounted, and — the qualifier the
entry asked to check first — only 1 of those 29 carried a progression style, so
`prescriptionFactor` (the other correction) wasn't absorbing the inflation for the rest.

## What shipped

`prescriptionFactor` now returns `null` instead of `1` when no style prescribes a set (a real
prescription can legitimately resolve to exactly 1, so the two cases need to be distinguishable).
`calculate1RM` falls back to `amrapScaleFactor(reps)` when there's no prescription — an
unprescribed set is an AMRAP set by construction, so it gets the same discount an explicit AMRAP
set already got. A prescribed set is unaffected; the two corrections never combine (that would
deflate the estimate, the mirror of the bug being fixed).

## The blast radius is wider than the entry's headline

The entry measured 13+ reps specifically, but `amrapScaleFactor` also discounts 6–12 rep sets
(0.97 / 0.93) that carry no style — those were silently getting the same un-discounted treatment
and are now corrected too. This is the right scope: `amrapScaleFactor` is banded by design and a
13+-only patch would have been an arbitrary carve-out of a formula that already covers the whole
range. Three existing tests had hardcoded expected values from the old (un-discounted) behaviour
and needed updating — caught by running the full suite, not by reasoning about it in advance.

## What's deliberately not done

`personal_records` (30 rows) was written from the old formula. Recomputing them edits training
history and needs the owner's say-so — split off as **Q-304b**, `Gate: owner`, same shape as
Q-298's historical zero-1RM rows.

## Verified

- New tests: fallback-to-AMRAP-scaling when no style, the 13/20/21-rep cases, and an explicit
  no-double-correction case against a real prescription — `packages/shared/src/__tests__/1rm.test.ts`.
- Three existing tests updated with correct new expected values, derived by hand-computing the
  same arithmetic `calculate1RM` performs (a naive `toBe(calcAmrap1RM(...))` comparison fails at
  13 reps specifically — double rounding vs single rounding differ by 0.25 there — so the test
  expectations are computed the same way the implementation computes them, not against a
  differently-rounded sibling function).
- Full suite: 567 test files passing, 4663 tests, 2 pre-existing failures unrelated to this change
  (missing `qrcode`/`@sentry/nextjs` packages in this sandbox's `node_modules`).
- `pnpm check:rules` — 55 of 55.
- `tsc --noEmit` clean.

**Not exercised:** production — the corrected formula only affects sets logged (or estimates
recomputed) after this deploys; nothing device, native, safe-area or offline is touched.
