# 2026-08-02 — stop the redecode pass rewriting rows it isn't changing (Q-46)

**Branch:** `fix/oura-raw-samples-restamp-guard` · **Version:** 1.250.6 · Follows
[run 1](../../handoff-2026-08-02-platform-batch-queue-drain-run-1.md); Q-46 was filed during that
run, when Q-35 was measured and retired.

## What was wrong

`redecodeOuraRawSamples` re-stamps `measured_at` over every row in each 500-row page with no
condition on whether the value is actually changing. `measured_at` is indexed
(`idx_oura_raw_samples_user_measured`), so an UPDATE that writes back the value already there
**still cannot be a HOT update** — it rewrites an entry in all four of this table's indexes.

Production, measured 2026-08-02:

```
n_live_tup   740,966
n_tup_upd  1,324,792
n_tup_hot_upd     19
```

1.3 million updates, nineteen of them HOT. `oura_raw_samples` is 452 MB — 146 MB heap and
**306 MB of indexes** — against ideal key widths of ~49 MB for the dedup index (actual 99 MB) and
~28 MB for `user_measured` (actual 107 MB). Roughly **130 MB of that is bloat**, and every redecode
pass made more.

## What shipped

One `AND measured_at IS DISTINCT FROM <the same expression>` on the UPDATE. That is the whole fix.

`redecodeOuraRawSamples` now also returns `restamped` — the count of rows whose `measured_at`
genuinely changed — alongside `scanned` and `updated` (which counts `event_name` corrections, a
different thing). Without it the function reported nothing about the work that was causing the
damage, and there was no way to observe the guard holding.

## Verified

Four DB-backed assertions, and the one that matters is the second pass:

- 40 rows seeded with a wrong `measured_at` → first pass re-stamps **40**, second pass re-stamps
  **0**. Before the guard the second pass was 40 again, every time, forever.
- The correction itself still works: the row sitting exactly at the anchor carries the anchor's
  wall-clock time.
- Moving the anchor re-stamps all 40 again and then settles to 0 — so the guard suppresses only
  no-op writes, never a real correction.

**The test was checked against the un-fixed code.** Reverting the `IS DISTINCT FROM` clause fails
two of the three assertions with `expected 40 to be 0`; restoring it passes. A guard test that
passes either way would be worthless.

## What this does not do

**It stops the bloat growing; it does not remove the 130 MB already there.** That needs a one-time
`REINDEX TABLE CONCURRENTLY oura_raw_samples`, which is a Railway-console action and is on the
owner checklist. The order matters little, but doing the REINDEX without this guard would just
refill.
