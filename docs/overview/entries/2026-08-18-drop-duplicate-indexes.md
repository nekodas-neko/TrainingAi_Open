# 2026-08-18 — seven pairs of byte-identical indexes (Q-550)

**Lane A** · branch `perf/redundant-duplicate-indexes` · migration **198** · no Kotlin, no APK.

The entry asked about one table: `oura_heartrate`, 34 MB with **6.8 MB of heap under 27 MB of
indexes**. Re-measuring against production found something better than the entry's lead — and found
it structurally, which matters, because the entry rightly distrusts its own scan counts (the
counters were reset by the 2026-08-17 crash recovery, so a fresh zero means "not since then", not
"never").

`oura_heartrate_user_ts` is not merely unused. It is **byte-identical** to
`oura_heartrate_user_id_timestamp_key`: same columns, same order, same sort options, no partial
predicate. Comparing `pg_index.indkey` / `indoption` / `indpred` across every table in the database
turned up **seven such pairs, ~10 MB**:

| dropped | size | survivor |
|---|---:|---|
| `oura_heartrate_user_ts` | 7696 kB | `oura_heartrate_user_id_timestamp_key` |
| `rr_intervals_user_at` | 2464 kB | `rr_intervals_user_id_at_key` |
| `idx_body_metrics_user_date` | 40 kB | `idx_bm_user_date` |
| `idx_workout_sessions_user_started` | 16 kB | `idx_ws_user_started` |
| `idx_ps_program_pos` | 16 kB | `program_sessions_program_id_position_key` |
| `idx_body_battery_daily_user_date` | 16 kB | `body_battery_daily_user_id_date_key` |
| `coach_messages_thread_position_idx` | 16 kB | `coach_messages_thread_id_position_key` |

Where a pair is unique/non-unique the unique one survives — it backs a constraint and cannot be
dropped anyway. Where both are plain (`body_metrics`, `workout_sessions`) the **001-lineage** name
survives, because later migrations still maintain it (174 recreates `idx_bm_user_date`, 002
recreates `idx_ws_user_started`) while nothing has touched 087's copies since it added them.

## Where two of them came from, and why it was a reasonable mistake

`087_composite_indexes.sql` says so itself:

> *"body_metrics: user data sorted by date (separate from unique(user_id,date) which has no DESC)"*

That reasoning is correct — a DESC index genuinely is not the ASC unique one. The DESC index it
wanted just already existed, created by `001_initial`. It duplicated 001, not the constraint. Two of
087's four statements were already-present indexes.

## Five deliberately left alone

`idx_bm_user_date`, `idx_oura_daily_user_date`, `oura_daily_summary_user_date_idx`,
`oura_daily_derived_user_day_idx` and the surviving `body_metrics` index all cover the same columns
as a unique index but carry **DESC** on the second column where the unique index is ASC.

Backward scanning does work — the local `EXPLAIN` for `ORDER BY at DESC` on `rr_intervals` picks
`Index Scan Backward` off the ASC unique index — so dropping them is probably sound too. The reason
they stay is not that it fails; it is that they are **128 kB combined**, so proving it properly buys
a rounding error.

## Verified

Migration applied locally: 0 of the 7 remain, all 7 survivors present. With `enable_seqscan=off`,
every representative query plans onto its survivor:

```
oura_heartrate       Index Scan using oura_heartrate_user_id_timestamp_key
rr_intervals         Index Scan Backward using rr_intervals_user_id_at_key
workout_sessions     Index Scan using idx_ws_user_started
program_sessions     Index Scan using program_sessions_program_id_position_key
body_battery_daily   Index Scan using body_battery_daily_user_id_date_key
```

No code references any of the dropped names (`schema.ts` declares no indexes at all), so nothing but
the planner ever knew they existed.

Production already prefers the survivors: `oura_heartrate_user_id_timestamp_key` had **3321** scans
against `user_ts`'s **44** in the same window.

## Reversible

Every drop is one `CREATE INDEX` away and the definitions are in the migrations named in 198's
header. No data is touched, and no row is read or written.

## Not exercised

Production — the migration lands on the next deploy. The reclaimed space appears as the indexes are
dropped; no `VACUUM FULL` is needed for an index drop, unlike the heap bloat in Q-534.

## Still open on `oura_heartrate`

`oura_heartrate_pkey` (4272 kB, 0 scans since recovery) on a table that already has a unique
`(user_id, timestamp)`. Dropping a primary key is a different class of change from dropping a
duplicate — it needs an FK check and is reversible only by rebuilding — and its zero is a
six-hour-old counter, so it is deliberately not in this PR. `oura_heartrate_user_updated` (9104 kB,
0 scans) stays for the reason the entry gives: migration 130 added it for Track-B sync, which is not
wired yet, so its zero is expected and correct.
