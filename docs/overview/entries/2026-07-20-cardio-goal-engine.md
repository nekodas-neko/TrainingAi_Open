# 2026-07-20 — Multi-goal cardio training engine (F3 Phase 2, part 1: the brain)

**Branch:** `claude/handoff-documentation-w1ud2j` · No version bump (engine foundation — not yet
user-wired; UI PR surfaces it).

Owner asked for goal-specific running plans (speed / distance / heart-health / recovery), weekly
HR-zone time targets, VDOT-based pace prescription for 5K/3K, and progress baselines. This PR builds
the deterministic engine, grounded in a source-cited training-science brief (Seiler polarized 80/20;
WHO/AHA/ACSM 150-min guideline; Daniels VDOT; Norwegian 4×4; Uth VO₂max; HRR autonomic marker).

## What landed (all pure TS, no migration — `goal_kind`/`framework_key` are free-text columns)

- **`lib/health/vdot.ts`** — Jack Daniels' VDOT: `vdotFromRace` (race → VO₂max-equivalent via the
  Daniels/Gilbert VO₂-cost + duration-fraction relations), `pacesFromVdot` (E/M/T/I/R training paces by
  inverting the VO₂ curve at each %VDOT), and `predictRaceTime` (Riegel `t₂=t₁·(d₂/d₁)^1.06`). Validated
  against Daniels' tables: 20:00 5K → VDOT ≈49.8, threshold pace ≈4:15/km.
- **`lib/running/cardio-goals.ts`** — goal registry: `speed` / `endurance` / `heart_health` /
  `recovery` (+ legacy `cardio_health`/`distance_event` aliases), each mapping to a framework and the
  progress markers it's judged by. `defaultFrameworkForGoal`.
- **`lib/running/zone-targets.ts`** — `weeklyZoneTargets(frameworkKey, weeklyMinutes)`: per-zone weekly
  minute targets by goal (speed ≈70/22 easy/hard, endurance 80/20, heart-health Zone-2 dominant,
  recovery all-easy), floored at the 150-min public-health guideline, with a moderate-equivalent check
  (vigorous counts 2×, Z1 excluded as light).
- **Three new frameworks** — `speed-vo2max` (2 quality/wk: VO₂max intervals + threshold + strides, hard
  days spaced), `zone2-base` (heart health: mostly Zone 2, hits 150 min), `aerobic-recovery` (HRR/RHR:
  all easy, no grey-zone grind). Registered in `framework.ts`; endurance reuses the existing
  `polarized-80-20`.
- **Route** — `POST /api/running-plan` accepts the four new goals and defaults the framework from the
  goal (explicit `frameworkKey` still overrides). Existing plans keep their stored framework — no drift.

## Verification

- 19 new unit tests (VDOT vs Daniels, Riegel, goal→framework mapping, per-goal zone splits, framework
  behaviour incl. "no hard back-to-back for speed", "no intervals for heart-health/recovery"). Full
  suite green (1863). tsc + lint clean.

## Next (this feature, following PRs)

Progress/baselines view (markers: RHR, HRR1, VO₂max, 5K/3K TT→VDOT, efficiency, zone distribution) ·
`/running` goal-picker + plan/zone-target UI (version bump lands there) · admin device-data capture
panel · cumulative-stress wiring.
