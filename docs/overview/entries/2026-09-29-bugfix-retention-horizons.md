# 2026-09-29 — the session-start reads: two prunes that have never run, and one index nobody uses

**Agent:** BugFix intake. **Docs only** — no product code.

## The three reads

- **`feedback_submissions` — 0 rows.** Row-scoped to the owner, so that is *none of his*, never
  *nobody's*. Nothing to file.
- **`error_events` — nothing new.** 25 distinct messages in 7 days, of which all but two are
  `bf110 resume …` telemetry from the live BF-110 investigation and one deliberate `BF-92` device
  probe. The single genuine fault — `/api/body-battery`, `timeout exceeded when trying to connect`,
  one hit on 2026-09-23 — is **already journaled** in `history-2026-09-23-folded-1.md`. Not re-filed.
- **Database size — 261 MB, 93 MB index.** This is where the work was.

## The growth rate rose, and it is not a leak

Against the two figures in the docs (171 MB on 08-18, 215 MB on 09-11) the rate went **1.83 →
2.56 MB/day**, on a `CLAUDE.md` line that said to expect ~1.7.

**The cause: the two largest growing tables have never reached their retention horizon.**

| table | retention | oldest row | age | ever pruned? |
|---|---|---|---|---|
| `oura_heartrate` | 180 d | 2026-06-22 | 99 d | **no** |
| `rr_intervals` | 90 d | 2026-07-17 | 74 d | **no** |

`oura_raw_samples`, the one window that *does* cycle, is holding at 173,960 rows across its 7-day
span — reclaiming correctly.

So the acceleration is temporary and the plateau projects to **~300 MB, about 4.5 cents a month**,
flattening by 2026-12-19. Worth carrying into `Q-30`, which is still open on storage cost.

## BF-222 — the risk inside that good news

Both prunes are throttled, fire-and-forget, on-write, and both end in
`.catch(err => console.error('[prune] … failed:', err))` — **stdout, not `error_events`**. Nothing
reads stdout. Their first-ever executions land **~2026-10-15** and **~2026-12-19**, and if either
fails the table just keeps growing with no signal. Recommended routing both catches to
`error_events`, which is the channel built for exactly this and which the session-start read already
covers.

## BF-223 — 7.2 MB of index with zero lifetime scans

`oura_heartrate_pkey`: `idx_scan = 0` with `stats_reset` **NULL**, so that zero covers the table's
whole life. No foreign key references the table. The sibling `(user_id, timestamp)` unique index
takes 10,025,158 scans — every read goes through it. The `id` column is still read by the export
path, but off a sequential scan, and dropping the constraint does not drop the column.

Filed with the drop **gated on the owner** despite OR-182's proved-dead authority: it is
`DROP CONSTRAINT` on a table the Oura pipeline writes to continuously.

## `CLAUDE.md` corrected

The daily-MB figure has now been wrong three times (0.4 → 1.8 → 1.7 against 2.56). Replaced it with
the shape — the two horizons, the ~300 MB plateau, and what to check once each passes — so the rule
stops needing a new number every few weeks. Also recorded the estimator trap it demonstrated again:
`n_live_tup` read **135,306** against **148,811** real rows.

## A gap worth naming

Nothing stores the shape, so every session re-derives it. This comparison took four queries plus
digging two datapoints out of prose. Recommended in BF-222 that a session running the read write the
four numbers into its journal entry — the fix is the journal, not a new table.

## Not exercised

Docs only. No device run, no code change, nothing written to production. **The export path's use of
`oura_heartrate.id` was not fully traced** — whether it orders or paginates by it is the one thing
that could justify keeping that index, and BF-223 names it as the check to do first.
