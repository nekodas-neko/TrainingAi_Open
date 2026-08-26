# Heart rate — domain index

**Owns:** live HR, HR zones and zone quotas, max-HR resolution, HRV and RHR as *metrics*, per-set
HR during workouts, and HR-recovery profiles.

**Does not own:** the radios that produce HR — ring, chest strap, their connection and
precedence — which are [`devices`](../devices/README.md). Zone-based pacing of a run is
[`cardio`](../cardio/README.md).

## Code

| Area | Where |
|---|---|
| Live HR | `lib/live-hr/` |
| Zones & max HR | `lib/health/hr-zones.ts`, `zone-minutes.ts`, `zone-quota.ts` |
| Smoothing & windows | `lib/health/hr-smoothing.ts`, `hr-window-merge.ts`, `observed-hr.ts`, `hr-episode-detection.ts`, `hr-change-display.ts` |
| HRV | `lib/health/rmssd.ts`, `hrv-5min.ts`, `hrv-frequency.ts`, `tachogram.ts`, `daytime-hrv.ts`, `daytime-hrv-model.ts` |
| Recovery profiles | `lib/health/hr-recovery-profile.ts`, `compute-hr-recovery-profile.ts`, `hr-recovery-by-exercise.ts`, `hr-recovery-trend.ts`, `hr-profile.ts` |
| Tables | `body_metrics` (hrv_ms, resting_heart_rate), `set_hr_stats`, `workout_hr_stats` |

**Max HR resolves in exactly one place** — the resolver was consolidated in v1.226.3; don't add a
second copy. Same for zone thresholds.

## Reference docs

- [`docs/reviews/2026-08-26-pillar-review.md`](../../reviews/2026-08-26-pillar-review.md) — **the five Home pillars answered, 2026-08-26.** The HR tile's "52" is the **7-day average** resting HR (`oura-score-chip-row.tsx:390` → `readiness.restingHr`). Measured over 50 nights: the nightly value moves **2.11 bpm** night to night, the tile's average **0.33** — **it discards 84% of the movement**, in the signal that is the *strongest* predictor of the owner's own check-in (r = **+0.557**, best of nine). Filed **TN-13**: show last night's value with its delta against baseline. **Do not swap in HRV** — more responsive, less correlated with felt state (+0.427).
- [`docs/reviews/2026-08-15-pillar-model-soundness-review.md`](../../reviews/2026-08-15-pillar-model-soundness-review.md)
  — §4: reviewed for model soundness and **came back clean**. Observed max **168 bpm** over 57,494
  samples independently corroborates the figure Q-57 adopted over `220 − age`; `daily_zone_minutes`
  stores `max_hr`/`resting_hr` per row. No entries filed.
- [`docs/oura-ring-data-reference.md`](../../oura-ring-data-reference.md) — which HR/HRV fields
  the Oura v2 API actually exposes and what they mean (`average_hrv` is rMSSD; `lowest_heart_rate`
  is the RHR proxy).
- The `polar-h10-ble` skill — the chest strap's HR service and RR intervals.
- Plans: `ls docs/superpowers/plans/*hr*` (15 today — the glob also catches non-HR names, skim it).

- Reviews: [`docs/reviews/2026-08-07-full-app-review.md`](../../reviews/2026-08-07-full-app-review.md) — **full-app deep review, 2026-08-07** (saving/caching/performance/logic across all 201 routes and 40 pages; 53 findings queued as Q-117…Q-138, plus root cause for Q-73 and mechanisms for Q-72/Q-107)

- [`docs/reviews/2026-08-18-ingest-and-input-validation.md`](../../reviews/2026-08-18-ingest-and-input-validation.md) — **the ingest surface and input validation, 2026-08-18** (heart-rate ingest rejects `-50` and `99999` bpm; no findings specific to this pillar). Findings Q-464/Q-465; **no ingest route accepts a `userId` from the body, and value validation rejects physiologically impossible input on every route reachable in the harness.**

- [`docs/reviews/2026-08-18-hr-rest-threshold-calibration.md`](../../reviews/2026-08-18-hr-rest-threshold-calibration.md) — **first calibration review of this pillar, 2026-08-18** (Q-515 — `HR_REST_THRESHOLD` is the rest/active boundary shared by Body Battery and the Activity Score, and its charge window collapsed **26.5% → 8.2%** of waking samples in one month. **Every input was correct**: a genuine fitness gain plus `resolveHrProfile` maturing `hr_max` from the age formula to an observed ceiling. The trap is a rate difference — resting HR fell 8.5 bpm while waking HR fell 4.2 — so a boundary pinned to resting moves twice as fast as the distribution it classifies. Sweeping the constant narrows the gap 3.2× → 1.4× but never closes it: **the anchoring is the defect, not the number**). **Part 2 / Q-516** — `PEAK_BANDS` is calibrated for a range strength training never reaches: observed set-peaks are **59–132**, so `150–169` and `170+` are **structurally unreachable**, `130–149` holds 2 episodes, and **72%** land in the `<110` band the spec de-emphasises — leaving **one usable bucket**. The de-emphasis is correct (`drop_60s` 3.0 below 110 vs 14.9 above), so re-banding recovers no hidden signal.

