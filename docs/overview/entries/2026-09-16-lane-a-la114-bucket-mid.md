# 2026-09-16 — Lane A · LA-114: the rename that cannot happen, and what was done instead

**Branch:** `lane-a/la114-stress-bucket-mid` · **Migration 275 (a column comment)** · no version bump

`oura_daytime_stress_buckets.bucket_start` holds the bucket's **midpoint**, and has since the table
was created. `daytimeHrvEstimatesPerBucket` returns `t = bStart + bucketMs / 2`, `scoreStressPoints`
carries `t` through, and `run.ts` writes `new Date(p.tMs)` straight into the column, so stored
timestamps sit on a `:15`/`:45` grid. Migration 212's own header is where the mistake is written
down — *"the bucket's own start instant, from the series' `t`"*.

## The rename was written, applied, pushed, and reverted

CI's **Migration Check** rejected it, and it was right to. The job's second step replays every
migration against a schema that already has everything (LA-13). A rename fails that twice over:

1. **`ALTER TABLE ... RENAME COLUMN` is not idempotent** — on replay the old name is gone. Fixable
   with an `information_schema` guard.
2. **The one that is not fixable:** every historical `claude_ro` view migration — 213, 215, 218,
   221 … 274 — contains `SELECT ... t.bucket_start ... FROM public.oura_daytime_stress_buckets`,
   because each regenerates the **full** view set. After a rename, all of them fail on replay.

Making them pass would mean editing already-applied migrations, which `ensureSchema` makes
meaningless — it tracks by **filename**, so an edited file is skipped forever and the change never
lands.

**There is an escape hatch, and taking it would have been wrong.** `migrate.js` has a
`REPLAY_EXEMPT` map, and its single entry exists for exactly this: *"002 renamed the column its
`cardio_sessions` FK references"*. So the repo has done one rename, and it cost an exemption. Doing
it here would mean exempting **a dozen** generated view migrations from the check that just caught
this — hollowing out the check to land a cosmetic fix.

**The general rule, which is the finding worth keeping:** in this repo, a column an earlier migration
names by hand cannot be renamed without exempting every such migration from the replay check. That is
a property of the migration model, not of this column.

## What shipped instead

- **Migration 275 is a `COMMENT ON COLUMN`** — idempotent, names no column a historical migration
  would stop finding, and makes the database self-describing to `\d+` and `pg_description`. It
  carries the full reasoning above so the next person does not re-attempt the rename.
- **The Drizzle property is `bucketMid`**, mapped to the `bucket_start` column, and every TypeScript
  reader now says `bucketMid` — the slice, the adapter, the repository interface, `RollupIO`, the
  rollup, the stress-day route and the admin device-comparison route.
- Nothing is re-stamped. The stored value is not wrong: a midpoint is a legitimate representative of
  a 30-minute bucket and the chart plots it as a point in time.

## ⚠ The gap this leaves, stated plainly

**`claude_ro.oura_daytime_stress_buckets` still exposes `bucket_start`, and that read surface is
where the defect actually bit.** A join written the obvious way, against another 30-minute series on
the epoch grid, returns **zero rows** — which reads as "no overlapping data" rather than "the join is
15 minutes out". It cost an hour during TN-39's validation earlier the same day, and a TypeScript
property name does nothing for a SQL query. **Adding the 15 minutes is the caller's job.**

So **LA-114 goes back in the queue**, re-scoped: the naming defect is documented, not fixed, and the
entry now names the constraint so nobody re-attempts the rename.

**One option deliberately not taken:** teaching `generate-claude-ro-views.js` to alias the column
(`t.bucket_start AS bucket_mid`) would fix the read surface and be replay-safe, since the base table
keeps its name. It was rejected because it makes `public` and `claude_ro` disagree about a column's
name — introducing a second naming confusion to fix the first. Recorded in the entry as a live
option rather than dismissed, because it is the only idea so far that reaches the surface that
matters.

## What the rename attempt did leave behind, correctly

`bucketStart` is accurate elsewhere and was left alone: the device-comparison harness
(`lib/health/device-comparison.ts`, `lib/oura-comparison-harness*.ts`) buckets at
`floor(t / width) * width`. **One place already knew** —
`lib/oura-comparison-harness-adapters.ts:82` converts a dHRV estimate back with
`new Date(e.t - HRV_BUCKET_MS / 2)`. The harness had the semantics right the whole time; the
persistence path did not.

## Verification

- **The failure was reproduced and the fix shown passing**, on a throwaway database built the way CI
  builds one: apply all migrations (275 applied, 0 failed), `TRUNCATE schema_migrations`, replay
  (274 applied, 001 replay-exempt, **0 failed, exit 0**). That is Migration Check's two steps.
- `pnpm test` **924 files / 8770 tests** green. The DB-backed stress tests
  (`daytime-stress-buckets.test.ts`, `lb102-stress-day-read.test.ts`, **14 tests**) ran against real
  Postgres, exercising the Drizzle property against the unchanged column.
- `pnpm check:rules` **75 of 75** — it caught the backlog's migration pointer twice, first at 275
  when two migrations were added and again at 277 when they were withdrawn. Typecheck and lint clean.

**Not exercised:** no authenticated request, no rollup pass, no device. `db-snapshot-integration.test.ts`
skips locally, but with no view migration in this PR there is nothing for it to check.

## The lesson worth carrying

The first version of this was written, validated locally, and pushed — and the local validation
never replayed the migrations. `pnpm test` and `check:rules` both passed on a database where the
rename had already been applied once. **A migration is not tested until it has been applied twice to
the same database**, and this repo's CI does exactly that, which is why it caught it and the sandbox
did not.
