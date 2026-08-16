# 2026-07-20 — Progress observation ("are you making progress?")

**Branch:** `claude/handoff-documentation-w1ud2j` · **Version:** 1.183.0

Owner request (part of the cardio work): "a good section for recording/observing baselines so the user
knows when they are making progress."

## What landed

- **`lib/health/progress-markers.ts`** — `assessMarker(config, series)` turns a marker's oldest→newest
  series into a baseline (first third) → current (last third) verdict: `improving` / `declining` /
  `stable` / `insufficient`, direction-aware (RHR lower-better; HRR1/HRV/VO₂max higher-better) with a
  per-marker noise floor so day-to-day wobble doesn't read as a trend. Absolute-value **bands** from the
  training-science brief (HRR1: below-normal / normal ≥13 / good ≥18 / strong ≥22 / excellent ≥30;
  VO₂max tiers) + re-test cadence. `assessFromTrends` maps a health-trends series to RHR/HRR1/HRV.
- **`components/health/progress-markers-card.tsx`** — prop-driven card (no extra fetch — reuses the
  health-trends series already loaded on the Heart Rate page) showing each marker's plain-language
  verdict, band, and re-test cadence with an up/down/steady icon.

## Verification

- 7 new unit tests (direction-aware trend, noise floor → stable, HRR1 banding, insufficient-data gate,
  assessFromTrends). tsc + lint clean; full suite green (1882).
- **NOT device-verified:** card render on the Samsung WebView (Known-Issues-gated per Canonical Runtime).

## Cardio feature status (this session)

Shipped: multi-goal running engine + VDOT + zone targets (#681), observed HR profile (#683), progress
observation (this). **Remaining** (see the handoff): `/running` goal-picker UI wiring the new goals +
zone targets + VDOT paces; an admin device-data capture panel (JSON export + failure catches);
cumulative-stress rollup wiring.
