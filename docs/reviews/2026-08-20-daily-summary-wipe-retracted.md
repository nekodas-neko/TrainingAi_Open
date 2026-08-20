# The daily-summary wipe never happened: `n_live_tup` is an estimate, and this database has never been analysed

**Date:** 2026-08-20 · **Agent:** Tuning 🎶 · **Pillars:** `[devices]` `[platform]` `[readiness]`
**Retracts** the central factual claim of
[`2026-08-19-daily-summary-replace-wipe.md`](2026-08-19-daily-summary-replace-wipe.md) (Q-528), which
I filed, and **restores** Q-525's original conclusion, which that claim had suspended.
**All numbers pulled 2026-08-20 ~06:20 UTC.**

---

## 1. What was claimed, and what is actually stored

Q-528 reported that `oura_daily_summary` held **1 row** against 198,223 raw samples, concluded that a
`fullHistory` rollup had wiped the history, and on that basis suspended Q-525 with *"nothing can be
concluded from stored data — rebuild first, then judge."*

The table holds **45 rows**, spanning **2026-07-07 → 2026-08-20**. Grouping them by when they were
written settles when they arrived:

| `created_at` | rows | covering |
|---|---|---|
| **2026-08-17 07:50** | **43** | 2026-07-07 → 2026-08-18 |
| 2026-08-18 18:58 | 1 | 2026-08-19 |
| 2026-08-19 15:18 | 1 | 2026-08-20 |

43 rows were created on **2026-08-17** and have existed continuously since. Q-528 was measured on
**2026-08-19**, when this table held 44. **The rows were there the whole time.** Nothing was wiped,
and there is nothing to rebuild.

`updated_at` tells the same story from the other side — 40 of those rows still carry their original
`2026-08-17 07:50` stamp, with one row rewritten per day since. A wipe-and-refill would have
re-stamped every row.

## 2. Why the read was wrong

Q-528 took its count from `pg_stat_user_tables.n_live_tup`, on the strength of a rule in my own baton:
*"`pg_stat_user_tables` is the one read here that is NOT row-scoped — use it to check whether a table
is empty."* The premise is right and the conclusion does not follow. `n_live_tup` is not a count; it
is a **planner estimate** maintained by autovacuum and `ANALYZE`. On this database:

```
SELECT relname, n_live_tup, last_autovacuum, last_analyze FROM pg_stat_user_tables
```

returns **`last_autovacuum` and `last_analyze` NULL on every table checked**. The estimates are
whatever a prior stats state left behind, and two of them are provably wrong today:

| table | `n_live_tup` | rows actually returned |
|---|---|---|
| `oura_raw_packed` | **0** | **764** |
| `error_events` | **0** | non-empty (rows returned by the session-start query) |
| `oura_daily_summary` | 45 | 45 ✅ |

So the instrument reads zero on a table holding 764 rows. A "1" from it is not evidence of one row.

**The reusable rule:** `pg_stat_user_tables` is authoritative for **physical size** (`pg_total_relation_size`,
`pg_indexes_size`) — those are read from the filesystem. Its **row counters are estimates**, and on a
database with no `last_analyze` they can be arbitrarily stale. To ask whether a table is empty, run
`count(*)`. Where the concern is that a `claude_ro` view is row-scoped and might hide other users'
rows, the honest phrasing is *"none of the owner's"* — the same hedge every other count here carries.

## 3. What survives from Q-528, and what does not

**Survives — the code shape is real.** `replaceOuraDailySummary`
(`lib/data/postgres/slices/oura.ts:1345`) does delete unconditionally and then guard the insert:

```ts
await db.delete(s.ouraDailySummary).where(eq(s.ouraDailySummary.userId, userId))
if (rows.length === 0) return          // guards the INSERT, not the DELETE
await db.insert(...)
```

A pass producing zero rows would replace the history and return successfully. Its only production
call site is `adapter.ts:6080`, reached **only** when `fullHistory` is set; routine ingest takes
`upsertOuraDailySummary`, a per-day `onConflictDoUpdate`, which is safe.

**Does not survive — that it fired.** It has not. The 2026-08-17 `fullHistory` pass wrote 43 rows
over a 43-night input, which is the function working. Q-528 is a **latent hazard on a
hand-triggered path**, not an incident, and its "rebuild the summaries" half is unnecessary work
against an intact table.

