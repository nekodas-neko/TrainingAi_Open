# 2026-08-02 — Q-28 sized against production: a restore is ~1,800 rows, so it waits (docs-only)

**Branch:** `perf/applydelta-batching` · Run-list item 7 of the
[batch queue drain](../../handoff-2026-08-02-platform-batch-queue-drain.md). **No code changed.**

Q-28 says, in its own words: *"Do the measurement before the refactor. … If a restore is a few
hundred rows this drops well down the queue; if it is five figures it is the largest remaining win
outside Phase 3."* The measurement was impossible when the item was written — no reachable
production data. It is reachable now.

## The measurement

`applyDeltaBody` iterates exactly twenty delta domains. Production row counts for all of them:

| domain | rows | | domain | rows |
|---|---|---|---|---|
| `set_logs` | 887 | | `personal_records` | 30 |
| `exercise_logs` | 308 | | `oura_daily_summary` | 29 |
| `body_metrics` | 96 | | `program_sessions` | 18 |
| `session_exercises` | 87 | | `prescribed_runs` | 7 |
| `workout_sessions` | 79 | | `fitness_tests` | 2 |
| `oura_daily_derived` | 78 | | `programs` / `schedules` / `schedule_days` / `progression_styles` / `style_sets` | single digits each |
| `sleep_sessions` | 63 | | `injuries` | 0 |
| `mood_logs` | 59 | | | |
| `activity_logs` | 42 | | **total** | **≈ 1,800** |

**≈ 1,800 sequential bridge crossings for a full restore**, on a one-time path. That is the "few
hundred" end of the item's own scale, not five figures. Steady-state daily deltas are a handful of
rows, where batching is imperceptible — as the entry already said.

**So: do not build it yet.** Q-28 is re-prioritised, not deleted; the analysis in the plan is sound
and the `executeSet` approach is right whenever the number justifies it.

## The tripwire that would change the answer

`oura_heartrate` holds **37,950 rows** in production and *is* mirrored in the local SQLite schema —
but it is **not one of `applyDelta`'s twenty domains**. It is populated by its own local write path,
not by the pull delta.

That one fact is the whole difference between 1,800 crossings and 40,000. **If any future change
adds the HR series (or another high-cardinality timeseries) to the sync delta, Q-28 becomes urgent
immediately** — a restore would jump to five figures and land exactly on the sequential path this
item describes. Q-29 D2 (the on-device rollup) is the most likely source of such a change.

This is recorded on the Q-28 entry so whoever adds a timeseries domain to the delta sees the
consequence in the same place they'd look for the domain list.

## Method note

Both "measure first" items in this batch (Q-35 and Q-28) came back **"don't build it"** once real
numbers were available. That is the mechanism working, not a wasted pair of sessions: between them
they avoided a table-rewriting migration that would have made the table bigger, and a refactor of
the code path with the worst data-loss history in the repo, for a one-time saving of a couple of
seconds.
