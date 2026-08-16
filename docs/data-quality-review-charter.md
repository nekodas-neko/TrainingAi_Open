# Data-Quality Review — session charter

**Purpose:** a standing session that hunts for *wrong numbers* in TrainingAI — scores that don't
match reality, calculations fed the wrong input, silent data gaps — using read-only access to the
production database. It also serves as the session the owner brings bugs to.

**Read this whole file before running anything.** It is written to be self-contained: a fresh session
with no prior context should be able to work from it alone.

---

## 1. The job

Not "does the code compile" — CI covers that. This is: **does the number the app shows correspond to
what actually happened?**

The failure mode to hunt is the one that started this work. On 2026-07-27 the first audit found that
the Sleep Score was being computed from the *most recent* sleep session rather than the main sleep, so
a 20-minute nap taken after waking produced a **Sleep Score of 5** on a night of 7.86 h at 90%
efficiency. Every unit test passed. The arithmetic was correct. It was scoring the wrong row.

That is the shape: **correct code, wrong input selection.** Unit tests cannot catch it because they
supply the input directly. Only real history reveals it.

---

## 2. Access

`POST https://trainingai-production.up.railway.app/api/admin/db-query`

```bash
curl -s -X POST "$BASE/api/admin/db-query" \
  -H "Authorization: Bearer $CLAUDE_DB_QUERY_SECRET" \
  -H 'content-type: application/json' \
  -d '{"sql":"SELECT count(*) FROM sleep_sessions"}'
```

`GET` the same URL returns schema discovery — every readable view and its columns. **Start there**;
don't guess table shapes.

**Ask the owner for `CLAUDE_DB_QUERY_SECRET`.** It is not in the repo and must never be committed.

### Constraints you will hit

| Limit | Value | Notes |
|---|---|---|
| Rate limit | **10 requests/min per IP** | Batch aggressively — combine many checks into one `SELECT` with subqueries. Sleep ~8 s between calls. |
| Row cap | 1000 | Response reports `truncated: true` — never assume a full set. |
| Payload | 5 MB | |
| Statement timeout | 10 s | Aggregate rather than pulling raw rows. |
| Statements | one per request | No `;`-separated batches. |

### What you can and cannot do

- **Read-only, enforced by the `claude_readonly` Postgres role** (`default_transaction_read_only`), not
  by SQL inspection. Every write form fails, including `WITH x AS (INSERT … RETURNING *) SELECT * FROM x`.
- **Row-scoped to the owner's account.** Other users exist and hold real health data; their rows are
  invisible by design. Don't try to work around it.
- **Withheld columns:** `users.password_hash`, all four `oura_tokens` secrets,
  `feedback_submissions.screenshot_data`, the three `push_subscriptions` Web-Push columns. Presence
  stand-ins exist (`has_pat`, `screenshot_bytes`).
- **Denied tables:** `invited_emails`, `rate_limits`.
- Every query writes an audit row to `db_query_log`.

**Emergency stop** (owner runs, no deploy): `REVOKE ALL ON SCHEMA claude_ro FROM claude_readonly;`

---

## 3. What you CANNOT see — do not mistake a clean audit for a healthy app

Large parts of this app's failure surface leave **no trace in Postgres**:

- Native SQLite (the on-device source of truth), the mutation outbox, dead-lettered syncs
- BLE drain behaviour, ring connection state, native service logs
- Safe-area insets, Samsung WebView rendering, gesture handling
- Anything computed and displayed but never persisted

`docs/device-smoke-checklist.md` remains the authority for all of it. A spotless data audit is
compatible with the app being broken on the phone. **Say so explicitly in every report.**

---

## 4. Method that actually finds things

The productive pattern is **triangulation**: compare a *stored/derived* value against the *raw inputs*
it claims to summarise, and look for pairs that can't both be true.

1. **Distributions first.** `min/avg/max` plus bucket counts on every score. Outliers are where bugs
   live — the nap bug surfaced as a `min` of 5.
