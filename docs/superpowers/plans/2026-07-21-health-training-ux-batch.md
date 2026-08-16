# Health / Training / Workout UX batch — 14 items (owner-directed 2026-07-21)

Owner walked through the app on-device (S25) and filed 14 UI/detail/bug items across the
Health, Training, Progress, Workout, Nutrition and More surfaces, with screenshots. This
doc is the master plan: **one section per item**, each self-contained enough to be its own
implementer PR. Queue entries for #2–#14 live in `docs/implementation-backlog.md`; **#1
(Readiness detail) is built in the same PR as this plan** per the owner's direction.

Research was six parallel source sweeps (all findings file:line-verified against `main`
2026-07-21). Where a screenshot contradicted the owner's hypothesis, the code truth is noted.

**Cross-cutting conventions all items must honour** (from CLAUDE.md):
- Score bands/labels come from `scoreBand()` (`lib/health/score-band.ts`) — never re-derive 70/50
  thresholds; colour always ships paired with the band label/icon (no colour-only state).
- Charts: reuse `chart.js`/`react-chartjs-2` via existing wrappers (`TrendSparkline`,
  `TrendChart`, `components/ui/sparkline.tsx`). Never pass `var(--x)` to a canvas paint API —
  resolve via `resolveColor` (`lib/chart-colors.ts`). Style both light + dark.
- Collapsible cards use the existing `components/ui/collapsible-section.tsx` (real `<button>`,
  `aria-expanded`, 44px target, `defaultOpen=false`) — don't hand-roll a chevron toggle.
- Safe-area: any new full-screen/nav-screen anchored control uses the floored utilities
  (`pb-safe-action` / `pb-safe-action-lg`), never bare `pb-safe`.
- Component files stay < ~800 lines; extract new UI into `components/` children.
- Any screen that fetches seeds synchronously from cache (`readCacheSync` in a `useLayoutEffect`,
  never a `useState` initializer) and revalidates — no skeleton flash on repeat visits.
- **Device gate:** most of these touch offline-first reads, safe-area, or native HR/BLE. Green
  `pnpm dev` is necessary, not sufficient — each item lists whether it needs an on-device smoke
  run or a Known-Issues row before merge.

---

## Item 1 — Readiness detail: contributor graph + score breakdown + context (BUILT WITH THIS PR)

**Current** (`app/health/readiness/readiness-content.tsx` → shared
`components/health/health-score-detail.tsx`): a score dial, flat 0–100 contributor bars
(`ContributorBars`, health-score-detail.tsx:66-87), a day-summary card, and a single 14-day
readiness sparkline (`TrendSparkline`). No breakdown of *how* the score is built, no per-contributor
history/average, no weighting shown.

**Data already on the client** (no API change needed):
- `/api/readiness-score` (`ReadinessScoreResponse`, `app/api/readiness-score/route.ts:19-77`):
  `readinessDisplayScore`, `ouraScore`, `source` (`oura+acwr`|`oura`|`custom`|`none`),
  `components {sleep,hrv,rhr,load}`, `readinessContributors` (record 0–100),
  `temperatureDeviation`, ACWR-blend fields (via `computeBlendedScore`, route.ts:79-110).
- `/api/health/trends` (`HealthTrendDay[]`, 14d) — already fetched by the screen.
- Composite weights (when Oura score absent): `READINESS_WEIGHTS` in
  `lib/health/readiness-composite.ts:17-26`.
- `components/readiness-card.tsx:176-227` **already implements** the "Oura base → ACWR → temp →
  final" breakdown UI — lift/share it rather than re-authoring.

**Target** — enrich `HealthScoreDetail` (readiness theme only) with, in order after the dial:
1. **Score-breakdown card** — "what the score is built on": Oura base → ±ACWR load → ±temp
   penalty → final (from `readiness-card.tsx`), OR when `source==='custom'`, the weighted
   composite table (each contributor × its `READINESS_WEIGHTS` weight → points). Shows the
   *formula*, not just the number.
