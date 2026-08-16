# 2026-08-07 — "Body temp elevated" explainer shows the real numbers

**Domain:** readiness — v1.267.16, JS-only (no APK rebuild)

## The report

Q-105 (owner UI-bug batch): the owner asked whether the "Body temp elevated" banner is gated to
30+ days of baseline data, and wanted the existing "Why this recommendation?" expandable to show
the actual number driving it, so it's clear what's being counted as "illness."

## Confirmed gating, no bug found there

Yes — `TEMP_BASELINE_MIN_DAYS = 30` (`ai-dynamic.ts`). `computeDeloadStrength()` only sets
`tempAlert` (and therefore the `temperatureAlert` field the banner keys off) when
`temperatureDeviation > 0.5°C` **and** `temperatureBaselineDays >= 30`. `temperatureBaselineDays`
is Oura's own accrued-history count for that day's temperature baseline
(`oura_daily_summary.nHistory`), not an app-invented number.

## What "average" can honestly mean here

Oura's API surfaces `temperature_deviation` as a °C delta from the ring's own internally-computed
personal baseline — it does **not** expose an absolute average baseline temperature anywhere in
the v2 API. So "average vs difference" can't literally show two absolute temperatures. The honest
version is **today's deviation vs the 0.5°C alert threshold**, plus **how many nights of baseline
back it** (the 30-day gate) as the confidence number. Deliberately did not build a fabricated
"your average is X°C" figure with no corresponding real data.

## The fix

- `ai-dynamic.ts`: promoted the inline `0.5` magic number to a named `TEMP_ALERT_THRESHOLD_C`
  constant, alongside the existing `TEMP_BASELINE_MIN_DAYS` — per "One Formula, One Place," so any
  future reader of the threshold reuses the same source rather than re-typing `0.5`.
- `packages/shared/src/types/program.ts`: added `temperatureDeviation`, `temperatureBaselineDays`,
  and `temperatureAlertThresholdC` to `NextSessionRecommendation.signals`.
- `lib/data/postgres/adapter.ts`: the raw `temperatureDeviation`/`temperatureBaselineDays` values
  were already computed and passed into `computeAiDynamicNextSession` — hoisted them into local
  variables shared between that call and the `signals` object the caller already builds, and added
  `temperatureAlertThresholdC: TEMP_ALERT_THRESHOLD_C`.
- `deload-explanation.tsx`: the temperature `Signal` entry now renders the real numbers when
  present — `"+0.7°C above your baseline (threshold 0.5°C) — based on 35 nights of history."` —
  falling back to the original qualitative sentence only if the numbers are somehow absent.

## A bundle-hygiene decision worth recording

The natural move would have been importing `TEMP_ALERT_THRESHOLD_C` directly into the client
component (`deload-explanation.tsx`, `"use client"`) to avoid ever duplicating the value. Checked
first: `ai-dynamic.ts` imports `STRESS_HIGH_DAY_THRESHOLD_MIN` from `lib/health/daytime-stress.ts`,
which pulls in the dHRV ONNX inference chain (`runDhrvImputation`) — a heavy, server-oriented
module with no business in a client bundle, and confirmed via grep that `ai-dynamic.ts` is not
imported by any client component today. Rather than make it the first one and drag that inference
chain into the browser, the threshold is sent over the wire as
`signals.temperatureAlertThresholdC`, populated server-side from the real constant. Single source
of truth is preserved (the constant is still defined exactly once), without the bundle cost.

## Verification

`tsc --noEmit -p .` clean (only the pre-existing unrelated `voice-log-button.tsx` error). `eslint`
on all four touched files matches the pre-existing baseline exactly (verified via `git stash` diff
on `adapter.ts`, the only file with pre-existing warnings — identical before and after). Existing
`lib/__tests__/ai-dynamic.test.ts` (34 tests covering `temperatureAlert` under the renamed
constant) still passes unmodified. Full suite: 404 files / 3192 tests green.

Verified the actual rendered output end-to-end against `pnpm dev`, matching the plan's own
verification instruction: seeded an `oura_daily_summary` row for today
(`tempDevC=0.7, nHistory=35`) for the test user. The local seed program defaults to
`phase_mode='manual'`, and this whole code path (`computeAiDynamicNextSession`) only runs for
`ai_dynamic` — temporarily flipped the seed program to `ai_dynamic` mode to exercise it (as done
earlier this session for the Q-109 fix's equivalent gap), confirmed via the live `/api/next-session`
response that `signals.temperatureDeviation: 0.7`, `temperatureBaselineDays: 35`,
`temperatureAlertThresholdC: 0.5` all round-tripped correctly, and confirmed the rendered
"Why this recommendation?" panel showed **"+0.7°C above your baseline (threshold 0.5°C) — based on
35 nights of history."** exactly, in both light and dark themes (screenshotted). Reverted the
program to `manual` and deleted the seeded row afterward so the local dev seed is unchanged going
forward.

**Not exercised:** no on-device S25 verification — pure server-data-plumbing + client text change,
no native/safe-area/gesture involvement.

## Deferred, not built

The plan flagged one open product question it explicitly said needed an owner decision rather than
a guess: should the sub-30-day "baseline still maturing" state surface anything today (e.g.
"gathering your temperature baseline (18/30 nights)"), given it currently renders nothing at all?
This session had no channel to ask the owner mid-implementation, so it was left unbuilt rather than
guessed at. Split off as **Q-105-followup** in `docs/implementation-backlog.md`.