**Unaffected — `oura_bucket` really is empty.** 0 rows in the row-scoped view, and no contrary
evidence. The baton's note that Q-522's principled MET/motion answer has no data to stand on still
holds; only the `oura_daily_summary` line was misread.

## 4. Q-525 restored, and sharpened

With the suspension lifted, Q-525's finding stands: `chronic_stress_score` is **NULL on all 96
`oura_daily_derived` rows**, re-confirmed today. The new evidence makes the diagnosis more precise
than "an incremental rollup can never satisfy the gate" — which is true, and is not the whole story.

Three gates sit between the data and a score. Measured, in order:

1. **`summaryRows.length < CHRONIC_STRESS_MIN_DAYS` (21)** — `adapter.ts:6251`. On a routine pass
   `rollupCutoffDs` is `max(anchor − 35 d, watermark − 3 d)`; the watermark advances every run (the
   ring uploads about hourly), so a routine pass builds **~3 nights** and this returns immediately.
   **The baton's reading is correct for incremental passes.** But the 2026-08-17 `fullHistory` pass
   built **43** summary rows. **This gate passed.**
2. **Summary-field completeness across the trailing 31 nights** (2026-07-18 → 2026-08-17): of 31
   nights, HRV / RHR-low / RHR-avg / duration / restless / MET are non-null on **31**, `temp_dev_c` on
   **27**. **27 of 31 complete — this gate passes too**, with six nights to spare over the 21 needed.
3. **The granular per-night signals** (`signalsByDate`: 30-sec hypnogram, per-5-min HRV, skin-temp
   samples, bedtime) — stashed per decoded night at `adapter.ts:5706`, fed through
   `computeNightIntermediates`. **This is the only remaining suspect**, and the same 2026-08-17 pass
   is consistent with it: it wrote **23** derived rows against **43** summary rows, and illness scored
   on all 23 while chronic stress scored on **0**.

So the pass reached the derived-score steps, cleared both countable gates, and still produced
nothing. **Whatever refuses is inside the granular layer**, and it cannot be measured from stored
data: the intermediates are recomputed in memory by design (*"no stored intermediate that could
drift"*, `chronic-stress-assembly.ts`), and **nothing persists a reason for the null** — same shape
as Q-526, where the Activity Score stores its blend wrapper instead of its contributors.

Two things follow, and they are the new backlog item (**TN-1**):

- **The only code path that can ever produce a chronic-stress score is the `fullHistory` pass** —
  which is the same flag that arms Q-528's unconditional delete. Whoever reorders that guard is also
  the person who can unblock this, and both belong in one change.
- **Instrument before relaxing.** The gate may be correctly refusing to score. Counting complete
  granular nights inside the pass — and recording that count — turns an unanswerable question into a
  one-line log. Relaxing `CHRONIC_STRESS_MIN_DAYS` without it would be Q-504's mistake again:
  loosening a threshold whose input has not been checked.

## 5. Not measured

- **Whether the chronic-stress wiring was deployed on 2026-08-17.** Repo history was cut at the
  public-repo migration (50 commits, oldest 2026-08-19), so `git log --diff-filter=A` dates every file
  to the cut and can date nothing before it. The 2026-08-17 pass may predate the feature. This does
  not change the conclusion — the score is null today, on a code path that has since run — but it
  means the 08-17 pass is **weak** evidence about the granular layer, not proof.
- **The granular decode itself.** Establishing which of the 31 nights carry a usable hypnogram, IBI
  series and skin-temp run requires decoding raw frames, which is not reachable from SQL.
- **`oura_raw_samples` retention is a red herring — checked, and it is fine.** The live table holds a
  ~10-day hot window (`measured_at` 2026-08-10 → 2026-08-20, 221,499 rows); the older **941,233**
  frames sit packed in `oura_raw_packed` (764 blobs, packed 2026-08-18 04:28). This looks exactly like
  data loss and is not: the rollup reads via `readRawFrames`
  (`lib/data/postgres/slices/oura-raw-frames.ts`), the two-tier reader that consults both tiers. Worth
  recording so the next session does not re-derive the alarm.

## 6. Standing constraint

`claude_ro` views are row-scoped to one user, so every count above is **the owner's, recently** —
never the system's. `error_events` prunes at 30 days; the Oura tables do not.