2. **Contributor graph** — replace/augment the flat bars with a small chart: each contributor's
   current value vs its own 14-day average (diverging bars or a grouped bar), sorted worst-first,
   each paired with its label (`lib/oura/contributors.ts`) and band colour. "Previous / average
   just informational" per the owner — show today's value + the 14d average as a faint marker.
3. **Per-contributor context row** — for the worst 2–3 contributors, a one-line "X vs your
   average Y" using the trends data.

Keep it readiness-specific via a prop flag on `HealthScoreDetail` (e.g. `showBreakdown`,
`breakdownField`) so Sleep/Activity are unaffected until their own items (#3) extend them.

**Files:** `components/health/health-score-detail.tsx`, `app/health/readiness/readiness-content.tsx`,
a new `components/health/readiness-breakdown.tsx` (extracted breakdown, shared with `readiness-card`),
a new `components/health/contributor-trend-chart.tsx`. Reuse `TrendSparkline`/`Sparkline`.
**Verify:** `pnpm dev` readiness page with seeded Oura data (breakdown = oura+acwr path) AND with
Oura score nulled (composite path). Device-gate: layout/safe-area only — web verification sufficient,
but note it renders differently with real vs seeded contributors.

---

## Item 2 — Detail-screen back button (Readiness / HRR / Sleep / Activity pills)

**Current:** all four screens DO have a back button in the shared `DetailHero`
(`components/health/detail-hero.tsx:228-238`), using `useBackOrFallback("/health")`
(`lib/hooks/use-back-or-fallback.ts`). **Root cause of "doesn't work":** the pills that open
these screens (`OuraScoreChipRow`) are rendered on the **Home/session-select** screen
(`app/session-select/session-select-content.tsx:1030`), but the back fallback is hard-coded to
`/health`. On a cold deep-link / PWA relaunch (`window.history.length <= 1`), back does
`router.replace("/health")` — landing on the Health tab, not Home. Also a light-mode contrast
issue: the chevron uses `text-neutral-900/90` over 0.4-opacity hero art (`detail-hero.tsx:212,219`),
so it can look absent.

**Target:** (a) pass the correct fallback from the opener — thread an `originTab`/fallback into
`DetailHero` so pills opened from Home fall back to Home; simplest robust fix is to make the
fallback the actual referring tab (or always `/` home) instead of a hard-coded `/health`.
(b) Bump the chevron's hit target and guarantee ≥4.5:1 contrast in both themes (solid pill
background behind the chevron). **Files:** `detail-hero.tsx`, `use-back-or-fallback.ts`, the pill
opener. **Verify on device** (safe-area + real back-stack behaviour): tap each pill from Home,
press back → returns to Home; hard-refresh a detail URL → back still lands somewhere sane.

---

## Item 3 — Sleep + Activity detail depth (match the HR screen's richness)

**Reference:** `app/health/heart-rate/page.tsx` is the rich standard (stat tiles, ObservedHrCard,
24h chart, trend sparklines, VO₂/vascular-age).

**Sleep (`app/health/sleep/sleep-content.tsx`):** currently renders only score ring +
contributors + latest-night hypnogram + consistency. See Item 6 — fold the night-detail depth
there.

**Activity (`app/health/activity/activity-content.tsx`):** the real gap. It shows a score + Oura
`activityContributors` (frozen/null since the BLE re-key) + a conditional `activityBlend` banner.
The app-computed formula is well-defined but **unsurfaced** (`lib/health/activity-score.ts`):
Movement weight 60 (steps 0.6 / active-cal 0.4, scored vs personal trailing average), Training
weight 40 (`TRAIN_CREDIT_BASE 6 + TRAIN_CREDIT_VOL 8 × volRatio`, from today's workout volume vs
typical). **Target:** an Activity breakdown card mirroring Item 1 — "Movement X/60 · Training Y/40
→ score", explicitly answering "does exercise contribute, how much" using `data.activityBlend`
(base/adjustment/final/trained, route.ts:240-247) + the `activity-score.ts` weights. Add steps /
active-cal / workout-volume tiles like the HR screen's stat tiles. **Files:** `activity-content.tsx`,
reuse the Item-1 breakdown component. Device-gate: needs real activity data to look right —
Known-Issues row acceptable if no device this session.

