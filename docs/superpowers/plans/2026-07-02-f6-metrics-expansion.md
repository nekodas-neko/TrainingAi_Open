# F6 — Metrics expansion

> Source: `docs/planned_upgrades.md` § F6 (session-178 audit). Four tiers = four PR-sized chunks, in order — each tier stands alone and earlier tiers are pure wins on already-stored data. F2 (tags/session sync) and F3 (set telemetry) are separate items with their own batch-F plan; don't fold them in here.

## Chunk 1 — Tier 1: pure compute on stored data

1. **Wear-time confidence signal.** `nonWearTimeSec` becomes a signal, not just a display: (a) a `wearConfidence(day)` helper in `lib/` (worn hours = `(86400 − nonWearTimeSec)/3600`; low-confidence below a threshold, default 18h, constant in the helper); (b) dim/badge HRV/RHR/readiness values on low-wear days in the health cards; (c) exclude low-wear days from the HRV/RHR baselines in `signals.ts` and `readiness-score` — grep both baseline computations and apply the same filter in one shared spot per the one-formula rule; (d) wear-time trend sparkline on the Oura section.
2. **Workout density + session-duration trend** — new derivations over `exercise_logs.volume` and session `startedAt→completedAt`; add to `/api/health/trends` and render in Health → Training (reuse `TrendSparkline`).
3. **Per-exercise RPE trend chart** — surface the existing `signals.ts` `rpeTrend`/per-exercise deltas via a small API read + chart on the exercise stats sheet. Read-only reuse; do not fork the computation.
4. **HRV baseline-deviation card** — `readiness-score` already returns `baselineHrv`/`recentHrv`; render standalone on the health Body tab.
5. **Protein/kg + steps/water trends** — extend `/api/health/trends` (protein ÷ latest `body_metrics.weight`; steps/water series already stored).

**Verify:** each new number spot-checked by hand against a SQL query on the local dev DB (seeded data covers workouts/body metrics/sleep); charts render with <14 days of data (empty/partial states).

## Chunk 2 — Tier 2: light aggregation

6. **Training monotony & strain (Foster)** — mean÷SD of daily load over 7d and strain = weekly load × monotony, computed where `training-load` already gathers the series; show beside ACWR with band labels. One formula, one place: put the math in `lib/` next to the ACWR implementation *(note: C5's ACWR unification may land first — build on whichever is canonical)*.
7. **Nutrition logging adherence** — logged-days ratio vs `meal_types.required` over 7/28d; new small computation in the nutrition weekly summary.
8. **Sleep consistency** — SD of `sleep_sessions.sleepStart` (careful: times cross midnight — compute variance on minutes-from-noon or unwrap ±12h); cross-check displayed value against the stored `sleep_regularity` contributor and show both.
9. **Tonnage-per-muscle weekly trend** — extend `getWeeklySetsByMuscleGroup` with tonnage + a multi-week series param; render in the muscle-volume card's detail view.
10. **Bodyweight rate-of-change vs goal band** — extend `lib/health/long-term-goal-progress.ts` with kg/week over a 14-day regression vs the goal band.

**Verify:** unit tests for monotony/strain, sleep-start variance (midnight wrap!), and rate-of-change; UI spot-check per card.

## Chunk 3 — Tier 3: new ingestion ✅ shipped (v1.109.0)

11. **Persist the fetched-but-dropped Oura fields** — `breathing_disturbance_index` (spo2 object already fetched, only `average` stored — `sync/route.ts:249`), `daily_activity.resting_time` + MET minutes, sleep `time_in_bed`. New nullable columns via the next free Postgres migration number (**claim it against the directory AND open PRs/plans per the migration rule**); COALESCE upserts backfill on next sync. Surface the already-stored `avgHeartRate`, `restlessPeriods`, `sleepTimeRecommendation` in the sleep detail page.
12. **Webhook handlers for the subscribed-but-unhandled types** (`daily_spo2`, `daily_stress`, `daily_cardiovascular_age`, `daily_resilience`, `vo2_max`) — mirror the existing readiness/sleep/activity handler shape in the webhook route, writing to the same columns the pull sync fills. Per the external-API rule: verify each payload's field names against the bundled Oura OpenAPI, and prove a non-null value lands in the DB column (fire a signed test payload at the local route) before calling it done.

**Verify:** migration applies on the local DB; a full `POST /api/oura/sync` (mock or recorded fixtures) lands non-null values in every new column; webhook test payloads accepted + rows written. ⚠️ Real Oura webhook delivery is prod-only — state it as the unexercised surface.

## Chunk 4 — Tier 4: data-quality surfacing ✅ shipped (v1.109.0)

13. **Sync freshness indicator** — "last synced N min ago" from `oura_daily.syncedAt`/`body_metrics.updatedAt` with a stale threshold, plus **outbox depth** (pending-mutation count) — render on the sync-health card that Batch A ships (if A's card hasn't landed yet, this chunk waits; don't build a second card).

## Wrap-up (per chunk)

- `pnpm tsc --noEmit && pnpm lint && pnpm test`; exercise each new card/chart on `pnpm dev` against the seeded local DB.
- Minor version bump per shipped chunk (new features) + changelog; tick F6 bullets in `planned_upgrades.md` as they land.
- Unexercised surfaces to declare: real Oura data/tokens (fixtures only locally), webhook delivery, on-device rendering.
