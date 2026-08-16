# 2026-07-20 — /running goal-picker UI + weekly zone targets (cardio Phase 2)

**Branch:** `claude/handoff-documentation-w1ud2j` · **Version:** 1.184.0

Surfaces the multi-goal cardio engine (#681) in the app.

## What landed

- **`components/running/plan-setup-sheet.tsx`** — the setup sheet now offers the four selectable goals
  from `SELECTABLE_CARDIO_GOALS` (Get faster / Go further / Heart health / Recovery & resilience) with
  their blurbs, and a target-distance selector (3K/5K/10K/Half/Marathon) for goals that need one. POSTs
  `{ goalKind, targetDistanceKm? }` — the route defaults the framework from the goal.
- **`app/api/running-plan/route.ts`** (GET) — response gains `zoneTargets`
  (`weeklyZoneTargets(plan.frameworkKey, weeklyBaseMinutes)`) and `goal` (label + blurb).
- **`components/running/weekly-zone-targets.tsx`** — per-zone weekly minute bars (coloured from the
  canonical `HR_ZONE_META`, newly exported from `hr-zones.ts`) + the goal label, easy/hard split, and the
  150-min public-health guideline note. Rendered on `/running` under the day's prescription.

## Verification

- tsc + lint clean; full suite green (1882).
- End-to-end on real Postgres: saved a `speed` plan → framework `speed-vo2max`, `weeklyZoneTargets`
  computed (5 zones, meets the 150-min guideline), goal resolved to "Get faster".
- **NOT device-verified:** the sheet + zone-target card render on the Samsung WebView, the offline-first
  plan-completion round-trip, and safe-area (Known-Issues-gated per Canonical Runtime).

## Cardio status

Engine #681 · observed-HR #683 · progress observation #685 · **goal-picker UI (this)**. Remaining:
admin device-data capture panel; cumulative-stress rollup wiring (see
`docs/superpowers/plans/2026-07-20-cardio-system-remaining.md`).
