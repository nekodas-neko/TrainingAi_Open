# 2026-09-16 — Lane A · BF-13/TN-6/Q-506/TN-8: a re-derivation for the zero-seeded baselines

**Branch:** `lane-a/bf13-tn6-baseline-seed` · **Batch:** `temperature-baseline` (4 entries)

## What this is

The `temperature-baseline` batch has been half-shipped since 2026-08-25. The *seed* was fixed then
(`seedOrUpdateBaseline`, Q-6): a fold that cold-starts now takes its mean from the first sample
instead of annealing toward it from zero. What that fix cannot reach is the **stored** baselines —
`computeDailySummaries` resumes from the previous night's persisted checkpoint, so the zero-folded
state is inherited forward every night, indefinitely. All four entries' pass tests were waiting on a
re-derivation that had never been run.

Measured in production before writing anything (`claude_ro`, so the owner's rows only): the
temperature baseline read **35.578 °C at n=62** and **35.658 at n=72**, still climbing toward nightly
values of 35.72–36.04, with `temp_dev_c` positive on **10 nights out of 10** and a baseline sd of
**1.41 °C** against a real spread near 0.1. That is the same defect the entries measured in August,
three weeks after the seed was fixed — which is the evidence that the seed fix does not reach stored
state.

## What shipped

`POST /api/admin/rederive-baselines` — admin-gated, rate-limited, `dryRun` by default. It reads the
nights already in `oura_daily_summary`, replays the fold cold (`seed = null`) through
`computeDailySummaries` — the same function the rollup folds with, so no formula is restated — and
rewrites the temperature baseline and `temp_dev_c` on the rows that differ.

**Only temperature is written.** That is the owner's 2026-08-24 decision: fix the seed for all six
metrics, re-derive only the ones measurably wrong. Temperature was the only one out by more than
noise (gap +2.80 nightly sd, above baseline on 100% of nights); the other five sat between −0.09 and
+0.28 sd. They are still recomputed and **reported**, so a later measurement that flips one has the
number in front of it, and they are written back unchanged — asserted on every written row.

## Why a route and not the Redecode the entries named

A full-history Redecode also re-derives: post-seed-fix it folds `seed = null` and replaces the table.
Three differences decided it.

1. It re-decodes every stored sample and rewrites the **nightly values** too. The owner's decision
   turns on the re-derivation touching a corrupted *intermediate* and leaving the raw nightly values
   alone — which is what makes it a different act from re-scoring history. This route is that act
   exactly.
2. It has **no dry run**. This one reports the full before/after per night without writing.
3. It needs the vendored decoder constants. TN-8 recorded that as the reason a Redecode "could not be
   run from a sandbox"; **that note needed a correction** — `lib/oura-models/constants/` is delivered
   at boot in production, so a Redecode *is* runnable there. The sandbox was the only blocker. This
   route needs no decoder at all, which is a smaller claim than the entry implied but still the
   reason it works where those constants are absent.

## The honest gap: illness scores are not re-stamped

Q-506's own metric does **not** move when this runs. `illness_score` / `illness_flag` live on
`oura_daily_derived` and are written by the rollup's `illness_radar` step alone — and despite a
comment in `rollup/run.ts` saying the readiness route computes illness live, `illnessFromSummaries`
has exactly one caller and it is that step. So a stored illness score keeps the z it was computed
with until a rollup pass rewrites that night, and the incremental rollup only covers the recent
window. Recorded in Q-506's `Keep:` rather than fixed here — re-stamping illness is the rollup's job,
not this route's.

## TN-8's pass test, half-converted

TN-8 asked for its premise to be asserted "in the same test that covers BF-13's re-derivation". Done
for the half a fixture can carry: against a zero-seed baseline **every** scored night's deviation is
positive, and after the cold re-fold they straddle zero with none above `TEMP_DEV_FEVER_LIMIT_C`.

The other half cannot be faked. The fixture is realistic — its zero-seed baseline lands on **35.464**,
the same value BF-13 measured in production — but its deviations peak at **0.671**, not the **1.33**
the owner's history reaches. It reproduces the sign bias, not the six nights that cross 1.0. That
measurement needs the run.

## Verification

- `pnpm test`: **924 files / 8765 tests** green (with `DATABASE_URL` set, so the DB-backed files
  actually ran rather than skipping).
- `pnpm check:rules`: **Ran 75 of 75**.
- Typecheck and lint clean (0 errors).
- **Mutation pass, 7 mutants, all killed**: write-every-row-unconditionally, push-the-recomputed-row-
  wholesale, `dryRun` failing open, warm-seed instead of cold, rate-limit removed, `nHistory`
  "repaired", and `temp_dev_c` left stale. **Equivalent control** (a wider `HISTORY_FLOOR`) stayed
  green.
  Two of those are worth naming. The control case — a history already folded with the correct seed
  must produce **zero** writes — is the only test that catches write-every-row. And the stale
  `temp_dev_c` mutant **survived the first pass**: a route that corrects the baseline but writes back
  the deviation computed against the old one fixes nothing any consumer can see, and every other
  assertion passed while it did. A test was added for it.
- `pnpm dev`: route compiles and returns 401 unauthenticated, with and without `?dryRun=false`.

**Not exercised.** The admin-authenticated path and the write itself never ran: the sandbox cannot
mint an admin session (Google OAuth), so the repository is a stand-in in every test and **no
production row was touched**. Nothing here says the owner's stored history has the shape the entries
measured — that measurement is theirs, taken through the admin read endpoint, and is not re-derived
here. No device, no native SQLite, no Oura hardware; the route is server-only and needs none.

## What is owed

The run. It is a production data write, so it was deliberately not fired from here. Recommended
order: dry-run first to read the size of the change, then `?dryRun=false`. All four entries stay in
the queue with `Keep:` lines, because every one of their pass tests is measurable only afterwards.
