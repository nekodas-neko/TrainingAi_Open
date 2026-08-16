# 2026-08-05 — Q-76: the fix was already written, it just wasn't called

**Domain:** sleep — v1.261.0, JS/server only (no `android/**`, no migration)

The backlog entry asked for two new things: a read-time merge rule for split nights, then a shared
`isAnalysableNight()` predicate applied at every sleep-analysis read site.

Neither was built. `nightSessions()` in `packages/shared/src/health/sleep-night.ts` already does
both — it classifies by circadian midpoint (so a nap can never enter a night), merges night windows
separated by up to `MAX_INTRA_NIGHT_GAP_HOURS = 3`, and collapses each night into one scoreable
session. It shipped with the F-1 fix and was wired into readiness, body-battery, weekly-digest, the
score audit and `sleepScoreTrend`. Eleven other read sites were simply never converted.

So the work was a sibling-surface sweep, not a new rule. Adding a second predicate beside the
existing helper would have been the "One Formula, One Place" failure this codebase keeps paying for.

## Checking that against the real rows first

Before touching anything, the 66 production `sleep_sessions` rows were pulled and run through
`groupSleepPeriods`/`nightSessions` with `Australia/Brisbane`:

```
rows=66 nights=54
under-4h: raw=14  nights=2
```

That matches the entry's three groups exactly: 11 group-A naps dropped, group B (2026-05-29)
merged into one 6.55 h night, group C's two truncated rows still short because nothing at read time
can recover them.

## What the bug was actually worth

Reconstructing `/api/sleep-performance-correlation`'s date → duration map both ways:

| date | before | after |
|---|---|---|
| 2026-07-04 | **0.11 h** | 8.22 h |
| 2026-07-07 | **0.33 h** | 7.86 h |
| 2026-07-10 | **1.42 h** | 8.83 h |
| 2026-07-16 | **0.25 h** | 7.33 h |
| 2026-07-21 | **1.33 h** | 7.75 h |
| 2026-07-26 | **0.00 h** | 7.00 h |
| 2026-05-29 | 4.02 h | 6.55 h |

**7 of 54 x-values were wrong, six of them by about eight hours.** Every one of those dates was
bucketed as `<6h` when it belonged in `8h+`. The cause is one line — `sleepByDate.set(s.date, …)`
in a loop over raw rows, so on any date carrying both a nap and a night, whichever came back last
won. It wasn't a subtle statistical problem; it was last-write-wins on a `Map`.

## The eleven sites

`sleep-performance-correlation` · `health-trends` (`meal-timing`) · `progress-summary` ·
`user/bedtime-estimate` · `ai/health-insight` · `nutrition-goals/recommend` · `ai-chat` ·
`ai-chat/tools` `getRecoveryData` · `ai-chat/tools` `getRecoveryVsPerformance` ·
`sleepDurationTrend` (so `adapter.ts:getNextSession` + periodization signals) ·
`running/assemble-plan-context`.

**Four were deliberately left on raw rows, and now say why in a comment:** `day-timeline` and the
sleep list render actual sleep events (naps included), `oura/hr-day` wants the day's real windows,
and both daytime-HRV paths (`oura-ble/device-metrics`, `maybeRefitDaytimeHrvModel`) use sleep
windows to *exclude* sleep from a daytime curve — excluding naps there would be the bug.

## The one that was worse than a correlation

`sleepDurationTrend` is not a chart. It is the recent-3-vs-baseline ratio that the AI-dynamic path
gates on at 0.85, and it feeds the periodisation signals. Its sibling `sleepScoreTrend` was given
the nap filter when F-1 was fixed; the duration variant was not. A single 0.33 h nap in the recent-3
window drops the ratio by roughly a third on its own.

It also counted a row with **no duration** as **0 hours**, documented as "legacy parity with
signals.ts". That parity manufactured precisely the sleep deficit the ratio exists to detect. Rows
with no duration are now skipped, matching what `sleepScoreTrend` already did.

The bedtime estimate moved least — 22:06 → 22:12 over the full history, 22:19 → 22:16 over 14 days.
A circular mean over 66 points is fairly robust to twelve of them; the number is now right for the
right reason rather than right by luck.

## Verification, and what it did not prove

Full suite **397 files / 3,145 tests green**. Six new unit tests, including a split-night case built
on 2026-05-29's real shape.

Every changed route was exercised against `pnpm dev` with a logged-in session: `progress-summary`,
`bedtime-estimate`, `sleep-performance-correlation`, both `health-trends` views, `next-session`,
`ai/health-insight`, `nutrition-goals/recommend` (after filling in the seed user's profile, which it
400s without) and `ai-chat` — including a prompt that forces both recovery tools. All 200, with real
model output describing the sleep data.

**The dev pass is a no-regression result, not a proof the filter fires.** The local seed's sleep
rows have `sleep_start == sleep_end` and contain no naps, so payloads were byte-identical before and
after — which is what should happen. The filtering was measured separately against the production
rows, above. Nothing here touches native, safe-area, gestures or notifications, so there is no
device-verification gate: the APK is a WebView on Railway and picks this up on deploy.

## Left open

2026-06-01 (1.45 h) and 2026-06-04 (3.83 h) are the only rows on their dates — the remainder of each
night was never stored. 2026-06-02 and 2026-06-03 have no row at all. Both need a redecode or
backfill from `oura_raw_samples`; recorded as a Known Issue rather than quietly filtered away.
