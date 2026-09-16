# 2026-09-16 — Lane A · LA-114: the stress bucket column never held a bucket start

**Branch:** `lane-a/la114-stress-bucket-mid` · **Migrations 275 + 276** · no version bump (nothing
user-visible changes; the chart renders the same points)

`oura_daytime_stress_buckets.bucket_start` holds the bucket's **midpoint**, and has since the table
was created. `daytimeHrvEstimatesPerBucket` returns `t = bStart + bucketMs / 2`, `scoreStressPoints`
carries `t` through, and `run.ts` writes `new Date(p.tMs)` straight into the column — so stored
timestamps sit on a `:15`/`:45` grid.

**Migration 212's own header is where the mistake is written down:** *"`bucket_start` is stored as
timestamptz (the bucket's own start instant, from the series' `t`)"*. The series' `t` is not the
start. The column was named for what its author believed `t` was.

## Rename, not re-stamp

The stored value is **not wrong**. A midpoint is a legitimate representative of a 30-minute bucket,
and the one consumer — the stress-day chart — plots it as a point in time, which is correct either
way. Only the name lies. Shifting 672 rows back by 15 minutes would move a chart that is currently
right in order to fix a string, and would be a data migration rather than a reversible rename.

The harm being removed is specific and already realised: a join written the obvious way, matching
these timestamps against another 30-minute series on the epoch grid, returns **zero rows** — which
reads as "no overlapping data" rather than "the join is 15 minutes out". It cost an hour during
TN-39's validation earlier the same day. A comment would not have prevented it; a name is what a
query gets written from.

## Two migrations, because a rename does not reach the view

**275** renames the column. **276** regenerates the `claude_ro` views, because a base-table
`RENAME COLUMN` does **not** rename a dependent view's output column — Postgres re-resolves the
reference and keeps the view's original alias. Without 276 the table would say `bucket_mid` while
`claude_ro` still said `bucket_start`, which is the same lie with an extra step, and every analysis
query runs against the view.

276 was generated, not hand-written (`scripts/generate-claude-ro-views.js`, which reads the live
local schema — so 275 had to be applied locally first). Verified the way 274's header prescribes:
diffed against 274, and the two differ by **exactly one line**. `oura_bucket.bucket_start_ms` /
`bucket_start_ds` are a different table and were deliberately untouched.

## What the rename did and did not sweep

`bucketStart` is a legitimate name elsewhere and was left alone: the device-comparison harness
(`lib/health/device-comparison.ts`, `lib/oura-comparison-harness*.ts`) buckets at
`floor(t / width) * width`, so its `bucketStart` really is a start.

**One place already knew.** `lib/oura-comparison-harness-adapters.ts:82` converts a dHRV estimate
back with `new Date(e.t - HRV_BUCKET_MS / 2)` — the harness had the semantics right the whole time;
it was the persistence path that got them wrong.

**The one reference a typecheck cannot see** was a raw `INSERT` in
`app/api/body-battery/__tests__/lb102-stress-day-read.test.ts`, naming the column in SQL text. That
is the shape that passes `tsc` and fails in CI. Found by grepping for the string rather than
trusting the compiler.

## Verification

- Migration applied to the local dev Postgres and the column confirmed renamed, primary key
  included (`(user_id, bucket_mid)`).
- **The DB-backed tests really ran**, not skipped: `daytime-stress-buckets.test.ts` and
  `lb102-stress-day-read.test.ts` — **14 tests** against the migrated local Postgres through real
  SQL, which is what actually exercises the renamed column and the fixed raw `INSERT`.
- `pnpm test` **924 files / 8770 tests** green. `pnpm check:rules` **75 of 75** — it caught the
  backlog's "next free migration" pointer still reading 275. Typecheck and lint clean.
- `pnpm dev`: `/api/body-battery/stress-day` and `/api/body-battery` compile and 401 unauthenticated.

**Not exercised.** No authenticated request and no rollup pass — the sandbox cannot mint a session,
and the rollup's stress step needs vendored constants it does not have. `db-snapshot-integration.test.ts`,
which is what would catch a stale `claude_ro` view, **skips locally even with `DATABASE_URL`** (it
needs the `claude_readonly` role, which the local setup does not create), so CI is the only place
migration 276 gets checked. No device, no APK.

**Deploy note:** a rename is not backwards-compatible with code already running. Railway applies
migrations on cold start, so there is a brief window where an old replica querying `bucket_start`
would error. It is reversible (`RENAME COLUMN bucket_mid TO bucket_start`) and drops nothing, and
the only writer is the rollup, which rewrites a failed day on its next pass.