---

## Item 4 — Body Battery: "how it's calculated" + more attention (homepage feature)

**Current** (`components/body-battery-card.tsx`, `app/api/body-battery/route.ts`): morning anchor =
readiness score, then per-minute HR-reserve charge/drain + stress drain. Explanation copy exists
**only in the empty state** (body-battery-card.tsx:154-168) — once populated it disappears.

**Target:** (a) a persistent, expandable "how it works" section (use `CollapsibleSection`) with
bullet points: opens at your readiness score each morning; **charges with rest/sleep, drains with
exercise + elevated HR + stress**; explicitly tie the four homepage features (Readiness / HRR /
Sleep / Activity) to how they feed the battery. (b) More visual attention: keep the day chart, add
the charged/drained deltas prominently, consider a subtle fill animation on the ring (reuse
`motion`/`useCountUp`). This is a homepage hero — it earns the polish. **Files:**
`components/body-battery-card.tsx`, maybe extract a `body-battery-explainer.tsx`. Device-gate:
HR-series driven — needs real ring data to populate; web shows the empty/explainer state.

---

## Item 5 — Health screen: goal-based energy budget + last-known weight (owner: budget ring)

**5a — Body weight shows "—" when nothing logged in 7 days.** Root cause is the API window:
`latestWeight = metaToday?.weightKg ?? metaRecent.find(...)?.weightKg` (health-content.tsx:706)
but `metaRecent` is only the last 7 days (`/api/body-metadata` `from = now−7d`,
`route.ts:71,91`). **Fix:** add a `latestWeightKg` (+ its date) to the `/api/body-metadata`
response computed from the newest row regardless of age; render it with a "last logged
<relative-date>" subtitle instead of the hard-coded "Last 7 days" (health-sections.tsx:187).

**5b — Goal-based energy budget ring** (owner-selected model). Replace/augment the cardio-only
"burned" card with a daily budget:
- **Target** = BMR (Mifflin-St Jeor, `mifflinStJeorBmr` from `lib/nutrition/goal-recommendation.ts`)
  × activity multiplier (`ACTIVITY_MULTIPLIERS`, use-health-calcs.ts) ± the user's **goal
  adjustment** (e.g. −500/day for weight loss — from the user's goal setting).
- **Counts down** as food is eaten; **adds back** energy burned from workouts + cardio + steps
  (today "burned" is cardio-`activity_logs` only, route.ts:115-117 — extend to include
  strength-workout energy and step-based movement).
- Show **remaining** (can go to 0 / negative), and a **projected weight-change** readout derived
  from the running deficit/surplus (7700 kcal ≈ 1 kg). Reuse `useEnergyBalance`
  (`use-health-calcs.ts:37-55`) as the base and reframe as a budget.
- **One-formula rule:** strength-workout energy estimation must live once in `lib/` (check for an
  existing estimator before writing one) and be imported; do not inline a MET/volume formula.

**Files:** `app/api/body-metadata/route.ts` (latest-weight + burned components), `health-sections.tsx`
(weight card + new budget card), `app/health/hooks/use-health-calcs.ts`, a new
`components/health/energy-budget-card.tsx`. Device-gate: web-verifiable with seeded data; the
step/workout energy inputs need a real day to sanity-check the number.

---

## Item 6 — Sleep night detail: surface the chips that the list card shows

**Current:** `SleepCard` (list, `components/health/body-cards/sleep-card.tsx:67-82`) shows
efficiency %, onset latency, overnight HRV, lowest HR, respiratory rate, per-stage hours. Clicking
into `/health/sleep` (`SleepContent`) renders `sleepRows[0]` only and **drops** those chips — the
per-night modal (screenshot) shows stages/latency/restless/avg-HR but not efficiency, HRV, BR, or a
comparison scale. All fields exist on `sleep_sessions` (`schema.ts:357-383`) and the `SleepRow` API
type already exposes them.

**Target:** (a) On the sleep detail / night modal, render the full metric set (efficiency, onset,
overnight HRV, lowest HR, respiratory rate, restless) as tiles, each with a **scale showing where
it sits vs the user's avg/max** over the trend window — a reusable `MetricScale` component (owner:
"a scale here — could be re-used on the home sleep screen too"). (b) Make each night in the list
(screenshot 8) open its own detail (not just latest). **Files:** `sleep-content.tsx`, the night
modal component, new `components/health/metric-scale.tsx` (reused on the home sleep card too).
Device-gate: web-verifiable with seeded sleep data.

