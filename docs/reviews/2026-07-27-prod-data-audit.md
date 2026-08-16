# Production data audit — 2026-07-27

First whole-history sweep using the read-only endpoint (`POST /api/admin/db-query`, plan
`docs/superpowers/plans/2026-07-26-claude-readonly-prod-db-access.md` §2c). Read-only, row-scoped to
the owner's account. Every number below is from production, not the local seed.

**Scope note:** the views are scoped to the owner (`fe481797…`), so all counts are their data only —
57 sleep sessions, 75 workouts, 88 body-metric rows, 170 food logs.

---

## 🔴 F-1 (HIGH) — the Sleep Score is taken from the most recent session, so a nap overrides the night

**This is the bug behind the owner's original report** (*"I had a really bad sleep last night and felt
really bad"* — and the score didn't reflect it).

`app/api/readiness-score/route.ts` sorts sessions by `sleepEnd` descending and scores `sortedSleep[0]`:

```ts
const sortedSleep = [...sleepSessions].sort((a, b) => b.sleepEnd.getTime() - a.sleepEnd.getTime())
const lastSleep  = sortedSleep[0]
```

When a day has both a main sleep and a later nap, **the nap is the most recent and wins**. The night
is never scored.

Two confirmed cases:

| Day | Session | Duration | Local window (Brisbane) | Persisted `sleep_score` |
|---|---|---|---|---|
| 2026-07-07 | **nap (scored)** | **0.33 h** | 10:44 → 11:03 | **5** |
| 2026-07-07 | main sleep (ignored) | 7.86 h | 22:16 → 07:02 | — |
| 2026-07-21 | **nap (scored)** | **1.33 h** | 18:18 → 19:52 | **31** |
| 2026-07-21 | main sleep (ignored) | 7.75 h | 22:20 → 06:54 | — |

A 20-minute nap produced a Sleep Score of **5** on a night with 7.86 h at 90% efficiency, 1.41 h deep
and 1.98 h REM. The score is arithmetically correct — it is scoring the wrong session.

**Blast radius: 12 of 45 distinct days (27%) have more than one sleep session; 11 of those include a
session under 2 h.** So roughly a quarter of the history is at risk of a nap-derived sleep score.

**It propagates.** The readiness composite's `previousNight` contributor (weight 0.16) reads this same
`sleepScore100`, so a nap-scored night drags readiness down too — consistent with 2026-07-21 showing
readiness 37 against a genuinely good night.

**Fix direction (not implemented):** select the night to score by *longest duration within the day*, or
by session type where the ring reports one, rather than by latest `sleepEnd`. Both `readiness-score`
and `lib/health/score-audit/sleep.ts` pick the session and must change together (the audit's
`splitNights` has the same "first match after sorting by sleepEnd" behaviour). The HRV-baseline
trailing mean should also exclude naps, or short sessions will depress the baseline.

## 🟠 F-2 (MEDIUM) — only 12 of 57 nights carry a persisted derived score

`oura_daily_derived` holds 70 rows spanning 2026-05-07 → 2026-07-27, but only **12** have
`sleep_score` and **12** have `readiness_score`.

The persist is a side effect of someone loading `/api/readiness-score`, which only ever writes *today's*
figures. Historical nights are therefore mostly unscored, so any trend/calibration analysis over
`oura_daily_derived` is working from a 21% sample. Worth a backfill pass that recomputes and persists
scores for every night with a scoreable session.

## 🟠 F-3 (MEDIUM) — data-coverage gaps in the metrics that feed scores

Null rates across the owner's history:

| Column | % NULL | Consequence |
|---|---|---|
| `body_metrics.active_calories` | **81.8%** | Activity's active-energy contributor (weight 15) renormalises out on 4 of 5 days |
| `body_metrics.hrv_ms` | 60.2% | 28-day HRV baseline built from ~35 of 88 rows |
| `body_metrics.spo2_pct` | 60.2% | — |
| `body_metrics.resting_heart_rate` | 58.0% | resting-HR baseline (and therefore HR zones → zone-minutes) built from ~37 rows |
| `body_metrics.weight_kg` | 38.6% | energy-budget/BMR inputs |
| `sleep_sessions.average_hrv_ms` | 33.3% | Sleep Score's `hrv` contributor (weight 12) |
| `sleep_sessions.respiratory_rate` | 31.6% | illness radar's breathing z |
| `sleep_sessions.onset_latency_sec` | 28.1% | latency contributor (weight 8) |
| `sleep_sessions.efficiency` / `restless_periods` / hypnogram | 21.1% | efficiency + restfulness + REM/deep |
| `body_metrics.steps` | 0.0% | ✅ complete |

**None are 100% NULL**, so no integration is fully dead — this is the good version of the
`onset_latency_sec` check (that column was NULL since ship due to a wrong field name; it is now
populated on 72% of nights). But the renormalising Sleep/Activity models silently redistribute weight
whenever a contributor is missing, so on a typical day the score is built from fewer inputs than the
model implies. That is exactly what Day Review's `gaps[]` is meant to surface per-day.

## 🟡 F-4 (LOW) — storage: 337 MB of the 1 GB volume, `oura_raw_samples` is 85% of it

| Table | Rows | Size |
|---|---|---|
| `oura_raw_samples` | 588,171 | **285 MB** |
| `oura_heartrate` | 31,633 | 28 MB |
| `rr_intervals` | 21,189 | 4.4 MB |
| *(next 9 tables)* | — | < 1 MB each |

Every raw sample is from the last **four weeks** (~200 k rows/week), so the retention/prune is working
— this is not the unbounded growth of the earlier 1 GB incident. At ~285 MB per four weeks of
retained window the volume is stable rather than climbing, but the headroom claim in the
`db-volume-cleanup-handover.md` doc should be re-derived from these numbers rather than the old ones.

Note `pg_total_relation_size` is ~485 bytes/row against ~24 bytes of `body_hex` per sample — the bulk
is row + index overhead, not the hex payload. The proposed `bytea` conversion would therefore save far
less than the estimated ~50%; worth re-costing before doing it.

## ✅ Clean

- **FK integrity** — 0 orphaned `exercise_logs`, `set_logs`, or `food_logs`.
- **`sessions_in_phase`** — 10 rows, values 0–4, all plausible against their prescriptions. No drift
  visible (small sample; re-check as the history grows).
- **Readiness-persist day-key bug** (`projectOverview.md` Known Issues) — **no orphaned rows found**:
  0 days carry a derived score without a matching sleep session. The mis-keying is real in code but
  has not produced detached rows in practice, because summary and sleep days have coincided so far.
  Lower priority than its Known-Issues entry implies.

## ⚪ Noted, probably benign

- **14 workout sessions with no exercise logs.** Consistent with abandoned starts, which
  `getDayLog` already filters via an `EXISTS` check. Worth confirming none are real sessions whose
  logs failed to sync.
- **Sleep 80 / readiness 29 on 2026-07-26.** Large divergence; likely the illness-radar suppression
  or cold baselines. Run Day Review on that date to see the contributor breakdown.

---

## What this sweep did NOT cover

- **Anything outside Postgres.** Native SQLite migrations, BLE drain behaviour, safe-area insets,
  WebView rendering, gesture handling and local-store reads leave no trace here. A clean data audit is
  not "everything is wired up correctly" — the device smoke checklist remains the authority.
- **Other users' data**, by design — the views are scoped to the owner.
- **Sync/outbox health.** The outbox is client-side (local SQLite); the server has no dead-letter
  table to inspect. Needs the on-device sync-health screen instead.
