# Owner UI Bug Batch — 2026-08-05

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A running collection of small, owner-reported UI/UX bugs found during a single
walkthrough session on 2026-08-05. Each numbered task below is an independent,
separately-mergeable workstream — implement and ship one at a time, per its own Q-number in
`docs/implementation-backlog.md`, the same pattern as the 2026-08-02 owner bug batches
(Q-36…Q-40, Q-63…Q-69). Do **not** implement this document in one PR; each task ships on its own
branch as its own backlog item clears.

---

## Task 1 (Q-86) — AI prescription duration-preset switch feels unresponsive

- **Branch:** `fix/duration-preset-refresh-feedback`
- **Reported:** owner changed the session time budget to "Normal" (60 min) on the Push
  pre-workout screen; the AI Prescription card did not update for a noticeable while, including
  after tapping the header refresh icon — it eventually loaded on its own.

### What's actually happening (traced 2026-08-05)

- The Quick/Normal/Long picker (`components/workout/session-duration-picker.tsx`, mounted from
  `components/workout/pre-workout-screen.tsx:209-217`) calls `handleDurationPresetChange`
  (`components/workout-screen.tsx:482-505`), which **awaits** a POST to
  `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts` with the new
  `durationPreset`.
- That route always runs a real, uncached `generateObject` LLM call
  (`packages/shared/src/ai-periodization/generate-prescription.ts:139-163,~289-291`) —
  `durationPreset != null` deliberately sets `skipCooldown: true`, bypassing the normal 30s
  dedup cache. **This is intentional and correct to keep**: caching across presets would serve a
  60-min prescription after switching to 30-min. The LLM call is typically ~2.6s but is only
  bounded by the route's `maxDuration = 30`, so a slow call can look stalled for up to half a
  minute with no differentiation in the UI between "still generating" and "hung."
- There **is** a loading indicator for this — the in-place heading swap at
  `pre-workout-screen.tsx:257-266` ("Preparing your AI workout…" + spinning icon), gated by
  `prescriptionPending={(aiPrescriptionPending || durationSwitching) && !prescriptionGenTimedOut}`
  (`workout-screen.tsx:1642`). But it's easy to miss and is entirely separate from —
- The header refresh button (`RefreshCwIcon`, `pre-workout-screen.tsx:172-180`, wired to
  `refreshExercises` / `workout-screen.tsx:507-514`): tapping it does **not** re-trigger the
  in-flight (or a fresh) duration-preset generation — it only invalidates client caches and
  re-fetches `/api/workout-data` + the periodization status endpoint. Its own spin/disabled state
  is bound to that re-fetch's `loading` flag, which flips back to `false` almost immediately
  because a cache seed already exists. **The result: the owner taps refresh expecting it to
  hurry the new prescription along, the icon spins briefly and stops as if something happened,
  and the actual AI card is unaffected — still mid-generation — which reads as "I clicked
  refresh, nothing happened, then it eventually loaded on its own."**

### Fix direction (not yet decided — pick during implementation)

The LLM latency itself is not the bug to fix (an uncached, preset-accurate regeneration is
correct behaviour); the bug is that the UI gives **misleading, decoupled feedback** across two
controls for what the owner experiences as one action. Two complementary changes:

1. **Make the header refresh button reflect the real prescription-generation state.** While
   `aiPrescriptionPending || durationSwitching` is true, the refresh icon should visibly reflect
   that (spinning / disabled), not just its own unrelated re-fetch. At minimum, tapping refresh
   during an in-flight generation should not present a "done" state (brief spin, stop) while the
   AI card is still loading underneath it.
2. **Make the "Preparing your AI workout…" state more prominent** immediately on tapping
   Quick/Normal/Long, so the delay reads as "in progress," not "did my tap register?" — confirm
   `durationSwitching` flips synchronously on tap (before the `await`), not only once the request
   resolves.
3. Do **not** re-introduce caching across `durationPreset` values, and do not have the refresh
   button fire a second, redundant generation call while one is already in flight for the same
   session (see the related race condition tracked separately in
   `docs/superpowers/plans/2026-08-03-prescription-generation-race.md`, Q-54) — check that
   plan/entry before adding any new trigger path here.

### Tasks

- [ ] Confirm `durationSwitching` (or equivalent) flips synchronously on tap, before the await,
      and drives a clearly visible loading state on the AI Prescription card.
- [ ] Tie the header refresh icon's visual state to the real pending state
      (`aiPrescriptionPending || durationSwitching`), not just its own local re-fetch `loading`
      flag — so it can't show "idle" while a generation is still running.
- [ ] Decide (and document the decision inline) whether refresh should be disabled/no-op entirely
      while a generation is in flight, or should query status without firing a duplicate
      generation.
- [ ] Local dev-server pass: change the time-budget preset on a session with an existing
      prescription, observe the loading state end-to-end, confirm refresh during that window
      doesn't show misleading feedback.
- [ ] Run tests + lint. Remove this task's entry (Q-86) from
      `docs/implementation-backlog.md`, add the journal entry + `projectOverview.md` update in
      the same PR.

---

## Task 2 (Q-87) — show "up next" exercise + starting weight on the rest/exercise-summary screen

- **Branch:** `feat/exercise-summary-up-next`
- **Reported:** owner-reported, 2026-08-05 (screenshot: Barbell Bench Press exercise-summary
  screen, "RESTING" countdown ring, sets table, "Next Exercise →" button). Request: surface which
  exercise is coming up next — and ideally its planned starting weight — on this screen, so the
  owner can start thinking about it during the rest countdown instead of only finding out after
  tapping "Next Exercise."

### What's actually there (traced 2026-08-05)

- `components/workout/exercise-summary-screen.tsx` renders from `summaryData: ExerciseSummaryData`
  (`components/workout/types.ts:5-20`), built once at completion time via
  `store.commitExerciseSummary({...})` (`components/workout-screen.tsx:1334-1347`, storing
  verbatim into `lib/stores/workout-store.ts:392-402`). `summaryData` currently carries only the
  just-finished exercise's own data — nothing about what comes after it.
- Everything needed to add it is already resolved in scope at that exact call site, so this is
  cheap: `effectiveExercises` (`workout-screen.tsx:233-236`, the full ordered session exercise
  list) + `store.currentIdx` (index of the exercise just finished) → `effectiveExercises[currentIdx
  + 1]` is the next exercise. Its planned starting weight is one call to the already-shared
  `computeInitialWeights(ex, sets)` (`workout-screen.tsx:60-76`) — the exact function that seeds
  the *actual* working weight when that exercise starts (picks `progressionStyle[0].pct *
  estimated1rm`, falling back through `target80` → `estimated1rm * 0.8` → `latestWeight`, rounded
  via `mroundStep`/`weightStepFor(equipment)`).
- **Don't reuse `pre-workout-screen.tsx`'s "last time" line** (avg reps × modal weight from
  history) as the source for this — that shows *last logged* weight, not the *planned* weight for
  today's session, and would show a different (and potentially stale/wrong) number than what the
  set card actually opens with once the user gets there. `computeInitialWeights` is the one
  formula that must be reused, not re-derived.
- If `currentIdx + 1` is out of range (last exercise of the session), there is no next exercise —
  the added UI must handle that (omit the section, or show a "last exercise" state) rather than
  reading past the array.

### Tasks

- [ ] Extend `ExerciseSummaryData` (`components/workout/types.ts`) with the next-exercise name and
      planned starting weight (nullable — last exercise in session has none).
- [ ] At the `commitExerciseSummary` call site (`workout-screen.tsx` ~line 1334), compute the next
      exercise from `effectiveExercises[store.currentIdx + 1]` and its starting weight via
      `computeInitialWeights`, passing both into the committed summary object.
- [ ] Render an "Up Next" element on `exercise-summary-screen.tsx` (near the rest timer/HR chart),
      using the existing weight-formatting helpers (`formatSetLoad`/`oneRmUnit`) for bodyweight-safe
      display — matching the app's theme-token/no-hex-literal rules.
- [ ] Handle the last-exercise-in-session case (no next exercise) without erroring or showing a
      blank/broken element.
- [ ] Local dev-server pass: complete an exercise mid-session and confirm the next exercise +
      weight render correctly during the rest countdown; complete the *last* exercise of a session
      and confirm the "no next exercise" case renders cleanly.
- [ ] Run tests + lint. Remove this task's entry (Q-87) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

---

## Task 3 (Q-88) — give Zone 1 minutes credit on days with no dedicated workout ("lazy days")

- **Branch:** `feat/zone1-lazy-day-credit`
- **Reported:** owner-reported, 2026-08-05: in the cardio section, Zone 1 active minutes are
  currently excluded from the weekly HR-zone quota with copy along the lines of "fills from
  ordinary daily movement, so it isn't counted toward your training week." The owner wants Zone 1
  (their framing: "heart rate minutes in the 50-60% zone") to actually count, **specifically for
  the lazy-day case** — a day with no dedicated exercise, where they'd still like credit for
  whatever light activity did happen.

### What's actually there (traced 2026-08-05) — this is a deliberate, documented design decision

- Zone 1 is defined as **0-60% of Heart Rate Reserve (Karvonen)**, not %HRmax
  (`packages/shared/src/health/hr-zones.ts:38-44`, `ZONE_DEFS`) — the owner's "50-60%" already
  falls inside it, so **no zone-boundary change is needed**, only the aggregation/display
  behaviour below. Max-HR comes from `resolveHrProfile()` (observed, spike-rejected 90-day max
  when reliable, else age-predicted); resting HR is a 28-day average.
- Zone 1 minutes are **already fully computed and stored for every day**, including days with no
  workout — `computeDayZoneSeconds()` (`lib/data/postgres/slices/oura.ts:633-646`) reads the whole
  local day (00:00-23:59) with no activity/workout gating, cached in `daily_zone_minutes.zone1Sec`
  (migration `129_daily_zone_minutes.sql`). **This is not a data-pipeline gap — the data the owner
  wants already exists per-day.**
- The exclusion is deliberate, at two independent points, both intentional per
  `docs/superpowers/specs/2026-07-26-cardio-system-spec.md` **D-10** (lines 60-82, 339-340):
  1. **Weekly training quota** — `computeZoneQuota()` (`packages/shared/src/health/zone-quota.ts:7-8,32,53`)
     filters `zoneId !== PASSIVE_ZONE_ID(1)` out of `trainingDoneMin`/`trainingTargetMin`.
     `components/cardio/zone-quota-card.tsx:13-15,70-72,96-107` still *renders* Zone 1 as
     complete-but-excluded, with the "fills from ordinary daily movement" copy the owner is
     seeing.
  2. **Activity Score "active minutes"** — `activeMinutesFromZoneSeconds()`
     (`packages/shared/src/health/zone-minutes.ts:80-86`) drops zone 1 entirely, a separate
     WHO-2020 moderate/vigorous-only convention.
  - D-10's own rationale for the exclusion, written at spec time: *"That is correct for the
    health-floor reading of the quota, but misleading as a 'did I train enough' signal... do not
    silently let Z1 auto-complete and imply the week is done."* — i.e. the concern was Zone 1
    quietly satisfying the *training* quota on a day the owner did no deliberate exercise. **The
    owner's ask here is the inverse of that concern**, not a contradiction of it: they want a
    lazy-day signal, not for Zone 1 to fill the training quota.

### Direction (needs one decision before implementation, not a blocker — the owner is the decision-maker here)

Keep D-10's exclusion of Zone 1 from the **deliberate training-week quota** intact (its rationale
still holds — Zone 1 filling passively must not read as "training done for the week"). Add a
**separate, complementary signal** scoped to days with no dedicated workout/cardio session: on
those days, surface Zone 1 minutes as their own "moved today" / lazy-day credit, distinct from the
training quota card. This avoids reopening D-10's original problem while giving the owner what
they actually asked for.

- [ ] Confirm with the owner (or infer from how they use the app) what "counts" should mean in
      product terms: a small stat/card ("Zone 1 today: NN min") shown only on days with no logged
      workout, vs. folding Zone 1 into some other existing day-level activity metric. Don't guess
      silently — this is a product decision, D-10 flagged exactly this choice as "decide in
      planning."
- [ ] Determine "no dedicated workout" precisely — no `workout_sessions` row for the day and no
      logged cardio/guided-walk session, reusing whatever existing check the app has for "rest
      day" if one exists (grep before writing a new one, per `docs/module-map.md`).
- [ ] Surface Zone 1 minutes (already in `daily_zone_minutes.zone1Sec`) for qualifying days via a
      new small UI element in the cardio section — do not change `computeZoneQuota()`'s existing
      training-quota exclusion, and do not change `activeMinutesFromZoneSeconds()`'s Activity Score
      exclusion; both stay as-is per D-10.
- [ ] Local dev-server pass: verify the new element appears on a day with no workout and Zone 1
      minutes present, and does NOT appear (or appears differently) on a day with a logged
      workout.
- [ ] Run tests + lint. Remove this task's entry (Q-88) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

---

## Task 4 (Q-89) — Workout tab session card doesn't show "trained today" right after finishing

- **Branch:** `fix/workout-select-trained-today-memo`
- **Reported:** owner-reported, 2026-08-05: after completing a workout, navigating back to the
  Workout tab's "Choose a session to start" card list, the just-finished session's card doesn't
  instantly reflect completion (no "trained today" state) — it looks the same as before the
  workout.

### Root cause (traced 2026-08-05) — a stale `useMemo`, not a missed cache-invalidation key

This is **not** the usual missed-invalidation-key bug class (CLAUDE.md's 12+ prior incidents) —
all the relevant cache keys ARE correctly invalidated. It's a stale-`useMemo` bug local to one
component:

- The screen is `WorkoutSelectContent` (`app/workout-select/workout-select-content.tsx`) — the
  Workout tab's card carousel (distinct from the Home tab's `RecommendationCard` in
  `app/session-select/`). `done-screen.tsx:568` navigates to `/session-select`, which redirects to
  `/workout`, landing directly here.
- `completeWorkout()` (`components/workout-screen.tsx:1465`) correctly calls
  `invalidateWorkoutDataImmediate()` then `invalidateWorkoutSummaries()`
  (`lib/cache-groups.ts:15-80`), which includes `next-session`, `workout-card:` (prefix),
  `workout-data:meta`, `workout-data:all`, `calendar-data:`/`streak-data`, and clears the legacy
  seeds. **Every key this screen reads is in the group** — invalidation itself is not the bug, and
  it's pure local cache clearing (no network), so it's long finished by the time the owner
  navigates off the Done screen. Not a race either.
- The actual defect: `workout-select-content.tsx:84` —
  `const lastTrained = useMemo(() => getLastTrainedLabel(currentSession), [currentSession])`.
  `currentSession` (`:82`) is `sessions[currentIdx]`, and `sessions` is set **once per mount** from
  the `workout-data:meta` fetch (`:139`), which resolves *before* the freshly-invalidated
  `workout-card:<id>` entries are repopulated by the later `workout-data:all` batch fetch
  (`:169-178`). When that batch finishes, it only calls `forceUpdate((n) => n + 1)` (`:179`) — a
  re-render, but `currentSession`'s object reference is unchanged, so the `useMemo` skips
  recomputation. `lastTrained`/`trainedToday` stay frozen at whatever the cache held at the moment
  `setSessions` ran (i.e. pre-invalidation), so the checkmark ring, "Trained today" label, and
  "Start Again" button text (lines 300, 331-334, 384-388) never update on this mount — only a
  later remount (e.g. a tab revisit bumping `tabEpoch`) picks up the fresh state.

### Fix direction

Make the `lastTrained` memo actually depend on the data that changes — either add the
`forceUpdate` counter as a `useMemo` dependency (cheapest), or move the trained-today lookup out
of a raw synchronous cache read inside a memo and into state set alongside the `workout-data:all`
batch fetch, consistent with how the rest of the screen updates on that fetch completing.

### Tasks

- [ ] Fix the `lastTrained`/`trainedToday` computation in `workout-select-content.tsx` so it
      recomputes when the `workout-data:all` batch (and its `workout-card:<id>` seeds) finishes,
      not only on a `sessions` reference change.
- [ ] Sibling-surface check: confirm no other memoized derived value in this file reads a
      `readCacheSync`-backed helper keyed off `currentSession` with the same staleness risk.
- [ ] Local dev-server pass: complete a workout, navigate back to the Workout tab, confirm the
      completed session's card shows "trained today" immediately without a manual refresh or tab
      revisit.
- [ ] Run tests + lint. Remove this task's entry (Q-89) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

---

## Task 5 (Q-90) — expand the sleep screen's data view: more trend charts + skin temperature

- **Branch:** `feat/sleep-screen-trend-cards`
- **Reported:** owner-reported, 2026-08-05: wants the sleep detail screen (`app/health/sleep/sleep-content.tsx`) built out further — a chart that can toggle between metrics or combine several, skin temperature shown somewhere on this screen, and more 14-day trend charts in the style of the existing "Sleep Score — 14 days" line chart: each sleep phase's hours per night over 14 days, bedtime trend, and wake-up time trend.

### What's already there vs what's new (traced 2026-08-05)

Good news — most of the raw data this needs is already being fetched by this screen or sits one
route away; this is mostly new UI, not new computation:

- **The existing "Sleep Score — 14 days" chart** is `components/health/trend-sparkline.tsx` — a
  shared, reusable chart.js line-chart component (also used by Readiness/Activity), fed by
  `GET /api/health/trends` (`app/api/health/trends/route.ts`), which returns a fixed 14-day
  `HealthTrendDay[]` with a hardcoded field set (`readinessScore, sleepScore, ... steps, waterMl`
  — no bedtime/wake/phase-hours/temperature today). `TrendSparkline`'s `Field` union type
  (`:16`) is hardcoded to the same list.
- **Bedtime/wake-time and per-night phase hours are already loaded into this exact screen and
  unused.** `sleep-content.tsx` (99 lines — well under the size-hotspot concern) already fetches
  30 days of `sleep_sessions` rows via `/api/sleep-sessions` into `sleepRows` state (`:22-45`),
  including `sleepStart`, `sleepEnd`, `deepSleepHours/remSleepHours/lightSleepHours/awakeHours` —
  today it only reads the *latest* night (for the Hypnogram) and 7 nights (for the bedtime-SD
  consistency card). **No new API/query work needed for phase-hours, bedtime, or wake-time
  trends** — it's a matter of reshaping data already sitting in state into new chart cards.
- **Skin temperature exists but is Readiness-only today.** `oura_daily.temperature_deviation` /
  `temperature_trend_deviation` (`schema.ts:755-756`) is a **daily aggregate** (one value/day from
  `daily_readiness`, not per-night), currently surfaced only on `components/readiness-card.tsx` /
  `components/health/readiness-breakdown.tsx`. `repo.getOuraDaily()` is already called inside
  `/api/health/trends` but the route drops the field before building `trends[]` — adding it there
  is a small, mechanical extension (route + `HealthTrendDay`/`Field` type), reusing
  `TrendSparkline` directly rather than building a new chart for it.
- **No existing bedtime/wake-time trend chart or sparkline exists anywhere** in the app (checked)
  — this part is genuinely new UI, though it can copy `TrendSparkline`'s chart.js pattern rather
  than inventing a new charting approach.
- Per the app's component-size convention, new chart cards go into **new child components** under
  `components/health/` (e.g. `sleep-phase-trend-card.tsx`, `bedtime-trend-card.tsx`,
  `temperature-card.tsx`), not inlined into `sleep-content.tsx`.

### Tasks

- [ ] Extend `HealthTrendDay` (`app/api/health/trends/route.ts`) and `TrendSparkline`'s `Field`
      union to include `temperatureDeviation`, reusing the existing readiness-screen data source
      (`repo.getOuraDaily()`, already called in this route).
- [ ] Add a skin-temperature card/chart to the sleep screen using the extended `TrendSparkline`.
- [ ] Build a phase-hours-per-night 14-day trend view from the `sleepRows` data already loaded in
      `sleep-content.tsx` (deep/rem/light/awake hours) — decide stacked-bar vs multi-line vs a
      toggle between individual phases, per the owner's "toggle between, or combine" request.
- [ ] Build a bedtime and a wake-up-time 14-day trend view from the same already-loaded
      `sleepStart`/`sleepEnd` data — new small chart component(s), following `TrendSparkline`'s
      chart.js conventions (theme tokens via `resolveColor`, no raw hex/white-alpha literals per
      the canvas-chart-colours rule).
- [ ] Decide the toggle/combine interaction the owner asked for — e.g. a segmented control above
      one shared chart area that swaps between phase-hours / bedtime / wake-time / temperature,
      versus separate always-visible cards. Don't guess silently if it's ambiguous which the owner
      prefers — cheap to ask, expensive to rebuild.
- [ ] Local dev-server pass: confirm all new charts render correctly with real seeded data across
      at least 14 days, and degrade sanely (empty state, not a crash) for a user/date range with
      fewer than 14 nights of history.
- [ ] Run tests + lint. Remove this task's entry (Q-90) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

---

## Task 6 (Q-91) — sleep hypnogram appears "missing" because the mounted screen never learns the data arrived

- **Branch:** `fix/sleep-screen-oura-sync-refetch`
- **Reported:** owner-reported, 2026-08-05: the sleep hypnogram has been missing for a while;
  previous sessions said to just redecode, but nothing seemed to happen — yet the data is visible
  elsewhere/eventually.

### The data is NOT missing in production — verified directly, 2026-08-05

Queried the `claude_ro` read-only schema directly rather than guessing from prior journal entries:
**zero nights with `duration_hours > 1` are missing `sleep_phase_5_min`** going back through the
last ~10 weeks (since late June 2026), including today (2026-08-05) — spot-checked content, not
just null-checked: every recent night has a well-formed ~80-130 char 5-min-epoch stage string.
Everything before late June has no hypnogram data because the BLE heuristic stager/SleepNet
pipeline didn't exist yet (expected, not a bug). **So "just redecode" advice from prior sessions
was very likely acting on a symptom that had already resolved server-side** — the real bug is
downstream of the data.

### Root cause (traced 2026-08-05) — a missing reactive refetch, not a data or TTL problem

- Both `app/health/sleep/sleep-content.tsx` and `health-metric-sheet.tsx` (via
  `app/health/health-content.tsx`) read `GET /api/sleep-sessions`
  (`app/api/sleep-sessions/route.ts`) through `cachedFetch` (key `'sleep-sessions'`, `TTL_MEDIUM` =
  1800s, `packages/shared/src/cache-ttl.ts:4`). `cachedFetchCore` paints from cache instantly then
  always fires a real network fetch **on every mount** — so a fresh navigation does pick up
  server-side changes; this is not a TTL-staleness bug in the usual sense.
- Invalidation of the `'sleep-sessions'` cache entry does exist:
  `invalidateOuraSync()` (`lib/cache-groups.ts:169`) fires after the admin "Redecode" button
  (`components/oura-ble/oura-ble-debug.tsx:264,268`) and after a normal BLE drain settles
  (`afterDrainSettles()`, `lib/oura-ble/sync.ts:12-23`), which also dispatches a `window` event
  `ta:oura-ble-synced`.
- **The gap: clearing a cache entry doesn't make an already-mounted component refetch, and nothing
  currently tells the sleep screens to.** `ta:oura-ble-synced` is listened to **only** by
  `session-select-content.tsx:679` — neither `sleep-content.tsx` nor `health-content.tsx`
  subscribes to it. So if the owner has the Sleep detail sheet (or Health tab) already open when
  the rollup finishes or Redecode completes, the cache is correctly cleared server-side but the
  visible screen has no signal to act on it — explaining exactly the reported sequence: "hit
  Redecode, nothing visibly happened" (it worked, invisibly) "...eventually loaded on its own"
  (a later navigate-away/remount finally issued the real fetch).
- Separately, the ingest route's own background rollup (`app/api/oura-ble/samples/route.ts:82-124`,
  the I20-documented lag path) is fire-and-forget and never triggers any client invalidation at
  all — only the explicit Redecode button and drain-settle event do. For the *ordinary* (non-manual)
  flow, the sleep screens' only guaranteed refresh is the next natural mount or the 30-min TTL.
- `'sleep-sessions'` is also not date-scoped (`cachedFetch`, not `cachedFetchToday`) despite its
  newest row effectively being "today's" possibly-still-processing session — a partial deviation
  from the cache-key rule, though moot in practice since mount-refetch already covers it.

### Fix direction

