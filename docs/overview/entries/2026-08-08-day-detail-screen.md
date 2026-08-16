# 2026-08-08 — Q-110: the training calendar's day-detail screen

**Branch:** `claude/health-metrics-button-designs-hy6cyv` · **Version:** 1.270.0 · **Closes:** Q-110

## What shipped

Tapping a day on the training calendar (Health → Training) opened a bottom sheet showing Exercise,
Activities and three body tiles. It now opens a dedicated screen you move between days on.

- **Route:** `app/health/day/page.tsx` + `day-detail-content.tsx`, `?date=YYYY-MM-DD`. The param is a
  starting point only — swiping is client state, so moving between days is not a navigation per day.
- **Sections** (`components/health/day-detail/day-sections.tsx`): Training (per-session exercise list
  with sets/reps/weight, derived volume, existing durations), Activity, Sleep (hypnogram + eight
  stats), whole-day HR, Body composition (weight at display size + up to sixteen fields).
- **Calendar tap repointed** in `health-content.tsx`. The sheet and `fetchDayOverlay` are left in
  place — the same overlay opens from other surfaces, and retiring it is a separate change.

## Design

C1 from `docs/design/2026-08-08-day-detail-a2-variations.html`, chosen by the owner after two
rounds. Do not re-open the layout question.

## Decisions worth not re-litigating

- **Scores come from `oura_daily_derived`, via a new one-query `getDerivedScoresForDay`.** Not
  `oura_daily` (Cloud columns frozen since the 2026-07-07 BLE re-key — would show numbers the app
  never served) and **not `buildDayAudit`**, which the plan originally suggested. buildDayAudit
  assembles 28 days of history across ~13 queries; that is the fan-out shape **Q-107** blames for
  pool exhaustion, and a screen the user swipes day-to-day cannot afford it. The derived table holds
  the value buildDayAudit itself persists, so correctness is unchanged and cost drops ~13×. Coverage
  is the trade: days never scored show "—" rather than being computed on demand.
- **HR is bucketed to 15 minutes server-side** (`DAY_HR_BUCKET_MIN`). Owner asked for the full-day
  trace at reduced density. Per-minute is ~1,440 points — about four samples per pixel at the
  rendered width, so the resolution is invisible at ~30× the payload. Buckets are **means**, not
  sample-at-boundary, so one spike cannot become the whole bucket.
- **Body composition was never missing, only unmapped.** `listBodyMetrics` already returned every
  scale column; the route mapped eight of them. The sheet was showing three of fourteen available
  numbers.
- **Swipe copies `nutrition-content.tsx`** — `useDrag`, same 60px/0.5 velocity thresholds, same
  `AnimatePresence` keyed on the date. `touchAction: pan-y` leaves the vertical axis to the browser,
  so direction-locking is the platform's job rather than a hand-rolled recogniser.
- **An in-flight response is guarded on the date** (`dateRef`). Swiping fast can land a slower
  response for a day already moved off, which would repaint the wrong day.
- **`DAY_LOG_TTL` named** now that `day-log:` has two readers (week-day sheet + this screen), per the
  one-canonical-TTL-per-key rule. Both sites were already `TTL_MEDIUM`, so this pins an existing
  agreement rather than changing behaviour.

## Verification

Signed in against the dev server, 412×891:

| Check | Result |
|---|---|
| Renders a populated day | sleep, hypnogram stats, HR trace, 5 body fields |
| Empty day | "Nothing logged on this day." |
| Calendar tap | `/health/day?date=2026/08/03` → "Monday 3 August" |
| Week-strip / chevron nav | day changes correctly |
| Tap targets | 48dp (back) and 54dp (week strip) — all clear of the floor |
| Horizontal overflow | none |
| Page errors | none |

HR bucketing checked directly: 180 per-minute rows inserted at 08:00 Brisbane produced 12 buckets
starting at minute 480 — correct width, correct local-midnight anchoring, values are means.

**Not verified on device.** No blur/filter/backdrop-filter anywhere. The genuine device unknown is
**the swipe**: `useDrag` on a vertically-scrolling page is exercised by mouse here, not by a thumb,
and this app has twice lost a session to gesture conflicts. Worth being the first thing checked on
the APK.

## Left open, deliberately

- The old `day-overlay-sheet.tsx` still exists and is still reachable from other surfaces. Retiring
  it is its own change.
- Weekly weight delta ("−0.4 kg this week") appeared in the mockup and is **not** built — it needs a
  second query, and this screen must paint from cache while swiping.
- Days never scored show "—" for readiness/activity rather than computing on demand. If that gap is
  common in practice, the fix is to run the existing backfill, not to make this screen expensive.