---

## Item 7 — Heart & Recovery combined widget; move "Measure HR now" out of the Oura section

**Current:** RHR/HRV/SpO₂ are three separate tiles (`RhrHrvSpo2Card`); "Measure HR now"
(`components/health/measure-hr-now.tsx`) is **nested inside `OuraSection`**
(`oura-section.tsx:148`) which returns `null` unless an Oura ring is connected
(`oura-section.tsx:113`) — so with a Polar strap and no ring, the button vanishes even though live
HR works. It is already device-agnostic (`getLiveHrManager()` → ring or strap).

**Target:** (a) A combined **Heart & Recovery** card that shows resting HR (day/night if available),
HRV, and SpO₂ in one widget, each with a **normal/abnormal range indicator** and where it sits vs
the trailing average (reuse the Item-6 `MetricScale`). (b) Lift `MeasureHrNow` out of `OuraSection`
into its own card **below** the Heart & Recovery card, un-gated from Oura connection (guard on
"any live-HR source available" instead). **Files:** new/expanded `components/health/heart-recovery-card.tsx`,
`measure-hr-now.tsx` (move its mount point in `health-sections.tsx`), `oura-section.tsx` (remove the
nested mount). Device-gate: **on-device** — live HR + safe-area; strap-vs-ring source is APK-only.

---

## Item 8 — ACWR & "Sleep vs Performance" cards: collapse by default + chart the data

**Current:** both are always-expanded plain `<div>`s in `getHealthSections()`
(`health-sections.tsx:589-640` ACWR, `:642-675` sleep-vs-perf). ACWR already embeds a
`TrainingStressLine` chart + permanent info blurb; sleep-vs-perf is numbers-only bucket tiles.

**Target:** wrap both in `CollapsibleSection` (`defaultOpen={false}`) so they show a compact
header row (headline number + one-line takeaway) collapsed, expanding to detail on tap. Replace the
sleep-vs-perf static bucket tiles with a small **bar chart** (avg %-change per sleep bucket, with
set-count labels) so the pattern is visible, not just numbers. **Files:** `health-sections.tsx`
(both cases), a `sleep-performance-chart.tsx`. Device-gate: web-verifiable.

---

## Item 9 — Oura ring battery live; muscle card as the Body-tab hero

**9a — Ring battery not live.** User-facing ring cards (`components/health/oura-section.tsx:162-177`
Ring Status, `components/more/oura-section.tsx:216-233`) read battery from the **Oura Cloud**
(`/api/oura/stats` → `ring_battery_level`), which is frozen since the 2026-07-07 BLE re-key →
always `batteryStale` → "Not live". A **live** BLE battery pipeline exists
(`/api/oura-ble/battery-poll` → `insertOuraBatteryPoll`, read via `getOuraBatteryPolls`) but is
**admin-gated** and only shown on `app/admin/oura-ble/page.tsx`. **Fix:** add a non-admin "latest
live battery" read (new endpoint or widen the existing one to the authed user's own polls) and wire
the Ring Status tile to prefer the latest BLE poll over the frozen Cloud value. **Files:** new
`app/api/oura-ble/battery-latest/route.ts` (user-scoped), `oura-section.tsx` (both), possibly
`lib/health/ring-battery.ts`. Device-gate: **APK** — real battery telemetry only lands from the
native service.

