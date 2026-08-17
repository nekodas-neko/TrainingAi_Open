# 2026-08-05 — Data-collection gap sweep: every production table, counted and dated

**Prompted by** the `workout_hr_stats` find (Q-11 defect A, v1.257.2): that table held **0 rows for
every workout ever logged** while its sibling `set_hr_stats` held 582, and the two are written from
the same code block three lines apart. The owner asked the obvious follow-up — *where else does a
gap like that exist?*

## The method, so it can be re-run

The original find came from **sibling asymmetry**, not from reading code. Two tables that should
fill together, one full and one empty, is a signal that survives whatever the code looks like.
Generalised, that is two queries:

**1. Row counts for every table.** Zero is the loud case.

```sql
SELECT 'workout_hr_stats' AS t, count(*) FROM claude_ro.workout_hr_stats
UNION ALL SELECT 'set_hr_stats', count(*) FROM claude_ro.set_hr_stats
-- … one line per table, ORDER BY 2 ASC
```

**2. Latest write per table.** A table with rows that stopped filling is the quiet case — and the
one that matters, because nothing looks broken.

```sql
SELECT 'body_metrics' AS t, count(*) AS n, max(updated_at)::text AS latest FROM claude_ro.body_metrics
UNION ALL …  ORDER BY 3 NULLS FIRST
```

Get the timestamp column per table from `information_schema.columns` rather than guessing —
`updated_at` / `created_at` / `measured_at` / `date` / `day` / `log_date` covers 56 of the 69.

**Then classify, and do not skip this step.** Most of what both queries surface is not a bug, and
reporting it as one is worse than not running the sweep. Three outcomes:

- **Broken** — a writer that should have run and did not.
- **By design** — read-through caches, opt-in captures, config tables, features not used.
- **Structurally inconsistent** — parent rows exist, children do not.

## Result: 69 tables

**11 empty · 16 with 1–5 rows · 19 not written in over 14 days.** After classification, **one**
confirmed defect (fixed), **one false positive produced by the audit view itself** (retracted below,
and the view fixed), and everything else explained.

### ✅ Confirmed fixed, and the sweep proves it

`workout_hr_stats` now reads **66 rows** — one per completed session. The v1.257.2 fix plus the new
Admin → Tools backfill did what they were supposed to. This is the sweep's control: the one table
known to be broken shows as repaired.

### 🔴 Real gap — the daytime-HRV model has never fitted, and its inputs are present

`oura_daytime_hrv_model` is **empty**. It is documented as "empty until the user has a fitted model
(cold start)", which would be a fine explanation if the inputs were missing. They are not:

| tag the refit reads | rows in production |
|---|---|
| `0x46` (70) | **41,592** |
| `0x69` (105) | **839** |
| `0x5d` (93) | **609** |

**✅ FIXED v1.259.1 — and this section's own diagnosis was wrong.** It said the failure had to be in
`extractNightlyTrainingSamples` → `fitDaytimeHrvModel` "not in the data". Execution never reached
either: `getOuraRawSamplesForTags` filtered on `decoded IS NOT NULL`, and that column is NULL on
**all 812,816 rows across all 30 tags** — `body_hex` is the archival source of truth and every other
consumer decodes on the fly. The filter matched nothing, so `rows.length === 0` was ALWAYS true and
the refit bailed on the first line. `/api/oura-ble/device-metrics` returning `{"days": []}` was the
same cause. Full writeup:
[`2026-08-05-raw-samples-decoded-column.md`](../overview/history-2026-08-04.md).

Worth noting how the wrong diagnosis happened: the tag counts above proved the *inputs* existed, and
that was read as proving the *query* returned them. Counting rows in a table says nothing about
whether the code's predicate selects them.

### ❌ RETRACTED — "eight phase sets contain no phases" was the audit tool lying

This section originally read: *`phase_sets` = 8, `program_phases` = 0 — eight phase sets, not one
phase between them.* **That was wrong, and the sweep itself produced the error.**