Subscribe the sleep screens to the same `ta:oura-ble-synced` signal `session-select-content.tsx`
already uses (or broaden it to a shared cache-invalidation-event bus if that's cleaner), and
trigger a refetch of `'sleep-sessions'` when it fires while those screens are mounted — the
sibling-surface fix to the pattern that already exists in one place but not the others.

### Tasks

- [ ] Sibling-surface sweep: find every place that reads the `'sleep-sessions'` cache key
      (`sleep-content.tsx`, `health-content.tsx`, `session-select-content.tsx`, any others) and
      confirm which do/don't react to `ta:oura-ble-synced` today.
- [ ] Add the missing subscription(s) so an already-mounted sleep/health screen refetches when a
      BLE sync/redecode completes, matching `session-select-content.tsx`'s existing pattern.
- [ ] Decide whether the ingest route's background rollup should also emit an invalidation signal
      once it finishes (closing the ordinary-flow gap), not just the manual Redecode path and
      drain-settle event — scope this carefully, the rollup is intentionally fire-and-forget for
      latency reasons (I20) and any change here must not reintroduce that timeout risk.
- [ ] Local dev-server pass: open the Sleep screen, trigger a redecode (or simulate the sync-settle
      event), and confirm the hypnogram appears without navigating away and back.
- [ ] Run tests + lint. Remove this task's entry (Q-91) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR — this closes a real gap in
      `docs/oura-ble-operations.md`'s I20 row, which only documents the rollup-lag angle, not this
      reactivity gap.

---

## Task 7 (Q-92) — smooth the home "Heart Rate · Today" chart + add a clearly-marked estimated backfill for gaps

- **Branch:** `feat/hr-day-chart-smoothing-backfill`
- **Reported:** owner-reported, 2026-08-05: the home screen's "HEART RATE · TODAY" chart line is
  very granular/jagged; wants it more bucketed/smoother, and a "backfill" option that draws an
  estimated line across missing-data gaps — clearly marked as estimated, not real data.

### What's already there (traced 2026-08-05)

- Component: `components/health/hr-day-chart.tsx` (`HrDayChart`, 227 lines, `react-chartjs-2`
  `Line`), rendered on home via `components/home/home-card-widget.tsx:317-333`. Data comes from
  `GET /api/oura/hr-day` → `repo.getHrForWindow` (`lib/data/postgres/slices/oura.ts:612-623`,
  `oura_heartrate`, strap-preferred merge).
- **Bucketing already exists but isn't tunable.** `hr-day-chart.tsx:50-52` already calls
  `bucketAverage` (the shared "One Formula, One Place" bucketing utility,
  `packages/shared/src/health/hr-smoothing.ts:10-22`, also used by the done-screen recovery chart
  and the live workout sparkline) — but it's hardcoded to 5-minute buckets, not exposed as a prop.
  Making the chart "smoother" is mostly a matter of exposing/bumping this, not new math.
- **Gaps are already handled deliberately** — `withGapBreaks`
  (`components/health/hr-day-chart-gaps.ts:17-26`) inserts a real break (`{x, y: NaN}`) when
  consecutive buckets are >20 min apart, and `spanGaps: false` is set explicitly
  (`hr-day-chart.tsx:156`) — this is intentional design (comment in `gaps.ts:5-8`: distinguishing
  real ring-off-body gaps from fake interpolation), which the owner's request is explicitly asking
  to *add an opt-in exception to*, not remove.
- **No existing interpolation/backfill utility anywhere** in the codebase — this part is
  genuinely new, but small: a sibling pure function next to `withGapBreaks` in the same
  already-isolated, unit-testable file.
- Theme-safe color precedent already exists (`resolvedLineColor`, `hr-day-chart.tsx:144`,
  `resolveColor` in `packages/shared/src/chart-colors.ts:5`) — the estimated line must follow the
  same scheme-aware pattern, never a raw hex/white-alpha literal, per the canvas-chart-colours
  rule.

### Tasks

- [ ] Promote the hardcoded `bucketMin = 5` (`hr-day-chart.tsx:50`) to a prop with a sensible
      default; decide the actual bucket size the owner wants smoother (5 min is already fairly
      granular over a 42-124bpm range — consider whether 10-15 min reads better, and confirm with
      a visual check rather than guessing a number).
- [ ] Add a new pure function (e.g. `interpolateGaps(buckets, maxGapMin)`) next to
      `withGapBreaks` in `hr-day-chart-gaps.ts` that linearly interpolates across gaps up to some
      bound, producing a separate point series — do not silently extend `withGapBreaks` itself,
      keep real-gap detection and estimated-fill as separate, composable concerns.
- [ ] Render the estimated series as a second chart.js dataset under/behind the real line:
      dashed (`borderDash`), lower opacity, a distinct scheme-aware color from the real-data line
      — and add a legend entry labeling it "Estimated" (the component already has a legend
      pattern at lines 205-224 to extend).
- [ ] Thread a `showBackfill?: boolean` prop from `HomeCardWidget` down to `HrDayChart` — decide
      whether it's owner-toggleable in the UI or always-on when gaps exist; don't guess silently
      if ambiguous.
- [ ] Local dev-server pass: confirm the chart reads smoother at the new bucket size, and that a
      day with a real HR gap shows the dashed estimated line only across that gap, clearly
      distinguishable from real data, in both light and dark themes.
- [ ] Run tests + lint. Remove this task's entry (Q-92) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

---

## Task 8 (Q-93) — make "Today's Timeline" cards tappable → relevant detail screen

- **Branch:** `feat/timeline-cards-tap-to-detail`
- **Reported:** owner-reported, 2026-08-05: wants the home "Today's Timeline" cards tappable —
  expanding/navigating to the relevant detail screen: nutrition card → food log, "Woke up" card →
  sleep/hypnogram detail, exercise card → HR chart + exercise details for that workout.

### What's there today (traced 2026-08-05)

- `components/home-day-timeline.tsx` (247 lines) — one shared `EventRow` wrapper with a
  `type`-keyed switch dispatching to seven small card components (`WakeupCard`, `SleepCard`
  ["Fell asleep"], `WorkoutCard`, `WalkCard`, `MealCard`, `BedtimeCard`, `TagCard`), all plain
  `<div>`s, **zero interactivity today**. Data comes from `GET /api/day-timeline`
  (`app/api/day-timeline/route.ts`, `TimelineEvent` interface `:17-38`), via `cachedFetchToday`.
- **There's a second, near-duplicate full-page renderer**: `app/health/timeline/page.tsx`
  (`TimelineItem`), same data source, also 100% display-only. A sibling-surface sweep — both need
  the same fix, or a shared component extracted so they don't drift.
- **The main gap: the API carries no ids.** `TimelineEvent` has no `session.id`, food-log id, or
  sleep-session id — only display-derived fields (`day: 'today'|'yesterday'`, formatted strings).
  The underlying repo rows already have these ids (`workoutSessions` loop `:143`,
  `foodLogs`/`byMeal` loop `:172` in the route) — they're just not surfaced to the client.
- **Nutrition and "Woke up" are straightforward wiring once ids/dates are threaded through**:
  `app/nutrition/page.tsx` / `nutrition-content.tsx` exists (currently only reads a `chat` search
  param, not `date` — needs `?date=YYYY-MM-DD` support added);
  `app/health/sleep/sleep-content.tsx` exists (currently only takes `userId`, no date-selection —
  needs wiring to jump to a specific night).
- **The workout card is the odd one out — no 1:1 detail screen exists today.**
  `components/workout/live-hr-chart.tsx` only ever renders inside the *in-progress* workout flow
  (live in-session HR store data), never for a completed/historical session by id. The closest
  existing UI, `workout-review-sheet.tsx`, is an AI progression-review tool (proposed set-shape
  changes), not a summary/HR view. The nearest thing to a historical per-day view is
  `stats-content.tsx`'s calendar-day bottom sheet (`dayOverlay` state) — shows exercises/edits for
  a date, no HR chart, keyed by date not session id. **This card's "expand to see HR chart +
  exercise details" needs new screen work, not just a routing wire-up.**
- Precedent for the tap/navigation pattern itself: `session-select-content.tsx`'s
  `router.push(`/workout?session=${id}`)` (via `useTransitionRouter`), with real
  `role="button"` cards (no nested `<button>`s, per the WebView nested-control rule) as seen in
  `metric-tiles-card.tsx`/`streak-card.tsx`.

### Tasks

- [ ] Extend `TimelineEvent` (`app/api/day-timeline/route.ts`) to carry the relevant id per card
      type (workout session id, food-log/meal date, sleep-session date) — the repo rows already
      have these, it's a surfacing change, not a new query.
- [ ] Add `?date=` support to `nutrition-content.tsx` and date-jump support to
      `sleep-content.tsx`, then wire the Meal/Wakeup/Sleep cards to navigate there.
- [ ] Decide the workout-card destination: build a minimal historical HR-chart + exercise-summary
      view keyed by `workout_sessions.id` (new, scoped screen), or repurpose
      `stats-content.tsx`'s day-overlay sheet and extend it with an HR chart. Don't default to
      the bigger option silently — size both before picking.
- [ ] Apply the same interactivity to both `components/home-day-timeline.tsx` and
      `app/health/timeline/page.tsx` (sibling-surface sweep), or extract a shared row component
      so they can't drift.
- [ ] Local dev-server pass: tap each card type from the home timeline and confirm it lands on
      the correct, correctly-scoped detail screen.
- [ ] Run tests + lint. Remove this task's entry (Q-93) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

---

## Task 9 (Q-94) — a Guided Walk shows as generic "Outdoor walking" on the home timeline

- **Branch:** `fix/timeline-guided-walk-label`
- **Reported:** owner-reported, 2026-08-05: a walk done via the app's Guided Walk feature appears
  on the home "Today's Timeline" as "Outdoor walking / 1.96 km / 24 min" instead of being
  identified as a Guided Walk.

### Root cause (traced 2026-08-05) — the distinguishing data is lost at a display-collapse step, not missing upstream

- A guided walk is saved via `components/guided-walk/walk-summary.tsx`'s `saveWalk()` into
  `activity_logs` with `activityType: 'walk'` (**shared** with every other walk — manual or
  auto-detected — no dedicated `source`/`modality` value), `title: 'Interval walk'` (or
  `'Treadmill interval walk'`), and a `segments` JSONB column (migration 161) that **only** a
  guided walk ever populates.
- The label is decided in two places, both of which have the real `title`/`segments` in scope and
  discard them:
  1. `app/api/day-timeline/route.ts:228-229` collapses every activity-log row to a bare
     `'Run'`/`'Walk'` via a keyword match on `${log.title} ${log.activityType}` — the actual
     `title` ("Interval walk") and `segments` are never read.
  2. `components/home-day-timeline.tsx:100` further maps `ev.title === "Walk"` →
     `"Outdoor walking"`.
- **Not a data-pipeline gap** — `repo.listActivityLogs` (`lib/data/postgres/adapter.ts:2015-2038`)
  already returns `segments`/`title` intact; the loss happens entirely in the timeline's own
  display-collapse logic.

### Tasks

- [ ] In `day-timeline/route.ts`'s label-collapse step, check `segments != null` (or the real
      `title`) before falling back to the generic `'Run'`/`'Walk'` keyword match, and surface a
      distinct label/type for a guided walk through to `TimelineEvent`.
- [ ] Update `home-day-timeline.tsx`'s `WalkCard` (and `app/health/timeline/page.tsx`'s
      equivalent, per the Task 8 sibling-surface note) to render "Guided Walk" for that case
      instead of "Outdoor walking".
- [ ] Local dev-server pass: log a guided walk and a plain auto-detected/manual outdoor walk on
      the same day, confirm the timeline distinguishes them correctly.
- [ ] Run tests + lint. Remove this task's entry (Q-94) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

---

## Task 10 (Q-95) — auto-activity-detection double-logs a walk during an active Guided Walk

- **Branch:** `fix/auto-detection-guided-walk-gate`
- **Reported:** owner-reported, 2026-08-05: during a Guided Walk session, the "activity tracking"
  auto-detection banner fired and appears to have detected/logged another separate run/walk
  activity covering the same time period as the guided walk already in progress.

### Root cause (traced 2026-08-05) — a known, already-solved suppression pattern that was never extended to this case

- The auto-detection system (`lib/activity/auto-detection-service.ts`, triggered by phone
  significant-motion or ring cadence) **already has** exactly this kind of suppression for one
  case: `isWorkoutInProgress(mode)` (`:64-66`) is checked inside `dispatchGate()` (`:247`) and
  blocks a motion trigger from arming GPS probing whenever a lifting workout is active.
  **There is no equivalent check for an active guided walk** — the service never imports
  `guided-walk-store`, so it runs completely blind to one being in progress.
- **The fix needs no new plumbing.** `isGuidedWalkActive(state)`
  (`lib/stores/guided-walk-store.ts:13-15`) is the exact same pure-predicate pattern as
  `isWorkoutInProgress`, already consumed elsewhere (`mobile-auth-handler.tsx:41`,
  `bottom-nav.tsx:56`) — it just isn't checked in `dispatchGate()`.