**9b — Muscle card as Body-tab hero.** The Body tab currently renders **no** muscle card (muscle
lives on Training / workout-select). Owner wants a compact muscle card **first** on the Body tab,
smaller but the main attraction, showing which muscles are worked, with more detail/animation.
**Approach:** prepend a `muscle` key to `BODY_GROUPS`/`BODY_DEFAULT_ORDER` (health-content.tsx:56-64)
+ a `case` in `renderBodySection`, rendering a compact `MuscleHeatmap`
(`components/muscle-heatmap.tsx`) + the `MuscleRecoveryCard` strip (both already used together on
workout-select:349-359). Add subtle activation animation. **Note:** changing `BODY_DEFAULT_ORDER`
only reorders for users with no saved order (`lib/health-card-order.ts` appends new keys) — fine
for a new key. **Files:** `health-content.tsx`, `health-sections.tsx`, a compact
`body-muscle-card.tsx`. Device-gate: web-verifiable (SVG heatmap); check the Samsung compositor
gradient-wipe caveat for SVGs in card grids.

---

## Item 10 — Training: merge Training Load + Sessions/Sets; fix avg duration

**10a — Merge.** The "Training Load" bar card and the Sessions/Sets/Volume/Avg-Duration grid are
already in **one component** (`components/stats/weekly-stats-hub.tsx` — bars :49-108, grid
:110-121, both from `/api/weekly-stats`). Owner wants them presented as one cohesive feature with
better UI — restructure `WeeklyStatsHub` so the bar chart and the stat grid read as a single unit
(shared header, the stats as a footer strip under the bars), rather than two stacked cards.
**Files:** `weekly-stats-hub.tsx`. Web-verifiable.

**10b — Avg duration reads too low (28m).** NOT a ÷7 bug — the denominator is already
`durationCount` (sessions with ≥2 logged timestamps). The real cause: duration =
`max(loggedAt) − min(loggedAt)` of exercise logs (`weekly-stats/route.ts:85-91`), i.e. first-set to
last-set span, which excludes warm-up + the final rest and understates a true 55-min session; and
sessions with <2 timestamped exercises are dropped. **Fix:** derive duration from
`completedAt − startedAt` where available (the `lib/health/workout-density.ts:23` approach) — but
`startedAt` is midnight-AEST per the route's comment, so verify a real `startedAt` exists before
using it; otherwise pad the log-span or use `workout_sessions` timing columns. **Confirm which
timing column is trustworthy before coding.** **Files:** `app/api/weekly-stats/route.ts`.
Web-verifiable against seeded sessions; sanity-check against the owner's real 55-min sessions on
device.

---

## Item 11 — Progress: Strength Trend + Trends to the top; fix Trends card height jump

**11a — Reorder.** `PROGRESS_DEFAULT_ORDER` (health-content.tsx:70) is currently
`["strengthProgress","goalsProgress","weightTrendProgress","strengthTrend","trends"]`. Move to
`["strengthTrend","trends", ...]`. Caveat: only affects users with no saved card order
(`lib/health-card-order.ts`) — acceptable, but if the owner's order is saved, may need a one-time
migration/reset of the progress order.