2. **Then explain each outlier** by joining back to its raw inputs. If the inputs look fine and the
   score doesn't, you've found something.
3. **Null-rate every column an integration populates.** 100% NULL = dead integration (this is how
   `onset_latency_sec` was found dead since ship). High-but-not-total = coverage gap that silently
   changes renormalising models.
4. **Count rows per grouping key that the code assumes is unique.** The nap bug is exactly a
   "code assumed one row per day, data has two" bug. Look for more of these — every `find(x => x.date === d)`
   in the codebase is a candidate.
5. **Reconcile stored counters against a derived recount.**
6. **Boundary-test dates.** Rows whose `date` disagrees with their timestamp converted to
   `Australia/Brisbane`. UTC/AEST diverge by 10 h; this has caused repeated bugs.

### Hazards specific to this codebase

- **A live database is a moving target.** Querying while the owner is mid-workout (or just finished)
  reads rows the outbox has not pushed yet. A device-vs-DB count gap is the expected *transient*
  state, not a finding: on 2026-07-28 a Push session read as 4 exercises / 12 sets against the
  device's 5 / 14, and it was simply the last exercise arriving ~90 s later (`updated_at 08:54:14`
  vs a query at ~08:52). **Before writing up any row-count or missing-data discrepancy, re-run it
  once sync has settled and check the rows' `updated_at` against your query time.**

- **Renormalising models.** Sleep and Activity scores redistribute the weight of any missing
  contributor. A score of 82 built from 4 of 8 contributors is not comparable to one built from 8.
  Always check *which* contributors were present.
- **Rounding.** Sub-scores are exposed rounded; a rebuilt weighted sum can sit ≤1 off. Don't chase that.
- **Timezone.** Always `Australia/Brisbane`. Never use UTC dates for "which day is this".
- **Frozen Oura Cloud fields.** Since the BLE re-key, Cloud-sourced scores are stale by design. Never
  treat `oura_daily.*_score` as current — the app's own derived values supersede them.
- **`oura_daily_derived` is sparsely populated** (see F-2 below) — absence is not evidence.

---

## 5. Already found — don't re-report these

Audit #1: [`docs/reviews/2026-07-27-prod-data-audit.md`](reviews/2026-07-27-prod-data-audit.md).
Audit #2: [`docs/reviews/2026-07-27-prod-data-audit-2-derived-metrics.md`](reviews/2026-07-27-prod-data-audit-2-derived-metrics.md).