- Confirmed **not** already covered by the existing false-positive plan
  (`docs/superpowers/plans/2026-08-03-auto-activity-detection-false-positive-gate.md`, shipped as
  Q-68, 2026-08-04) — that plan's scope is a different scenario entirely (ring-confirm notifying
  too eagerly on ~90s of incidental in-band cadence with no GPS corroboration, e.g. during a scale
  weigh-in) and is explicitly a **notify-only veto** ("the session itself still starts and still
  records... this task doesn't touch save-path quality gates") — it never mentions guided walks
  and doesn't touch `dispatchGate()`'s workout/guided-walk gating at all.
- **Sibling gap found in passing, worth fixing in the same pass**: the manual "Other Activity"
  flow has the identical hole — `isActivityActive` (`lib/stores/activity-store.ts:58-60`) is also
  never checked in `dispatchGate()`.

### Additional symptom detail, 2026-08-06 — same bug, new timing information worth designing around

Owner reported a second instance of this: after **finishing** a Guided Walk (not during), the app
opens the manual "Other Activity" start sheet asking them to name/save an activity — i.e. the
auto-detection system's own independently-tracked session reaches its confirm/save step right at
the moment the guided walk ends, not just producing a background duplicate log as first reported.

This sharpens the fix's edge case: gating `dispatchGate()` on `isGuidedWalkActive()` correctly stops
a *new* motion trigger from arming GPS probing while the flag is true, but if auto-detection's own
gate already reached `'tracking'` state **before** the walk-active flag flips back to false at
completion (a real race at the boundary, not just "during" vs. "after"), the pending
session-confirm/save step could still fire post-walk even with the gate fix in place. **Worth
explicitly testing this boundary case**, not just the steady-state "gate blocks triggers while
`isGuidedWalkActive()` is true" case — confirm a guided walk that runs long enough for
auto-detection to reach `'tracking'` doesn't still surface a stray confirm sheet the moment the
walk ends.

### Tasks

- [ ] Add `isGuidedWalkActive(useGuidedWalkStore.getState())` alongside the existing
      `isWorkoutInProgress` check in `dispatchGate()` (`auto-detection-service.ts:247`), mirroring
      the workout gate exactly.
- [ ] Sibling-surface sweep (found during investigation, not yet fixed): add the equivalent
      `isActivityActive` check for the manual "Other Activity" flow in the same pass.
- [ ] Local dev-server pass (or scripted state simulation, since GPS/motion triggers are hard to
      reproduce in the sandbox): confirm `dispatchGate()` no-ops while a guided walk (and a manual
      activity) is active, and still fires normally otherwise.
- [ ] Specifically test the completion-boundary race described above: a guided walk long enough for
      auto-detection to reach `'tracking'` before the walk ends must not still surface the "Other
      Activity" start/confirm sheet once `isGuidedWalkActive()` flips false — the steady-state gate
      check alone may not cover this if auto-detection's own session was already mid-flight.
- [ ] Run tests + lint. Remove this task's entry (Q-95) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

---

## Task 11 (Q-96) — "Burned" and "Balance" cards use a broken calorie source that exists correctly elsewhere

- **Branch:** `fix/body-burned-balance-energy-source`
- **Reported:** owner-reported, 2026-08-05: the Body tab's "Burned" card reads 0 kcal despite a
  logged workout and a guided walk that day — it isn't accounting for workouts or walks, and
  should really be BMR + Walk + Run + Workout. Separately, the "Balance" card (food intake vs
  energy expenditure) has never shown real data — always "No data".

### Root cause (traced 2026-08-05) — the correct calculation already exists and is already wired into a different, working card

- **"Burned"** (`app/health/health-sections.tsx:500-518`, case `"caloriesBurned"`) reads
  `calsBurnedToday`, computed in `app/api/body-metadata/route.ts:176-178` as a bare sum of
  `activity_logs.caloriesBurned` across today's rows. That column is populated **only** by Health
  Connect enrichment or a manual metrics PATCH — a Guided Walk explicitly writes
  `caloriesBurned: null` at completion (`components/activity/done-activity-screen.tsx:199`,
  comment: "computed server-side; it hydrates on the next sync/fetch" — that hydration never
  actually happens without Health Connect), and **lifting workouts (`workout_sessions`) aren't
  queried by this calculation at all.** So a day with a real walk + a real Push session correctly
  shows `0`, not "no data" — the row exists, its calorie field is just always null for these
  sources.
- **"Balance"** (`health-sections.tsx:587-618`, case `"weightTrend"`) reads `energyBalanceKcal`
  from `useEnergyBalance()` (`caloriesToday − calsBurnedToday − TDEE`) — it reuses the same broken
  `calsBurnedToday`, plus requires food to already be logged today (an all-or-nothing null gate on
  weight/height/age/sex/food), stricter than the working card below.
- **The fix already exists, wired into a different card in a different tab group.**
  `computeActiveEnergy()` (`packages/shared/src/health/daily-energy.ts:95-130`) correctly combines
  strength-session energy (`estWorkoutKcal()`, MET × Schofield BMR,
  `packages/shared/src/health/workout-energy.ts:91`) + logged walk/run/cycle activities +
  de-duplicated passive steps into one number — exactly "BMR-adjacent + Walk + Run + Workout" as
  the owner described. It's already computed at `body-metadata/route.ts:144-152` as
  `activeEnergyKcalToday`, and already correctly feeds `EnergyBudgetCard`
  (`components/health/energy-budget-card.tsx`, via `useEnergyBudget`,
  `use-health-calcs.ts:55-86`) in the "Activity & intake" card group — just not the "Burned"/
  "Balance" cards in the "Body" group (`health-content.tsx:59` vs `:62`).
- BMR itself is the standard single-source formula (`mifflinStJeorBmr()`,
  `packages/shared/src/nutrition/goal-recommendation.ts:29`) — already used by both
  `useEnergyBudget` and `useEnergyBalance` for their TDEE term.

### Fix direction

This is a source swap, not new domain math — no new formula needs inventing, per "One Formula,
One Place": there is already exactly one correct implementation (`computeActiveEnergy`), and two
cards are bypassing it in favor of a narrower, HC-dependent field.

### Tasks

- [ ] Swap "Burned"'s source from `calsBurnedToday` to `activeEnergyKcalToday`
      (`computeActiveEnergy()`'s output, already computed in the same route) so it reflects
      BMR-adjacent + workout + walk/run energy, matching what `EnergyBudgetCard` already shows
      correctly.
- [ ] Swap `useEnergyBalance()`'s `calsBurnedToday` term to the same `activeEnergyKcalToday`
      source, and reconsider whether Balance's all-or-nothing null gate should relax to match
      `useEnergyBudget`'s (which doesn't require food to be logged first) — decide during
      implementation, don't silently keep the stricter gate if it's not intentional.
- [ ] Sibling-surface check: confirm no other card/screen still reads the bare
      `calsBurnedToday`/`activity_logs.caloriesBurned` sum expecting it to represent total daily
      burn (grep before assuming this is the only two call sites).
- [ ] Local dev-server pass: on a day with a logged lifting workout and a guided walk, confirm
      "Burned" and "Balance" now show non-zero, sane values consistent with `EnergyBudgetCard`'s
      existing number for the same day.
- [ ] Run tests + lint. Remove this task's entry (Q-96) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

---

## Task 12 (Q-97) — "already trained today" state on the Workout tab card is too subtle

- **Branch:** `feat/workout-card-trained-today-banner`
- **Reported:** owner-reported, 2026-08-05: now that Q-89 fixed the card actually updating, the
  "already done" state itself isn't visible enough — wants a large, unmistakable banner over the
  card showing it's already complete, rather than the current small indicators.

### What's there today (traced 2026-08-05)

All in `app/workout-select/workout-select-content.tsx`, driven by the `trainedToday` boolean
(`:85`, already fixed by Q-89 to actually update promptly):
- A faint `ring-1 ring-green-500/40` on the whole card (`:300`).
- A 12px `CheckCircle2` icon + "Trained today" text, sized/styled the same as every other
  secondary metadata line on the card (`:331-335`).
- The primary button swaps text to "Start Again" with a subtler border style instead of the
  brand-color fill (`:382-388`).

All three signals are real but small and easy to miss at a glance — exactly the owner's
complaint. This is a visual-prominence request, not a data/logic bug (Q-89 already covers making
the underlying state correct and timely).

### Direction — refined 2026-08-06 with concrete visual reference from the owner

The small pill version of this ("FRONT [check] Completed Today BACK" above the muscle diagram) has
since shipped, but the owner has now seen it live and wants something bolder, with a specific
reference: a semi-transparent "COMPLETED" **stamp** graphic (3 stock examples supplied — a rotated
rubber-stamp look, bold condensed type, distressed/clean variants) layered **on/behind the
`MuscleHeatmap` SVG itself**, not just a pill above it. Treat the supplied images as a style
reference for the *shape* of the idea (rotated stamp badge, semi-transparent, bold type) — recreate
it as an in-app SVG/CSS element in the app's own theme colors (the existing success-green token),
not a licensed stock raster asset, consistent with this app's no-external-image-assets /
theme-token design convention.

**Second, separate request**: drop the "Front"/"Back" text labels entirely — the owner considers
them self-evident from the silhouettes themselves. These live in the *shared* `MuscleHeatmap`
component (`components/muscle-heatmap.tsx:114-118,130-134`, gated on `!compact`), used in 12 other
places across the app (`active-workout-screen.tsx`, `warmup-screen.tsx`, `exercise-stats-sheet.tsx`,
`builder-wizard.tsx`, `body-muscle-card.tsx`, `injury-card.tsx`, `weekly-muscle-sets-card.tsx`,
`exercise-history-sheet.tsx`, `sore-muscle-picker.tsx`, and others) — the labels read as redundant
in every one of those contexts too (a front-view silhouette next to a back-view one is self-evident
everywhere, not just on this card), so removing them from the shared component rather than
special-casing this one call site is likely correct, but confirm no call site has a reason to keep
them (e.g. a context where the two halves aren't obviously paired) before a blanket removal.

Still true from the original scope: keep the existing "Start Again" button reachable and
functional, don't occlude the recovery-% pills below, verify light/dark theme, use theme tokens
throughout (no raw hex, no stock image assets), and this pairs with Q-89 (the underlying
`trainedToday` state already updates promptly) so the new treatment shows immediately on
completion, not after a remount.

### Tasks

- [ ] Design an in-app "COMPLETED" stamp treatment (SVG/CSS, theme-token colored, semi-transparent,
      rotated-badge style per the owner's reference images) layered on/behind the `MuscleHeatmap`
      SVG on the Workout tab card (`workout-select-content.tsx:299-392`) when `trainedToday` is
      true — replacing or augmenting the current small pill, per what actually reads best once
      built.
- [ ] Remove the "Front"/"Back" text labels from `MuscleHeatmap`
      (`components/muscle-heatmap.tsx:114-118,130-134`) — sibling-surface check across all 12
      current call sites first, since this is a shared component, not scoped to just this card.
- [ ] Keep the existing "Start Again" button reachable and functional underneath/alongside the new
      treatment — this is a visibility enhancement, not a state that should block re-starting the
      session.
- [ ] Verify light and dark theme rendering, and that the stamp doesn't clip/overflow or make the
      muscle diagram unreadable at the S25 viewport.
- [ ] Local dev-server pass: complete a session, confirm the new treatment appears clearly and
      immediately (paired with the Q-89 fix so it doesn't wait for a remount), and that the
      Front/Back label removal reads fine across the other `MuscleHeatmap` call sites checked above.
- [ ] Run tests + lint. Remove this task's entry (Q-97) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

---

## Task 13 (Q-98) — Running screen: skip leaves a dead end, plus a redesign toward per-card imagery

- **Branch:** `fix/running-skip-dead-end-and-cards`
- **Reported:** owner-reported, 2026-08-05: on the Running pre-run screen, tapping "Skip" leaves
  you unable to choose anything else — only "Back to Cardio" remains, even though the run-type
  carousel above is still swipeable. Suggested direction: consider dropping "Skip" as a separate
  concept and redesign the screen carousel-native, similar to the Workout tab, with distinct
  imagery per run type that you swipe through.

### Two separate problems found (traced 2026-08-05) — a real bug, and a design request

**The bug (APK-only, would not be caught by a web-sandbox check):**

- `components/running/running-plan-content.tsx:260` keys its action panel on `status`
  (`'pending'` → `PrescribedRunCard`'s Start/Skip buttons; otherwise → the dead-end "Today's run
  skipped..." message), not on which carousel card is currently swiped to. `onSkip` →
  `markRun('skipped')` (`:141-164`) writes `'skipped'` through the local store + outbox — from
  then on the fixed panel is gone regardless of what the carousel shows.
- **There IS working reset logic that should fix this on its own** — swiping calls
  `applyOverride` (`:191-200` → `app/api/running-plan/override/route.ts:65-78`), whose server
  route explicitly resets status to `'pending'`, and the client sets `setLocalStatus('pending')`
  on success. **But `applyOverride` only does a bare `fetch` — unlike `markRun`, it never writes
  through `store.upsertPrescribedRun`/`queueMutation`.** The local-first status effect
  (`:131-139`) re-runs on the resulting `data` change and re-reads status from the **local
  store**, which still holds the stale `'skipped'` row `markRun` wrote — clobbering the reset back
  to `'skipped'` immediately. On web, `getLocalStore()` returns `null` so this race doesn't exist
  and swipe-to-unskip *appears* to work in the sandbox — this is squarely the
  "verified but broken because the failing path is unreachable in the sandbox" pattern this repo
  has hit before. **Device verification required**, not just a dev-server pass.

**The redesign request:**

- The Running screen's carousel (`components/running/run-type-carousel.tsx`) already uses the
  shared `SwipeCarousel` primitive (`components/ui/swipe-carousel.tsx`, `@use-gesture/react`) —
  **this is actually the better-built one of the two carousels in the app.** The Workout tab's
  session carousel (`workout-select-content.tsx`) is a hand-rolled raw-`TouchEvent` swipe
  implementation — one of the "two independent hand-rolled swipe implementations" CLAUDE.md's own
  rule already calls out as tech debt. **Don't copy the Workout tab's gesture code** — reuse
  `SwipeCarousel`, which this screen already has. What IS worth imitating from the Workout tab is
  its **per-card-bound single action button** structure (one persistent Start button whose target
  reassigns as you swipe, no separate skip step to get stuck in) and its use of imagery
  (`MuscleHeatmap`) per card.
- Concretely: restyle `RunTypeCarousel`'s slides (currently text-only,
  `run-type-carousel.tsx:44-67`) with per-run-type imagery/SVG, and fold an inline Start action
  into each slide (as `PrescribedRunCard`'s button does today, keyed to that slide's type/
  duration) — eliminating the separate fixed `PrescribedRunCard` panel and the "Skip" button
  concept entirely. Swiping away from a run type *is* skipping it; there's nothing left to get
  stuck behind.

### Tasks

- [ ] **Bug fix (do this regardless of the redesign decision below):** make `applyOverride` write
      through the local store/outbox the same way `markRun` does, so the reset-to-pending on
      swipe survives the local-first status effect's re-read. Verify **on-device** — this is
      exactly the class of bug that passes a sandbox check while staying broken on the APK.
- [ ] Decide scope with the redesign in mind: minimal fix alone (unblocks the dead end,
      keeps today's layout), or the fuller carousel-native redesign (per-slide imagery + inline
      start, removing `PrescribedRunCard` and the Skip button). Both are valid to ship
      independently — the bug fix should not wait on the redesign being resourced.
- [ ] If doing the redesign: source or design per-run-type imagery/SVG (Easy/Tempo/etc.), fold
      the start action into each `SwipeCarousel` slide, remove the now-unused
      `PrescribedRunCard`/skip-message branch in `running-plan-content.tsx:248-279`.
- [ ] Local dev-server pass for layout/logic, **plus an on-device APK pass** for the skip/reset
      race specifically (per the note above, this won't reproduce in the sandbox).
- [ ] Run tests + lint. Remove this task's entry (Q-98) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR — note in
      `projectOverview.md` if the redesign half is deferred and only the bug fix ships.

---

## Task 14 (Q-99) — Guided Walk: redesign as a Long / Short / Custom carousel

- **Branch:** `feat/guided-walk-long-short-custom-presets`
- **Reported:** owner-reported, 2026-08-05: wants the Guided Walk setup screen to follow the same
  swipeable-carousel visual theme as the rest of the app (Workout tab, and the Running screen from
  Task 13), with three presets — **Long**, **Short**, and **Custom** — where Custom is a
  user-configured setup, falling back to a default if never set up.

### What's already there (traced 2026-08-05)

- `components/guided-walk/walk-config.tsx` already has a 2-card carousel: `PRESETS` (`:15-18`) is
  a flat array of exactly `Standard` (5×3/3 min, ~30 min) and `Quick` (3×3/3 min, ~18 min) — no
  existing structure for a third, user-editable preset "kind."
- **This screen already uses the same `SwipeCarousel` primitive as the Running screen** (Task
  13) — same card shape, same dot-row styling, same "swipe to pick a preset" microcopy. If "main
  theme" means the pattern already shared between Running and Guided Walk, **the carousel
  mechanics need no change, only content** — this is genuinely cheap on the mechanics side. If it
  specifically means the Workout tab's richer look (palette color + `MuscleHeatmap`-style
  imagery), that's a separate, larger visual-theming task layered on top (see Tasks below).
- Sets/Fast/Slow/Warm-up/Cool-down are fully independent free-editing fields in
  `useGuidedWalkStore().config` (persisted `localStorage`, `ta_guided_walk_v1`) — selecting a
  preset dot just overwrites `sets/fastSec/slowSec` via `applyPreset()`; warm-up/cool-down aren't
  touched by presets at all today. **There's already an implicit "custom" state** — `presetIndex`
  (`:42-45`) falls back to index 0 ("Standard") whenever the current values don't match any
  preset, so a manually-edited config is silently mis-displayed as "Standard selected" today. A
  real Custom card replaces that fallback with an honest third state.
- **No persisted "saved custom config" exists** — the store persists only the single active,
  transient `config`. Needs a new `customConfig: WalkConfig | null` field on the existing
  zustand store (already covered by its `persist` middleware — no DB migration, consistent with
  this app's other `ta_*` localStorage-only UI prefs).
- No existing interval-count duration-preset convention in the cardio pillar specifically, but the
  codebase-wide ±30 relative-delta short/long convention exists
  (`packages/shared/src/workout/duration-model.ts`, `DURATION_PRESET_DELTA_MIN`/
  `budgetForPreset()`). **Lowest-risk mapping, reusing values that already exist and are
  presumably already tuned/liked**: rename current "Standard" (5×3/3, ~30 min) → **Long**, current
  "Quick" (3×3/3, ~18 min) → **Short**.

### Tasks

- [ ] Add a `customConfig: WalkConfig | null` field to `guided-walk-store.ts` (persisted via the
      existing middleware).
- [ ] Relabel current presets: "Standard" → **Long**, "Quick" → **Short** (values unchanged unless
      the owner wants different numbers — check before assuming).
- [ ] Add a third **Custom** carousel card: reads `customConfig` if set, else
      `DEFAULT_WALK_CONFIG` (`lib/walk/interval-plan.ts:59`). Decide the save interaction before
      building — should selecting Custom route the always-visible steppers to edit `customConfig`
      directly (autosave), or need an explicit "Save as Custom" action? Today steppers and presets
      share one flat `config`, so this is the one real design decision here, not a detail to
      guess past.
- [ ] Fix `presetIndex`'s silent "falls back to Standard/Long when nothing matches" behavior to
      correctly show Custom-selected (or no-selection) instead, now that a real third slot exists.
- [ ] If the fuller Workout-tab-style visual richness (palette/imagery) is in scope for this pass,
      size it as a separate, explicit step — it's materially more work than the preset/Custom
      logic change and touches theming this screen has never used. Don't bundle it in silently.
- [ ] Local dev-server pass: confirm all three presets apply correctly, Custom persists across a
      reload, and warm-up/cool-down behavior (untouched by presets today) is intentional in the
      new three-preset model.
- [ ] Run tests + lint. Remove this task's entry (Q-99) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

---

## Task 15 (Q-100) — visible scrollbar on the cardio page (likely a sibling-surface issue, not cardio-only)

- **Branch:** `fix/cardio-hide-scrollbar`
- **Reported:** owner-reported, 2026-08-05: a scrollbar is visible on the right edge of the cardio
  page.

### Root cause + scope note (traced 2026-08-05)

- The cardio page's main scroll container is a plain `overflow-y-auto` div with no
  scrollbar-hiding utility: `components/cardio/cardio-content.tsx:81` —
  `className="flex h-full flex-col gap-2.5 overflow-y-auto px-4 pt-safe pb-safe-action"`.
- The app already has a utility for this — in fact **two, near-duplicate ones**:
  `.scrollbar-hide` (`app/globals.css:159-167`, `@layer utilities`) and `.no-scrollbar`
  (`app/globals.css:476-478`), same effect (`scrollbar-width: none` + `::-webkit-scrollbar {
  display: none }`), defined separately. Currently applied at only two call sites in the whole
  app (`admin-content.tsx`, `weight-dial.tsx`) — everywhere else with a scrolling root container
  doesn't hide it.
- **This is very likely broader than just cardio** — a grep for `overflow-y-auto` on top-level
  `*-content.tsx` screens found the same pattern (bare `overflow-y-auto`, no hide utility) on
  `more-content.tsx`, `year-review-content.tsx`, `stats-content.tsx`,
  `session-select-content.tsx`, `nutrition-content.tsx`, and `health-content.tsx`. The owner
  happened to notice it on cardio; the others weren't checked against a real device, only
  grepped, so don't assume they're silent — confirm on-device before ruling them in or out.

### Tasks

- [ ] Confirm on-device (or via the WebView rendering, since scrollbar chrome can differ from the
      sandbox) whether this is cardio-specific or reproduces across the other `overflow-y-auto`
      root containers listed above.
- [ ] Apply the scrollbar-hide utility to `cardio-content.tsx:81` at minimum; extend to the other
      confirmed-affected screens in the same PR if the sibling-surface check confirms they're
      affected too (per the sibling-surface-sweep rule — don't fix one surface and leave known
      siblings broken).
- [ ] While touching this, consolidate `.scrollbar-hide` and `.no-scrollbar` into one utility
      (they're identical) rather than leaving two near-duplicate copies — low-risk cleanup, do it
      only if it doesn't expand this task's blast radius unreasonably.
- [ ] Local dev-server + on-device pass: confirm no visible scrollbar chrome on the fixed
      screen(s) while scroll behavior itself is unchanged.
- [ ] Run tests + lint. Remove this task's entry (Q-100) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

---

## Task 16 (Q-101) — sleep list shows onset time as "bedtime", inconsistent with sibling surfaces

- **Branch:** `fix/sleep-list-bedtime-consistency`
- **Reported:** owner-reported, 2026-08-05: sleep times on the Sleep detail sheet look pushed
  back — typical bedtime is 10-10:30pm, but the list shows later times.

### Measured against production, 2026-08-05 — confirmed, precise, and now root-caused

Queried `claude_ro.sleep_sessions` directly for the last 8 nights: the displayed "bedtime" (start
of the time range) matches `sleep_start + onset_latency_sec` **exactly to the minute**, every
night — e.g. 2026-08-05: raw `sleep_start` converts to 23:06 local, `onset_latency_sec` = 1200 (20
min), displayed "11:26 pm". Wake time renders correctly with no offset. This is real, reproducible
onset-latency time (10-25 min in the sample) being added onto what the owner reasonably reads as
"what time did I go to bed."

### Root cause (traced 2026-08-05) — not a stray bug, but a real inconsistency between two legitimate conventions used on different surfaces

- `components/health-metric-sheet.tsx` (list rows `:330-336`, detail header `:120-122`) and
  `components/health/body-cards/sleep-card.tsx` (`:50-53`) all call `actualSleepWindow(r)`
  (`lib/sleep/actual-window.ts:29-41`) and use its `.start` instead of the raw `sleepStart` — this
  function independently re-derives "time of first non-awake 5-min hypnogram epoch" from the phase
  string, by design (its own header comment: "bedtime with onset latency trimmed off"). It isn't
  reading `onset_latency_sec` directly — it's a **second, independent computation of the same
  quantity**, which is why it matches to the minute: the BLE ingest pipeline
  (`lib/data/postgres/adapter.ts:5031,5105`) computes `onsetLatencySec` with the *exact same*
  "first non-awake epoch × 5 min" formula this display function re-derives.
- **Two other surfaces disagree and show the raw bedtime instead**: the Hypnogram ribbon x-axis
  (passes raw `sleepStart`/`phaseWindowStart`) and the "Fell asleep" day-timeline card
  (`app/api/day-timeline/route.ts:126-140`) — which anchors on raw `sleepStart` and shows onset
  latency only as a separate, informational subtitle, never folded into the displayed time. **This
  is the pattern the owner's mental model matches** — "Fell asleep [time]" with latency called out
  separately reads correctly as "went to bed at X, took N min to fall asleep."
- Net: 3 surfaces show "actual sleep window start" (onset-trimmed) labeled ambiguously as if it
  were bedtime; 2 surfaces show raw bedtime with latency called out separately. Not a data bug —
  `sleep_start` is correctly populated from Oura's raw `bedtime_start` (Cloud) or the raw
  dense-sensing window start (BLE) in both paths — this is a **display-convention inconsistency**
  across sibling surfaces, and the 3-site convention is the one confusing the owner.

### Fix direction

Standardize the Sleep list/detail sheet and the sleep-card widget on the "Fell asleep" pattern
already used correctly elsewhere: show raw `sleepStart` as the range start, and surface onset
latency as separate informational text/badge (the sleep-card widget already has a latency badge
at `:81` it could extend to the others) rather than folding it into the displayed time range.
`actualSleepWindow`'s trim may still be useful for other purposes (e.g. correcting end-time
overshoot) — decide during implementation whether to keep it for that narrower use or retire it
if nothing else needs it.

### Tasks

- [ ] Change `health-metric-sheet.tsx` (list `:330-336`, detail header `:120-122`) and
      `sleep-card.tsx` (`:50-53`) to display raw `sleepStart`/`recentSleep.sleepStart` as the
      range start, matching the Hypnogram ribbon and day-timeline "Fell asleep" card.
- [ ] Surface onset latency as separate informational text at these sites (list row and detail
      header currently have none; sleep-card already has a badge to extend/reuse) — don't just
      delete the information, relocate it to match the pattern that already works correctly.
- [ ] Check whether `actualSleepWindow`'s trimmed end-time is still needed anywhere once the
      start-time use is removed from these 3 sites — don't leave a now-half-used helper without
      checking its remaining callers.
- [ ] Local dev-server pass: confirm the sleep list/detail bedtime now matches the raw
      `sleep_start` value (cross-check against `claude_ro.sleep_sessions` for a known night), and
      that latency is still visible, just no longer folded into the time.
- [ ] Run tests + lint. Remove this task's entry (Q-101) from `docs/implementation-backlog.md`,
      add the journal entry + `projectOverview.md` update in the same PR.

---

## Task 17 (Q-102) — wire the morning sleep-feel rating into the live Sleep Score, neutral at 3/5

- **Branch:** `feat/sleep-feel-score-adjustment`
- **Reported:** owner-reported, 2026-08-05: wants the morning check-in's sleep-feel rating (1-5)
  to adjust the live Sleep Score — a rating of 3/5 (their typical/default rating, "the basic one
  most of the time") should have **zero** effect, and only ratings that deviate below or above 3
  should adjust the score, with the adjustment's size scaling with distance from 3.

### ⚑ Correction to the premise, and a decision this reverses — surface before building

- **It is not currently wired up.** The owner believed this was already connected; it isn't.
  `sleepQualityFeel` (`day_checkins.sleep_quality_feel`, 1 = best … 5 = worst, confirmed in
  `packages/shared/src/types/day-checkin.ts:19,59`) is read **only** by the admin calibration
  diagnostic (`app/api/admin/sleep-feel-calibration/route.ts`) and by the separate AI-periodization
  signal set (`packages/shared/src/ai-periodization/signals.ts:67-74,210-216`) — never by the
  actual Sleep Score computation. `computeSleepScoreSeries`/`computeSleepScore`
  (`packages/shared/src/health/sleep-score.ts:172-182,277-336`) take only `SleepSession[]` (+
  baselines/habitual bed-wake hours) — no check-in data at all.
- **This reverses a specific, already-documented owner decision.** The calibration module's own
  header comment records it: *"Owner decision (2026-07-27, audit finding Q-16):
  `day_checkins.sleep_quality_feel` stays OUT of the Sleep Score and becomes 'something to look
  back on when tuning.'"* That decision existed specifically to keep the self-report independent
  of the score it's used to calibrate/validate against (Q-72's own r=-0.354 finding, and any
  future calibration work in `sleep-feel-calibration.ts`, both rely on the score being computed
  *without* the self-report as an input — otherwise a "does the score match how it felt"
  comparison becomes partly circular). **This is a real, worth-flagging tradeoff, not just a
  technicality** — once feel adjusts the score, `sleep-feel-calibration.ts` and any future
  score-vs-feel correlation work needs to account for the score no longer being independent of
  feel (e.g. by comparing against a stored pre-adjustment value). Noting this so the decision is
  made with eyes open, not blocking it — the owner is the one who can reverse Q-16.
- **This does NOT resolve the still-open Q-72** (`docs/implementation-backlog.md`) — Q-72 posed a
  choice between (a) rescaling the score's dynamic range or (b) a separate "felt vs scored"
  signal, both of which kept feel out of the score. This is a **third, different direction** the
  owner is now giving, not a pick between Q-72's two options. Leave Q-72 as its own open item
  unless the owner says this supersedes it.

### ⚑ New blocker, found 2026-08-06 while investigating a separate morning-check-in complaint — read before implementing

`sleepQualityFeel`'s on-screen slider is **pre-filled from the Sleep score itself**
(`prefillMorningScales()` → `scoreToScale(sleepScore)`,
`packages/shared/src/nutrition/day-checkin-prefill.ts:31-38`) — the check-in sheet opens already
positioned at a sleep-score-derived guess, before the owner looks at it. An unedited answer is not
independent self-report, it's the score reflected back at itself. **Wiring an unedited
`sleepQualityFeel` into the live Sleep Score (this task's entire premise) would be circular for any
day the owner didn't actively move the slider** — the score would be nudged by a value derived from
itself. See the `[readiness]` Known-Issues row this same investigation added
(`projectOverview.md`, 2026-08-06) and **Q-113** (the sibling task addressing the prefill
contamination directly). **Do not implement this task until either Q-113 ships a fix for the
prefill issue, or this task adds its own way to distinguish a genuinely-edited answer from an
untouched prefill** (e.g. only apply the adjustment when the stored row's value differs from what
`scoreToScale` would have produced that morning, or track a "touched" flag at save time).

### Fix direction (matches the scale's real semantics: 1=best…5=worst, 3=neutral default)

A post-score, symmetric, zero-at-3 delta: `adjustment = (3 − sleepQualityFeel) × k` — feel=1
(best) → positive adjustment (score up); feel=5 (worst) → negative (score down); feel=3 or no
check-in for that day → zero, unchanged. Clamp the final score to [0,100]. **`k` (points per
rating-step) is an open parameter, not decided by this write-up** — pick a conservative default
(e.g. small enough that a 1-point swing away from 3 nudges the score a few points, not double
digits) and confirm the magnitude feels right against real recent nights before shipping, rather
than guessing a number that turns out too aggressive or too subtle.

### Tasks

- [ ] Confirm the direction/formula above with a quick sanity check against a few of the owner's
      own recent nights (e.g. the 2026-07-26 "felt 5, scored 80" and 2026-07-03 "felt 1, scored
      93" nights from Q-72's own measurement) before picking `k`.
- [ ] Add `sleepQualityFeel`/check-in data as an input to the Sleep Score computation path —
      thread it through `computeSleepScoreSeries`/`computeSleepScore` and every caller that needs
      the adjusted value (health screen, weekly-digest, readiness-score if it consumes Sleep
      Score, the score audit tooling) — grep for callers before assuming the list is complete.
- [ ] Apply the delta as a distinct, clearly-separable step (not folded into the existing
      `SLEEP_WEIGHTS` contributor pattern) so it can be audited/disabled independently, and so a
      day with no check-in cleanly falls back to the unadjusted score.
- [ ] Update (or flag for follow-up) `sleep-feel-calibration.ts` and its admin endpoint to account
      for the score no longer being feel-independent, per the circularity note above — at minimum
      leave a comment/doc note describing the change, since the module's existing comment
      explicitly documents the old (now reversed) decision.
- [ ] Local dev-server pass: verify a 3/5 check-in day shows an unchanged score, and 1/5 vs 5/5
      days on similar underlying sleep data show a visibly different, correctly-signed adjustment.
- [ ] Run tests + lint. Remove this task's entry (Q-102) from `docs/implementation-backlog.md`,
      add the journal entry + `projectOverview.md` update in the same PR — explicitly note the
      Q-16 reversal in the journal entry, not just the new feature.

---

## Task 18 (Q-103) — Body Battery "How it moves" panel always claims it opens at Readiness, even when it opened at Sleep

- **Branch:** `fix/body-battery-anchor-source-copy`
- **Reported:** owner-reported, 2026-08-05 (screenshot: home screen, Body Battery expanded —
  "Currently 91, from last night's sleep" directly above a "How it moves" panel reading "Opens each
  morning at your Readiness"). The battery had anchored to last night's Sleep score (91, matching
  the Sleep ring exactly) while Readiness (73) was still loading, but the static panel below it
  claims Readiness unconditionally — a visible self-contradiction on the same screen.

### Root cause (traced 2026-08-05) — one static string never wired to the same field two sibling lines already use

- `components/body-battery-card.tsx` computes `battery.anchorSource` (`'readiness' | 'sleep'`) and
  already renders it correctly dynamically in **two** places on the same card: the "Started at"
  line (`:159-161`, `' from readiness'` / `' from sleep'`) and the collapsed-state summary
  (`:190-194`, `', from this morning's readiness'` / `', from last night's sleep'`).
- The "How it moves" panel's own line, a few lines below at `:206`, is a plain hardcoded string —
  `<span>Opens each morning at your <span className="font-medium text-foreground">Readiness</span></span>`
  — with no reference to `battery.anchorSource` at all. It always says Readiness regardless of
  which source the battery actually anchored to. This is the exact contradiction in the
  screenshot: two lines on the same expanded card, one correct and dynamic, one static and wrong.
- Confirmed via `packages/shared/src/health/body-battery-inputs.ts` that anchoring to Sleep instead
  of Readiness is expected, intentional behavior (provisional anchor before today's Readiness
  lands, per the `anchorProvisional` flag already rendered elsewhere on this same card) — not a
  bug in the anchor logic itself, only in this one line of copy failing to reflect it.

### Fix direction

Make the "How it moves" line read `battery.anchorSource` the same way the other two lines on this
card already do — e.g. `Opens each morning at your {anchorSource === 'sleep' ? 'Sleep' : 'Readiness'}`,
kept consistent with the "Started at"/summary lines' existing wording choices (readiness vs sleep).

### Tasks

- [ ] Make `body-battery-card.tsx:206`'s "How it moves" line render the actual `battery.anchorSource`
      instead of a hardcoded "Readiness", matching the wording pattern already used at `:160-161`
      and `:192-193`.
- [ ] Local dev-server pass: seed/force a sleep-anchored (pre-Readiness) state and confirm all
      three lines on the expanded card now agree; confirm the Readiness-anchored case still reads
      correctly too.
- [ ] Run tests + lint. Remove this task's entry (Q-103) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

---

## Task 19 (Q-104) — "Weighing you…" toast still fires on a plain Home-tab visit, despite the 2026-08-01 fix

- **Branch:** `fix/scale-home-focus-toast-recurrence`
- **Reported:** owner-reported, 2026-08-05 (screenshot: Home screen, nobody on the scale, a
  "Weighing you…" progress toast visible above the bottom nav). This is the same symptom a prior
  session already investigated and shipped a fix for
  (`docs/overview/entries/2026-08-01-scale-false-weighing-toast-on-home-focus.md`,
  `projectOverview.md`'s `[platform][devices]` Q-67-adjacent entry) — the toast is recurring after
  that fix, not a first report.

### What the prior fix covers, confirmed still present in current `android/` source

- `ScaleBleService.kt` currently has the `hasSeenActivityThisWake` gate described in the prior
  entry: `onState()` (`:290-305`) suppresses CONNECTING/PREPARING/WAITING from JS unless a reading
  was already captured this wake or no real activity has been seen yet; `onFailure()`'s retry
  broadcast (`:369-377`) and give-up notification (`:386`), and `onCycleDeadline()`'s give-up
  notification (`:282`), all gate the same way. Only `onUnstableReading()` (`:314-329`) sets
  `hasSeenActivityThisWake = true` and unconditionally fires the `scaleStatus: waiting` event that
  drives the JS "Weighing you…" toast (`components/capacitor-native-init.tsx:248-280`).
- **This means the toast can currently only be showing for one of two reasons**: (a) the installed
  APK on-device predates this fix (app version at time of the prior fix vs the current
  `package.json` version 1.266.5 — many rebuilds have shipped since 2026-08-01, so check the
  owner's installed build number before assuming this), or (b) `onUnstableReading()` is firing
  without a real person on the scale — i.e. the gate is working exactly as designed, but its one
  ungated trigger (real proof someone is on the scale) is itself a false positive.

### Not yet root-caused — needs a fresh on-device capture, not a guess

The prior investigation's fix was built and reasoned from a `chrome://inspect` log capture; this
recurrence needs the same treatment before writing more Kotlin blind. Two concrete hypotheses worth
checking against a fresh capture, not proof of either yet:
- **Stale/cached characteristic value on subscribe.** Some BLE peripherals return the last-notified
  value immediately when a client (re-)subscribes to a characteristic (a resubscribe with dense
  notify vs a fresh reading isn't distinguished at the parse layer today). If Home-tab focus
  re-links the GATT connection and the scale's FFE1 characteristic replays its last real
  measurement, `ScaleGattClient` would parse it as a genuine unstable reading and legitimately (by
  today's logic) flip `hasSeenActivityThisWake`, even with nobody on the plates. This would explain
  the fix's own gate working exactly as designed while still producing the symptom, since
  `onUnstableReading` is the one trigger deliberately left ungated as "real proof."
- **Installed build predates the fix.** Simplest explanation, worth ruling out first — confirm the
  version string on the owner's device (Settings/About or the app footer) against when the fix
  shipped, before assuming the Kotlin logic itself has a gap.

### 2026-08-10 update — the on-device capture arrived via a fresh owner report, and it points squarely at hypothesis (a)-ruled-out / (b)-confirmed-by-code

Owner reported: "when scrolling to home screen the weigh-in keeps triggering," with two screenshots
— Home's live "Weighing you…" progress bar, and the OS notification shade. The shade gives a real
timestamped sequence: `5:43am Oura Ring connected`, **`5:46am "Weigh-in logged — 71.0 kg logged"`
(a genuine capture)**, **`5:47am "Scale — Connected — listening for weigh-ins"` (a fresh reconnect
one minute later)** — and the Home screenshot's own clock reads 5:47 with "Weighing you…" actively
showing. A brand-new cycle starting 60 seconds after a real capture, with no plausible time for a
second genuine weigh-in, rules out hypothesis (a) (stale build) implicitly — the ring-battery chip
and other 2026-08-08/09 features are visibly present and working, so this is a current build — and
matches hypothesis (b)'s predicted shape exactly.

Re-reading `onUnstableReading` (`ScaleBleService.kt:314-329`) against this evidence: it is **not
gated at all**, by explicit design — the class doc calls it "the one signal allowed to lift
suppression, since that's real proof someone is on the scale right now," and the handler itself
**undoes** `hasCapturedThisWake` (line 319) before force-firing a fresh `waiting` state (line 328).
Every other broadcast path in the file is protected by the 2026-08-01 fix; this one path is
deliberately exempt on the assumption that an "unstable reading" notification can only originate
from a real person on the scale. If the scale's GATT characteristic instead replays its
last-buffered notification on resubscribe — a documented behavior class for cheap BLE
body-composition scales, and exactly what a Home-tab-triggered `setHomeScreenActive` reconnect
would trigger per this file's own class-doc comment (lines 138-140) — this is the one path with no
way to catch it, by construction.

**Still unconfirmed and worth checking before writing the gate**: whether the replayed reading in a
fresh capture matches the prior captured weight (71.0kg in this case) essentially exactly — that's
the discriminator between "stale replay" and "some other spurious trigger" the capture task below
was already asking for. The code-level mechanism is now understood either way; only the precise
BLE-level cause of the value itself remains open.

### Tasks

- [x] ~~Confirm the installed APK's version against the 2026-08-01 fix's ship date~~ — ruled out by
      the 2026-08-10 evidence above (contemporaneous features visibly present and working).
- [ ] Capture a fresh `chrome://inspect` log (or the native `scaleLog` console output) of a spurious
      Home-tab-visit toast, matching the original 2026-08-01 investigation's methodology, and check
      whether `onUnstableReading` fires with weight data matching the *previous* real weigh-in
      (stale characteristic replay, now the leading hypothesis) or genuinely novel/noisy data.
- [ ] Gate `onUnstableReading` itself rather than trusting it unconditionally: either require the
      reported weight to differ from the last captured value by more than scale noise tolerance
      before treating it as a new physical weigh-in, or require a short minimum settle/consistency
      window — same shape as the check already proposed below, now with a concrete trigger
      (same-value replay on Home-tab-triggered reconnect) to test against.
- [ ] Local dev-server pass is not meaningful here (Kotlin/native-only) — this needs the on-device
      capture above before implementation, and an on-device re-test after.
- [ ] Run tests + lint. Remove this task's entry (Q-104) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR — update the existing
      `[platform][devices]` scale-toast Known-Issues entry rather than adding a duplicate one.

---

## Task 20 (Q-105) — "Body temp elevated" deload banner gives no numbers behind the call

- **Branch:** `feat/temp-alert-explanation-numbers`
- **Reported:** owner-reported, 2026-08-05 (screenshot: home screen banner "Body temp elevated —
  Rest or deload recommended"). Asked whether it's gated to 30+ days of baseline data, and if so,
  wants it expandable to show the average vs the difference driving the "illness" read.

### Confirmed gating, traced 2026-08-05

- Yes: `TEMP_BASELINE_MIN_DAYS = 30` (`packages/shared/src/ai-periodization/ai-dynamic.ts:165`).
  `computeDeloadStrength()` (`:167-203`) only sets `tempAlert` (and therefore the
  `temperatureAlert` field the banner keys off) when `temperatureDeviation > 0.5` **and**
  `temperatureBaselineDays >= 30` (`:183-184`). The 0.5°C threshold is currently an inline magic
  number, not a named constant alongside `TEMP_BASELINE_MIN_DAYS`.
  `temperatureBaselineDays` is `oura_daily_summary.nHistory` — Oura's own accrued-history count for
  that day's temperature baseline (`lib/data/postgres/adapter.ts:1671`) — not an app-invented
  number.
- `DeloadBanner` (`app/session-select/components/deload-banner.tsx:30`)
  shows the static "Body temp elevated — rest or deload recommended" line whenever
  `recommendation.temperatureAlert` is true, with no numbers. `DeloadExplanation`
  (`app/session-select/components/deload-explanation.tsx:20-25`) is the existing "Why this
  recommendation?" expandable already rendered directly below the banner on the recommendation
  card (`recommendation-card.tsx:251`) — it already has a temperature line, but it's fixed
  qualitative copy ("Body temperature is above your baseline — often an early sign of illness,
  incomplete recovery, or heat/alcohol stress."), no actual deviation value.
- **Important constraint on what "average" can mean here**: Oura's API surfaces `temperature_deviation`
  as a °C delta from the ring's own internally-computed personal baseline — it does **not** expose
  an absolute average baseline temperature value anywhere in the v2 API. So "avg vs difference"
  can't literally show two absolute temperatures; the honest version is **today's deviation vs the
  0.5°C alert threshold**, plus **how many nights of baseline back it** (the 30-day gate) as the
  confidence number. Don't build a fabricated "your average is X°C" figure that doesn't correspond
  to real data.
- The raw `temperatureDeviation`/`temperatureBaselineDays` values are already computed and passed
  into `computeAiDynamicNextSession` (`adapter.ts:1668-1671`) but are **not** currently threaded
  into `NextSessionRecommendation.signals` (`packages/shared/src/types/program.ts:116-123`) — the
  UI has no access to the actual numbers today, only the boolean `temperatureAlert`.

### Fix direction

Thread the real numbers through to the UI and make the existing temperature line in
`DeloadExplanation` show them instead of only qualitative text, e.g. "+0.7°C above your baseline
(threshold 0.5°C) — based on 30 nights of history." No new backend computation needed, this is a
plumbing + copy change.

### Tasks

- [ ] Export the 0.5°C threshold as a named constant (e.g. `TEMP_ALERT_THRESHOLD_C`) next to
      `TEMP_BASELINE_MIN_DAYS` in `ai-dynamic.ts`, replacing the inline `0.5` literal — per "One
      Formula, One Place," the UI must reuse this constant rather than hardcoding its own copy of
      the threshold.
- [ ] Add `temperatureDeviation: number | null` and `temperatureBaselineDays: number | null` to
      `NextSessionRecommendation.signals` (`packages/shared/src/types/program.ts`), populated in
      `computeAiDynamicNextSession`'s return (`ai-dynamic.ts:305-320`) from the values already
      passed into it.
- [ ] Extend `DeloadExplanation`'s temperature `Signal` entry (`deload-explanation.tsx:20-25`) to
      render the real deviation and baseline-nights figures alongside the existing qualitative
      text, reusing the new threshold constant for the comparison.
- [ ] Decide (don't guess silently): should the sub-30-day "baseline still maturing" case surface
      anything at all today (currently invisible — no banner, no explanation line), e.g. "gathering
      your temperature baseline (18/30 nights)"? The owner didn't ask for this explicitly but it's
      the natural companion to making the mature case transparent — check with the owner if
      ambiguous rather than silently building or silently skipping it.
- [ ] Local dev-server pass: force a temperature-alert state (seed `oura_daily_summary` with
      `tempDevC > 0.5` and `nHistory >= 30`) and confirm the expandable shows real numbers matching
      the seeded values.
- [ ] Run tests + lint. Remove this task's entry (Q-105) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

---

## Task 21 (Q-106) — home Recommended-Today card shows "Last: —" even for a well-established session

- **Branch:** `fix/recommendation-card-last-trained-memo`
- **Reported:** owner-reported, 2026-08-05 (screenshot: home "RECOMMENDED TODAY" card, Legs, "Last: —"
  despite a 62-day streak and the same week already showing Pull/Push completed on the calendar
  strip below it).

### Root cause (traced 2026-08-05) — the same stale-memo-behind-a-cache-fill class as Q-89/Q-91, plus one independent code smell

- `lastSessionDay()` (`recommendation-card.tsx:18-39`) reads `readCacheSync('workout-card:<id>')`
  synchronously and returns `"—"` for three completely different situations — session not found,
  cache not yet populated, and genuinely-never-logged — with no way to tell them apart from the UI.
  The Workout tab's sibling function, `getLastTrainedLabel()` (`workout-select-content.tsx:25-42`),
  already distinguishes these (`""` while loading vs. an explicit `"Never trained"` when the data
  really is empty) — `recommendation-card.tsx` never picked up that distinction.
- **`RecommendationCard` is wrapped in `memo()` (`:315`) and none of its props change when the
  `workout-data:all` batch resolves.** That batch (`session-select-content.tsx:562-571`) only calls
  `setCached('workout-card:<id>', ...)` — a side effect outside React state — never touches
  `recommendation`, `activeSessions`, `moodLog`, or any other prop this card receives
  (`session-select-content.tsx:1238-1253`). So `lastSessionDay()` only ever reflects whatever was in
  cache at the moment of this card's *first* render after any of its actual props last changed —
  if that render lands before the batch fetch has populated `workout-card:<id>` (a real, plausible
  race: `next-session` and `workout-data:all` are separate parallel fetches, `next-session` is
  typically the faster of the two), the card is frozen on `"—"` until something else changes one of
  its memoized props, which for a normal single visit largely never happens. **This is the same bug
  shape found and queued as Q-89** (a `useMemo` with a stale dependency) and **Q-91** (a mounted
  component with no signal that a cache it reads just got filled) — same failure family, third
  independent site.
- **Independent code smell, worth fixing regardless of the above:** `lastSessionDay()` takes a
  session **name** and re-looks it up by name against `activeSessions` (`:23`,
  `sessions.find(s => s.name === session)`) even though the caller already has the full session
  object with a real `id` (`displaySession`, `:77`, passed as `displaySession.name` at `:180`) —
  this is exactly the "session identity = DB id, not name" anti-pattern CLAUDE.md's Standing
  Instructions call out, and an unnecessary indirection here: nothing stops it from just reading
  `workout-card:${displaySession.id}` directly, no `activeSessions` lookup needed at all.

### Fix direction

Two independent, both-worth-doing fixes:
1. Simplify `lastSessionDay()` to accept a session id directly (drop the `activeSessions`
   name-lookup param entirely) — removes a silent-failure path regardless of the memo issue.
2. Give this card's "last trained" computation a real dependency on cache freshness, same shape as
   Q-89's fix: either thread the parent's existing `refreshTick`/`tabEpoch`
   (`session-select-content.tsx:120,133`, already bumped on tab revisit) into a prop
   `RecommendationCard` actually reads, or move the `workout-card:<id>` read out of a bare function
   call and into `useEffect`-driven state that updates once the batch fetch's callback fires (the
   callback already runs client-side at `:564-568`, it just doesn't currently notify anything).

### Tasks

- [ ] Change `lastSessionDay()`'s signature to take a session id, not a name, and drop the
      `activeSessions` param — update the call site (`:180`) to pass `displaySession.id`.
- [ ] Fix the memo-staleness: pick one of the two approaches above (or another that achieves the
      same thing) so this card's "Last:" value updates once `workout-card:<id>` is actually
      populated, without requiring an unrelated prop change to force a re-render first.
- [ ] Sibling-surface check: `todaySessionObj` (`:74-76`) also does a name-based
      `activeSessions.find` — confirm whether it has the same id-vs-name concern and fix in the
      same pass if so.
- [ ] Consider (don't guess silently, matches the existing `getLastTrainedLabel` convention):
      should `lastSessionDay()` also distinguish "still loading" from "genuinely never trained"
      instead of collapsing both to `"—"`, for the same debuggability reason the owner hit here?
- [ ] Local dev-server pass: load Home fresh (clear the `workout-card:` cache first to force the
      race), confirm the recommended card's "Last:" populates correctly once data loads, for a
      session with real history.
- [ ] Run tests + lint. Remove this task's entry (Q-106) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

---

## Task 22 (Q-107) — `/api/sync/pull` intermittently fails, likely DB-pool contention from `getSyncDelta`'s 21-query fan-out

- **Branch:** `fix/sync-delta-query-batching`
- **Reported:** owner-reported, 2026-08-05/06 (screenshot: home screen, pull-to-sync surfaced "Sync
  is backing off after an earlier error — retrying shortly").

### This is not a copy question — traced to a real, evidenced production fault, 2026-08-05

- The toast itself (`session-select-content.tsx:660`) is working exactly as designed (Q-37,
  2026-08-02) — it only fires when a **prior** pull already failed and set the backoff window
  (`isSyncBackedOff()`, sampled before this attempt). It correctly told the owner "something failed
  earlier," it just can't say what, since the client never learns the server-side cause.
- Queried `claude_ro.error_events` directly (per the session-start orientation rule) rather than
  guessing. Found real `/api/sync/pull` server failures for the owner's account, 2026-07-30 through
  2026-08-01, quiet in the days since — **not** proof it's fixed (CLAUDE.md's "stopped ≠ fixed"
  rule) — with the following fingerprint:
  - A **different table each time** — `programs`, `day_checkins`, `injuries`, `mood_logs`,
    `food_logs`, `set_logs`, `progression_styles`, `prescribed_runs` — all wrapped in Drizzle's
    generic `"Failed query: select ..."` message. Neither `message` nor `stack` captures the
    underlying Postgres error (timeout vs. connection-refused vs. something else) — the report
    loses the actual cause.
  - **Every failure across all 4+ days carries the identical `since` cursor param
    (`2026-07-28T01:09:17.285Z`)** — meaning this device's pull was stuck retrying the same page
    over and over without ever fully succeeding across that window (consistent with the existing
    "a first-page failure doesn't advance the cursor" design in `pullDelta`
    (`lib/local-store/sync-engine.ts:587-597`) — the mystery is why the query kept failing, not
    that the cursor didn't move).

### Root-cause theory (not yet confirmed against Railway's own Postgres logs)

- `getSyncDelta` (`lib/data/postgres/adapter.ts:3211-3235`) fires roughly **21 queries in a single
  flat `Promise.all`** per pull call — every domain (programs, body metrics, sleep, mood, activity,
  fitness tests, prescribed runs, workout sessions, food logs, supplements, supplement logs,
  injuries, exercise logs, set logs, personal records, oura daily ×3, day checkins, food items ×2)
  at once.
- The app's own DB pool is deliberately capped at `max: 10` connections (`lib/data/postgres/client.ts`,
  per this file's own load-bearing Database section) — a single pull call alone can want more
  connections than the pool has, so the moment any other request on the same pool also needs one
  (another API route, or the next page in `pullDelta`'s own loop), one of the 21 is left waiting and
  is the one that errors or times out. This matches the observed fingerprint exactly: a
  near-random, different table each occurrence, same user, recurring over days — not a deterministic
  query bug, which would fail 100% of the time for every user, always the same table.
  CLAUDE.md's Database section already names this exact risk class ("Before re-enabling or adding a
  heavy sync domain... load-test it against a realistic outbox backlog") — this reads as that risk
  materialising in production, not a new category of bug.
- **Not yet confirmed**: this is the leading theory from the evidence available inside the app's own
  DB, not a certainty. Railway's own Postgres logs (connection-acquire timeouts,
  `statement_timeout` hits) would confirm or rule it out directly — worth checking if accessible
  before committing to the batching fix below.

### Fix direction

- If confirmed: reduce `getSyncDelta`'s peak connection demand by chunking the ~21 queries into
  smaller batches (e.g. groups of 5-8 via sequential `Promise.all` calls, or a small concurrency
  limiter) instead of one flat `Promise.all` — directly cuts the peak simultaneous connection count
  a single pull call can demand.
- Independently worth doing regardless of the pool theory panning out: capture the underlying
  Postgres error (`error.cause` / the driver's own error object) in the server error-report path,
  not just Drizzle's wrapper message — this exact investigation needed a manual `claude_ro` query
  dig because the stored error gave no usable cause. Future occurrences of this class shouldn't need
  that.
- Consider (don't guess silently): should a first-page pull failure still be all-or-nothing, or
  should `getSyncDelta`'s per-domain queries fail independently so one flaky table doesn't block
  every other domain's data from reaching the device? This is a bigger design question than the
  batching fix — flag it, don't build it speculatively without confirming it's worth the complexity.

### Tasks

- [ ] Check whether Railway's Postgres logs are reachable to confirm the connection-pool-contention
      theory (connection-acquire timeouts / `statement_timeout`) before committing to the batching
      fix — don't build a fix for an unconfirmed cause if better evidence is available.
- [ ] Chunk `getSyncDelta`'s ~21-query `Promise.all` into smaller concurrent batches, sized to stay
      comfortably under the pool's `max: 10` even with other concurrent request load.
- [ ] Add the underlying Postgres error cause to the server error-report path (wherever
      `reportServerError`/the catch site for this route currently only logs Drizzle's wrapper
      message) so a future occurrence doesn't require a manual DB dig.
- [ ] Local dev-server pass: force a pull and confirm sync still completes correctly with the
      batched queries (no behavior change in the happy path, just less peak connection pressure).
- [ ] Run tests + lint. Remove this task's entry (Q-107) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR — this closes/updates the
      `[platform]` Known-Issues row this investigation added.

---

## Task 23 (Q-108) — Body Battery chart's "now" label is hardcoded, doesn't reflect real staleness; card never live-refreshes while Home sits open

- **Branch:** `fix/body-battery-chart-stale-now-label`
- **Reported:** owner-reported, 2026-08-06: asked whether the low-sample-count Body Battery reading
  is trustworthy, and suspected the Home screen doesn't refresh — chart appeared to span only
  ~2 hours (9:22am → "now") despite having woken over 3 hours earlier.

### Traced 2026-08-06 — two separate, confirmed findings, one real bug and one working-as-intended

- **Confirmed: Home does not poll.** `session-select-content.tsx:761-766`'s `body-battery`
  `cachedFetchToday` only re-runs on `refreshTick` change — which only bumps on initial mount, tab
  revisit (`tabEpoch`), pull-to-sync (`handlePullSync` → `refetchAll`), or a BLE sync-settle event
  (`ta:oura-ble-synced`). No interval/polling exists. A Home tab left open and foregrounded for
  hours with no user action genuinely shows the same payload the entire time — this matches the
  owner's suspicion exactly.
- **The real bug: `DayChart`'s right-edge label is a hardcoded literal `"now"`
  (`components/body-battery-card.tsx:79`), not derived from the actual last-sample timestamp or a
  live clock.** So a stale card doesn't just fail to refresh — it actively claims to be current when
  it isn't, which is worse than silence. This is the part worth fixing: whatever staleness policy
  is chosen, the label must stop asserting freshness it can't back up.
- **Not a bug — working as designed:** the "Limited data" badge + "only N heart-rate readings...
  treat the number as a rough guide" text (`body-battery-card.tsx:93-94,171-178`) is the deliberate
  Q-57 low-confidence disclosure — it already tells the owner honestly not to over-trust a sparse
  reading. Nothing to change here.
- **Checked against production, not assumed:** queried `claude_ro.sleep_sessions` directly — the
  ring's actual recorded `sleep_end` for that night was **09:13:56 local**, close to the chart's
  9:22am start (small gap plausibly from `nightSessions()`'s own reassembly/first-sample offset,
  not investigated further as it's minor). The wake-anchor pipeline picked a real, correctly-dated
  night and a real recorded wake time — **no evidence of a wake-time computation bug**. Any gap
  between the ring's detected wake and the owner's subjective wake time is ring-detection lag
  (inferred from movement/HR change, which lags behind physically getting up while lying still),
  not something to chase in this codebase.

### Fix direction

Make the label honest rather than hardcoded. Two complementary options, not mutually exclusive:
1. Show the actual last-data timestamp instead of the word "now" when the freshest sample isn't
   recent (e.g. `fmtAest(t1)` instead of the literal string, always — or conditionally, falling back
   to "now" only within some small freshness window).
2. Consider adding lightweight revalidation while Home is foregrounded and visible for a while (not
   a screen-wide timer per the render-discipline rules — scope it to just this card, e.g. a bounded
   interval or revalidate-on-visibility-change), so a long-open Home tab doesn't sit silently stale.
   Weigh this against the app's general TTL-based staleness model before adding a new polling
   pattern — check whether other cards already have (or deliberately avoid) this and stay consistent.

### Tasks

- [ ] Replace the hardcoded `"now"` label in `DayChart` (`body-battery-card.tsx:79`) with something
      that reflects actual data freshness — at minimum the real last-sample time, formatted
      consistently with the left-edge label.
- [ ] Decide (don't guess silently) whether to add bounded live revalidation for this card while
      Home is foregrounded, or leave staleness handling to the existing refresh triggers and rely
      solely on the corrected label to communicate it honestly.
- [ ] Local dev-server pass: seed a Body Battery payload with an old last-sample timestamp, confirm
      the label reflects it rather than claiming "now".
- [ ] Run tests + lint. Remove this task's entry (Q-108) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

---

## Task 24 (Q-109) — manual Home "Deload" has no effect on AI-driven prescriptions, plus move the choice onto the pre-workout screen

- **Branch:** `fix/manual-deload-ai-prescription-wiring`
- **Reported:** owner-reported, 2026-08-06 (3 screenshots: pre-workout Legs screen after choosing
  Deload from Home, showing full "AI Prescription · Intensification" numbers with no visible deload
  treatment). Owner: "I'm not sure it's even calculating deload weights/reps right now," and
  separately requested moving the Deload choice off Home (which should offer only Workout/Rest)
  onto the pre-workout screen, near/above the session-length (Quick/Normal/Long) picker.

### Part 1 — real bug, confirmed by code trace, not a display gap

- `handleDeload` (`app/session-select/session-select-content.tsx:929-932`) routes to
  `/workout?session=<id>&aiDeload=1`.
- Server-side (`app/api/workout-data/route.ts:359-378`), `aiDeload=1` sets
  `sessionPhaseStatus.isDeloadActive = true`. That flag reaches the actual prescribed load through
  exactly one mechanism: `deloadAwareStylePhase()` (`packages/shared/src/phase-engine.ts:125-134`),
  which swaps in a lighter phase's style — but this only runs on the **static-progression-style
  path**.
- **The moment `aiDrivesLoad` is true** (an AI-dynamic prescription actively driving load — the
  normal state for this program, and what every screenshot showed), `buildWorkoutExercises`
  (`packages/shared/src/workout/session-data.ts:168-183`) unconditionally applies
  `prescriptionStyleForExercise(p)` from the already-generated prescription. **`aiDeload` is never
  referenced in this branch at all.** The only per-exercise reduction that can appear here is
  `p.deloaded` — a flag the AI-dynamic engine bakes into the prescription **at generation time**,
  from its own independent automatic emergency/per-exercise deload detection
  (`packages/shared/src/ai-periodization/generate-prescription.ts`, soreness/overtraining signals),
  completely orthogonal to the user manually asking for a lighter session today.
- `aiDeload` still does three things today, none of which touch the shown/logged numbers: sets the
  phase-status banner condition (`isDeloadActive`), tags logged sets `intensityMode: 'deload'`
  (`workout-screen.tsx:1272`), and suppresses PR credit (`workout-screen.tsx:1285-1293`).
- **A real, already-tuned reduced-load path exists and is reusable**: `DELOAD_LOWER_PCT` /
  `DELOAD_REPS` / `DELOAD_SETS` / `DELOAD_REST` and `deloadOverrideForGoal()`
  (`packages/shared/src/ai-periodization/deload-constants.ts`) — the same values the automatic
  emergency-deload system already applies. The gap is that nothing calls this (or an equivalent)
  when the *user* requests a deload on an AI-driven session; today it only fires when the *system*
  decides to on its own.

### Part 2 — UX redesign (owner-requested, not yet scoped in detail)

- Home's recommendation card currently offers three buttons (Deload/Rest/Full,
  `recommendation-card.tsx` — see the earlier Body Battery/temp-alert investigation's sibling card)
  when `deloadOrRestRecommended` is true. Owner wants Home to offer only **Workout** or **Rest**,
  moving the Deload choice to the pre-workout screen (`pre-workout-screen.tsx`), positioned
  near/above the `session-duration-picker.tsx` (Quick/Normal/Long) control — i.e. Full vs. Deload
  becomes a toggle alongside session length, decided at the point that actually determines the
  session, not one screen removed from it.
- This redesign is **largely pointless to ship without Part 1 fixed first** — moving a control that
  still doesn't change the numbers just relocates the same non-functional choice.

### Fix direction

1. When `aiDeload` is true and `aiDrivesLoad` is true, apply a real load reduction on top of (or
   instead of) the stored prescription — reusing `deloadOverrideForGoal()`/the `DELOAD_*` constants
   for consistency with the system's own automatic deload, rather than inventing new numbers. Decide
   (don't guess silently): does a manual deload request override every exercise's prescription
   wholesale, or layer on top of exercises the prescription already flagged `deloaded`? These
   shouldn't double-discount.
2. Redesign the pre-workout screen to host the Full/Deload toggle near the duration picker, remove
   the Deload button from Home's three-way card (leaving Workout/Rest only), and wire the toggle to
   the same `aiDeload` mechanism (once Part 1 makes it real) rather than inventing a second path.

### Tasks

- [ ] Wire a real load reduction into the `aiDrivesLoad` branch of `buildWorkoutExercises` when
      `aiDeload` is true, reusing `deloadOverrideForGoal()`/`DELOAD_*` constants.
- [ ] Decide the interaction with `p.deloaded` (prescription-time auto-deload) so the two mechanisms
      don't compound or conflict.
- [ ] Confirm `phaseStatus.isDeloadActive`'s existing "Deload — ..." banner
      (`pre-workout-screen.tsx:183-188`) actually renders when a manual deload is chosen on an
      AI-dynamic session — the owner's screenshots didn't show it; check whether that's a separate,
      smaller display bug worth folding in here.
- [ ] Redesign: move the Deload selector from Home's three-way card to the pre-workout screen, near
      the Quick/Normal/Long duration picker; Home's card becomes Workout/Rest only.
- [ ] Local dev-server pass: choose Deload on an AI-dynamic session with an active prescription,
      confirm the displayed and logged weights/reps are genuinely reduced (not just labeled),
      matching `deloadOverrideForGoal()`'s numbers for the session's training goal.
- [ ] Run tests + lint. Remove this task's entry (Q-109) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR — this closes the `[workouts]`
      Known-Issues row this investigation added.

---

## Task 25 (Q-110) — rework the Training Calendar's day-detail sheet into a dedicated, swipeable full-screen day view with HR, sleep, full body composition, and scores

- **Branch:** `feat/day-detail-screen-swipeable`
- **Reported:** owner-reported, 2026-08-06, in two rounds. First: the day-detail bottom sheet
  (Training tab, tap a calendar day) shows only "Exercise" + a 3-tile "Body Data" row
  (Weight/Steps/kcal) — wants HR data, sleep data, full body-composition data, and health scores
  added, with historical look-back. **Follow-up, same session, before this was built:** rather than
  cramming more sections into the existing bottom sheet, rework it into a dedicated scrollable
  screen you swipe left/right between days on — "kinda like the food logging" — and put real design
  thought into making it visually appealing, not just a mechanical data dump.

### Scope note — this supersedes the sheet-only version of this task and is a bigger effort

The original ask (more sections in the existing `Sheet`) and the follow-up (a whole new swipeable
screen) are different sizes of change. This entry now targets the follow-up — a genuinely new
screen, not an extension of `day-overlay-sheet.tsx` — and should be sized/estimated accordingly
before picking it up. The data-sourcing groundwork below (what to fetch, and how) is unchanged by
the UI rework and stays valid either way.

### Reuse the app's own swipeable-day precedent — don't hand-roll this

`app/nutrition/nutrition-content.tsx` already does exactly what "like the food logging" describes,
and it's the reference implementation, not just an analogy:
- `useDrag` from `@use-gesture/react` (`bindDateSwipe`, `nutrition-content.tsx:420-433`) — horizontal
  swipe, thresholded on movement + velocity, calling `setSelectedDate(shiftDateStr(selectedDate, ±1))`.
- Chevron buttons in the header doing the identical `shiftDateStr` call (`:452-473`) — swipe and
  tap are two inputs to one piece of state, not two separate mechanisms.
- `AnimatePresence mode="popLayout"` + a `motion.div` keyed on `selectedDate`, sliding in from the
  swipe direction (`:483-489`, `dateChangeDirRef`) — this is the "scrollable screen between days"
  feel the owner is describing.
- Per CLAUDE.md's own standing rule ("Reach for `@use-gesture/react` before hand-rolling touch
  handling... two independent hand-rolled swipe implementations exist today") — copying this
  pattern is the correct move, not a suggestion; a third hand-rolled swipe implementation would be
  the wrong direction entirely.
- This becomes a real screen/route (e.g. `app/health/day/[date]/page.tsx` or a query-param variant
  of an existing route), not a `Sheet` — the calendar's day-tap navigates here instead of opening
  the bottom sheet.

### Cross-reference — this is very likely Q-93's missing destination screen

Q-93 (Task 8, above) flagged that making the home "Today's Timeline" cards tappable has **no
existing 1:1 detail screen for a historical/completed workout day** to navigate to, and scoped
"build a minimal historical HR-chart + exercise-summary view" as an open, unsized decision. This
task, if built as a real day-detail screen, is plausibly that exact destination — for all timeline
card types, not just workouts. **Whoever picks up either Q-93 or Q-110 should check the other first**
so the app doesn't end up with two different historical-day screens built independently.

### Design — this needs real visual thought, not a mechanical port

The owner explicitly asked for more design effort here, not just more data. This app has an
existing UI-design skill (`ui-ux-pro-max`) that enforces this app's own design system (theme
tokens, floored safe-area utilities, existing `components/ui/` primitives, Samsung WebView
constraints, instant-paint cache seeding) — use it when designing this screen's layout rather than
freehanding a new visual style. Don't default to a flat scroll of stat tiles (the current sheet's
weakness) — with this much data (exercise + HR + sleep + full body composition + scores) per day,
the layout itself is a real design problem: what's above the fold, what's grouped, what's
collapsible/expandable, what uses a chart vs. a number tile.

### What's already there vs what's genuinely new (traced 2026-08-06)

- The component is `components/health/day-overlay-sheet.tsx`, fed by `GET /api/day-log?date=`
  (`app/api/day-log/route.ts`). It already takes an arbitrary `date` param and the calendar
  (`app/stats/stats-content.tsx`) already lets the owner navigate to any past month/day — **the
  "look back historically" half is already satisfied by the existing structure**; whatever new data
  gets added just needs to be fetched per the requested date, not hardcoded to "today," and it
  inherits historical browsing for free.
- **Body composition is already partially wasted, not missing.** `DayBodyMeta`
  (`app/api/day-log/route.ts:21-30`) already fetches `bodyFat`, `protein`, `carb`, `fat`, and
  `distanceKm` from `body_metrics` — none of these five are rendered in the sheet's "Body Data" grid
  today (`day-overlay-sheet.tsx:256-283` only renders `weightKg`/`steps`/`calories`). Fix that first,
  it's free. Beyond that, `body_metrics` (`schema.ts:209-243`) carries a full scale-composition set
  the route doesn't fetch at all: `skeletalMusclePct`, `fatFreeMassKg`, `subcutaneousFatPct`,
  `visceralFatIndex`, `bodyWaterPct`, `muscleMassKg`, `boneMassKg`, `proteinPct`, `bmrKcal`,
  `metabolicAge` — plus `restingHeartRate`, `hrvMs`, `spo2Pct` (this is the Renpho scale integration's
  column set, CLAUDE.md's Oura Ring section).
- **Sleep is entirely absent from this sheet.** `sleep_sessions` for that date (duration, stage
  hours, efficiency, onset latency, average HRV, avg/lowest HR, sleep score) is never queried by
  `/api/day-log` today — needs a new query, keyed by date the same way `bodyMeta` already is.
- **Scores need care, not a fresh derivation — reuse `buildDayAudit`, don't re-implement.**
  `lib/health/score-audit/buildDayAudit({repo, userId, date, tz})` (`docs/module-map.md`'s
  score-audit row) already assembles Sleep/Readiness/Activity/HR for **one arbitrary historical
  day**, correctly choosing between the app's own derived computation and the frozen Cloud
  `oura_daily` columns per the app's established precedence (the same choice `computeReadinessComposite`/
  `computeSleepScore`/`computeActivityScore` make elsewhere) — critical for dates after the
  2026-07-07 BLE re-key, where `oura_daily`'s Cloud columns are frozen/stale and reading them
  directly would silently show wrong historical scores. **Do not query `oura_daily` directly for
  this feature** — that's the exact mistake `buildDayAudit` exists to avoid. Its current shape is an
  *audit* (full contributor/weight/points breakdown, `storedMatchesRecompute` drift flags) — more
  technical detail than a normal user-facing summary needs; extract/reuse its underlying per-day
  data-gathering for a simpler top-line (score + 2-3 headline contributors) rather than exposing the
  raw audit shape in product UI.
- **HR**: resting HR / HRV / SpO2 come along with the body-composition columns above. A full
  minute-by-minute HR chart for the selected day is also possible — `GET /api/oura/hr-day?date=`
  already accepts an arbitrary historical date (confirmed, not just "today") — but is a bigger UI
  addition inside an already-dense bottom sheet. **Decide, don't guess silently**: summary stats
  (resting HR/HRV/SpO2 alongside body composition) vs. embedding a full `HrDayChart`-style chart for
  the selected day. Recommend starting with summary stats given the sheet's existing density; a full
  chart can follow if the owner wants it after seeing the summary version.

### Fix direction

Extend `/api/day-log` to also return: (a) the full `body_metrics` composition set for the date
(rendering everything already fetched-but-dropped plus the new scale columns), (b) that night's
`sleep_sessions` row, and (c) a trimmed top-line score summary sourced through `buildDayAudit`'s
data-gathering (or an equivalent shared helper) rather than a fresh `oura_daily` read. Extend
`day-overlay-sheet.tsx` with new "Sleep" and "Scores" sections alongside the existing "Exercise" /
"Activities" / "Body Data" sections, and widen "Body Data" to a scrollable/paginated grid or a
sub-expandable "More" state given how many fields this becomes (don't just cram 15 tiles into the
current 3-column grid unreviewed).

### Tasks

- [ ] Check Q-93's status first (per the cross-reference above) — don't build a second historical
      day screen if that task already built one.
- [ ] Design the new screen's layout (use the `ui-ux-pro-max` skill) before writing UI code — what's
      above the fold, grouping (exercise / HR / sleep / body composition / scores), chart vs. tile
      choices, given how data-dense a single day becomes with everything requested.
- [ ] Build the new screen/route with swipe (`useDrag`, `@use-gesture/react`) + chevron date nav +
      `AnimatePresence` slide transition, copying `nutrition-content.tsx`'s pattern
      (`bindDateSwipe`/`shiftDateStr`/`dateChangeDirRef`) rather than a new implementation.
      Repoint the calendar's day-tap (`app/stats/stats-content.tsx`) at this screen instead of
      opening `day-overlay-sheet.tsx`; decide whether the sheet is retired or kept for a lighter
      quick-glance use elsewhere.
- [ ] Render the five already-fetched-but-dropped `DayBodyMeta` fields (`bodyFat`, `protein`,
      `carb`, `fat`, `distanceKm`) — free, no new query.
- [ ] Extend `DayBodyMeta`/`/api/day-log` (or a new route backing this screen) to include the full
      scale-composition column set (`skeletalMusclePct`, `fatFreeMassKg`, `subcutaneousFatPct`,
      `visceralFatIndex`, `bodyWaterPct`, `muscleMassKg`, `boneMassKg`, `proteinPct`, `bmrKcal`,
      `metabolicAge`, `restingHeartRate`, `hrvMs`, `spo2Pct`).
- [ ] Add a "Sleep" section: query `sleep_sessions` for the selected date and render duration,
      stage hours, efficiency, onset latency, HRV, avg/lowest HR, and sleep score.
- [ ] Add a "Scores" section: readiness/sleep/activity scores + a couple of headline contributors,
      sourced via `buildDayAudit`'s per-day data-gathering (extract/reuse, don't re-query
      `oura_daily` directly) so historical dates around the BLE re-key render correctly.
- [ ] Decide whether to add a full-day HR chart (reusing `/api/oura/hr-day?date=`, already
      date-capable) or keep HR to summary stats only for this pass.
- [ ] Local dev-server pass: swipe/chevron between several past days with varying data (a day with
      full scale-composition data, a day with only Oura data, a day before the BLE re-key, a day
      with nothing) and confirm every section degrades gracefully, and the swipe/transition feels
      right at the S25 viewport.
- [ ] Run tests + lint. Remove this task's entry (Q-110) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

---

## Task 26 (Q-111) — Home header device-battery chips (ring/strap/scale); question whether the manual refresh button is still needed

- **Branch:** `feat/home-device-battery-chips`
- **Reported:** owner-reported, 2026-08-06: wants a small icon + battery bar on Home for the ring
  and chest strap (scale too, if it has battery data available) — asked whether that could live near
  the header refresh button, and questioned whether that button is still needed given pull-to-sync
  exists. Semantics requested: ring "should always advertise so [it's] current"; strap and scale
  show live battery while connected, and the last-seen battery % when disconnected.

### Per-device state, traced 2026-08-06 — very different starting points

- **Ring: mostly already built, just not surfaced on Home.** `GET /api/oura-ble/battery-latest`
  (`app/api/oura-ble/battery-latest/route.ts`) already returns the correct, current source — direct-BLE
  keepalive polls (migration 133), not the frozen Oura Cloud value — with `ageMinutes` computed
  server-side. **A battery chip component already exists** (`components/oura-battery-chip.tsx`) but
  reads the *wrong*, frozen source (`/api/oura/token`'s Cloud `batteryLevel`, hidden via its own
  `batteryStale` flag since the 2026-07-07 re-key) — it's effectively dead/invisible today. Don't add
  a second chip; point a new/fixed version at `battery-latest` instead. Matches the owner's "should
  always be current" framing — the ring's foreground service keeps a near-continuous BLE link per
  CLAUDE.md's Oura Direct-BLE section, so `ageMinutes` should normally read low; no explicit
  "disconnected" state is expected for the ring the way it is for strap/scale.
- **Strap: a live value exists natively but never reaches JS, and nothing persists it.**
  `PolarStrapService.kt`'s `onBattery()` (`:231-233`) already tracks a live `battery: Int?` and
  includes it in `status()` (`:392`), exposed via the `getStatus()` `@PluginMethod`
  (`PolarBlePlugin.kt:78-81`) — but grep confirms **no JS call site reads the `battery` field from
  `getStatus()` anywhere**, and nothing persists a reading anywhere (DB or local) for a "last seen"
  fallback. Separately, `chest-strap-pairing.tsx` does a one-shot direct GATT Battery-Service read
  (`0x180F`/`0x2A19`) during pairing only — a different, narrower mechanism, not the ongoing one.
- **Scale: no battery capability exists at all, anywhere.** Not the native service, not a GATT read,
  nothing — confirmed by grep across `ScaleBleService.kt`/`ScaleBlePlugin.kt`. This is genuinely new
  BLE work, not a wiring gap like the strap — the Renpho scale is a standard BLE device and likely
  exposes the same Battery Service (0x180F) the strap does, but nobody has read it. Matches the
  owner's own "if that comes up" hedge — treat as lower priority / a stretch goal on this task, not
  a blocker for shipping the ring + strap chips.

### The refresh-button question — concrete finding, not just a style opinion

Checked what each one actually does, since "do we need it" has a factual answer:
- **Pull-to-sync** (`components/pull-to-sync.tsx` wrapping `handlePullSync`,
  `session-select-content.tsx:639-672`) drains the ring (`syncOuraRing()`), runs
  `pushMutations`/`pullDelta`, invalidates `invalidateWorkoutSummaries`/`invalidateReadinessInputs`/
  `invalidateOuraSync`, then calls `refetchAll()` — which refetches meta/workout-data/sleep-sessions/
  mood **and bumps `refreshTick`**, which is what the gated mount effects for Body Battery,
  training-load, muscle-recovery, and the HR-day chart key off (`:761-810`).
- **The header refresh button** (`:1055-1068`) does `invalidateWorkoutMetaRefresh()` +
  `fetchWorkoutData()` + `fetchMeta()` + `syncOuraRing()` + `pullDelta(userId, true)` — **it never
  bumps `refreshTick`**, so it does not refresh Body Battery, training-load, muscle-recovery, the HR
  chart, sleep-sessions, or mood at all.
- **The button is not merely redundant with pull-to-sync — it is strictly narrower.** Two "refresh"
  affordances that do a visibly different amount of work is worse than one, not equivalent. This
  supports the owner's instinct to remove it and reuse that header slot, though the counter-argument
  (a gesture is less discoverable than a visible button, and some users won't find pull-to-refresh)
  is real too — **decide, don't guess silently**: drop the button and rely on pull-to-sync +
  the new device chips, or keep a slimmer manual-refresh affordance somewhere else on the screen.

### Fix direction

Build a small horizontal row of device chips (icon + battery%, following `oura-battery-chip.tsx`'s
existing pill visual shape) in the Home header, likely replacing the refresh button's slot pending
the decision above:
1. **Ring** — point a corrected battery chip at `/api/oura-ble/battery-latest`; retire or repoint
   the existing dead `OuraBatteryChip`.
2. **Strap** — read `battery` from `PolarBle.getStatus()` while the service is connected (poll or
   add a broadcast event, whichever fits the existing plugin pattern better); persist the last
   reading + timestamp (local store at minimum, consider syncing server-side like the ring's
   `oura_ble_battery_poll` if cross-device "last seen" matters) so a disconnected state can show
   "last seen N% · Xh ago" instead of nothing.
3. **Scale** (stretch) — add a Battery-Service (0x180F/0x2A19) read to the scale's native service,
   mirroring the strap's live-tracking shape once built, plus the same persistence.
4. Each chip needs its own connected/disconnected visual state (live color/icon vs. a muted
   "last seen" treatment) — per this app's colour-only-state rule, pair any color change with an
   icon/label difference, not color alone.

### Tasks

- [ ] Fix/repoint the ring battery chip to `GET /api/oura-ble/battery-latest`, add it to the Home
      header, remove the now-redundant Cloud-sourced version.
- [ ] Wire the strap's `battery` field from `getStatus()` into JS, persist last-known
      value + timestamp, build its Home-header chip with live/last-seen states.
- [ ] Decide the refresh button's fate (remove vs. relocate vs. fix to match pull-to-sync's scope)
      and implement accordingly, freeing the header slot if it's removed.
- [ ] Stretch: add scale battery reading (native BLE) + its Home-header chip, matching the strap's
      live/last-seen shape.
- [ ] Local dev-server pass isn't meaningful for the native halves (Kotlin/BLE) — needs an on-device
      pass: pair ring/strap, confirm live battery renders while connected and a sane "last seen"
      state renders after disconnecting the strap.
- [ ] Run tests + lint. Remove this task's entry (Q-111) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR — note explicitly if the scale
      stretch goal was deferred.

---

## Task 27 (Q-112) — merge "Day in Review" + "End of Day" into one richer daily-review experience; extend the same treatment to the weekly recap

- **Branch:** `feat/unified-day-review`
- **Reported:** owner-reported, 2026-08-06 (2 screenshots: Home's "Your Day in Review" AI-digest
  sheet with an HR chart and a steps bar chart; Nutrition's "End of Day" sheet with meal-backfill
  prompts). Wants the two combined into one bigger, more informative section — nutrition's visual
  language as the base — with richer charts/data (daily min/max HR, body composition, calories
  burned/expended, total weight lifted per session, body temp, steps, "something like the timeline
  for the day"), a nicer banner (or a notification instead), tap-through to a proper read-through of
  the day followed by missed-meal backfill + wellness/journal wrap-up, roughly a 7-day rolling
  lookback for comparison, and possibly the same uplift applied to the weekly recap at a longer
  (monthly-scale) lookback. **Explicit ask: this is primarily a UI/design uplift**, not just more
  data.

### ⚑ Scope note — this is spec-sized, not a batch-task-sized item

Every other entry in this file is independently shippable in roughly one PR. This one spans two
existing sheets, a new/changed notification-or-banner surface, several new chart types, a
multi-domain data assembly, and a parallel treatment for the weekly recap. **Whoever picks this up
should treat it as writing a fresh implementation plan against the direction below, not executing a
turnkey checklist** — several product decisions are flagged as open, not resolved, on purpose.

### What exists today (traced 2026-08-06) — two separate, independently-triggered sheets

- **"Day in Review"** = `components/day-review-sheet.tsx`, opened from a Home banner
  ("Your day in review is ready", `session-select-content.tsx:1158-1159`). Fetches
  `/api/daily-digest` (an AI-generated text summary), a compact `HrDayChart` for today, and a
  `WorkoutLoadComparisonChart` (today's session volume vs. the last 4 sessions of that type) — that's
  the whole content. No body composition, no calories, no explicit min/max HR callouts, no
  journal/meal integration, no multi-day trend beyond the load-comparison bar chart.
- **"End of Day"** = `components/nutrition/end-of-day/end-of-day-review.tsx`, opened from a plain
  grid button on the Nutrition screen (`nutrition-content.tsx:551-557`) — **not a Home banner**.
  Already reasonably rich: `DaySummaryCard` (calorie/macro bars + Body Battery chip),
  `MealBackfillSection` (the "what did you have for X" prompts in the screenshot),
  `WellnessSection` (evening self-report scales: physical tiredness, mental drain, barely moved,
  hydration, late heavy meal), `JournalSection`, `TodayInsightCard`. Visually plain — flat dark
  cards, no charts, no trend context.
- These are genuinely disconnected today: different trigger surfaces (Home banner vs. Nutrition
  button), different data domains (workout/HR/AI-text vs. nutrition/wellness/journal), no shared
  component between them despite the owner's mental model that they're "the same kind of thing."
- **The weekly analog already exists too**: `app/api/weekly-digest/route.ts` +
  `components/weekly-recap-banner.tsx` — same shape as the daily AI-digest banner, same
  opportunity for the same uplift, which is what "possibly the same thing but on the monthly scale
  for the weekly review" is asking for.

### Data sources for the richer chart/stat set — already computed elsewhere, reuse rather than re-derive

Per "One Formula, One Place," none of the requested data needs a new formula — it needs assembling
from what already exists (much of this list was already catalogued investigating Q-110, same
session):
- **HR min/max**: derivable from the same `/api/oura/hr-day?date=` readings `DayReviewSheet`
  already fetches — currently rendered as a line only, no explicit min/max stat.
- **Body composition**: full `body_metrics` scale-composition column set (`skeletalMusclePct`,
  `fatFreeMassKg`, `subcutaneousFatPct`, `visceralFatIndex`, `bodyWaterPct`, `muscleMassKg`,
  `boneMassKg`, `proteinPct`, `bmrKcal`, `metabolicAge`) — see Q-110's writeup for the exact column
  list, same source.
- **Calories burned/expended**: `computeActiveEnergy()` (`packages/shared/src/health/daily-energy.ts`)
  is the one correct implementation (BMR-adjacent + workout + walk/run energy) — already flagged in
  Q-96 (this same running batch) as the source two other cards should be using instead of a broken
  narrower field; reuse it here too rather than a third copy.
- **Total weight lifted / session volume**: `WorkoutLoadComparisonChart`'s existing data source
  (`/api/workout-load-history`) already has this per session.
- **Body temp**: `oura_daily.temperature_deviation` / the derived-first precedence already
  established for the temp-alert work (Q-105, this same batch) — reuse that precedence, don't read
  the frozen Cloud column directly for recent dates.
- **Steps**: already in `body_metrics`/the existing steps bar chart in the current Day in Review
  sheet.
- **Scores (readiness/sleep/activity)**: `buildDayAudit`'s per-day data-gathering, same
  BLE-re-key-aware precedence flagged in Q-110 — don't read `oura_daily` directly.
- **"Something like the timeline for the day"**: `components/home-day-timeline.tsx` /
  `GET /api/day-timeline` already assembles a chronological event list (wake, meals, workout,
  bedtime) for a day — likely the direct model for this, rather than inventing a new timeline
  renderer.

### Design direction (open decisions — don't guess silently on any of these)

- **Visual base**: owner explicitly wants nutrition's UI as the foundation. Concretely, that's
  `nutrition-content.tsx`'s card/ring visual language (macro rings, `DaySummaryCard`'s bar style)
  **and** its swipeable day-navigation pattern (`useDrag` + chevrons + `AnimatePresence`, the same
  precedent already scoped for Q-110's day-detail screen). If both this task and Q-110 land, the app
  converges on one consistent "swipe between days" interaction used in Training Calendar, Nutrition,
  and Day Review — worth building/reusing one shared pattern rather than three parallel
  implementations. **Cross-check against Q-110 before implementing either.**
- **Banner vs. notification**: owner asked for the banner to be upgraded "if not" replaced by a
  native notification instead. Decide which — a richer in-app banner that still requires opening the
  app, or a push notification that can deep-link straight to the new combined review.
  4-part flow if a single entry point: **read-through of the day** (the enriched digest + charts) →
  **missed meals** (existing `MealBackfillSection`, only if something's actually missing) →
  **wrap-up questions/journal** (existing `WellnessSection`/`JournalSection`, only if not already
  filled in) — i.e. sections that already have data render as a summary, sections still missing
  render as the existing prompt/form. Decide the exact skip-vs-show logic per section.
  - **7-day rolling lookback**: decide which stats get a 7-day trend treatment (sparkline/delta vs.
  a bare "today" number) — likely HR, steps, volume, body composition are the natural candidates;
  don't blindly add a trend to every single stat if it doesn't read well at a glance.
- **Weekly recap uplift**: same direction, longer lookback window (owner's "monthly scale") — size
  as a follow-up pass after the daily version proves out the pattern, not a simultaneous build,
  unless the owner wants both at once.

### Tasks

- [ ] Write a proper implementation plan for this (per the writing-plans convention) before touching
      code — this entry captures direction, not a build-ready spec. Resolve the open decisions above
      during that planning pass, ideally checking with the owner on the banner-vs-notification and
      exact section-flow questions rather than guessing.
- [ ] Cross-check against Q-110's day-detail screen work (same plan doc) for the shared
      swipe-between-days pattern before building either.
- [ ] Design the merged sheet/screen's layout (use the `ui-ux-pro-max` skill, per the owner's
      explicit "UI uplift" framing) — what's above the fold, chart choices, card grouping.
- [ ] Assemble the richer data set server-side, reusing the existing formulas/sources listed above —
      no new domain math.
- [ ] Merge `DayReviewSheet` and `EndOfDayReview` into the new unified experience; retire whichever
      surface(s) become redundant.
- [ ] Decide and build the banner/notification upgrade.
- [ ] Apply the same treatment to the weekly recap (`weekly-recap-banner.tsx`/`weekly-digest`) as a
      distinct, separately-sizeable follow-up.
- [ ] Local dev-server pass: confirm the merged review renders correctly with varying data
      completeness (a day with no workout, a day with no scale reading, a day with everything).
- [ ] Run tests + lint. Remove this task's entry (Q-112) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

---

## Task 28 (Q-113) — Morning Check-in: stop score-based pre-filling, replace Motivation with an illness/context flag

- **Branch:** `feat/morning-checkin-rework`
- **Reported:** owner-reported, 2026-08-06 (screenshot: Morning Check-in sheet — Recovery,
  Motivation to train, Sleep quality). Questioned Recovery and Motivation as overlapping with the
  Readiness check and hard to answer meaningfully first thing, mostly still in bed; suggested
  dropping to just Sleep quality if nothing better fits. Clarified via follow-up: happy to keep
  Recovery if it's useful, but doesn't want it "affecting Body Battery too much," and flagged
  they've mostly left it at the default without real thought — worth re-examining if it's currently
  given a lot of weight anywhere.

### Investigation, 2026-08-06 — found a real root cause, not just a UX preference to accommodate

- **`perceivedRecovery` and `sleepQualityFeel` are pre-filled from Readiness/Sleep score, not a
  neutral default.** `prefillMorningScales()` (`packages/shared/src/nutrition/day-checkin-prefill.ts:31-38`)
  computes `perceivedRecovery: scoreToScale(readiness)` and `sleepQualityFeel: scoreToScale(sleepScore)`,
  read directly into `MorningCheckinSheet`'s initial state
  (`components/morning-checkin-sheet.tsx:28-29`). The sheet opens already positioned at a
  score-derived guess — this is almost certainly *why* it felt redundant with Readiness (it
  literally starts as a function of Readiness) and why the owner's own honest read is that they
  rarely engage with it: an unedited tap-Save genuinely saves the prefilled guess as if it were
  independent self-report. **Motivation defaults to a flat 3 ("no reliable objective signal", per
  the prefill file's own comment) — not score-derived, but equally not a real opinion unless
  actively changed.**
- **Confirmed Recovery has zero live effect on Body Battery** — grepped `/api/body-battery/route.ts`
  directly, `perceivedRecovery` is never read there. Directly answers the owner's stated worry: it
  currently affects the live number not at all.
- **But it does affect an already-published statistic**, and the effect there is a real concern:
  `battery-recovery-calibration.ts` documents `r = −0.414, p = 0.010, n = 39` between Body Battery
  and `perceivedRecovery`, used as evidence the model tracks genuine felt recovery. Some unknown
  share of that data is the unedited readiness-derived prefill, not real self-report — and Body
  Battery itself anchors from Readiness each morning, so an unedited Recovery value vs. a
  Readiness-anchored Body Battery risks partial circularity. The correlation may still hold once
  re-checked against only genuinely-edited rows, but it can't be trusted as-is.
- **Also compromises the still-queued Q-102** (wire `sleepQualityFeel` into the live Sleep Score) —
  same prefill mechanism, same circularity risk, now blocked on this task per Q-102's updated entry.
- **`motivation` has no calibration or gating use anywhere** — grepped every consumer; it only
  reaches the AI-periodization LLM prompt as one clause of free text
  (`packages/shared/src/ai-periodization/prompt.ts:275-276`), never a deterministic input. Confirmed
  safe to replace without losing anything already proven valuable — unlike Recovery.
- **Prior trims already happened here**: `MORNING_SCALES`'s own comment
  (`packages/shared/src/types/day-checkin.ts:43-48`) records "Wake mood" removed as a double-up
  with Motivation and "Resting soreness" removed as a double-up with Recovery — this is the third
  pass at trimming this check-in, not the first.

### Decisions made with the owner, 2026-08-06

- **Keep Recovery and Sleep quality.** Don't remove either — fix the prefill contamination instead
  of removing the question it would otherwise justify removing.
- **Replace Motivation** with a quick illness/context flag (e.g. None / Feeling sick / Alcohol last
  night / Travel or poor sleep environment) — ties into the AI-periodization system's existing
  illness-flag/self-reported-sick signals (already consumed elsewhere in the deload logic) and can
  help explain body-temp/HRV anomalies the app currently just flags as unexplained (the Body Battery
  card's own "often an early sign of illness, incomplete recovery, or heat/alcohol stress" copy is
  exactly the kind of question this would help answer). Confirm the exact option set and how it
  writes to `day_checkins`/feeds the AI signals during implementation — not fully scoped here.

### Fix direction for the prefill contamination

Stop seeding `perceivedRecovery`/`sleepQualityFeel` from `scoreToScale(readiness/sleepScore)`.
Options, decide during implementation:
1. Default to a neutral, unselected state (no pre-picked position) so any saved value requires an
   actual tap — simplest, and directly fixes "answered without engaging."
2. Keep a neutral default (e.g. always 3) but distinct from the score-derived one, so at least a
   lazy Save doesn't masquerade as an opinion agreeing with Readiness/Sleep score specifically.
3. Add a persisted "touched" flag distinguishing a genuinely-edited answer from an accepted prefill,
   so downstream calibration/scoring work (this task's fix, Q-102, any future correlation study) can
   filter to real self-report only — the most robust option, and the one that unblocks Q-102 without
   also requiring option 1 or 2.

### Tasks

- [ ] Fix the score-based pre-filling on `perceivedRecovery` and `sleepQualityFeel` — pick one of
      the three approaches above (or a combination, e.g. option 1 + a touched flag).
- [ ] Replace "Motivation to train" with the illness/context flag; decide its exact option set and
      wire it to the existing illness-flag/self-reported-sick signals in the AI-periodization
      pipeline rather than a new, parallel one.
- [ ] Re-run (or flag for a follow-up) the Body-Battery-vs-Recovery calibration
      (`battery-recovery-calibration.ts`) against only genuinely-edited rows once the touched-flag
      (or equivalent) exists, since the current published correlation may be partly circular.
- [ ] Unblock Q-102 once the prefill fix (or a touched flag) lands — update its entry to remove the
      blocker.
- [ ] Local dev-server pass: open Morning Check-in on a fresh day, confirm Recovery/Sleep-quality no
      longer silently reflect Readiness/Sleep score back at the owner, and the new illness/context
      flag saves and reads back correctly.
- [ ] Run tests + lint. Remove this task's entry (Q-113) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR — this closes the `[readiness]`
      Known-Issues row this investigation added.

---

## Task 29 (Q-114) — scale "Weighing you…" progress bar has already drifted from the real native timeout; shorten both together

- **Branch:** `fix/scale-cycle-budget-drift-and-trim`
- **Reported:** owner-reported, 2026-08-06: now that the scale connection activates near-instantly
  (the persistent-connection redesign), the "Weighing you…" progress bar feels too long relative to
  how quickly weight is actually recorded — suggested trimming ~2 seconds off it. **Clarified in a
  follow-up**: the bar functions as user guidance for "how long to keep standing still" — its whole
  purpose is wrong if weight is already fully captured before it visually finishes, since it's then
  telling the owner to keep standing longer than actually necessary. That framing is the acceptance
  test for this fix: not just "shorter," but genuinely matching real capture time, since the bar's
  job is to communicate required stand-still duration, not just look nice.

### Found something bigger while checking the numbers, 2026-08-06 — a real drift bug, not just a pacing question

- The JS progress bar's duration constant, `SCALE_CYCLE_BUDGET_MS = 12_000`
  (`components/capacitor-native-init.tsx:18`), has an explicit comment: "Mirrors
  `ScaleBleService.CYCLE_BUDGET_MS` (Kotlin, native side) — the toast's progress bar visualises the
  same deadline the native retry loop actually gives up at... there's no shared constant across the
  Kotlin/TS boundary" — i.e. the two are supposed to be hand-kept in sync, by design, with an
  explicit warning that this is fragile.
- **They've already drifted.** The real native value is `CYCLE_BUDGET_MS = 16_000L`
  (`android/app/src/main/java/com/trainingai/app/scale/ScaleBleService.kt:94`) — 4 seconds longer
  than what the JS bar visualises. The bar currently finishes (reaches 0% width) a full 4 seconds
  before the native side actually gives up and shows a failure notification — exactly the trap the
  JS comment warned about, already realized.
- **Real connect-latency data exists and supports shortening, not just leaving it** —
  `docs/scale-ble-connect-latency.md` (2026-08-01, on-device `chrome://inspect` capture): total time
  from connect start to a proven-alive link was **2206ms cold, 1270ms on an auto-reconnect** — both
  well under even the JS bar's current (already-short-of-native) 12s. This supports the owner's
  instinct that there's real slack to trim, though that capture measured link-establishment only,
  not full weight-reading stabilization time, so it's a lower bound on real end-to-end capture time,
  not the whole answer.

### Fix direction

Reconcile the two constants to one true value first — a JS-only change would either widen the
existing drift (if shortened below the current mismatch) or leave it in place. Then shorten that
reconciled value based on the real connect-latency data, leaving comfortable margin over the
measured ~2.2s worst-case cold-connect time for reading stabilization and sync — the owner's
suggested "~2 seconds shorter" lands in a reasonable range (e.g. reconciling toward ~12-14s rather
than the current native 16s), but pick the exact number from a fresh on-device timing capture
rather than guessing, since the existing capture doesn't cover full weight-stabilization time.

**Trade-off to flag, not just implement blindly**: `CYCLE_BUDGET_MS` is not purely cosmetic — it's
also literally how long the native side keeps retrying a stubborn connection before giving up
(`ScaleBleService.kt:261-270`, `onCycleDeadline()`). Shortening it reduces retry margin for a
slower-than-typical connection, not just trims a visual animation. The connect-latency doc itself
flags unresolved variance in cold-connect timing (`docs/scale-ble-connect-latency.md`'s "Next
steps" section) — shorten with real margin, and re-verify on-device across a few real weigh-ins
rather than shipping on the strength of one capture.

### Tasks

- [ ] Reconcile `SCALE_CYCLE_BUDGET_MS` (`capacitor-native-init.tsx`) and `CYCLE_BUDGET_MS`
      (`ScaleBleService.kt`) to the same value — this pair drifting silently is exactly what the
      existing code comment warned could happen; consider whether a shared source of truth (e.g. a
      value read from a single config file at build time, or at minimum a stronger comment/test
      tripwire) is worth adding so it can't drift silently again.
- [ ] Pick the new shared value informed by a fresh on-device timing capture (link-alive time +
      typical stabilization time to a stable reading), not just the existing link-latency-only data
      — leave real margin over the worst observed case, not just the typical case.
- [ ] On-device pass: confirm the progress bar's visual pace now roughly matches real weigh-in
      completion time for a normal step-on, and that a genuinely slow/failed connection still gets
      a fair shot before the native side gives up (don't just test the fast path). **Acceptance
      test per the owner's framing**: stand on the scale for a normal weigh-in and confirm the bar
      does not still show significant time remaining once the weight is actually captured — the bar
      exists to tell the owner how long to keep standing still, so it must reflect real capture
      time, not just look visually shorter.
- [ ] Run tests + lint. Remove this task's entry (Q-114) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

---

## Task 30 (Q-115) — deloaded sets feed the 1RM estimate as genuine max-effort sets, inflating PRs and future prescriptions

- **Branch:** `fix/deload-excluded-from-1rm-estimate`
- **Reported:** owner-reported, 2026-08-06 (screenshot: Incline Bench Press exercise summary during
  what should have been a deload — "New Personal Record!", estimated 1RM 78.75kg → 85.75kg, from
  sets of 42.5kg × 8 and 42.5kg × 11). "Those numbers don't look right."

### Root cause, confirmed in code — not a one-off fluke

- `prescriptionStyleForExercise()` (`packages/shared/src/ai-periodization/apply-prescription.ts:34-43`)
  builds the per-set `StyleSet[]` the workout screen logs against from an `AiPrescriptionExercise`,
  and **unconditionally sets `useFor1rm: true` on every set, regardless of `presc.deloaded`.**
- `calculate1RM` (`packages/shared/src/1rm.ts:56-76`) applies a `prescriptionFactor` that
  reverse-derives an implied 1RM from "what %1RM would explain this weight-for-reps at the
  prescribed intensity" — correct for a genuine working-pct set, actively wrong for a deload, where
  `pct` is deliberately suppressed (`DELOAD_LOWER_PCT` ≈ 50%, `deload-constants.ts`) specifically so
  the set is *not* a true-effort indicator. Running a 50%-effort set through that formula as if it
  were a real top set inflates the estimate sharply. A rough reconstruction from the screenshot's
  own numbers (42.5kg, 8/11 reps, ~50% deload pct) lands in the same 85-93kg range actually shown —
  well above the real pre-deload 78.75kg.
- **Both deload paths that route through `prescriptionStyleForExercise` share this bug**: a
  whole-session deload prescription, and the soreness-triggered per-exercise deload
  (`reevaluatePrescriptionForToday`/`computePerExerciseDeload`, traced in an earlier owner question
  the same session) — both produce an `AiPrescriptionExercise` with `deloaded: true` and get the
  same unconditional `useFor1rm: true`.
- **Real downstream harm, not just a wrong on-screen number.** The inflated estimate is stored as
  the exercise's new 1RM/PR. `resolveWorkingBasis()` (`lib/1rm.ts:368-380`) — the single resolver
  every prescription path uses — takes the **max** of last-log-1RM, seed estimate, and all-time PR.
  A bogus inflated deload-session number can push a **future real working session's** prescribed
  weight above what the lifter has actually earned.

### ⚠️ Widened 2026-08-06 — the naive fix misses the whole-session deload path entirely

Owner reported a second, related symptom the same day: a mood-checkin sore-muscle banner promised
only bench-press-adjacent exercises would be lightened, but **every** exercise in the session ended
up deloaded. Traced this to a real, separate escalation path that the fix above does not cover.

- `computePerExerciseDeload` (`packages/shared/src/ai-periodization/per-exercise-deload.ts:60`)
  escalates from `'per_exercise'` to `'whole_session'` whenever more than half the session's
  exercises match a sore muscle on their main-role assignment — by design (per its own header
  comment), not a bug. Marking many muscle groups sore in one check-in (plausible — the owner had
  marked six groups sore in the same-day mood check-in investigated earlier this session) easily
  crosses that threshold.
- Once escalated, `reevaluatePrescriptionForToday` doesn't deload anything itself — it returns
  `needsRegenerate: true` and fires an async `/prescribe` regenerate
  (`reevaluate.ts` around the `outcome === 'whole_session'` branch). That regenerate calls
  `buildWholeSessionDeloadPrescription` (`generate-prescription.ts:59-90`), which applies the same
  deload `pct`/`reps` to **every** exercise in the session uniformly.
- **Critically, `buildWholeSessionDeloadPrescription` never sets the per-exercise `deloaded` flag —
  only the prescription-level `AiPrescription.deload` boolean.** `AiPrescriptionExercise.deloaded`
  (`packages/shared/src/types/ai-periodization.ts:39`) stays `undefined` for every exercise built
  this way. **The originally-proposed fix (`useFor1rm: !presc.deloaded`) would silently do nothing
  for this path** — every exercise in a whole-session deload would keep `useFor1rm: true` and keep
  inflating its 1RM, exactly the bug this task exists to fix, just untouched by the fix as first
  scoped.
- **Separate, smaller finding worth fixing alongside**: the sore-muscle-picker's "will be
  lightened" banner (`sore-muscle-picker.tsx:110-111`, `components/checkin/`) always phrases the
  outcome as if only the matched muscle's exercises will be affected. It has no awareness of the
  >50%-exercises-affected escalation rule, so it can promise a narrow, targeted outcome and then
  the session-wide deload fires instead — confusing regardless of the 1RM bug. Worth a copy/logic
  fix so the banner reflects a whole-session outcome when that's what's actually about to happen
  (see the sibling task this spawns, if filed separately, or fold in here).
- **Directly observed, not just reconstructed from theory**: the owner's done-screen from that same
  whole-session-deload session shows 4 of 5 completed exercises (Cable Pulldown, Barbell Overhead
  Press, Barbell Skull Crusher, Cable Preacher Curl) all flagged "Personal Records" in one session —
  confirms the predicted blast radius against a real screenshot, not just the escalation logic read
  in isolation.

### Fix direction

`prescriptionStyleForExercise` needs to exclude a set from 1RM estimation whenever it's NOT a
genuine working-pct set — that means checking both signals, not just the per-exercise one:
`presc.deloaded === true` (per-exercise path) **and** the caller passing through whether the whole
prescription is a whole-session deload (`prescription.deload === true`, from
`buildWholeSessionDeloadPrescription`). Since `prescriptionStyleForExercise` only receives a single
`AiPrescriptionExercise`, not the parent `AiPrescription`, this likely means either passing the
whole-session flag down as a second argument, or normalizing whole-session deloads to also stamp
`deloaded: true` on each exercise at construction time (in `buildWholeSessionDeloadPrescription`
itself) so every downstream consumer has one consistent signal instead of two.

### Tasks

- [ ] Fix `prescriptionStyleForExercise` to exclude deloaded sets from 1RM estimation — must cover
      **both** the per-exercise `deloaded` flag and the whole-session `AiPrescription.deload` case;
      verify by checking `buildWholeSessionDeloadPrescription`'s output actually carries a signal
      this function can see (stamp `deloaded: true` there too if that's the simpler fix).
- [ ] Fix the sore-muscle-picker banner to reflect a whole-session outcome when the >50%-affected
      escalation is about to fire, instead of always implying a narrow, per-muscle scope.
- [ ] Sibling-surface check: does the older static-progression-style deload path
      (`deloadAwareStylePhase`, program-configured deload-phase styles set via the builder UI) have
      the same gap — i.e. is `useFor1rm` on a deload-phase style's sets already correctly `false`,
      or does it need the same fix in a different place?
- [ ] Decide whether already-corrupted stored PRs/estimates (from prior deload sessions before this
      fix) need a retroactive correction pass, or are left as historical noise — check production
      data for how many rows are actually affected before deciding the effort is warranted.
- [ ] Local dev-server pass: log a deloaded exercise's sets and confirm the estimated 1RM does not
      move (or moves down/stays flat, never spikes) and no false "New Personal Record" fires.
- [ ] Run tests + lint. Remove this task's entry (Q-115) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR — this closes the `[workouts]`
      Known-Issues row this investigation added.

---

## Task 31 (Q-116) — Health tab's "Live HR" shows a live reading without tapping "Measure now"; likely tied to overnight ring drain

- **Branch:** `investigate/live-hr-leak-ring-battery`
- **Reported:** owner-reported, 2026-08-06 (screenshot: Health tab, "LIVE HR 66 bpm" with a
  non-dimmed/fresh reading, "Measure now" never tapped). Suspects this explains ~15%/night ring
  battery drain.

### Structural mechanism confirmed; exact leak source NOT yet pinned down — needs on-device evidence

- `MeasureHrNow` (`components/health/measure-hr-now.tsx`) renders `useLiveHr()`'s `bpm`
  unconditionally, regardless of whether this component itself started the stream.
  `useLiveHr()` (`lib/live-hr/use-live-hr.ts`) is explicitly documented "read-only... does NOT
  start/stop the manager" — it only subscribes to the app-wide `LiveHrManager` singleton
  (`lib/live-hr/manager.ts`). A non-dimmed reading (`stale` false → sample under 8s old) means the
  manager's workout-grade live path is *currently* engaged by something, somewhere in the app — this
  confirms the symptom is real and structurally explicable, but not which caller left it running.
- **The ring is deliberately workout-only, never ambient** (`manager.ts:14-18,89-92`, explicit
  comment: "keeps the ring's battery-costly burst loop from running 24/7"). Only the chest strap (if
  paired) runs in ambient/all-day mode by design. So a live ring reading outside an actual workout
  is a real deviation from intended behavior, not a documented feature — worth chasing.
- **Leak vectors to check on-device, most-likely first**:
  1. A stale/abandoned workout stuck at `store.mode === 'active'` in the persisted Zustand store
     (workout state deliberately survives a refresh, per CLAUDE.md's Known Issues). `workout-screen.tsx`'s
     `useEffect` calls `mgr.start()` whenever `mode` is `'active'`/`'exercise-summary'`, with
     `mgr.stop()` only in the effect's cleanup — a workout left active without being properly
     finished/left keeps this engaged indefinitely.
  2. The native BLE foreground service surviving an app crash/force-kill without ever receiving the
     JS-side stop call — Android foreground services run independent of the JS/React lifecycle, so a
     killed app mid-workout could leave the ring's native burst loop running all night.
  3. Lower likelihood: a debug console (`components/oura-ble/live-hr-test-console.tsx`) left
     running — admin-only, so unlikely for normal use, but has the same start/stop shape and is
     cheap to rule out.

### Fix direction

**Diagnose before fixing** — don't guess at which vector is real. Check
`getLiveHrManager().getDiagnostics()`/the ring source's connection state during/after a period of
reported drain, and check whether the workout store's persisted `mode` was stuck at `'active'`
overnight. Once the actual leak source is confirmed, the fix is likely narrow (e.g. a safety-net
timeout that force-stops the manager if `workoutWanted` has been true for implausibly long with no
active workout session backing it, or hardening the native service's own lifecycle against a JS-side
crash).

### Tasks

- [ ] On-device diagnostic pass: reproduce or catch the ring showing live HR outside a workout,
      capture `getLiveHrManager().getDiagnostics()` and the workout store's persisted state at that
      moment.
- [ ] Confirm which leak vector (or another one not yet identified) is actually responsible before
      writing a fix.
- [ ] Implement the targeted fix once the mechanism is confirmed — likely a safety-net timeout
      and/or hardening the native service lifecycle against a JS crash mid-workout.
- [ ] On-device pass: verify overnight ring battery drain drops back to the expected passive-poll
      baseline after the fix.
- [ ] Run tests + lint. Remove this task's entry (Q-116) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR — this closes the
      `[heart-rate][devices]` Known-Issues row this investigation added.

## Task 32 (Q-140) — "Log Activity" sheet's "Interval walk" shortcut duplicates the separate Guided Walk feature

- **Branch:** `fix/remove-log-activity-interval-walk-shortcut`
- **Reported:** owner-reported, 2026-08-07 (screenshots of the Log Activity sheet): "this is the log
  activity section; doesn't need interval walk like that cause guided [walk] exists."

### Confirmed redundant

- `components/workout/log-activity-sheet.tsx` (lines 61-71) renders a featured "Interval walk"
  button — icon, title, subtitle "Guided fast/slow blocks with HR zones" — that calls
  `startGuidedWalk()` (lines 49-52), which navigates to `/activity/guided-walk`.
- Guided Walk already has its own separate, always-visible entry point: `components/cardio/modality-picker.tsx`
  renders a "Guided walk" row independently of `LogActivitySheet`.
- `LogActivitySheet` is only ever opened one way — `components/cardio/cardio-content.tsx`'s
  `ModalityPicker` "Other activity" row (`onLogActivity={() => setLogOpen(true)}`, lines 127-130,
  144-145) — so the sheet and the Guided Walk row are siblings on the same screen, not nested. The
  in-sheet shortcut is a pure duplicate of a feature the owner can already reach directly.

### Fix direction

Delete, don't replace:
- The button block (`components/workout/log-activity-sheet.tsx` lines 61-71).
- The `startGuidedWalk` function (lines 49-52) it calls.
- The `router.prefetch('/activity/guided-walk')` call (line 40) that exists only to warm this
  shortcut's navigation.
- The `PersonSimpleWalk` icon import, if nothing else in the file references it after the button is
  removed — check before deleting.

No other navigation path is affected; Guided Walk stays reachable exactly as it is today via
`ModalityPicker`.

### Tasks

- [ ] Remove the "Interval walk" button, `startGuidedWalk`, the prefetch call, and the now-unused
      icon import from `log-activity-sheet.tsx`.
- [ ] Confirm the sheet still renders correctly with the remaining log-activity options.
- [ ] Confirm Guided Walk is still reachable from the Cardio screen's `ModalityPicker` unaffected.

**Note on the safe-area half of this report:** the owner also asked to audit all activity screens
for bottom-button spacing. Investigation found the same class of bug (`pb-safe-action` used where
`pb-safe-action-lg` is required on navless takeover screens) across
`active-activity-screen.tsx:90`, `done-activity-screen.tsx:312`, `walk-config.tsx:116`,
`walk-active.tsx:155`, `walk-summary.tsx:218` — but this turned out to already be queued, in more
detail and with one additional site (`fitness-tests/test-active.tsx:90,102`) this pass missed, as
**Q-118** (`fix/navless-safe-area-sweep`) from the same-day full-app review
(`docs/reviews/2026-08-07-full-app-review.md` §2.4). No new entry added — see Q-118 in
`docs/implementation-backlog.md` for the authoritative version.

## Task 33 (Q-141) — AI chat ignores an explicit "show on a chart" follow-up and just repeats the text summary

- **Branch:** `fix/ai-chat-chart-follow-up-not-honored`
- **Reported:** owner-reported, 2026-08-08 (screenshot of AI Analysis chat): asked "Show my body
  weight progression over time," got a one-line text summary, then explicitly asked "Show on a
  chart" and got the *same style of text summary again* — no chart rendered either time.

### The chart pipeline itself is correctly implemented — confirmed by reading it end to end

- `app/api/ai-chat/route.ts`'s system prompt (`## Chart format`, lines 176-179) instructs the model:
  "When asked for a chart, output: `<sheet_chart>{...}</sheet_chart>`" with an inline example and
  the three supported types.
- The client-side parser (`packages/shared/src/parse-chart-blocks.ts`) correctly extracts
  `<sheet_chart>` blocks, Zod-validates the payload shape (the F2 comment documents this was already
  hardened against a wrong-shape JSON block once), and strips the raw tag from the displayed text.
- `components/chat.tsx:668-671,698-700` calls `parseChartBlocks` on every assistant message and
  renders each valid chart via `<ChartMessage>` — unconditionally, no extra gating.
- **So the render path was never reached at all** — the model's raw response text contained no
  `<sheet_chart>` block on either turn, confirmed by the fact `cleanText` (what actually displayed)
  was full plain-English prose both times, not a chart tag stripped down to nothing.

### Two structural gaps that make this more likely than a one-off model slip

- **Conversation history is text-only across turns.** `recentHistory`
  (`app/api/ai-chat/route.ts:40-42`) maps prior turns to `{role, content}` — the flattened display
  text only. Any tool call the model made on turn 1 (almost certainly `getRecoveryData`, which
  returns real `bodyMetrics: {date, weightKg}[]` — `lib/ai-chat/tools.ts:98-101`) and its raw
  results are gone by turn 2. A short follow-up like "show on a chart" forces the model to
  re-recognize it needs to re-fetch the series and reformat it as a chart, rather than mechanically
  reformatting data already in hand — every extra inference step is a chance for the model to fall
  back to summarizing instead.
- **The chart-format instruction doesn't call out short follow-ups.** "When asked for a chart" reads
  naturally as matching the CURRENT message in isolation. A 3-word follow-up ("Show on a chart") with
  no restated subject may not trigger it as reliably as a chart request stated in the same message as
  the data ask.
- **The chat model is `gemini-3.1-flash-lite`** (per `CLAUDE.md` and `lib/ai/instrument.ts`) — the
  free-tier lite model, which is more prone to dropping a secondary formatting instruction (the
  `<sheet_chart>` tag) buried mid-system-prompt, especially under a compound ask (re-fetch data +
  reformat as structured tag + still write the one-sentence insight the prompt also requires).

### Not a confirmed single root cause — needs an owner decision on how hard to force compliance

This is model instruction-following, not a deterministic code path, so there's no single line to
point at and fix. Two independent, non-exclusive directions:

1. **Strengthen the prompt** — make the `## Chart format` section explicitly cover short follow-ups
   ("if the user's message is a short follow-up like 'show/put that on a chart', 'graph it', 'chart
   that' — treat it as a chart request for whatever was just discussed, re-fetching data via a tool
   if needed, and always emit a `<sheet_chart>` block, never a text-only repeat"). Cheap, no
   guarantee — still probabilistic compliance from an LLM.
2. **Add a deterministic client-side safety net** — if the user's message matches an explicit chart
   ask (e.g. `/\b(chart|graph|plot)\b/i`) and the model's response contains zero `<sheet_chart>`
   blocks, surface a distinct "couldn't build a chart for that — try asking again" state instead of
   silently presenting a plain-text answer as if the request were satisfied. Deterministic, but is a
   fallback/UX decision, not a fix to the actual miss rate.

### Tasks

- [ ] Owner decision: which direction(s) to build — prompt-only, safety-net-only, or both.
- [ ] If prompt: rewrite the `## Chart format` section per the direction above; spot-check with a
      few real follow-up phrasings ("chart that", "graph it", "as a chart please").
- [ ] If safety net: add the chart-intent regex + no-chart-detected fallback state in `chat.tsx`.
- [ ] Run tests + lint. Remove this task's entry (Q-141) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

## Task 34 (Q-158) — a same-day mood check-in with zero sore muscles doesn't clear a whole-session Deload recommendation already on screen

- **Branch:** `fix/mood-checkin-no-refetch-after-save`
- **Reported:** owner-reported, 2026-08-09 (screenshots of Home and the Lower pre-workout screen):
  "not sure why it's recommending deload — there was no training of those muscles within 48 hours?"
  Banner read: "Most of this session's muscles are still sore (Glutes, Quads, Back, Hamstrings) — a
  lighter full-session deload will serve recovery better than training through it."

### Confirmed a real live bug against production data, not a soreness-detection accuracy question

- **The whole-session deload trigger is entirely self-report-driven, not a live recovery check.**
  `computePerExerciseDeload` (`packages/shared/src/ai-periodization/per-exercise-deload.ts`) takes
  `soreMusclesInSession: string[]` as a plain input and escalates to `'whole_session'` when more
  than half the session's exercises match a sore label (line 60) — it never independently checks
  "was this muscle actually trained in the last 48h" at prescription time. The banner's phrasing
  ("still sore") reads as automatic detection but is just echoing back whatever the mood check-in's
  sore-muscle picker held.
- `soreMusclesInSession` is built in `app/api/workout-data/route.ts:496-504` from
  `moodLogToUse = todayMoodLog ?? yesterdayMoodLog` — correctly prefers today's log when one
  exists (nullish coalescing, not `||`), and only populates the sore list when
  `moodLogToUse.bodyState.includes('sore_muscles') && moodLogToUse.soreMuscles.length > 0`.
- **Queried production directly (`claude_ro.mood_logs`) and got a smoking gun.** Today's check-in
  (`log_date` 2026-08-09, `created_at` 22:31:07 UTC = 08:31 AEST — essentially the same minute as
  the screenshots) has `body_state: []`, `sore_muscles: []` — the owner explicitly said "no sore
  muscles" this morning. Yesterday's check-in (`log_date` 2026-08-08) has `sore_muscles: ["Chest",
  "Back", "Shoulders", "Biceps", "Triceps", "Quads", "Hamstrings", "Glutes", "Calves"]` — which
  contains **all four** muscles named in the stale deload banner (Glutes, Quads, Back, Hamstrings).
  Since the fallback logic correctly prefers today's (empty) log when it exists, this match is only
  possible if the screen was still showing a prescription computed before today's check-in existed.
- **Root cause: the mood check-in's save handler never triggers a refetch of the screen that shows
  the prescription it affects.** `MoodCheckInSheet` is used from exactly one call site
  (`app/session-select/session-select-content.tsx:1438-1443`), and its `onSaved` prop is wired as
  `onSaved={(log) => setMoodLog(log)}` — a purely local state update that only feeds the check-in
  card's own display (confirmed by grep: `moodLog` state appears nowhere near the workout-data
  fetch or the AI Prescription/deload banner). The mood-checkin-sheet's save handler *does* call
  `invalidateCheckinAffectsPrescription()` (`components/mood-checkin-sheet.tsx:242`), which
  correctly clears the `workout-data`/`next-session` cache groups — so the cache-invalidation half
  of this pattern is fine. What's missing is the refetch trigger: nothing calls `fetchWorkoutData()`
  or bumps `refreshTick` afterward, so the already-rendered pre-workout screen keeps its stale
  in-memory prescription until the next unrelated remount, pull-to-sync, or the header refresh
  button (which does correctly call `invalidateWorkoutMetaRefresh(); fetchWorkoutData(); fetchMeta();`
  at line 1085-1087 — proof the right call already exists in the file, just not wired to this save
  path).
- **This is the same stale-repaint bug class CLAUDE.md already documents repeatedly** (cache
  correctly invalidated, but no refetch triggered) — here it produces a materially wrong training
  prescription (a full-session deload) that directly contradicts the user's own same-day answer.

### Fix direction

Wire `MoodCheckInSheet`'s `onSaved` at `session-select-content.tsx:1443` to also call
`fetchWorkoutData()` (mirroring the header refresh button), not just `setMoodLog(log)`. Mechanical,
no new logic — the correct refetch function already exists in the same file.

### Tasks

- [ ] Add a `fetchWorkoutData()` call (or equivalent) to `onSaved` at the `MoodCheckInSheet` call
      site so the AI Prescription/deload banner recomputes immediately after a check-in save.
- [ ] Verify locally: log a sore-muscle check-in that would trigger a whole-session deload, confirm
      the banner appears without navigating away; then re-open the check-in, clear all sore muscles,
      save, and confirm the deload banner clears without a manual refresh.
- [ ] Run tests + lint. Remove this task's entry (Q-158) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR — this closes the
      `[workouts][app-shell]` Known-Issues row this investigation added.

## Task 35 (Q-169) — the new ring-battery chip crowds the Home header date row

- **Branch:** `fix/home-header-ring-battery-chip-crowding`
- **Reported:** owner-reported, 2026-08-09 (screenshot of Home): "the addition of the battery has
  ruined the aesthetics of the home. might need to remove or move it." Confirmed via a clarifying
  question that this is the ring-battery chip in the header, not the Body Battery card lower on the
  page.

### The risk was flagged by the implementer who shipped it, unverified, and it landed

`OuraBatteryChip` was wired into the Home header on 2026-08-08 (Q-111 ring half,
`docs/overview/entries/2026-08-08-home-ring-battery-chip.md`), placed inside the same flex row as
the date text and `WeatherChip`:

```
app/session-select/session-select-content.tsx:1061-1070
<div className="flex-1 min-w-0">
  <div className="flex items-center gap-2">
    <p className="... whitespace-nowrap shrink-0">{date}</p>
    <WeatherChip />
    <OuraBatteryChip />
  </div>
  <h1>{greeting}</h1>
</div>
```

That row competes for width against the header's fixed-width right-side icon cluster (reorder /
refresh / avatar buttons), inside a `flex-1 min-w-0` container. The journal entry's own
"Not exercised" section already named this exact risk and left it unverified: *"The weather chip
rendered empty locally (no weather data), so the header was verified with one chip present, not
two; in production both sit on that line and it will be tighter than what I saw."* The owner's
report is that flagged risk materializing — three elements (date, weather chip, battery chip) on
one line reads as cluttered on a real device with both chips populated.

### Fix direction — owner asked for remove-or-move; move preserves the Q-111 fix

Removing loses real, recently-fixed work (Q-111's ring half deliberately took a dead component and
made it live). Moving it is the option that keeps the feature. Candidates, no committed choice yet:

1. **Move to the right-side icon cluster** — a small icon-only battery indicator alongside the
   reorder/refresh/avatar buttons, tooltip/aria-label carrying the percentage instead of showing it
   inline. Keeps the date row to two elements (date + weather).
2. **Move to a dedicated devices-status area** — e.g. surfaced only on the More/profile screen or a
   future devices section, off the Home header entirely. Lower visibility, but zero crowding risk.
3. **Simplify the chip itself** — icon-only by default, percentage on tap/press, so it takes a
   fraction of the horizontal space it does now.

### Tasks

- [ ] Owner decision: which relocation (or simplification) direction to build.
- [ ] Implement the chosen placement; verify on a real device with both the weather chip and battery
      chip populated simultaneously (the exact case the original PR didn't test) — the S25 or a
      narrow web viewport at minimum.
- [ ] Run tests + lint. Remove this task's entry (Q-169) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

## Task 36 (Q-173) — Home's "Fatigue detected" early-deload card gives no reason, unlike the sibling recommendation card that already solves this

- **Branch:** `feat/early-deload-card-explanation`
- **Reported:** owner-reported, 2026-08-10: "today it recommended emergency deload but wouldn't
  tell me why."

### Confirmed: a working "why" pattern already exists in this codebase, just not wired here

- The banner the owner hit is `EarlyDeloadCard` (`components/home/early-deload-card.tsx`), driven
  by `readiness-payload.ts`'s `earlyDeloadRecommended` flag — a bare boolean:
  ```
  earlyDeloadRecommended = score < 45 && acwr > 1.2
  ```
  (`lib/health/readiness-payload.ts:474-476`). The card's copy is fixed, generic text: *"Your
  readiness is low and training load is elevated. Consider taking a deload week now."* No numbers,
  no breakdown, no expand-for-more — there's nothing to tell, because nothing beyond the boolean
  reaches the client. The raw `score` and `acwr` values behind the trigger aren't even in the
  `ReadinessScoreResponse` payload as their own fields (score is there; ACWR only exists baked into
  `components.load`, not exposed raw).
- **This app already has the right pattern for exactly this kind of banner, on a sibling feature.**
  `DeloadExplanation` (`app/session-select/components/deload-explanation.tsx`) is a full
  "Why this recommendation?" collapsible — icon + plain-English reason per signal (temperature vs.
  baseline with the actual threshold, readiness score vs. the 70+ range, HRV trend, sleep trend,
  consecutive training days, energy check-in, sore muscles) plus a headline strength label and an
  explanation of the Deload/Rest/Full options. It's wired into `RecommendationCard`
  (`recommendation-card.tsx:261`) for the **day-to-day** Full/Deload/Rest choice — the "Why this?"
  link visible on the "Recommended Today" card. `EarlyDeloadCard`'s **deload-week** recommendation
  (the more drastic one — "emergency" fits this framing far better than the routine daily choice,
  which already explains itself) has no equivalent.
- **Not a duplicate-formula problem** — the two recommendations are genuinely different mechanisms
  (day-scoped recommendation-engine signals vs. score+ACWR-threshold early-phase check) — this is a
  missing-feature/wiring gap, not two implementations of one thing.

### Fix direction

Extend `ReadinessScoreResponse` to carry the raw signals behind `earlyDeloadRecommended` (the score,
the ACWR value, and which of the two conditions is true — one, the other, or both), and give
`EarlyDeloadCard` the same collapsible "why" treatment as `DeloadExplanation` — doesn't need to reuse
the exact component (different data shape), but should match the pattern: a one-line headline plus
an expandable, numbers-backed signal list.

### Tasks

- [ ] Add the raw `score`/`acwr` (and which threshold(s) tripped) to `ReadinessScoreResponse`.
- [ ] Build a "why" expansion for `EarlyDeloadCard` in the same visual language as
      `DeloadExplanation` — readiness score vs. the 45 threshold, ACWR vs. the 1.2 threshold, phased
      in plain English.
- [ ] Verify locally: force a low-readiness/high-ACWR state (or seed one in the local dev DB) and
      confirm the card explains itself.
- [ ] Run tests + lint. Remove this task's entry (Q-173) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

## Task 37 (Q-175) — confirming an early-deload WEEK from Home doesn't reduce AI-dynamic prescribed weight, same gap Q-109 fixed for the per-session toggle

- **Branch:** `fix/early-deload-week-ignored-by-ai-dynamic-prescription`
- **Reported:** owner-reported, 2026-08-10, immediately after the Q-173 investigation into Home's
  "Fatigue detected" card: "even though i selected the deload button; it still gave me my normal
  session.."

### Confirmed the exact Q-109 gap, reopened for a second, separate trigger

- Tapping "Take deload week now" on `EarlyDeloadCard` calls `POST /api/confirm-early-deload`, which
  sets `programs.earlyDeloadWeekStart = today` and flags any already-started sessions
  `isEarlyDeload = true` (`lib/data/postgres/slices/programs.ts:682-698`) — nothing else.
- `isDeloadActive()` (`packages/shared/src/phase-engine.ts:109-118`) correctly turns true for the
  full 7-day window off `earlyDeloadWeekStart`, and `deloadAwareStylePhase()` swaps in the program's
  deload phase style — **but this only feeds `buildWorkoutExercises`'s static-progression-style
  resolution** (`session-data.ts:128`, `styleResolutionPhase`). It is never read inside the
  `if (aiDrivesLoad)` block (`session-data.ts:169-206`).
- That block's only deload trigger is the `aiDeload` boolean — sourced exclusively from the
  `aiDeload=1` query param the pre-workout Full/Deload/Rest toggle sets, which is exactly what
  **Q-109 already fixed** (v1.271.x, "Wire manual Home Deload choice into AI-driven prescriptions").
  That fix added the `else if (aiDeload)` branch applying `deloadOverrideForGoal` — but scoped it to
  one of the app's two deload-confirmation entry points. `isDeloadActive`/`earlyDeloadWeekStart`
  from `EarlyDeloadCard` was never wired to it.
- **Net effect**: for any AI-dynamic program (the normal state, same as Q-109 established), an
  entire confirmed early-deload *week* produces byte-identical prescribed weights to a normal Full
  week — the owner trains at full intensity for up to 7 days believing they've backed off, exactly
  reproducing Q-109's symptom through the other door.

### Fix direction

Thread `isDeloadActive` into the `if (aiDrivesLoad)` branch the same way `aiDeload` is — likely
`else if (aiDeload || isDeloadActive)` reusing the existing `deloadOverrideForGoal` call, so both
deload-confirmation entry points converge on one mechanism rather than each needing its own copy.
Check whether `p.deloaded` (the automatic engine's own per-exercise deload) should still take
precedence, matching the existing "skipped when already deloaded by the automatic engine" comment.

### Tasks

- [ ] Wire `isDeloadActive` into `buildWorkoutExercises`'s AI-dynamic deload branch alongside
      `aiDeload`, reusing `deloadOverrideForGoal` — no new formula.
- [ ] Verify locally: confirm an early-deload week (seed `earlyDeloadWeekStart` in the local dev DB
      or via the API), start an AI-dynamic session, and confirm the prescribed weights are actually
      reduced, not just the phase-status banner/PR-suppression cosmetics.
- [ ] Check the static-progression-style path still works unchanged (this fix must not touch
      `deloadAwareStylePhase`, only add the AI-dynamic branch).
- [ ] Run tests + lint. Remove this task's entry (Q-175) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR — this closes the
      `[workouts]` Known-Issues row this investigation added.

## Task 38 (Q-202) — a deliberate, sustained weight reduction never lowers the prescribed load, because the all-time PR always wins the 1RM floor

- **Branch:** `feat/deliberate-weight-reduction-1rm-override`
- **Reported:** owner-reported, 2026-08-11 (screenshot: Dumbbell Lateral Raise, pre-set screen):
  "ive lowered my weights to try start from a lower weight with better form but it looks like its
  calculating 1rm from top weight rather than last weight."

### Confirmed by the numbers in the screenshot, then traced to the exact mechanism

- **The math doesn't reconcile with the recent log.** "Last session — 5 Aug" shows `7.5×10` for
  both sets. Even a generous formula (Epley: `weight × (1 + reps/30)`) puts that at ~10 kg — nowhere
  near the displayed **1RM: 16.25 kg**. The prescribed load (`LOAD THE BAR TO 12.5 kg`, "70.5% of
  1RM") cascades entirely from that inflated figure, not from the two most recent, deliberately
  lighter sessions.
- **By design, not a bug in the mechanical sense.** `resolveWorkingBasis()`
  (`packages/shared/src/1rm.ts:376-388`) — "the 1RM a prescription should be computed from, one
  definition for every weight path" — takes `Math.max(lastLog1rm, seedEstimate, allTimePr1rm)`. The
  function's own comment: *"Included so an easy day never lowers targets."* That's real, deliberate
  protection against a single bad/light session dragging future prescriptions down.
- **The gap: there is no user-facing way to distinguish "one easy day" from "I am deliberately
  resetting my baseline for several weeks."** Grepped for any PR edit/delete/reset mechanism —
  none exists anywhere in the app. The all-time PR is permanent and always wins the `Math.max()`, so
  no number of consecutive lighter sessions ever lowers the prescribed weight — the system will keep
  pulling back toward the historical peak indefinitely, directly against the stated goal.
- **Not the same shape as the existing deload mechanisms.** The app already has two ways to say "go
  lighter than usual" — the per-session Deload toggle and the 7-day `EarlyDeloadCard` early-deload
  week (Q-109, Q-175) — but both are explicitly time-boxed. Neither fits "I want a new, lower
  baseline starting now, indefinitely, until I say otherwise" (technique work, return from injury,
  a deliberate reset).

### Fix direction — needs an owner decision on shape, not just a mechanical patch

Some form of user-initiated override that participates in `resolveWorkingBasis` — most likely a
per-exercise (or global) "reset working baseline" action that temporarily suppresses `allTimePr1rm`
from the max (e.g., an expiring override, or one that persists until the lifter's logged numbers
catch back up to it naturally). Needs product judgment on scope (per-exercise vs. global), duration
(time-boxed vs. manual-clear), and whether the all-time PR record itself should stay untouched
(likely yes — it's a real earned achievement) while only the *prescription basis* is overridden.

### Tasks

- [ ] Owner decision: shape of the override (per-exercise/global, time-boxed/manual-clear) before
      any implementation.
- [ ] Implement the chosen override, threading it into `resolveWorkingBasis` at every call site
      (session-data.ts, next-session/prescription, bodyweight rep basis — the same three paths the
      function's own doc comment says it unified).
- [ ] Verify locally: set an override on an exercise with a high all-time PR, confirm the prescribed
      weight actually drops to match the lighter recent sessions, not just the display.
- [ ] Run tests + lint. Remove this task's entry (Q-202) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

## Task 39 (Q-203) — the ring-battery chip still bothers the owner after Q-169's relocation; remove it from Home rather than adjust it again

- **Branch:** `fix/ring-battery-chip-remove-from-home`
- **Reported:** owner-reported, 2026-08-12 (screenshot of Home): "the ring battery icon ruins the
  aesthetics. move it or remove it" — the same complaint as Q-159/Q-165/Q-169, on the build that
  already shipped that fix.

### Q-169 already tried "move" — confirmed shipped, confirmed insufficient

- `Cut Coach latency 10s to 3.5s, and move the ring-battery chip (Q-170 + Q-169) (#1220)`, merged
  2026-08-10, relocated `OuraBatteryChip` off the header's date line into the right-side icon
  cluster (`session-select-content.tsx:1081-1085`, alongside the reorder/refresh/avatar buttons)
  and simplified it to icon-only (no percentage text, battery glyph changes shape by level —
  `components/oura-battery-chip.tsx`).
- **This screenshot is from 2026-08-12, two days after that shipped** — plenty of time for the
  fix to reach the owner's device — and the same aesthetic objection came back, with the same
  "move it or remove it" framing as the original Q-159 report. One relocation-plus-simplification
  round did not resolve it.
- Original Q-159/165/169 write-up already named three candidate directions; two (relocate,
  simplify) have now been tried together and the objection persists. The third — **move off Home
  entirely to a dedicated devices-status area** (e.g. the More/profile screen) — was not attempted
  and is what's left.

### Fix direction — the lower-visibility home already exists, confirmed

Remove `<OuraBatteryChip />` from the Home header entirely. **`components/more/oura-section.tsx`
(the Oura device card on the More/Profile screen) already renders ring battery status** — level,
charging state, and a stale/muted variant — independently of the Home header chip
(`bat`/`BatteryIcon` at lines 41-45, 171, 224-232). Removing the Home chip loses no information the
owner can't already see; it just stops duplicating it in a spot they've now twice said doesn't
work.

### Tasks

- [ ] Remove `OuraBatteryChip` from the Home header (`session-select-content.tsx:1081-1085`) and
      its import.
- [ ] Confirm `components/more/oura-section.tsx`'s existing battery display is unaffected (it reads
      from a different source/path — verify it still works standalone).
- [ ] Decide whether `oura-battery-chip.tsx` itself becomes dead code (delete) or stays for a
      future non-Home surface — check for any other call site before deleting.
- [ ] Run tests + lint. Remove this task's entry (Q-203) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

## Task 40 (Q-212) — the on-screen Warm Up timer is a flat 10 minutes for every session length, unlike the (already correct) planning model it should share

- **Branch:** `fix/warmup-timer-not-scaled-to-session-length`
- **Reported:** owner-reported, 2026-08-13 (screenshot: "Legs — Warm Up" screen, Quick/30-min
  session): "its still giving 10minutes warmup for the 30min session. it should of been a % pf
  time. so should of been only 5minutes for the quick session?"

### Confirmed: two disconnected warmup-duration concepts, only one of them scales

- **The screen the owner is looking at uses a hardcoded flat constant.**
  `WARMUP_GOAL_SEC = 600` (`components/workout/warmup-screen.tsx:12`) drives both the countdown
  text (`0:02 / 10:00`) and the progress bar. `WarmupScreen`'s props (`sessionType`, `exercises`,
  `workoutStartMs`, `onBeginExercises`, `onBack`) carry no session-length or duration-preset
  information at all — confirmed by reading the full prop interface and its one call site
  (`components/workout-screen.tsx:1701-1714`). There is structurally nothing this screen could
  scale against even if it wanted to.
- **The owner's mental model — warmup as a % of session time — already exists, correctly
  implemented, elsewhere in this exact codebase.** `packages/shared/src/workout/duration-model.ts`
  has `WARMUP_FRACTION = 0.15` and `warmupBudgetMin(totalBudgetMin, measuredWarmupMin,
  standardBudgetMin)`, with a `WARMUP_CEILING_FRACTION = 0.2` cap for shortened sessions — for a
  30-min Quick session this computes to ~4-5 minutes, matching the owner's own expectation almost
  exactly. This function **is live in production**: `workingBudgetMin()` (which calls it) is
  imported by `packages/shared/src/ai-periodization/signals.ts:15` and used to compute
  `effectiveTimeBudgetMin` — the real budget the AI prescription is trimmed against. So the
  session-length-aware warmup model correctly shapes *how many exercises/sets get prescribed* for
  a Quick session. It was never threaded into the countdown timer the lifter actually watches.
- **Not the same gap as Q-83.** Q-83 (shipped 2026-08-05) fixed a double-charge in this same
  `warmupBudgetMin`/planning path. That fix is confirmed still live and correctly wired (traced the
  import chain end to end). This is a separate, previously-unnoticed gap: the *planning* formula
  and the *on-screen countdown* were never the same code path to begin with.

### Fix direction

Thread a computed warmup-goal-seconds value into `WarmupScreen` instead of the hardcoded constant.
The client already has what it needs: `sessionBudgetMin` (session's own configured length,
`workout-screen.tsx`) and the chosen `durationPreset` (`periodization.state.prescription.durationPreset`,
`'short' | 'standard' | 'long'`) — both usable client-side since `duration-model.ts` lives in
`packages/shared`. Compute
`warmupBudgetMin(budgetForPreset(sessionBudgetMin, durationPreset), null, sessionBudgetMin) * 60`
and pass it as a prop, replacing `WARMUP_GOAL_SEC`.

### Tasks

- [ ] Add a `warmupGoalSec` prop to `WarmupScreen`, computed at the call site from
      `sessionBudgetMin` + `durationPreset` via the existing `duration-model.ts` functions.
- [ ] Remove the `WARMUP_GOAL_SEC` hardcoded export once nothing references it — check
      `active-workout-screen.tsx`'s `startRestChip` call (`workout-screen.tsx:702`), which also
      currently uses the flat constant for its own warm-up rest-chip anchor.
- [ ] Verify locally: pick Quick on a 60-min-configured session, confirm the Warm Up screen shows
      ~5 min instead of 10; pick Long, confirm it scales up accordingly.
- [ ] Run tests + lint. Remove this task's entry (Q-212) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

## Task 41 (Q-222) — auto activity-detection false positives trace to a classifier the codebase already flags as unvalidated, and the planned calibration capture was never run

- **Branch:** `feat/gait-classifier-calibration-capture`
- **Reported:** owner-reported, 2026-08-14: "the auto activity detection is still really bad and
  triggers for almost all false positives." (Same message also reconfirmed the still-open scale
  "Weighing you…" recurrence — that's Q-104, already root-caused with a fix direction; no new
  entry needed there, this task covers the second half only.)

### The classifier's own comments already predicted this, and the fix was scoped but never executed

- The ring-cadence walk/run confirmation path (AD-2) is driven by `classifyGait()`
  (`packages/shared/src/health/gait-classifier.ts`). Its own header comment: **"PROVISIONAL
  BANDS — NOT yet confirmed on-device… come from physiological priors… do not hand-tune further
  without real data."** `WALK_HZ_MIN`/`WALK_HZ_MAX`/`RUN_HZ_MIN`/`RUN_HZ_MAX` were never validated
  against a real captured walk or run — they are an educated guess standing in for measurement.
- `auto-detection-service.ts`'s own `dispatchGate` comment records a **confirmed false positive**
  already caught this way: "a 'Sumo Deadlift' rest period sustained ~90s of ring cadence in the
  walk band, confirming a phantom walk… its Hz bands are still provisional/uncalibrated… so they
  alone can't be trusted to reject this." That fix (blocking auto-detection while a workout is in
  progress) closes the one *reproduced* case; it doesn't touch the underlying uncalibrated bands,
  which can misfire on anything else with cadence-like motion outside a tracked workout.
- **The fix was already scoped, in detail, and never run.** The originating plan doc
  (`docs/superpowers/plans/2026-07-23-ring-cadence-activity-detection.md`, "Calibration" section,
  explicitly marked "device-gated — the load-bearing task") lays out exactly what's needed:
  capture decoded gait frames for (a) a counted walk, (b) a run, (c) a stationary lifting session
  — named explicitly as "the false-positive case" — and (d) desk/idle; confirm the
  `stride_frequency` units/column-order against the counted walk; then set the bands so (a)/(b)
  confirm and (c)/(d) never do, pinned as test fixtures. None of this has been done — the bands in
  the file today are still the priors from the plan's initial draft.
- **Not yet queued anywhere** — grepped the backlog for any calibration-tracking entry; none
  exists. The gap has sat as a code comment, not a queue item, since the plan shipped.

### Why this needs the owner, not just an implementer session

The capture step is physical: it needs the owner to actually walk a counted distance, run, and do
a stationary lifting session with the ring on, ideally via the plan's already-referenced "admin
device-data capture panel" (cardio-system-remaining item 2) or an ad-hoc capture. No amount of code
review substitutes for this — the bands are guesses until real frames exist to tune them against.

### Tasks

- [ ] Confirm the admin device-data capture panel referenced in the plan exists and works, or
      scope the ad-hoc capture path if it doesn't.
- [ ] Owner performs the four captures (counted walk, run, stationary lifting, idle) per the plan's
      Calibration section.
- [ ] Confirm `stride_frequency` units/column-order against the counted walk (closes the
      `step-features.ts` D-2 open item the plan references).
- [ ] Set `WALK_HZ_MIN`/`WALK_HZ_MAX`/`RUN_HZ_MIN`/`RUN_HZ_MAX` (and the motion floor) from the
      real captures; pin the exact frames as unit-test fixtures so a future change can't silently
      drift back to guesses.
- [ ] Run tests + lint. Remove this task's entry (Q-222) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

## Task 42 (Q-223) — the `/config` shortcut redirects to a tab value `/more` doesn't recognize, silently landing on Profile instead of the Program Builder

- **Branch:** `fix/config-redirect-wrong-tab-value`
- **Reported:** owner-reported, 2026-08-13 (screenshot: AI Coach chat, "Build or Modify Program"
  handoff card tapped): "clicking this link just took me to 'more' rather than actual builder."

### Confirmed: a one-value mismatch between the redirect and the tab parser

- `app/config/page.tsx` is a pure redirect: `redirect('/more?tab=config')`.
- `app/more/more-content.tsx` defines `type Tab = "profile" | "friends" | "workout"` and parses
  the `tab` query param against exactly those three values, in both the initial state
  (lines 50-53) and a sync effect (lines 66-69). `'config'` is not one of them, so the param is
  silently discarded and the screen falls back to the default `'profile'` tab — landing the user on
  generic "More," never the Program Builder.
- **The actual Program Builder (`ConfigScreen`) is mounted under `tab === "workout"`**
  (`more-content.tsx:193-194`), not a `"config"` tab that doesn't exist. The redirect target is
  simply the wrong string.
- **Not new to the Coach handoff card** — `components/coach/handoff-card.tsx`'s
  `program_builder` destination links to `/config`, so this is the newly-shipped path that
  surfaced it, but `app/session-select/components/recommendation-card.tsx:197` has an existing
  `href="/config"` link with the identical bug, unnoticed until now. `components/config-screen.tsx`
  itself also writes `/config` back via `history.replaceState` as its own canonical URL — confirming
  `/config` is meant to be a real, working shortcut, not `/more?tab=config` masquerading as one.

### Fix direction

One-line fix: `app/config/page.tsx` → `redirect('/more?tab=workout')`. No changes needed to
`more-content.tsx`'s tab parsing or to either caller (`handoff-card.tsx`, `recommendation-card.tsx`)
— both already link to the stable `/config` shortcut, which is the right layer for this to live at.

### Tasks

- [ ] Fix the redirect target in `app/config/page.tsx`.
- [ ] Verify locally: tap the Coach's "Build or Modify Program" card and the session-select
      "Recommended Today" card's config link, confirm both land directly on the Program Builder
      (`ConfigScreen`), not the Profile tab.
- [ ] Run tests + lint. Remove this task's entry (Q-223) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

---

## Task 43 (Q-226) — the Exercise Readiness sore-muscle picker races its own suggestion fetch and can strand a stale selection

- **Branch:** `fix/mood-checkin-stale-suggested-soreness-race`
- **Reported:** owner-reported, 2026-08-14 (two screenshots of "Exercise Readiness — Before Upper,"
  one minute apart): "I think the excercise readiness card might be caching the old results as it
  opened with stuff from last sessjon; then when I reopened it — it dissapesred." First open: 5
  selected muscles (Chest, Shoulders, Triceps, Quads, Calves) plus a whole-session-deload warning
  banner. Reopen ~1 minute later: 2 selected muscles (Quads, Calves), no banner.

### Confirmed: two effects in `mood-checkin-sheet.tsx` racing over the same `suggested` state

`MoodCheckInSheet` is mounted unconditionally at its call site
(`app/session-select/session-select-content.tsx`, `<MoodCheckInSheet open={moodSheetOpen} .../>`)
— it never unmounts, so every local `useState` (including `suggested`) persists across close/reopen.

- **Effect A** (`useEffect(..., [open])`, lines 87-95) seeds `suggested` synchronously from a cache
  read, then calls `cachedFetch('muscle-recovery', '/api/muscle-recovery', ...)`. Verified
  `cachedFetchCore` always performs a real `await fetch(url, { cache: 'no-store' })`
  (`lib/sqlite/cache.ts:284`) before its `onData` callback fires with server-fresh data — so
  `suggested`'s corrected value always lands on a *later* render pass than the one where `open`
  first flips true, never the same pass.
- **Effect B** (`useEffect(..., [initialLog, open])`, lines 150-167) runs in the same effect-flush
  as Effect A, right after it. For a fresh check-in (`!initialLog`) it does
  `setSoreMuscles(suggested)` — but this `suggested` is a closure over the render that scheduled
  *this* effect pass, i.e. whatever `suggested` was left at from the sheet's *previous* open (or
  empty, the very first time). `suggested` is not in this effect's dependency array, so it never
  reruns when Effect A's async update later resolves.
- **Effect C** (`useEffect(..., [open, initialLog, suggested, seededFromSuggestions])`, lines
  172-177) is the only effect that reruns once `suggested` resolves correctly, but it only fills
  `soreMuscles` `if (prev.length === 0)`. Effect B has already stamped a non-empty (stale) list in
  by then, so this guard permanently blocks the correction for the rest of that open.
- **Net sequence, matching the report exactly:** first open shows whatever `suggested` was stale-left
  at (a leftover 5-muscle list from earlier in the session, wide enough to trip
  `computePerExerciseDeload`'s whole-session-escalation warning in `sore-muscle-picker.tsx`). While
  the sheet sits open, the async fetch quietly corrects `suggested` in the background, but
  `soreMuscles` can't follow (Effect C's guard blocks it). Closing and reopening reruns Effect B —
  now `suggested` already holds the corrected value left over from the previous open's resolved
  fetch, so the reopen shows the right, smaller list with no banner.
- **Not a caching bug** — no stale server/HTTP data is involved; this is a plain React stale-closure
  race between two effects that don't declare a dependency on each other's output.

### Fix direction (not yet built or reviewed)

Either give Effect B a dependency on `suggested` so it reruns and re-seeds once the fetch resolves,
or merge Effects A/B/C so `soreMuscles` is seeded exactly once per open from whichever value
`suggested` finally settles on. Any fix must preserve the existing "never re-add a muscle the lifter
explicitly deselected" behavior that Effect C's `seededFromSuggestions` latch protects today — the
bug is in Effect B's stale read, not in that guard.

### Tasks

- [ ] Fix the effect race in `components/mood-checkin-sheet.tsx` per the direction above.
- [ ] Verify locally: open the Exercise Readiness sheet fresh, confirm the initially-selected sore
      muscles match the final resolved `/api/muscle-recovery` suggestion (not a stale leftover),
      including on a slow/throttled network where the fetch resolves well after the sheet paints.
- [ ] Run tests + lint. Remove this task's entry (Q-226) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

---

## Task 44 (Q-227) — AI Coach proposes logging an injury with a guessed severity instead of asking what the pain actually is

- **Branch:** `fix/coach-injury-no-diagnostic-questions`
- **Reported:** owner-reported, 2026-08-14 (screenshot: AI Coach chat): "Im getting lower back pain
  from some of my excercises what donyou think it is?" — Coach's only reply was a `proposeChange`
  "Log Lower Back Injury" card (Area: lower back, Severity: mild, Apply/Cancel); no text answered
  the question. Owner: "this is okay; but I would of preffered more diagnostic before reccomending
  an injury."

### Confirmed: one write-domain has a restraint guardrail in the system prompt, injury does not

- `app/api/coach/route.ts`'s `SYSTEM` prompt's "## Deloads" section (lines 69-74) is explicit:
  *"If the user says they are run down, beaten up, or asks for a lighter week, an early deload is a
  proposeChange… Propose it only when they ask for it or clearly describe needing one; never open a
  conversation with it."* No equivalent sentence exists for `injury` anywhere in `SYSTEM`.
- The injury domain's own tool description (`lib/coach/tools.ts:235-237, 252-253`) only specifies
  which fields exist (`muscleName`, `severity`, `notes`, `resolved`) and that "logging an injury
  records it and nothing else" — it never says when proposing one is appropriate, or that the model
  should ask about the pain before doing so. A bare mention of pain is enough today to trigger
  `proposeChange`.
- **`severity` was fabricated, not extracted.** The owner's message contains no severity language
  whatsoever. `ChangePreviewSchema`'s `severity` field is free-choice, so the model picked "mild"
  with nothing behind it. The manual injury-entry sheet the domain was explicitly built to mirror
  (`components/health/injury-sheet.tsx:34,191-238` — see this plan's own Phase-1 note, "The injury
  domain is nearly free," and `docs/implementation-backlog.md` §2045-2049) makes severity a button
  the **user** taps; Coach's path skips that self-report and invents the value instead. This also
  runs against `SYSTEM`'s own "## Honesty" rule — *"Anything you assert about the user's data must
  come from a tool result, never from memory"* — the severity here is neither.
- **The actual question — "what do you think it is?" — went unanswered.** That is a diagnostic ask
  (which exercise, what movement, sharp vs. dull, when it started), not a request to log anything.
  Coach has prose and `renderChoiceList` available to ask it and used neither.
- Not a bug in `lib/coach/domains/injury.ts` itself — its preview/apply/undo/dedup logic is correct
  and unrelated; this is a prompt-guardrail gap in what triggers the proposal, not in the proposal's
  handling once triggered.

### Fix direction

Add an injury-domain section to `SYSTEM` mirroring "## Deloads": ask what hurts, which exercise, and
how bad before proposing anything, and never guess `severity` from unrelated text — only set it from
something the user actually stated, or omit it and let the confirmation screen's own field carry the
self-report.

### Tasks

- [ ] Add the injury-domain guardrail to `SYSTEM` in `app/api/coach/route.ts` per the direction
      above.
- [ ] Verify locally: send a vague pain report with no severity language and confirm Coach asks a
      clarifying question (or renders a choice list) before ever proposing an injury log; confirm a
      specific report ("severe pain in my lower back during deadlifts") can still go straight to
      `proposeChange` without unnecessary friction.
- [ ] Run tests + lint. Remove this task's entry (Q-227) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

---

## Task 45 (Q-228) — a straggler from the already-fixed Q-115 deload corruption is still poisoning Incline Bench Press's prescribed weight

- **Branch:** `fix/deload-1rm-poisoned-prescription-basis`
- **Reported:** owner-reported, live, mid-workout, 2026-08-14 (screenshot: "Upper" session,
  Intensification S2, Incline Bench Press 1/5): "could you review the phase change and the weight
  and load increase — it feels like its much too much." Prescribed 72.5 kg (83% of a shown 86.25 kg
  1RM) against a "Last session — 7 Aug" display of 42.5×8 / 42.5×11 — caught before loading the bar.

### Confirmed root cause, against production, via the read-only admin endpoint

- The 42.5 kg "last session" sets were themselves a **whole-session AI deload** (2026-08-06,
  `planned_pct: 52`) — the exact corruption Q-115 already found. Its corrective migration
  (`168_q115_whole_session_deload_pr_correction.sql`, 2026-08-07) fixed 4 of the 5 exercises logged
  in that one session (Overhead Press, Skull Crusher, Preacher Curl, Pulldown — each now
  `exercise_deloaded: true, estimated_1rm: 0`).
- **Incline Bench Press — exercise 1 of that same session, logged 21:41 UTC, just before the
  migration's audited 21:47-22:09 window — was never touched.** It still carries `exercise_deloaded:
  true` but `estimated_1rm: 85.75`, the original inflated value. Reproduced by hand from the stored
  sets (42.5×8, 42.5×11, `planned_pct: 52`, `planned_reps: 8`) through `calculate1RM`'s
  `prescriptionFactor` rescale, exactly matching the mechanism the migration's own comment
  describes for its 4 siblings.
- **Today's prescription reused that same stray value — this is not a fresh occurrence of the Q-115
  bug.** `getLastRealOneRmBatch` (`lib/data/postgres/adapter.ts:1410-1437`) — the source of
  `resolveWorkingBasis`'s `lastNonDeload1rm` (`packages/shared/src/1rm.ts:373-409`, Q-202) — selects
  the most recent `exercise_logs` row with `estimated_1rm > 0` and never filters on
  `exercise_deloaded`. It relies entirely on the write-time invariant that a deloaded set always
  stores `estimated_1rm = 0` — an invariant this exact row already disproves.
- **The fix pattern already exists in the same file, just not applied here.**
  `reconcilePersonalRecord` (`adapter.ts:2954-2978`) explicitly filters
  `eq(exerciseLogs.exerciseDeloaded, false)`, commented "mirrors shouldCountTowardPr's per-exercise
  deload gate." `getLastRealOneRmBatch` is the one sibling query missing that same defensive filter.
- **Honest basis**: the owner's last genuine (non-deload) session, 2026-07-30 — 62.5kg × 6-7 reps ×
  4 sets at 80% — gives **78.75 kg**, an 83% target of ~65 kg, not 72.5 kg. `personal_records` is
  clean (78.75) because `shouldCountTowardPr` already checks `exercise_deloaded` at the write gate —
  this is specifically a `getLastRealOneRmBatch` read-path gap.
- **Scope, confirmed for the owner's account**: exactly one poisoned row
  (`exercise_logs.id = c4e3d87d-b357-4f08-8910-dfe3462611ca`). Not an ongoing leak — one missed
  straggler plus a real structural gap that let it leak through.

### Fix direction

1. **Structural**: add `exercise_deloaded = false` to `getLastRealOneRmBatch`'s query, mirroring
   `reconcilePersonalRecord` — protects every user, not just this row.
2. **Corrective migration**, same shape as 168: zero `estimated_1rm` on the Incline Bench Press
   straggler row.

### Tasks

- [ ] Add the `exercise_deloaded = false` filter to `getLastRealOneRmBatch` in
      `lib/data/postgres/adapter.ts`.
- [ ] Write a corrective migration (mirroring 168) zeroing `estimated_1rm` on
      `exercise_logs.id = c4e3d87d-b357-4f08-8910-dfe3462611ca`.
- [ ] Verify locally: seed a deloaded exercise log with a nonzero `estimated_1rm` (simulating a
      straggler) and confirm `getLastRealOneRmBatch` now excludes it and falls through to the next
      real log or PR.
- [ ] Run tests + lint. Remove this task's entry (Q-228) from `docs/implementation-backlog.md`, move
      the `projectOverview.md` Known-Issues row to
      [`docs/overview/known-issues-resolved.md`](../../overview/known-issues-resolved.md) once verified,
      add the journal entry in the same PR.

---

## Task 46 (Q-229) — AI prescriptions never expire; `prescriptionExpiresAt` is stored and never read against `now`

- **Branch:** `fix/prescription-never-expires-past-7-days`
- **Reported:** found while investigating Q-228, same live session (screenshot: Barbell Overhead
  Press, "Upper," Intensification S2, exercise 3/5): "might be the same bug; but deload has
  affected the max weight for these excercises. which is the one thing it shouldn't do."

### Confirmed root cause, against the exact production row Q-228 used

- `session_periodization.id = a4fec65d-95e6-44d2-8091-95c7e35e6003` — generated
  2026-08-06T22:11:55.022Z, `prescription_expires_at` exactly 7 days later
  (2026-08-13T22:11:55.022Z). Today's live workout (2026-08-14) served the identical prescription
  JSON — same `pct`/`reps`/`sets` for all 5 exercises, unchanged from generation. `updated_at` is
  2026-08-13T22:28:18.968Z, **16 minutes past its own expiry**, showing the row was reused without
  regeneration.
- **`prescriptionExpiresAt` is written correctly and essentially never read.** The only place it is
  ever compared to a clock is `shouldTriggerEmergencyDeload`
  (`packages/shared/src/ai-periodization/emergency-deload.ts:19`), and that gates a narrow,
  unrelated case (suppressing re-offering a still-pending emergency-deload while its own offer
  window is open) — nothing about an `auto_applied` prescription's own age.
  `reevaluatePrescriptionForToday`'s only two `needsRegenerate` triggers are an emergency-deload
  signal or whole-session soreness; there is no calendar-expiry branch, despite the file's own doc
  comment stating the 7-day boundary as intended design.
- **Effect is structural**, not one account's data: any session type not re-run within 7 days of its
  last generation replays stale numbers indefinitely — no LLM progression happens for that session
  until an unrelated emergency/soreness signal fires. Ordinary program variety (more than a
  handful of session types, a missed week, travel) makes this routine, not rare.
- **Compounds with Q-228** on today's Incline Bench Press number specifically (replayed 83% landed
  on Q-228's separately-poisoned 1RM); Barbell Overhead Press isolates this bug alone — its 1RM
  basis is correct, but the replayed 52% is simply an 8-day-old deload-era percentage.

### Fix direction

Add an explicit `now > prescriptionExpiresAt` check for `auto_applied`/`consumed` prescriptions,
treated the same as `needsRegenerate: true`. Needs a decision on whether the emergency-deload
suppression window at `emergency-deload.ts:19` should change too, since it reads the same field.

### Tasks

- [ ] Add the expiry check to the regeneration-trigger path (`reevaluatePrescriptionForToday` or
      its caller in `workout-data/route.ts`).
- [ ] Decide and document how the emergency-deload pending-offer suppression window
      (`emergency-deload.ts:19`) interacts with the new check.
- [ ] Sweep production (read-only admin endpoint) for how many other sessions/users are currently
      serving an already-expired prescription, to size the blast radius.
- [ ] Verify locally: seed a `session_periodization` row with a past `prescriptionExpiresAt` and
      confirm the next workout-data fetch regenerates rather than replaying it.
- [ ] Run tests + lint. Remove this task's entry (Q-229) from `docs/implementation-backlog.md`, move
      the `projectOverview.md` Known-Issues row to
      [`docs/overview/known-issues-resolved.md`](../../overview/known-issues-resolved.md) once
      verified, add the journal entry in the same PR.

---

## Task 47 (Q-230) — a completed Guided Walk's steps and calories are always null, even though the app already has what both need

- **Branch:** `fix/guided-walk-steps-calories-null`
- **Reported:** owner-reported, 2026-08-14 (screenshots: Guided Walk start screen + "Walk complete"
  interval summary with per-interval SPM): "still seeing the post activity issue. seeing that we
  [have] spm we should be able to get steps count right? as well as a burned calorie number to add
  to our logs."

### Confirmed: both fields are hardcoded null, not silently failing to compute

- `components/guided-walk/walk-summary.tsx`'s `saveWalk()` writes `steps: null, caloriesBurned:
  null` literally (lines 156-158, 172). `components/activity/done-activity-screen.tsx` hardcodes
  `caloriesBurned: null` too (line 195); its `steps` only ever populates for `treadmill` activities.
- **Steps — the owner's instinct is correct, and the data already exists.**
  `packages/shared/src/health/cadence.ts`'s `CadenceSummary.series` is a 10-second-binned,
  median-filtered spm series, persisted as `cadence_series` on every walk/run/hike/treadmill log.
  Integrating it (`Σ spm_i × binDurationSec/60` over populated bins) is a real, derivable step-count
  estimate buildable today.
  - This is smaller and different from the backlog's existing "Phase G steps" note, which blocks
    real per-activity counts on a not-yet-built raw-BLE-frame reader for a true, gap-free count.
    Don't let that note gate this — the cadence-integration estimate needs none of that
    infrastructure.
  - **Dual-wear is real** — the owner wears the ring on the treadmill alongside the strap and
    flagged exactly this risk: "we don't want inflated results." Checked
    `lib/activity/cadence-tracker.ts`'s `pickLiveCadence()` (lines 148-159) directly: it already
    picks one source per reading (strap when fresh, ring only as fallback), never a blend, and while
    `RING_CADENCE_VALIDATED` is `false` the fallback branch returns `null` instead of using ring at
    all — so today every reading in `cadenceSeries` is unconditionally strap-only, and
    `source === 'strap'` is an exact gate, not an approximation. That soundness is contingent on the
    flag staying `false`; once ring calibration ships and it flips, a walk's series could legitimately
    mix strap and ring readings within itself, and a per-walk `source` check would stop guaranteeing
    an unmixed series. Build the integrator to reject non-strap readings per-reading, not per-walk,
    from the start — free today, and avoids revisiting this the day ring validation lands.
- **Calories — the formula already exists and is simply never called at write time.**
  `computeActiveEnergy()` (`packages/shared/src/health/daily-energy.ts`, the source Q-96 already
  made canonical for the Body tab) derives a logged activity's kcal via `estWorkoutKcal`
  (MET-by-type × duration × Schofield BMR) using only duration + the user's age/weight/sex + the
  activity type — all available at save time. It's applied only in the downstream aggregate today;
  the row's own `caloriesBurned` is never populated by it.

### Fix direction

1. Add a `cadenceSeries` → step-count integrator (strap-sourced only), called at save time.
2. Call `estWorkoutKcal` at save time in both `walk-summary.tsx` and `done-activity-screen.tsx`,
   writing the result instead of `null`. Sibling-surface sweep every `activity_logs` writer for the
   same hardcoded-null pattern.
3. Label both as estimates in the UI, distinct from a device-measured count.

### Tasks

- [ ] Build the cadence-series step integrator (strap-only) and wire it into `walk-summary.tsx`.
- [ ] Call `estWorkoutKcal` at save time in `walk-summary.tsx` and `done-activity-screen.tsx`;
      sweep for other `activity_logs` writers with the same null pattern.
- [ ] Verify locally: complete a guided walk with strap cadence data and confirm the saved
      `activity_logs` row carries non-null `steps` and `caloriesBurned`; confirm a ring-sourced
      walk still saves `steps: null` (not a guessed, unvalidated number).
- [ ] Run tests + lint. Remove this task's entry (Q-230) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

---

## Task 49 (Q-246 / Q-247) — deload-day bar styling, and the day-detail screen's missing calorie summary

- **Branch:** `fix/health-day-detail-energy-and-deload-bar`
- **Reported:** owner-reported, 2026-08-14, two screenshots (Health → Training bar chart; Health →
  day detail for "Friday 14 August"): "the deload day formatting looks bad. it should be normal;
  but maybe striped instead of colored in for the bar" and "the summary is; energy expenditure. the
  day overview doesnt show the calories in vs out. doesnt show the calorie expenditure for workouts
  or activities... the activity can have a lot more information on it rather than just a title and
  time" — plus a request to confirm workouts/activities/steps are all correctly counted toward the
  calorie goals.

### Q-246 — deload day looks identical to a rest day on the weekly bar chart

`components/stats/weekly-stats-hub.tsx` gates the bar's height/fill on `hasData = day.volume > 0`
and falls back to a flat grey "no data" sliver otherwise — the same treatment a genuine rest day
gets. `app/api/weekly-stats/route.ts` deliberately zeroes `volume` for a deload day (correct, so it
doesn't inflate the weekly-total metric) while still populating `day.sessions` and `day.isDeload`
correctly — the component already reads `isDeload` for its small "D" label, but the bar's own
height/fill branch never checks it, only the now-zeroed `volume`.

**Fix direction**: widen the gate to `day.volume > 0 || day.sessions.length > 0`; give a deload day
its own striped fill (each session's palette color, diagonal stripes instead of solid) at normal bar
height instead of the flat "no data" grey.

### Q-247 — day-detail has no energy summary; Activity rows are title + duration only

**The formula is correct — this is a display gap.** `computeActiveEnergy()`
(`packages/shared/src/health/daily-energy.ts`) already combines strength workouts, logged
activities (MET-by-type), and passive steps (de-duplicated against logged-outdoor-activity steps)
into one correct net-of-rest total, fed correctly by its one call site,
`lib/health/energy-balance-service.ts` — this is what powers Nutrition's Energy Balance card.

**The gap**: `app/health/day/day-detail-content.tsx` and `/api/day-log` never call any of this.
`DayBodyMeta.calories` is calories *eaten*, with no "burned"/"net" counterpart anywhere on the
screen. `ActivitySection` (`components/health/day-detail/day-sections.tsx:123-144`) renders only
`title` + `startTime` + `durationMin`, despite `ActivityLog` already carrying `distanceKm` and
`avgHr`/`maxHr` today (and `caloriesBurned`/`steps` once Q-230 ships).

**Fix direction**:
1. Add an Energy section (Eaten / Burned / Net) to the day-detail screen, reusing
   `computeActiveEnergy()`/`energy-balance-service.ts` rather than a second implementation.
2. Enrich `ActivitySection` with the fields already available (distance, avg HR) plus Q-230's
   additions (calories, steps).
3. Consider a per-workout kcal estimate in `TrainingSection` from the same `estWorkoutKcal` term.

### Tasks

- [ ] Fix the Q-246 bar render gate and add the striped deload fill.
- [ ] Add the Q-247 Energy section to the day-detail screen, reusing the existing formula.
- [ ] Enrich `ActivitySection`'s rows with distance/avg HR now, and calories/steps once Q-230 lands.
- [ ] Verify locally: a week containing a real deload session shows a full-height striped bar, not a
      grey sliver; a day with a workout + activity shows a correct Eaten/Burned/Net summary matching
      Nutrition's own Energy Balance card for the same day.
- [ ] Run tests + lint. Remove this task's entries (Q-246, Q-247) from
      `docs/implementation-backlog.md`, add the journal entry + `projectOverview.md` update in the
      same PR.

---

## Task 50 (Q-245) — swiping to a previous day and back on Nutrition fills a fresh "today" with the previous day's food

- **Branch:** `fix/nutrition-stale-day-swipe-food-logs`
- **Reported:** owner-reported, 2026-08-14 (screenshot: Nutrition page, fresh today, `Eaten 0`): "on
  a fresh day; if you swipe to previous day; then back to today it fills in food data with the
  previous day meal for today. it doesnt reset until app close and reopen."

### Confirmed: a same-date anti-flicker guard applied across a date change

`app/nutrition/nutrition-content.tsx`'s `loadFoodLogs` has the same guard shape three times:

```
setLogs(prev => next.length === 0 && prev.length > 0 ? prev : next)     // line 191, store-less path
setLogs(prev => merged.length === 0 && prev.length > 0 ? prev : merged) // line 236, local-store path
setLogs(prev => server.length === 0 && prev.length > 0 ? prev : server) // line 240, hydrate-failure fallback
```

Intent: protect a day's real, already-rendered food log from being wiped by a transient empty
response for *that same day* (matching CLAUDE.md's "never apply a server response that would
replace optimistic data with null/absent"). But `prev` is whatever `logs` held from the last fetch
regardless of which date it was for — the guard has no date-identity check, so it can't distinguish
"empty response = network hiccup for the day we're showing" from "empty response = the correct
answer for a different, genuinely empty day."

**Exact reproduction**: swipe to a previous day with real food → `logs` correctly holds that day's
entries. Swipe back to today (fresh, zero logs) → `loadFoodLogs(todayStr)` → local store and server
both correctly return `[]`, but the guard sees `next.length === 0 && prev.length > 0` (prev being
the *previous day's* food) and keeps it — today shows yesterday's meals. Nothing re-triggers the
fetch, so it sticks until a full remount (app close/reopen resets `logs` to `[]`, and the
mount-scoped `useLayoutEffect` re-seeds correctly for `todayStr`) — exactly "doesn't reset until app
close and reopen."

Not a cache-key bug — `nutrition-food-logs-${today}` and `store.getFoodLogsWithItems(today)` are
correctly date-scoped. This is a React state guard that doesn't know which date it's protecting.

### Fix direction

Track which date `logs` currently represents (a ref alongside the state, or `{date, data}` folded
into one state value) and only apply the "keep prev on empty" protection when the incoming fetch's
date matches it. A fetch for a different date always overwrites, empty or not. Fix all three
occurrences together — one bug, not three.

### Tasks

- [ ] Add date-identity tracking to `loadFoodLogs` and gate all three "keep prev" guards on it.
- [ ] Verify locally: log food today, swipe to a previous day with different food, swipe back to
      today, confirm today's log (not the previous day's) renders immediately.
- [ ] Verify the still-wanted case survives: simulate a slow/failing fetch for the *same* day that
      already has real logged food and confirm it still doesn't flash empty.
- [ ] Run tests + lint. Remove this task's entry (Q-245) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

---

## Task 51 (Q-248) — logging Exercise Readiness on Home shows "saved" but the screen doesn't progress

- **Branch:** `fix/readiness-card-stuck-after-save`
- **Reported:** owner-reported, 2026-08-15 (screenshot: Home, readiness sheet just closed): "add
  this to the top of the queue - doing the readiness did not progress it" — the "Readiness saved"
  toast is on screen while the "How are you feeling? / Log Readiness · ~15 sec" prompt underneath
  is unchanged.

### Confirmed: a real gate, and a plausible cause not yet reproduced on device

`app/session-select/session-select-content.tsx:1247` renders `ReadinessCheckinCard` while
`moodLog` is `undefined`/`null`, and swaps to the real `RecommendationCard` once it's populated —
a genuinely different card, so "didn't progress" means `moodLog` state in the parent never flipped.

The save sheet (`components/mood-checkin-sheet.tsx`) fires its toast and closes *synchronously*,
before any await — that part is fine. But the callback that flips `moodLog`
(`onSaved?.(log)` → `handleMoodSaved` → `setMoodLog(log)`) only fires after `await localWrite` then
`await invalidateCheckinAffectsPrescription()`. `localWrite` is the on-device SQLite write, and the
comment directly above it in the same file documents this exact write **previously stalling ~2
minutes** under sync-pull contention (single Capacitor SQLite connection). The 2026-08-13 fix
stopped the *sheet* from awaiting it before closing, but left the Home screen's card transition
gated behind the same write — so the toast can say "saved" while the screen the owner is looking at
stays on the pre-save prompt for as long as that write is contended, with nothing on screen to
explain why.

**Not yet confirmed as the actual cause at capture time** — needs an on-device repro: trigger a
sync pull, log readiness mid-pull, and see whether the card ever flips without a manual reload, and
how long it takes.

### Fix direction

1. Reproduce on device with a sync pull in flight before changing anything.
2. If confirmed: either fire `onSaved` from the optimistic `log` immediately (matching how the
   toast/close already treat the write as fire-and-forget), or give the card a visible
   saving/pending state instead of silently showing the identical pre-save prompt.
3. Re-check the ordering comment (`onSaved` placed after invalidation specifically to dodge the
   session-164 stale-cache-read bug) — any reordering must not reopen that one.

### Tasks

- [ ] Reproduce on device with a sync pull in flight; confirm or rule out the stall theory.
- [ ] Fix the `onSaved` gating per whichever direction the repro points to.
- [ ] Verify locally: log readiness with no contention (should already work) and log it during a
      simulated sync pull (should no longer visibly stall, or should show a clear pending state).
- [ ] Run tests + lint. Remove this task's entry (Q-248) from `docs/implementation-backlog.md`, add
      the journal entry + `projectOverview.md` update in the same PR.

---

<!-- Next owner-reported bug appends here as its own Task N (Q-NN) section. -->
