# 2026-09-29 — BF-222: a failed sensor retention prune now leaves a row in `error_events`

**Lane A · `lib/data/postgres/slices/oura.ts`.**

- **Why:** the `oura_heartrate` (180 d) and `rr_intervals` (90 d) prunes are fire-and-forget on the
  write path and ended in `console.error`, i.e. stdout, which nothing reads. Neither has ever run,
  because both tables are still inside their horizon, so their first executions (~2026-10-15 and
  ~2026-12-19) would have failed invisibly.
- **Change:** `recordPruneFailure(db, table, err)` logs as before AND inserts an `error_events` row
  (`url = 'prune:<table>'`), which the session-start read already checks. It uses the slice's own
  handle, because `reportServerError` reaches the database via `@/lib/data`, which would be a cycle.
- **Tests:** a source guard that both prunes route through the helper, and a real-Postgres write of
  the row. The Oura-slice suites (147) and Custom Rules pass.
- **Owed (BF-222 `Keep:`):** confirm the first `rr_intervals` prune after 2026-10-15 (`min(at)` ≈ 90
  days).
- **The size read, recorded so the next session can diff it (BF-222's second point):** 261 MB total,
  93 MB index (2026-09-29); largest tables `oura_raw_samples` 76 MB, `error_events` 52 MB,
  `oura_heartrate` 38 MB, `rr_intervals` 31 MB; oldest `oura_heartrate` 2026-06-22, oldest
  `rr_intervals` 2026-07-17.
