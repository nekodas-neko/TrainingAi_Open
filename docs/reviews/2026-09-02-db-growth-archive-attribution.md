# The database's growth is partly the archive the baseline was measured before (BF-55, Q-283)

**Date:** 2026-09-02 · **Agent:** Implementation Lane A · **Entries:** BF-55, Q-283

BF-55 asks for two things: a re-read of the total (*"it has not been read since 2026-08-30"*) and an
answer to *"what is adding ~2.5 MB/day more than expected"*. This provides the first, and attributes
a little over half of the excess to something that must not be treated as a defect.

## The re-read

| when | total | source |
|---|---|---|
| 2026-08-18 | **171 MB** | the post-packing baseline (CLAUDE.md) |
| 2026-08-30 | **206 MB** | BF-55 |
| **2026-09-02** | **200 MB** | this read |

The drop from 206 is migration 249 landing on 2026-09-01, which removed the 21 MB
`oura_heartrate_user_updated`. Verified gone: `oura_heartrate` now carries exactly two indexes, the
`(user_id, timestamp)` unique key at 84,909 scans and its primary key.

## The attribution — and why it is not a defect

`oura_raw_packed`, the permanent frame archive, holds **1,072 rows / 18 MB of blob**, and its first
pack is dated **2026-08-18** — *the same day as the baseline*. So it has grown **18 MB in 15 days,
or ~1.2 MB/day**, and it is never pruned: `body_hex` is the archival source of truth and CLAUDE.md
forbids pruning or mutating the server copy.

That is roughly **62% of the 29 MB the database has gained since the baseline**, and it means the
**~0.4 MB/day expectation cannot have included it.** The packing work that produced the 171 MB
figure created a new permanent writer on the same day, at a rate nothing had yet observed. Part of
the "7× trend" is an expectation that was never re-baselined against the archive it made possible.

The trade is working as designed: `oura_raw_samples` holds a rolling window (min→max
`ring_timestamp_ds` spans **7.58 days**, 189,406 real rows, 73 MB) while the archive takes the
overflow at about an eighth of the raw size. Projected forward, 1.2 MB/day is **~440 MB/year** of
permanent archive on a 5 GB volume, at Railway's $0.15/GB/month.

**Still owed, and BF-55 keeps it:** the remaining ~0.7–1.7 MB/day depending on the window. This
narrows the search rather than closing it, and the archive should be excluded from the next attempt
rather than counted again.

## Q-283 — its named candidate is gone, and the remainder is 800 kB

Q-283 is headlined *"~11 MB of indexes have never served a scan"*. Re-measured today:

- **Its one real candidate, `oura_heartrate_user_updated` (5.7 MB), no longer exists** — BF-55's own
  index half took it in migration 249. The entry has not been updated to say so.
- Zero-scan indexes in total: **117, at 7,528 kB**. But excluding primary keys and unique
  constraints — which BF-55 warns read 0 while being consulted on every insert, and which the entry
  itself says must never be dropped — what is left is **30 indexes totalling 800 kB**, the largest
  a 128 kB `db_query_log_created_at_idx`.

So the entry as written would send an implementer to write a destructive migration for **0.4% of the
database**. That is a recommendation to close or downgrade it, not to implement it.

**One reading that strengthens the caveat rather than weakening it:** `pg_stat_database.stats_reset`
is **NULL**, so these counters have never been reset and cover the database's lifetime. That makes
"never scanned" a stronger claim than the entry assumes — and it still does not make a constraint
index droppable, which is the whole point. BF-55's counter-example holds today: `rr_intervals_pkey`
read 0 on 2026-08-30 and reads **10,930** now.

## A recurrence worth recording

`pg_stat_user_tables.n_live_tup` reported **76** rows for `oura_raw_packed` against **1,072** from
`count(*)` — a 14× understatement, on a table whose `last_autoanalyze` is NULL. This is the exact
trap CLAUDE.md documents (it once produced a data-loss incident, Q-528, that had never happened).
The size columns beside it were exact, as always. Same query, same row: one half trustworthy, the
other not.

## Reproducing

Production read-only via `/api/admin/db-query`. `pg_stat_user_tables` and `pg_stat_user_indexes` are
NOT row-scoped — they report the whole database. Join `pg_stat_user_indexes` to `pg_index` and filter
`NOT indisunique AND NOT indisprimary` to separate droppable indexes from constraints; the archive's
rate comes from `min(packed_at)`/`max(packed_at)` and `sum(length(blob))` on `claude_ro.oura_raw_packed`.
