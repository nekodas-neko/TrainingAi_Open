# 2026-09-28 — RV-182 closed: `oura_heartrate_pkey` stays

Parts ① to ③ of RV-182 shipped on 2026-09-25. Those were the no-op backfill, the clock-offset
read, and the HR rollup's delete-then-insert churn. The last line noted `oura_heartrate_pkey` at
7 MB with 0 scans and left the drop for a migration of its own. **Decided against, on evidence.**

- The admin snapshot pages every table by its primary key, and `db-snapshot.ts` has no fallback
  for a table without one (every production table has a PK, its header says). `oura_heartrate` is
  a bulk table, so a `bulk=` snapshot pages 800k rows on exactly this index. The 0-scan reading came
  from a period with no bulk snapshot, so it measured disuse by the one reader that matters, not
  deadness.
- Swapping the PK onto the `(user_id, timestamp)` unique key would keep pagination. It would also
  rebuild a constraint on the largest hot table under lock, and drop the uniqueness of `id`.
- The saving is 7 MB, which is about $0.001 a month at the billed rate.

So the index stays. Reopen only if the table's write cost is measured to matter, not on storage.