| Ref | Finding | Status |
|---|---|---|
| **F-1** | Sleep Score scores the most recent session, so a nap overrides the night. 12/45 days affected. Propagates into readiness via `previousNight`. | Queued, **not fixed** |
| **F-2** | Only 12 of 57 nights carry a persisted derived score — the persist only ever writes *today*. | Queued, after F-1 + Q-1 |
| F-3 | Coverage gaps: `active_calories` 82% null, HRV 60%, resting HR 58%. None fully dead. | Documented |
| F-4 | Storage 337 MB of 1 GB; raw samples pruned to a stable 4-week window. Row overhead dominates, so the proposed `bytea` conversion saves less than estimated. | Documented |
| **Q-1** | The rollup's `nightInputsByDate.set(wakeDate, …)` is last-window-wins, so a nap overwrites the night in `oura_daily_summary` and poisons the checkpointed EMA baselines. 4/21 rows; the 3 lowest readiness scores in history. | Queued, **not fixed** |
| **Q-2** | `temp_event` decodes to three interleaved temperature channels; the rollup flattens them, so nightly temp is the coarse middle channel (34–37 °C swings, 2.63 °C baseline spread). | Queued, blocked on protocol work |
| Q-3 | `restless_periods` changed meaning at the BLE cutover (230.6 → 2.5) with the same column and the same curve; restfulness contributor moves ~31 points on units alone. | Queued |
| Q-4 | `respiratory_rate` written from an explicitly-uncalibrated estimator (13.11 → 9.32 rpm). `average_hrv_ms` (+78%) and `lowest_heart_rate` (−8.4 bpm) shifted at the same cutover — flagged for calibration, not asserted as bugs. | Queued |
| Q-5 | `/api/personal-records/seed` overwrites PRs unconditionally; 5/36 wrong, 4 values appear in no log. PRs keyed on exercise *name*. | Queued |
| Q-6 | The six EMA baselines seed at zero; `temp_dev_c` reached +17.0 °C and is surfaced ungated to the AI prompt and day-log. | Queued |
| Q-7 | Nine `oura_daily_derived` columns never written, incl. `activity_score` — Activity Score v2 has 0 days of history. | Queued |
| Q-8 | `user_stats` mixes two definitions of "a workout"; 26% of lifetime volume is from uncompleted sessions. | Queued, owner call |
| Q-9 | Three max-HR resolvers; they agree today only because observed (168) < age-predicted (187). | Queued |
| Q-10 | `sleep_sessions` has no session `type`, so nap-vs-night must be guessed from duration. Degenerate 0.00 h rows are stored and scored. | Queued, take with Q-1/F-1 |
| Q-11 | `set_hr_stats`: 79% `coverage_ok = false`, 67% null `peak_bpm`; `workout_hr_stats` empty. Root cause is off-Postgres. | Queued, device-gated |
| **Q-12** | Bodyweight 1RM has two eras (real weigh-in → fixed `BW_REF = 100`); Pull-Up 82.0 → 114.5 kg in one session on fewer reps, recorded as a real PR. | Queued, **not fixed**, owner call |
| Q-13 | A bodyweight set is worth 100 kg to the 1RM/intensity path and 0 kg to volume — 208 reps missing from ACWR, `user_stats`, and the engine's own volume budget. | Queued, after Q-12 |
| Q-14 | `planned_pct` vs `intensity_pct` are on different bases for bodyweight → structural 13–19 pp overshoot on every such set. | Queued |
| — | Readiness-persist day-key bug produced **zero** detached rows in practice. | Lower priority than its Known-Issues row implies |

**Periodization/prescriptions — audited in full at audit #2 and clean apart from Q-12…Q-14:**
`sessions_in_phase` reconciles exactly on all 10 rows; `intensity_pct` reconciles against the PR-derived
reference on 21 of 23 exercises (the 2 exceptions corroborate Q-5); `baseline_1rm` snapshots match the
PRs as of their generation date; prescription `confidence` is deterministic, not LLM-reported (explicit
guard in `lib/ai-periodization/confidence.ts`); `pending` status still drives load by design
(`prescriptionDrivesLoad`); no NULL `style_id` and no expired prescriptions. **Two traps here too:**
derive `sessions_in_phase` by joining **`ws.session_id`**, never `ws.program_session_id` (dead column,
NULL on all 75 rows — joining on it makes every row look drifted to 0); and `ws.session_id` is NULL on
46 of 75 rows but **all of them are May/June** — every session since 2026-07-01 carries it.

**Clean as of audit #2 — do not re-raise without new evidence:** FK integrity (0 orphans anywhere);
`exercise_logs.volume` reconciles to `Σ(weight × reps)` on all 288 rows; `sessions_in_phase` counters;
timezone/date boundaries (`mood_logs`, `day_checkins` 0 mismatches; the 2 `food_logs` mismatches are
next-morning edits); duplicate-per-key sweep clean on every table except `sleep_sessions`;
`food_items` orphans/macros. Two traps that *look* like findings and are not:
**`oura_raw_samples.decoded` is 100% NULL by design** (ingest stopped persisting the JSONB —
`adapter.ts:4264`; the rollup decodes from archival `body_hex` live), and
**`exercise_logs.muscle_groups` is empty on 80 rows** but all of them are dated 2026-04-30 → 05-21 and
none since — historical, bounded, not ongoing.

