## 2026-07-23 — Health & workout fixes round 3 (v1.201.0)

Owner feedback batch (on-device screenshots across Home / Health / Workout). Six shipped; three
findings handed back (data/device-gated).

### Shipped
- **Morning check-in: removed the Resting-soreness scale** (overlapped with Recovery). The
  `restingSoreness` column stays on `DayCheckin` (always null now); per-muscle soreness unaffected.
  `soreness-volume`'s whole-body branch now keys off per-muscle soreness only (null-safe).
- **Body-temp deload gated to ≥30 nights of baseline** (`TEMP_BASELINE_MIN_DAYS`, ai-dynamic).
  Threaded `temperatureBaselineDays` (= `oura_daily_summary.n_history`) through the next-session
  input; the frozen pre-re-key Cloud value reports 0 nights so it can't fire either. +2 tests.
- **Reworded the pre-workout readiness card** so it's clear the check-in tunes today's session
  (lighter loads on sore muscles, can flag deload/rest), not the whole plan.
- **Golden-zone colouring on the `MetricScale` vs-recent ranges** (Heart & Recovery + sleep-night
  detail) — `optimal="low|high|mid"` paints green/amber/red by metric direction.
- **Energy-budget prompt** (`EnergyBudgetPrompt`): when the budget can't compute (missing
  height/age/sex) the card shows a "set up your energy budget" prompt linking to `/profile` instead
  of vanishing silently.
- **Consolidated the heart section:** extracted a self-fetching `HrDayCard` and moved the 24h HR
  graph out of `OuraSection` into the Heart & Recovery section (next to RHR/HRV/SpO₂ + the already-
  adjacent Live-HR card). Removed the now-dead HR-day fetch/state from `oura-section.tsx`.

### Verification (sandbox)
`tsc` + lint clean; ai-dynamic + ai-periodization tests pass (46); `/health`, `/workout`,
`/session-select` render 200.

### Findings handed back (NOT code-fixed this round)
- **Home — Activity blank:** not a bug — the own-activity score needs *today's* steps/active-calories
  (Oura Cloud frozen). Blank at 7am before any movement synced. Owner chose to leave the hint for now.
- **Health — Sleep hypnogram:** renders only with a 5-min sleep-phase string (`sleepPhase5Min`),
  which comes from the on-device BLE SleepNet rollup — device/pipeline-gated, not front-end.
- **Workout — nav dots:** already 6px in `main` (QA round 1, older than the v1.199.1 features on the
  device). The big-dots screenshot is a stale cached bundle — awaiting owner re-confirm on latest.

### NOT device-verified
Energy-prompt link, heart-section reshuffle look, and the range-bar zones render in-sandbox but the
S25 pixel look (both themes, safe-area) is unconfirmed.