- [`docs/reviews/2026-08-19-zone-minutes-move-hours-coverage.md`](../../reviews/2026-08-19-zone-minutes-move-hours-coverage.md) — **the two HR-derived Activity contributors, coverage-checked 2026-08-19**
  (Q-522/Q-523 — the direct continuation of Q-515 and Q-516 above. Q-515's boundary problem, seen
  from the Activity Score: at `HR_REST_THRESHOLD = 0.05` the rest boundary is **59.7 bpm** while the
  owner's waking HR runs p50 **69** / p90 **88**, so **856 of 857 waking hours** count as "moved".
  Q-516's banding problem, in a second consumer: `ZONE_DEFS` puts Zone 2 at **133 bpm** and only
  **0.29%** of chest-strap samples reach it, so zone minutes are **0 on 53 of 59 days**. Also measures
  the ring's sampling cadence — an exact **300 s**, against a `DEFAULT_MAX_GAP_SEC` of 120 whose own
  comment says a ring samples ~1/min — which truncates **80.1%** of ring intervals.)

- [`docs/reviews/2026-08-19-active-minutes-who-threshold.md`](../../reviews/2026-08-19-active-minutes-who-threshold.md) — **`maxHr` vs `targetAnchorMax`, and the WHO band mismatch, 2026-08-19.**
  `resolveHrProfile` resolves **two** ceilings on purpose: `maxHr` uses the observed max only when it
  is ≥ age-predicted (so a soft month cannot make ordinary efforts read as maximal), while
  `targetAnchorMax` uses the corroborated observed max for *reachable* targets. Measured:
  `estimatedMax` **187**, `observedMax` **167** (5th-highest of 72,519 readings, `CORROBORATION = 5`).
  **Active-minutes must anchor on `targetAnchorMax`; %-of-max effort math keeps `maxHr`.** Third
  consumer of the Q-515/Q-516 banding problem.

## Open issues

```bash
grep -n '^### .*\[heart-rate\]' projectOverview.md   # 12 entries today
grep -n '\[heart-rate\]' docs/implementation-backlog.md   # 4 queue items today (Q-522, Q-523 added)
```

Live at the time of writing (2026-08-05):

- ✅ **The activity detail sheet's HR chart had never rendered** (found + fixed 2026-08-09,
  v1.276.1). `/api/oura/hr-window` gated its time params on `HH:MM` while the sheet sends the
  Postgres `time` column verbatim (`HH:MM:SS`), so every call from that sheet 400'd before the
  handler and the chart/zone breakdown/route colouring stayed empty. See
  [`the journal entry`](../../overview/history-2026-08-08.md).

- 🟡 **Q-11 — attribution timing fixed, device-side coverage question still open.**
  `workout_hr_stats` being empty (Defect A) and a session never getting attributed unless its recap
  was opened (Defect B) are both fixed as of v1.257.2/v1.266.1. What's left: a large share of
  existing `set_hr_stats` rows have `coverage_ok=false`/null `peak_bpm` — needs re-measurement now
  that new sessions attribute same-day instead of days-late, before concluding anything about real
  device dropout rates.
- **D5 own daytime-HRV** ships behind a cold-start gate and is not device-verified.
- **D6 comparison harness** (ring vs strap) is not device-verified and its ±5 bpm band is
  unvalidated.
- Live-HR smoothing, the per-set "Heart & Recovery" card, and the rest-only in-workout HR replay
  are all shipped but unverified on device.
- **The home "Heart Rate · Today" chart's bucket width is now a `bucketMinutes` prop (default 10,
  up from a hardcoded 5) and supports an opt-in `showBackfill` dashed line across coverage gaps
  20min–2h wide.** Shipped only at the home widget call site; the other three `HrDayChart`
  consumers keep the smoother default bucket but no backfill. Not verified against the real
  `localStorage`-gated home widget toggle — see
  [`docs/overview/history-2026-08-04.md`](../../overview/history-2026-08-04.md).

## History

- Handoffs: `ls docs/handoff-*-heart-rate-*.md`
- Journal: `grep -rl 'live.HR\|HRV\|hr-zone' docs/overview/entries/`

## Gotchas specific to this domain

- **HRV field naming has shipped dead twice** — Oura's is `average_hrv` (rMSSD); Health Connect's
  is `Rmssd`, not `Sdnn`. Verify against the pinned source, then prove a non-null value lands in
  the column.
- **The ring's PPG sleeps when worn-idle.** No live HR at a desk is firmware power-gating, not a
  bug.
- **RR intervals and bpm must agree** — `rrContradictsBpm` in `lib/validation/plausibility.ts`
  exists because they didn't.
