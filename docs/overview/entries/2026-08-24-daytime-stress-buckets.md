# The daytime-stress buckets are persisted (TN-3a) — storage and write only

**Branch:** `feat/daytime-stress-buckets` · **Lane A** · migrations 212, 213

## Why

The owner asked to see *"what days/hours cause most stress"*, and nothing could answer it.
`buildDaytimeStressSeriesFromModel` produces a 30-minute bucket series on [−1,+1];
`summarizeStressDay` reduces it to three daily scalars and those are all that reached storage. The
series existed only inside the `/api/body-battery` response, for today, wake → now.

The daily scalars cannot substitute. Measured across 31 production days: 22 carry high-stress
minutes (mean 50/day, max 180), so the signal is real — but the daily aggregate is compressed to a
range of **−0.14 … +0.23** (sd 0.100) on a [−1,+1] scale. The information is in the buckets.

## What shipped

- **Migration 212** — `oura_daytime_stress_buckets` (`user_id`, `day`, `bucket_start`, `level`).
  Rows, not a JSONB array on `oura_daily_derived`, because the read aggregates *across* days by hour
  of day. `bucket_start` is the instant rather than an hour-of-day integer: the hour must be derived
  in the user's timezone at read time, and baking a local hour in would freeze it against a timezone
  change. ~32 buckets per waking day, ~11.7k rows/year.
- **Migration 213** — regenerated `claude_ro` views (85 → 86). The schema is default-deny, so a new
  table is unreadable until the generator re-runs, and `claude-ro-readonly-role.test.ts` fails on
  the table/view count divergence. A new migration number rather than editing 211, because
  `ensureSchema` tracks by filename and an edited applied file is skipped forever.
- **The write** rides the rollup's existing per-day series build, through `io.replaceStressBuckets`.

**The two-baselines hazard is settled as the entry asks: the rollup is the sole writer.** The live
route builds the same series from `restingHr` + a 28-day HRV mean, the rollup from
`latest.rhrLowBpm` + `nightHrvMs`. Persisting both would put two numbers behind one metric. The
rollup wins because it is the only one that can back-fill.

Whole-day **replace**, not merge: the series is recomputed as a unit, so a re-run producing fewer
buckets must shrink the stored day rather than leave stale ones merged in beside the new, where they
would read as real stress.

## A correction I nearly shipped

The write's `setWhere` user-scope went in with a comment claiming it prevented cross-user overwrite,
and a test claiming to prove it. **It does neither.** The primary key is `(user_id, bucket_start)`,
so one user's insert cannot conflict with another user's row — removing the line left all six tests
green. Both the comment and the test now say what is true: the line is redundant insurance against
the key ever narrowing, kept per CLAUDE.md's `onConflictDoUpdate` rule, and the cross-user test
catches a narrowed key rather than a missing scope.

Found the same way as the vacuous test in TN-4: by deleting the thing and checking the tests notice.

## Verification

Six DB-backed tests, and the two load-bearing ones are **proven by mutation** — removing the
day-clearing delete (turning replace into merge) fails them with `expected length 1, got 3` and
`expected 0, got 1`.

- `claude-ro-readonly-role.test.ts` — 23 pass, including the table/view parity check.
- Rollup + Postgres suites: 854 pass.
- Full suite: 4718 passed, 51 skipped, 2 pre-existing unrelated failures (missing `qrcode`).
- `pnpm check:rules` — Ran 55 of 55. `tsc --noEmit` and `pnpm lint` clean (lint added to my local
  gate after it caught a `prefer-const` in #417 that `check:rules` and vitest both missed).

## Not exercised — the entry stays open

1. **No back-fill has been run and its depth is unknown.** The write rides the rollup, so a wide
   pass will fill history from `oura_raw_packed` — but **the rollup cannot execute in this sandbox
   at all**, because it needs the vendored constants Q-49 removed from the repo. So no bucket has
   ever been written by the real producer. The storage layer is proven end to end against real
   Postgres; the producer is not. The entry asks for the achieved depth to be stated, and it cannot
   be until a pass runs on Railway.
2. **The route still computes its own series for today** rather than reading through — deliberate,
   since changing a working Body Battery read belongs with TN-3b, which is what needs a consistent
   read across days.
3. **TN-3b is blocked on a back-fill existing**, not merely on the table existing.

Nothing here was seen on device, and `pnpm dev` could not be run (missing `@sentry/nextjs`).
