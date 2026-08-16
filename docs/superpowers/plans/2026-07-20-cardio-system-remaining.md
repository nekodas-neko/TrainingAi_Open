# Cardio training system — remaining work (handoff, 2026-07-20)

The goal-based cardio system the owner asked for (speed/distance/heart-health/recovery plans, HR-zone
weekly targets, VDOT paces, progress baselines, observed HR profile) is **built at the logic + data
layer and partly surfaced**. This is the handoff for the remaining pieces. Each is its own PR.

## ✅ Shipped this session (do not redo)

| Piece | Where | PR |
|---|---|---|
| Multi-goal engine — VDOT (`vdotFromRace`/`pacesFromVdot`/`predictRaceTime`), goal registry (`cardio-goals.ts`), weekly zone targets (`zone-targets.ts`), 3 frameworks (`speed-vo2max`/`zone2-base`/`aerobic-recovery`) | `lib/health/vdot.ts`, `lib/running/*` | #681 |
| Robust observed HR profile — min/max/avg with spike rejection, observed-vs-estimated max, %-of-max | `lib/health/observed-hr.ts`, `/api/hr-profile`, `components/health/observed-hr-card.tsx` | #683 |
| Progress observation — baseline→current verdict per marker (RHR/HRR1/HRV) with bands + cadence | `lib/health/progress-markers.ts`, `components/health/progress-markers-card.tsx` | #685 |

The engine is grounded in `docs/` training-science research (Seiler 80/20, WHO/ACSM 150-min, Daniels
VDOT, Norwegian 4×4, Uth VO₂max, HRR bands) — the constants carry inline citations.

## 🔧 Remaining (each a PR)

### 1. `/running` goal-picker UI (Cardio-3) — surfaces the engine to the user
- **Scope:** the `/running` screen currently creates a plan with the legacy default. Add a goal picker
  from `SELECTABLE_CARDIO_GOALS` (`lib/running/cardio-goals.ts`) → `POST /api/running-plan` with the
  chosen `goalKind` (the route already accepts `speed`/`endurance`/`heart_health`/`recovery` and
  defaults the framework). For a `speed`/`endurance` goal collect a target distance; for `speed`, if the
  user has a recent 5K/3K, show predicted paces via `pacesFromVdot(vdotFromRace(...))`.
- **Also surface** the weekly HR-zone targets: extend the `GET /api/running-plan` response with
  `weeklyZoneTargets(plan.frameworkKey, weeklyMinutes)` and render the per-zone minute bars + the
  150-min guideline note.
- **Files:** `app/running/*` / `components/running/*`, `app/api/running-plan/route.ts` (GET response).
- **Verify:** `pnpm dev` goal-pick → plan renders with zone targets; **device-smoke** the offline-first
  completion + safe-area (per Canonical Runtime — Known-Issues row).

### 2. Admin device-data capture panel + JSON export (Cardio-4) — ✅ SHIPPED (admin R&D)
> Shipped: `components/admin/data-capture-console.tsx` (generic probe runner, per-probe try/catch, JSON snapshot + copy) + admin-gated `app/admin/data-capture/page.tsx`, linked from Admin → Tools. Native probes APK-only.
- **Scope:** an admin page that records the device-gated captures the owner needs (BLE metric validation
  vs Oura baselines, ring-step enable/decode, HRR, live-HR %max, etc.), each as a labelled JSON blob the
  owner can copy/export, with **explicit per-step try/catch that surfaces the exact failure** (which
  plugin/route failed and why) rather than a silent empty state. Mirror the existing `/admin/oura-ble`
  console patterns (`components/oura-ble/*`, admin-gated routes).
- **Files:** new `app/admin/data-capture/*` + `components/admin/*`; reuse `getLocalStore`/plugin guards.
- **Verify:** dev-server renders the panel + JSON export shape; **APK-only** for the actual native
  captures (Known-Issues row) — the whole point is the owner runs it on-device to collect data.

### 3. Cumulative-stress rollup wiring (task 17) — was owner-gated, now GO
- **Scope:** the `cumulative_stress` model (`lib/oura-models/cumulative-stress.ts`, already a
  golden-verified port) needs two per-5-min HRV series the rollup doesn't compute:
  `hrv_medianHR_5min` + `hrv_quality_5min`. Add them to `aggregateOuraRawSamples`
  (`lib/data/postgres/adapter.ts`), then wire the model to compute + persist to `oura_daily_derived`.
  **Touches the Oura god-file rollup** — serial-track discipline; additive columns only.
- **Verify:** DB-backed test against local Postgres (the rollup is testable, cf.
  `oura-ble-aggregate.test.ts`).

## Next-marker hookups (small follow-ups within the above)
- Progress-markers currently covers RHR/HRR1/HRV. Add **VO₂max** (from `fitness_tests` + `vo2max.ts`)
  and **5K/3K TT → VDOT** (from logged runs via `vdot.ts`) to `assessFromTrends` once the running UI
  feeds those series — the `MARKER_CONFIGS.vo2max` band table is already there.
- Live "%-of-current-max" during a workout: `live-hr-chart.tsx` can read `workingMax` from
  `/api/hr-profile` and show `pctOfMax(liveBpm, workingMax)` — device-gated.