**Access gap:** audit #2 could not use Day Review — `GET /api/admin/day-review` returns **401** with
`CLAUDE_DB_QUERY_SECRET`, because its bearer path needs `ADMIN_EXPORT_SECRET`. Ask the owner for that
too. In the meantime the workable substitute is to **run the real modules** (`computeSleepScore`,
`decodeEventBody`, …) in a throwaway vitest file against production rows — that keeps the
"no second implementation" rule while still exercising the real code.

---

## 6. Calculation surfaces worth auditing

Every one of these turns raw data into a number the user sees. For each, ask: *what would "wrong"
look like, and would anything currently catch it?*

**Scores & composites** — `lib/health/`: `sleep-score.ts`, `readiness-composite.ts`, `activity-score.ts`,
`score-band.ts`, `illness-radar.ts`, `stress-resilience.ts`, `chronic-stress-assembly.ts`,
`recovery-index.ts`, `personal-baseline.ts` (EMA baselines — check maturity gates and units;
temperature is centi-°C, breathing is rpm×10, and getting that wrong silently produces absurd z-scores).

**Training load** — `lib/ai-periodization/acwr.ts` (`computeVolumeAcwr`), `lib/1rm.ts`,
`lib/health/training-stress.ts`, `workout-density.ts`, `workout-energy.ts`.

**Cardio & HR** — `hr-zones.ts`, `zone-minutes.ts`, `observed-hr.ts`, `hr-recovery-profile.ts`,
`vo2max.ts`, `vdot.ts`, `rmssd.ts`, `hrv-5min.ts`, `cadence.ts`.

**Energy & nutrition** — `daily-energy.ts`, `daily-goals.ts`, `energy-balance.ts`,
`body-composition.ts`, `step-estimate.ts`.

**Sleep pipeline** — `sleep-staging.ts`, `hypnogram.ts`, `sleep-consistency.ts`, `sleep-trend.ts`,
`breathing-rate.ts`.

`docs/module-map.md` is the index of where each formula lives. **Check it before assuming a
calculation is missing** — this project enforces One Formula, One Place, so a second implementation
of the same metric is itself a bug worth reporting.

### The complementary tool

**Admin → Day Review** (`/api/admin/day-review?date=` or `?from=&to=`, up to 31 days) runs the *real*
scoring code for a given day and returns every contributor's input, sub-score, effective weight, points
contributed, and what was missing.

**Use it whenever a SQL query suggests a score is wrong.** SQL shows you the raw data; Day Review shows
you what the model did with it. Reproducing the formulas in SQL would create a second implementation
that drifts — don't.

---

## 7. Output convention

- Findings → `docs/reviews/YYYY-MM-DD-<topic>.md`. Severity-ordered, each with **the query that
  demonstrates it** and concrete production numbers. No finding without evidence.
- Anything actionable → an entry in `docs/implementation-backlog.md`, plus a `projectOverview.md`
  Known-Issues row if it affects shipped behaviour. **A documented finding with no queue entry is a
  dropped finding** — this project's rule, and it is enforced.
- Sequence dependent fixes explicitly (F-2's backfill must not run before F-1, or it would bake
  nap-derived scores into history permanently).

## 8. Guardrails

- **Report, don't fix, by default.** Several findings have more than one defensible remedy (F-1: is the
  night "the longest session" or "the ring-reported main sleep"?). Surface the choice; let the owner pick.
- Small unambiguous fixes are fine with the owner's go-ahead. Anything touching scoring semantics
  changes the meaning of historical data — always ask.
- **Verify against production, not against a green deploy.** During this build, a merged-and-deployed
  fix twice failed to take effect — once because `CREATE OR REPLACE VIEW` left stale views, once
  because `ensureSchema` tracks migrations by filename and skipped an edited file. Both times the code
  and the tests said "done". Only querying production revealed otherwise. **Confirm the number changed.**
- The local dev DB (`pnpm db:local`) is always available and freshly seeded — use it for anything
  destructive. Note that a bug reproducing in prod but not locally usually means **prod data drift**,
  not a code difference.