`claude_ro.program_phases` was scoped through `program_id`:

```sql
WHERE EXISTS (SELECT 1 FROM public.programs p
              WHERE p.id = t.program_id AND p.user_id = '<owner>')
```

But `program_id` is nullable — migration 024 is literally named
`024_fix_program_phases_nullable_program_id.sql` — and the modern write path never sets it.
`createPhaseSet`, `updatePhaseSet` and the 042 seed all insert with **only** `phase_set_id`.
Measured on the local DB:

| | |
|---|---|
| total phases | **573** |
| with `program_id` | **0** |
| with `phase_set_id` | **573** |
| rows the old predicate could return | **0, for any user** |

So the view returned nothing and the sweep read that as an empty table. Fixed in migration 167 by
scoping through `phase_sets` (keeping the `program_id` arm for any legacy row that has one), with a
DB-backed regression test.

**The lesson is about the tool, not the table.** An audit view that filters on the wrong column does
not fail — it lies, quietly and consistently, and every conclusion drawn through it inherits the
lie. The row-count sweep in this document was run entirely through `claude_ro`. Its other findings
were spot-checked against code paths rather than taken from counts alone, which is what kept them
honest; a count that no code path corroborates should be treated as a claim about the *view* until
proven otherwise.

Regenerating also surfaced two columns that migrations 163–166 added without re-running the
generator — `prescribed_runs.segments` and `exercise_library.merged_into` — which were unreadable
because the schema is default-deny. That is the documented reason to regenerate when adding tables
or columns, and it had been missed four migrations running.

**`running_plans` = 1 with `running_baselines` = 0 still stands** as a genuine (minor) oddity, and is
unaffected by the view bug — `running_baselines` has its own `user_id`, so nothing was hidden.

### ✅ Checked and NOT gaps — recorded so they are not re-chased

This is the more useful half of the sweep. Each of these looks alarming in the raw output and is
correct behaviour:

| table | reading | why it is fine |
|---|---|---|
| `schedule_days` | **0 rows**, with 4 schedules | all four schedules are `type='rotation'`; `schedule_days` only applies to `type='weekly'` |
| `daily_zone_minutes` | 15 days stale | **read-through cache** — written only when the cardio/zone screens are opened, so staleness tracks screen visits, not data loss |
| `oura_accel_chunks` | 21 days stale | opt-in continuous capture, deliberately off by default and never all-day (real drain on strap and phone) |
| `oura_workouts` | 31 days stale, last write **2026-07-05** | two days before the BLE re-key. The Oura Cloud gets no new data from this ring by design — this is the re-key, visible in the data |
| `users`, `programs`, `progression_styles`, `style_sets`, `meal_types`, `activity_types` | 38–74 days stale | config: changes only when edited |
| `injuries`, `feedback_submissions`, `seasons`, `season_results`, `push_subscriptions`, `oura_tags`, `oura_bucket` | empty | features not used, or never wired to a live producer |

The `oura_workouts` row is worth keeping: a table whose last write lands two days before a known
migration is the *expected* shape of that migration, and reading it as breakage would have been the
easy mistake.

## What the sweep is good at, and what it misses

It finds tables that are empty or have stopped. It does **not** find:

- **A column that is always null in a populated table.** That is the `latency` / `onset_latency`
  class from CLAUDE.md — the row lands, one field is silently `undefined`. A null-rate sweep per
  column is the natural follow-up and was not run here.
- **Values that are wrong rather than absent.** `workout_hr_stats` would have looked healthy at 66
  rows even if every number in it were garbage.
- **Rows written to the wrong user or day.** Counts and timestamps cannot see that.
- **Its own blind spots.** Every count here came through `claude_ro`, and one of those views was
  scoped on the wrong column — so the sweep confidently reported an empty table that had 573 rows.
  A zero that no code path explains is a claim about the view until proven otherwise.

Re-running the two queries above after any deploy that adds a producer is cheap and catches the
loud class immediately.
