# 2026-07-20 — Surface run-explain narration + prescription volume breakdown (W4 §5.3 / §5.5)

**Branch:** `feat/w4-surface-explain-and-volume` · **Version:** 1.185.0

Owner chose (interactive intake) to **surface** the two W4 dead-field items rather than delete them.

## What landed

- **`running-plan/explain` wired (W4 item 3).** The prescribed-run card (`prescribed-run-card.tsx`)
  now POSTs the deterministic rationale + gate reasons to `/api/running-plan/explain` and renders the
  warmer one-sentence AI restatement in place of the raw rationale. **Never load-bearing:** the
  deterministic `rationale` renders immediately and the AI copy only swaps in when it lands; any
  failure or `degraded` response keeps the deterministic text. gateReasons is joined to a stable
  string for the effect dep so a new array ref per render doesn't re-fire the fetch (route is
  rate-limited 15/hr). Owner note: keep for now, deprecate later if the per-view AI call is excessive.
- **`weeklyVolumeContribution` surfaced (W4 item 5).** The AI-prescription card
  (`ai-prescription-card.tsx`) now renders the already-computed per-muscle weekly volume as
  `{muscle} {sets}/wk` pills (highest-volume first), mirroring the workout-review sheet's
  weekly-impact pill pattern. No route change — it was already computed + persisted, just unrendered.

## Verification

- tsc + lint clean (0 errors). Production build green.
- **Both are new UI on APK surfaces (running screen, workout prescription card) — NOT device-verified.**
  Device-smoke: open a prescribed run and confirm the AI sentence renders (and the deterministic text
  shows if offline/AI-down); open an AI prescription and confirm the volume pills render and sum
  sensibly. Recorded as a Known-Issues item.

## Remaining W4

- Item 7 (exercise-history `isDeload` badge vs drop) — still pending an owner decision.
