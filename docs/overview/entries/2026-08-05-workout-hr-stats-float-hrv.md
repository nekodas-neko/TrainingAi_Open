# 2026-08-05 — `workout_hr_stats` was empty because a float met an integer column

**Domain:** heart-rate · workouts — v1.257.2, JS/server-only (no APK rebuild)

`workout_hr_stats` held **0 rows** for all 66 completed workouts, and had since migration 135
shipped. The backlog's guess was that the producer was missing or that it was a device-side capture
problem. It was neither.

## The signature that gave it away

The two snapshot tables are siblings written from the same block, three lines apart, in
`app/api/oura/hr-data/route.ts`:

```ts
if (readings.length > 0) {
  void repo.upsertWorkoutHrStats(userId, sessionId, summary).catch(err => console.error(…))
  void repo.upsertSetHrStats(userId, sessionId, setHrRows).catch(err => console.error(…))
}
```

Production:

| table | rows |
|---|---|
| `set_hr_stats` | **582** |
| `workout_hr_stats` | **0** |

Same call site, same guard, same fire-and-forget shape — so the block ran, and one of the two writes
threw every single time. `set_hr_stats.computed_at` confirmed the block runs live: a bulk backfill
batch on 2026-07-22, then one-session-at-a-time writes on 07-23, 07-24, 07-26 … 08-04.

## The cause

`workout_hr_stats.workout_hrv_ms` is `integer`. It is the **only integer HRV column in the schema** —
`sleep_sessions.average_hrv_ms`, `oura_daily_derived.hrv_rmssd_ms`, `body_metrics.hrv_ms` and
`night_hrv_baseline_ms` are all `doublePrecision`. Its producer is `rmssdFromRr`, whose last line is
`return Math.sqrt(mean)`.

node-postgres serialises the JS number to text, and Postgres rejects the whole statement:

```
invalid input syntax for type integer: "38.42156862745098"
```

`set_hr_stats` has no HRV column, which is exactly why it was unaffected. The difference between 582
and 0 was one column type.

**Proven, not inferred.** A probe against the local DB reproduced the error verbatim, and the new
regression test in `oura-workout-hr-stats.test.ts` fails with that exact message when the fix is
removed. Every existing test in that file passed `workoutHrvMs: 44` or `null` — an integer or
nothing, never the shape the real producer emits. That is why it shipped.

## What was fixed

- **`Math.round` at the write site**, not in `rmssdFromRr`. The column is the constraint; every other
  consumer of rMSSD wants the float, and sub-millisecond precision on a durable snapshot is
  immaterial. A comment at the write site records why the column is the odd one out.
- **Both persist calls now report.** `console.error` in a fire-and-forget catch is invisible in
  production, which is the whole reason this survived for months — the recap renders identically
  whether the snapshot saved or not, so there was no symptom to notice. They now go through
  `reportServerError` and land in `error_events`.
- **An Admin → Tools card for the workout-HR backfill.** `/api/oura-ble/backfill-hr-stats` has
  existed since migration 135 with no button. Without it the fix would only help workouts from here
  on, leaving all 66 existing sessions at zero. Its per-set sibling already had a card, so both now
  share one `HrBackfillCard` driver rather than a second copy of the pass loop.

**Verified end-to-end**, not just at the unit level: seeded a real HR + RR series into a local
session so the rMSSD came out fractional, ran the new card in a browser against `pnpm dev`, and the
row landed — `avg_bpm 125, peak_bpm 140, workout_hrv_ms 42, readings_count 181, source chest_strap`.
Before the fix that same insert produced nothing at all.

## The second defect, diagnosed but deliberately not fixed

Chasing this turned up a separate gap in the same area. Four recent sessions have **zero**
`set_hr_stats` rows — not rows with null metrics, none at all — despite hundreds of HR samples
inside their own windows:

| day | session | sets | rows | computed_at |
|---|---|---|---|---|
| 2026-08-02 | Pull | 15 | **0** | — |
| 2026-08-01 | Lower | 18 | 18 | 2026-08-04 |
| 2026-07-30 | Upper | 18 | **0** | — |
| 2026-07-30 | Legs | 18 | **0** | — |
| 2026-07-26 | Pull | 15 | **0** | — |
| 2026-07-20 | Push | 14 | 14 | 2026-07-29 |

The only trigger for per-set attribution is `GET /api/oura/hr-data` — the **recap fetch**. Finish a
workout and never open its recap and that session is never attributed, permanently. Every session
before 2026-07-22 has rows because the backfill was run once that day; every gap is after it. The
days-late `computed_at` values are recaps opened later.

**Not fixed here, on purpose.** Computing at workout completion is the obvious move and has a trap:
HR ingest lags the workout, so an early compute is partial — and writing a partial row removes the
session from `listSessionsMissingSetHrStats`, so the backfill would never revisit it and the partial
would become permanent. The fuller-wins upsert protects the values but not the work-list. A correct
fix makes the work-list coverage-aware first. That is now written up on Q-11 rather than guessed at
in this PR.

The immediate remedy needs no code: Admin → Tools → "Backfill per-set HR stats" drains the gaps
today, and that card's copy was corrected — it used to claim new workouts populate automatically,
which is only true if you open the recap.