**11b — Trends card height jumps** (`components/health/trends-section.tsx`). The 7-pill view picker
swaps between four different-height bodies (loading `h-24`, one-line error, two-line empty,
variable-length insight + either `TrendChart` or `CorrelationBars`). **Fix:** reserve a
**fixed-height content area** (like `StrengthTrendCard`'s fixed `Sparkline height={64}`) so every
view — data, empty, loading — occupies the same box; clamp/scroll the insight paragraph.
**Files:** `trends-section.tsx`, `health-content.tsx` (order). Web-verifiable — cycle all 7 pills,
confirm no reflow.

---

## Item 12 — Nutrition: food lands in the current-time bucket, not the selected one

**Root cause (saved-meals path only):** the regular add-food path is already guarded
(`assign-step.tsx:24,37` — `selectedId` inits from `preselectedMealTypeId`, time-of-day is a
`prev ??` fallback). But `SavedMealsSheet.quickLog` (`saved-meals-sheet.tsx:201-203`)
**unconditionally** computes the bucket from `new Date().getHours()` and has **no**
`preselectedMealTypeId` prop; `FoodLoggerSheet` doesn't forward the selected bucket to the nested
`SavedMealsSheet` (`food-logger-sheet.tsx:240-246`). So opening "breakfast" → picking a saved meal
→ logs into the current-time bucket. **Fix:** add `preselectedMealTypeId` to `SavedMealsSheet`
props, forward it from `FoodLoggerSheet`, and in `quickLog` use `preselected ?? time-of-day
fallback`. **Files:** `saved-meals-sheet.tsx`, `food-logger-sheet.tsx`. Web-verifiable — reproduce
by adding a saved meal to a non-current bucket. (This is a bug fix for a shipped feature → no merge
gate.)

---

## Item 13 — More screen: cache-seed the remaining spinner sources

**Current:** most of More is correctly seeded. The instant-paint gaps are `cachedFetch`-only with
no `readCacheSync` seed: **`more-seasons`** (more-content.tsx:91), **`program-week`**
(profile-tab.tsx:223), **`admin-pending-count`** (profile-tab.tsx:236); plus the empty-array
`loading` gate in friends feed/leaderboard, and the `ssr:false` dynamic-import skeletons for
`ConfigScreen`/`AchievementsSection`. **Fix:** add `readCacheSync` seeds (in `useLayoutEffect`,
not a `useState` initializer) for the three fetches; make the friends feed/leaderboard clear
`loading` on a seeded empty array. **Files:** `more-content.tsx`, `profile-tab.tsx`,
`friend-feed.tsx`, `friend-leaderboard.tsx`. Web-verifiable — second visit shows no flash.

---

## Item 14 — Workout screen: 3-card layout (Workout · Run · Activity) (owner-directed)

**Current:** `app/workout-select/workout-select-content.tsx` (419 lines, the `workout` tab) is a
hand-rolled **full-100dvh single-card vertical swipe carousel** — one `ProgramSession` fills the
whole screen (card `h-full`, muscle map `flex-1`), navigated by dots; a separate "Log Activity"
button opens `LogActivitySheet` (activity types → `/activity`). Runs live separately
(`/running`). Workouts and activities are two disjoint systems here.

**Owner-directed target — three cards on one screen (not tabs, not a carousel):**
1. **Workout card (large)** — a **compact version of the workout screen**: today's recommended
   session with a smaller muscle map, exercise count/duration, recovery, and Start; a compact way
   to reach the other sessions (a small horizontal session picker / row rather than a full-screen
   swipe).
2. **Run card (large)** — running info: **baselines, a cool usable metric, animation**. Surface
   from the running plan (`/api/running-plan`, `components/running/`) — e.g. current weekly zone
   target / VDOT pace / last run, with a tasteful animated element. Tapping starts a run / opens
   `/running`.
3. **Activity card (small)** — the remaining activity types (`ActivityType` grid from
   `LogActivitySheet`) in a compact card; tap → `/activity`.

This replaces the full-height carousel with a scannable three-card screen and gives runs
first-class space. **Files:** rewrite `workout-select-content.tsx` into an orchestrator +
`components/workout-select/workout-card.tsx`, `run-card.tsx`, `activity-card.tsx` (keep it
under ~800 lines each); reuse `MuscleHeatmap`, `MuscleRecoveryCard`, `LogActivitySheet`,
`session-palette`, `activity-icons`. **Verify on device** — safe-area (the Start controls +
bottom nav), gestures (the session picker), and the muscle-map SVG on the Samsung compositor.
This is the largest item; scope carefully and consider splitting the run-card metric/animation into
a follow-up if it balloons.

---

## Sequencing / risk notes

- **Quick, low-risk wins** (own small PRs, web-verifiable): #12 (nutrition bucket), #13 (More
  cache-seed), #11a (reorder), #10b (avg duration), #2 (back button — but device-gate the safe-area).
- **Medium** (new components, reuse existing charts): #1 (this PR), #3, #6, #8, #10a, #11b.
- **Larger / device-gated:** #4, #5, #7, #9a (needs BLE), #9b, #14.
- **Shared building blocks to build once and reuse:** the Item-1 **breakdown card** (reused by #3
  Activity), and the Item-6 **`MetricScale`** (reused by #7 and the home sleep card). Build these
  deliberately as shared `components/health/` primitives.
- Every item that changes a user-visible surface bumps `package.json` + `lib/changelog.ts` in its
  own PR.
