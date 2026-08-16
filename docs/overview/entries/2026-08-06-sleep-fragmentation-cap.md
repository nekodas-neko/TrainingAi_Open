# 2026-08-06 — Sleep Score gets an awake-time fragmentation cap

**Domain:** sleep — v1.267.0, JS/server-only (no APK rebuild)

Owner reported last night's sleep as bad — on call, woken repeatedly by work calls — and asked how
that translated into the data. It scored **89, "High"**. This session traced why, tried and
rejected two other designs, and shipped a standalone cap.

## Why 89 was defensible under the existing model, and wrong anyway

Contributor breakdown for the night: `totalSleep` 97, `hrv` 100, `hr` 100, `schedule` 99, `timing`
88 — all normal, because the night was long (8.5h) and autonomically unremarkable (HRV 66ms was
*above* the personal baseline). Only `efficiency` (58) and `restfulness` (62) reflected the
disruption, and together they're 18 of 110 weight — diluted into invisibility by everything else
looking fine.

This reproduces a finding already sitting in the backlog: **Q-72**, measured 2026-08-04 against 32
owner-rated nights — Sleep Score mean 91.3, sd 4.4, range 80–98, while the owner's own 1–5 feel
rating used the full scale. Worst-of-month (rated 5) scored 80; best-of-month (rated 1) scored 92–93.
The score barely uses its own range.

## Two designs tried and rejected before this one

1. **Reweight + steepen the existing curves** (shift weight from `hr`/`schedule` into
   `efficiency`/`restfulness`, steepen the efficiency and awake-penalty curves). Backtested against
   29 BLE-era nights paired with `sleep_quality_feel`: moved the target night (89→79) but barely
   moved the feel-correlation (−0.454 → −0.474), because the two worst-feel nights in the dataset
   (2026-07-21, 2026-07-26) aren't fragmentation nights at all — one has nothing wrong on any axis,
   the other fails only on HRV/HR, already scored. Reweighting a contributor that isn't the problem
   doesn't fix nights failing on a different axis.
2. **Wire `sleep_quality_feel` into the score directly** — this is Q-102, already scoped with a
   plan (`feat/sleep-feel-score-adjustment`). **Owner explicitly declined it live in this session**:
   doesn't want the self-report driving the score, wants it kept independent for backlog/model
   calibration (preserves the 2026-07-27 Q-16 decision Q-102 would have reversed). Q-102's backlog
   entry is marked declined; do not implement without the owner reopening it.
3. **`restlessPeriods` as the fragmentation signal** — tried, then rejected on real data. The
   disrupted night and 2026-07-17 (the single best-rated night of the prior month) carry the
   **same** `restlessPeriods` value (4). For this ring, in this range, it's noise, not a separator.

## What shipped

`awakeFraction` (time awake ÷ time asleep+awake) turned out to be the real signal: last night's
value was the 2nd-highest of the calibration window, several standard deviations above the
sleeper's own trailing mean — unlike `restlessPeriods`, it actually separates.

`packages/shared/src/health/sleep-score.ts` adds a **standalone cap**, not another weighted
contributor: `finalScore = min(weightedBlendScore, awakeFractionCap(z))`, where `z` is this
night's awake fraction expressed as personal standard deviations from a trailing baseline
(`sleepScoreBaselines` now also returns `awakeFractionBaselineMean`/`awakeFractionBaselineSd`,
gated on `SLEEP_AWAKE_FRACTION_BASELINE_MIN_NIGHTS = 14` prior main sleeps — higher than the
7-night gate on `hrv`/`hr`/`schedule` because a hard cap misfiring off a noisy sd estimate is a
bigger risk than a smoothly-blended contributor being slightly off). `SleepScoreResult` gains
`preCapScore` (the pre-cap weighted blend, for audit transparency) and `fragmentationCap` (null
unless the cap actually fired). Every caller (`readiness-score`, `body-battery`, `weekly-digest`,
`sleep-trend`, the resilience model in `adapter.ts`, the admin day-review audit) goes through
`sleepScoreBaselines()` → `computeSleepScore()` already, so the new baseline fields flow through
automatically with no call-site changes — confirmed by grepping every non-test call site first.

Deliberately **not** folded into `SLEEP_WEIGHTS`/the renormalising blend: it only ever lowers a
score, never raises one, so a genuinely clean night's ability to reach 100 is untouched by
construction (pinned by a new test). The admin day-review audit (`score-audit/sleep.ts`) surfaces
`preCapScore`, the baseline mean/sd, and a note when the cap fires, so it's inspectable rather than
a silent adjustment.

## Backtested against the real function and full production history, not a re-implementation

Ran the actual shipped `computeSleepScoreSeries` against all 53 nights of real production
`sleep_sessions` history (2026-05-26 → 2026-08-06). Confirms the design goals held:

- **Fires correctly on genuine outliers already in the data**: 2026-07-11 (z=3.00, weighted blend
  76 → capped 32), 2026-07-04 (z=1.88, 86 → 76).
- **Touches nothing else** — the other 51 nights, including every clean one, score identically to
  before.

## One honesty note

The specific night that motivated this — 2026-08-06 — was re-queried mid-session and its
`awake_hours` had been **revised downward by the live BLE rollup** between the first read and the
final one (1.92h → 1.17h; `updated_at` moved to 02:37 UTC, after the earlier reads). Under the
corrected numbers, that night's z-score is 0.99 — just short of the cap threshold, so the shipped
mechanism does **not** cap last night's score specifically. The design and the code are correct and
proven against other real nights in production (07-11, 07-04 above); this one particular night
turned out milder than the ring's still-catching-up numbers first suggested. Not re-tuning the
curve to force this specific night to trip — that would be fitting the threshold to one data point
after the fact, which is exactly the p-hacking failure mode the personal-baseline design exists to
avoid.

## Not exercised

Web-sandbox only — no device/APK verification needed (JS/server-only change, no native paths
touched). Not verified against the live app UI (Health screen, weekly digest) in a browser; only
verified via unit tests and a direct backtest against `computeSleepScoreSeries`. The score consumers
render whatever `computeSleepScore` returns, so this should flow through unchanged, but a visual
check of the Health screen's Sleep Score card on `pnpm dev` was not done this session.
