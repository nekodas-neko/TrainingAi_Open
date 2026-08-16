# 2026-08-07 — Wire the Today's Timeline sleep cards to the per-night detail view

**Domain:** app-shell / sleep — v1.267.8, JS-only (no APK rebuild)

## The report

Q-93-followup (owner UI-bug batch, split off from Q-93): the "Woke up"/"Fell asleep" Today's
Timeline cards were left non-interactive when the meal card shipped, because the plan's premise —
that sleep-card wiring was "straightforward" — didn't hold up at `/health/sleep`
(`SleepContent` has no date-selection UI, always renders the latest night).

## Finding a real destination

`/health/sleep` genuinely has no per-night selector, but a second, separate surface does:
`HealthMetricSheet`'s sleep sheet (opened from the Body tab's Sleep card on `/health`) already
lists and renders full detail — hypnogram-style stage breakdown, HRV, efficiency — for any of the
last 14 nights via its `sleepReadings` prop and `selectedSleep` state. The only piece missing was a
way to tell it, from outside, which night to open with instead of the list.

## The fix

- `app/api/day-timeline/route.ts`: the `date` field (added for the meal-card fix) is now also
  populated on the "Woke up" and "Fell asleep" events specifically (it was already computed for the
  `day` bucket, just not attached to these two event objects).
- `components/home-day-timeline.tsx` and `app/health/timeline/page.tsx` (sibling-surface sweep):
  both timeline renderers' tap logic changed from a single meal-only ternary to an if/else-if chain
  — wakeup/sleep events now navigate to `/health?tab=body&openSleepDate=${date}` (the Sleep card
  lives in the Body tab's card order, not Training — confirmed against `BODY_GROUPS` in
  `health-content.tsx` before wiring the link, not assumed).
- `app/health/health-content.tsx`: reads `?openSleepDate=` on mount, sets `metricSheet('sleep')`
  and a new `initialSleepDate` state to pre-select that night.
- `components/health/metric-sheets.tsx`: threads `initialSleepDate` through to the sleep
  `HealthMetricSheet` as `initialDate`.
- `components/health-metric-sheet.tsx`: new `initialDate` prop + effect that finds the matching
  reading in `sleepReadings` and calls the existing `setSelectedSleep` — reusing the sheet's own
  list/detail toggle rather than adding a second rendering path. Falls back silently to the list if
  the date isn't in the loaded 14-night window (same as any other no-data case here).

## Verification

Typecheck clean on all six touched files (the pre-existing `voice-log-button.tsx` missing-module
error is unrelated, confirmed via `git status` — that file isn't touched). Lint clean except two
pre-existing warnings (an unused `MapPin` import and a ternary-as-statement, both confirmed
pre-existing via diff, not introduced here). Full suite: 401 files / 3,175 tests green.

Ran `pnpm dev` against the seeded local DB and exercised the real path: no sleep session exists for
today's date in the seed data, so tested the actual integration point directly —
`/health?tab=body&openSleepDate=2026-08-03` (a seeded night) — with Playwright in both light and
dark themes. Confirmed the sheet opens straight to that night's detail view (header shows
`2026-08-03`, sleep-stage breakdown rendered) rather than the list, in both themes.

**Not exercised:** the actual timeline-card tap on a day with a real "Woke up" event (seed data's
latest sleep session is several days behind today's date, so no such card renders on the seeded
home timeline right now) — verified instead by driving the same `?openSleepDate=` URL the tap
handler constructs, which exercises every layer downstream of the click. No on-device confirmation
of tap-target sizing/feedback on the S25 — this project has no component-test/Playwright infra
wired into CI, this was a manual check.

## Remaining scope

The workout timeline card is still non-interactive — Q-93-followup's entry is scoped down (not
removed) to just that piece: it needs a historical per-session HR-chart + exercise-detail screen
that doesn't exist yet at all, genuinely new screen work.
