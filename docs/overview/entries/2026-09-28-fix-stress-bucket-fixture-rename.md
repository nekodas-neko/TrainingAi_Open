# 2026-09-28 — the two stress E2E fixtures follow `LA-114`'s column rename

**Lane B.** Branch `fix/stress-bucket-fixture-rename`. Test-only; no product code, no version bump.

## What shipped

`e2e/tn35-stress-against-events.spec.ts` and `e2e/tn3b-stress-on-hr-chart.spec.ts` now `INSERT` into
`oura_daytime_stress_buckets.bucket_mid` instead of `bucket_start`, in both the column list and the
`ON CONFLICT` target.

`LA-114` renamed that column earlier the same day (migration `202609280647_rename_stress_bucket_mid.sql`)
because it had **always** held the bucket's midpoint — `t = bucketStart + bucketMs / 2` — so a join
written against an epoch-aligned 30-minute series landed 15 minutes out and returned nothing. The
rename swept the schema, the adapter, the rollup IO and the two routes. It did not sweep the two E2E
fixtures that write the column directly in SQL, so both files died in `beforeAll` with
`column "bucket_start" of relation "oura_daytime_stress_buckets" does not exist` before reaching an
assertion. This is the sibling-surface half of that rename.

## How it was found, which is the part worth keeping

Not by reading the diff — by reading the **CI log of the run I had already merged**. `LA-176` (#1893)
cleared six always-red specs, and auto-merge fired on the five required checks while the advisory E2E
job was still running, so I noted in that PR that I had never seen CI confirm the six. Polling it
afterwards produced the verdict, and the `bucket_start` error was in the Postgres output underneath
two spec failures I had assumed were mine to explain.

Both stress failures are **deterministic**, not flaky. That distinction is the reason this got its own
fix rather than a line in the flake entry: they would have inflated `LB-178`'s flake rate by 40% and
aimed that investigation at test ordering, which is not where they live.

## Verified

- The exact patched fixture statement, upsert path included, executed against the local DB:
  `INSERT … (user_id, day, bucket_mid, level) … ON CONFLICT (user_id, bucket_mid) DO UPDATE`. The PK is
  `(user_id, bucket_mid)`, so the conflict target matches the index it infers.
- `npx tsc --noEmit` clean · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors (831 warnings,
  inside the standing band) · `check-test-typecheck` none above baseline · full `pnpm test` green.

**A bare rename was checked for semantics rather than assumed to be safe.** The column means a
midpoint, and both fixtures write `:00`/`:30` grid times, which is *not* where a real midpoint lands
(`:15`/`:45`). That is deliberate and moves no assertion here: the consumer
(`/api/body-battery/stress-day`) maps `bucketMid.getTime()` straight to `t` with no shift, so the
fixture writes and the route reads one value; tn35's event at 07:30 sits inside the middle bucket on
either reading; and tn3b only asserts the legend renders when measured points exist. Re-anchoring the
fixtures to `:15`/`:45` would have changed their meaning beyond the rename for no gain, so it was not
done. A comment in each file records this.

**Not exercised:** neither spec was run end-to-end locally — E2E needs a built app and the full suite
is ~36 min on one worker. The failure fixed is a SQL column that does not exist, which the statement
test above reproduces and clears exactly; CI's E2E job is the confirmation, and it is advisory.

## Also in this PR

`LB-178` gains its **first full-CI census** (run `36396363930`): 257 passed, 5 failed, 6 flaky,
1 skipped, 3 did not run, **36.3 min**. Its own stated first step was a repeat-run census, and this is
one taken against CI rather than locally, where the order-sensitivity cannot reproduce. Three readings
from it:

- `food-log-swipe-delete:238` failed in CI exactly as in two of three local runs — the most
  reproducible of the set, and where that entry should start.
- `diary-nested-meal` is new to the list and appeared on two lines at once (`:231` hard, `:197`
  flaky); `:231` already had history in the backlog under runs #1280 and #1377.
- At 36.3 min the suite finished **under** `LB-166`'s 45-minute cap, which it had been hitting. Six
  specs each burning a timeout before failing were most of the difference, so `LA-176` bought back
  roughly the margin the cap was eating.

`or162-canvas-census:30`'s failure is noted there for completeness and left to `OR-162`, which already
records that the census reads 0 canvases in the harness and that the harness cannot answer its
question.
