# Guided walk — big uplift (owner directive 2026-07-23)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans to work this
> plan task-by-task. Checkbox (`- [ ]`) syntax tracks progress.

## Context

The owner used the guided interval walk for the first time and filed 10 notes (screenshots:
a mid-walk "Slow — target ≤112 bpm" screen, and a "Walk complete" summary showing a 3×3/3,
18-min walk). Three items were small, low-risk fixes and were **already shipped in this same
session** (branch `claude/guided-walk-uplifts-1gou5m`, no separate plan needed):

- **#1 + #2 (HR-zone calibration)** — the fast/slow bpm targets were computed from
  fallback defaults (190 bpm max HR, 60 bpm resting) instead of the walker's real data. Fixed
  by wiring `repo.getBodyBatteryHistory()` (90-day max of `hrMaxObserved`) into
  `app/activity/guided-walk/page.tsx` as the observed-max input. **The 70%/40% HRR split
  itself was already correct** — it matches the actual Nose et al. Interval Walking Training
  protocol (fast ≥70% VO2peak, slow ~40% VO2peak; see Sources below) — so no formula change
  was needed, only the input calibration.
- **#3 (preset buttons "did nothing")** — root-caused via the dev-server walk logs to a
  **missing-feedback bug, not a functional bug**: the owner's actual walk ran as 3 sets/18 min
  (the "Quick" preset), so the tap worked — it just gave zero visual confirmation (no
  selected-state highlight, no tap animation/haptic), so it read as broken. Fixed:
  `components/guided-walk/walk-config.tsx` now highlights the preset matching the current
  config and adds `active:scale-95` + `hapticLight()` on tap, consistent with the rest of the
  app's touch-feedback convention.
- **#4 (no confirm-exit dialog)** — new `components/guided-walk/leave-walk-dialog.tsx`
  (mirrors `LeaveWorkoutDialog`), wired into: the in-screen "End walk" button
  (`walk-active.tsx`), the bottom-nav tab-away guard (`bottom-nav.tsx`), and the hardware
  back-button guard (`mobile-auth-handler.tsx`) — the same three surfaces the workout screen
  already guards, per the sibling-surface sweep rule.

**This plan covers the remaining, genuinely large items: #5, #6, #7, #8, #9, #10.** They are
sequenced by dependency — GPS/speed data (#6) is the foundation several others build on.

> **#6 and #9's speed/per-phase-stats parts (formerly Phases A/B here) were consolidated into
> their own standalone plan per owner request:**
> [`docs/superpowers/plans/2026-07-23-guided-walk-gps-speed-pace.md`](2026-07-23-guided-walk-gps-speed-pace.md).
> That plan also folds in the cadence reconciliation below (superseded by AD-2, a real shipped
> module) and the pace-primary/HR-secondary UI decision. Phases C, D, E, F, G below are
> unchanged and still live in this document; where they reference "Phase A," read that as the
> GPS/speed/pace plan linked above.

**Owner decision (2026-07-23, follow-up conversation) — pace is the primary fast/slow
signal, HR is secondary.** Looking at the owner's real walk data (Set 1→3: slow 82→91→106
bpm, fast 99→98→111 bpm), the fast/slow HR readings were close together and both climbed
steadily set-over-set — classic cardiac drift, not a clean effort signal. Heart rate is a weak
way to *distinguish* fast vs. slow during walking for a reasonably fit person, since walking
often doesn't push HR far from resting even at a brisk pace. The original Nose et al. protocol
actually prescribes an individualized **target walking speed** (from a lab VO2peak test), not
heart rate — HR is only the easy-to-measure proxy consumer apps substitute. **Once Phase A
(GPS/pace) ships, pace becomes the primary "are you actually walking fast/slow" target and HR
becomes a secondary "how hard did that feel" confirmation** — both shown to the walker as
guidelines, not just HR alone as today. This reprioritizes Phase E's nudge design below (evaluate
pace against target first, HR second) and should also reshape the active-walk UI once Phase A
lands (pace as the headline readout during a phase, HR as the supporting stat) — not specified
further here since it depends on how Phase A's UI actually turns out; revisit at that point.

## Non-goals

- No change to the 70%/40% HRR fraction targets — confirmed correct against the source
  research; only inputs were ever wrong.
- No native code changes ship without an owner APK rebuild + on-device smoke — every phase
  below states plainly which half (JS/server vs native) it touches.

---

## Phases A/B — superseded, moved to their own plan

See the pointer near the top of this doc. The full GPS/map/speed/pace/elevation/cadence/
per-phase-stats implementation plan now lives in
[`2026-07-23-guided-walk-gps-speed-pace.md`](2026-07-23-guided-walk-gps-speed-pace.md) as
Tasks 1-5 there. Do not implement from this section — it is kept only as a historical record of
the original scoping; the linked plan is current and reconciled against the shipped AD-2 module.

---

## Phase C — HR chart with fast/slow phase shading (#5)

**Independent of A/B** — can be done any time; uses the samples already collected today.

- `components/activity/activity-hr-chart.tsx` already renders an HR line chart from
  `{timestamp, bpm}[]` — reusable almost as-is. Two gaps vs. what the owner asked for
  ("HR chart to show slow vs fast walk", i.e. shaded phase bands, not just a plain line):
  1. `WalkHrSample` uses `{at, bpm}` (`at` = epoch ms) — trivial to map to
     `{timestamp: new Date(at).toISOString(), bpm}` for the existing prop shape.
  2. The chart has no concept of phase bands. Add an optional prop (e.g. `phaseBands?:
     { fromMin: number; toMin: number; kind: 'fast' | 'slow' }[]`) that draws a background
     `Filler`/annotation region per band (chart.js — either a lightweight custom plugin, or
     the `chartjs-plugin-annotation` package if already available; check before adding a new
     dependency). Extend `ActivityHrChart` itself with this optional prop rather than forking
     a second HR-chart component — one chart implementation, used by both regular activities
     (which won't pass `phaseBands`) and the guided walk (which will).
- [ ] Wire it into `walk-summary.tsx`, replacing the plain per-interval bpm list (or
  supplementing it) with the chart, `phaseBands` built from `plan.segments`.

**Verification:** dev-server smoke (chart renders with the fixture samples collected during a
sandbox walk — live HR reads "—" in the sandbox, but the chart can still be exercised with
synthetic sample data in a unit test).

---

## Phase D — Reuse the Android status-bar pill for phase + countdown (#7)

**Native Kotlin work — requires an owner APK rebuild; cannot be verified in this sandbox.**

The "Android pill" is the promoted-notification status-bar chip built for the rest timer
(`lib/native/rest-timer-chip.ts` + `RestTimerPlugin.kt`, see
`docs/superpowers/plans/2026-07-14-rest-timer-statusbar-chip.md` for the full mechanism:
`setRequestPromotedOngoing` + OS-ticked chronometer anchored to a finish timestamp — **the OS
ticks it, JS never re-posts every second**). The rest-timer design doc explicitly scoped it as
"not a general notifications framework — one purpose-built chip for the rest timer," so this
is new native surface area, not a config toggle on the existing plugin.

- [ ] **Investigate chip coloring feasibility first** — Android's promoted-notification chip
  is primarily an icon + `setShortCriticalText`/chronometer text; check the same Android 16
  Live Update docs the rest-timer plan cites for how much color control `setColor()` /
  `ProgressStyle` actually gives before assuming "different colors per phase" is achievable.
  If full background-color theming isn't possible, the fallback is a distinct icon per phase
  (fast vs slow) plus the OS-default tinting.
- [ ] Add a new Kotlin plugin (e.g. `WalkChipPlugin.kt`, modelled directly on
  `RestTimerPlugin.kt`) with `start({ phaseLabel, colorOrIcon, finishAtMs })` /
  `update(...)` / `stop()` methods — reuse the existing `setWhen(finishAtMs)` +
  `setUsesChronometer(true)` + `setChronometerCountDown(true)` pattern so the walk's
  fast/slow countdown ticks itself, matching the rest chip's zero-per-second-JS-work design.
- [ ] `lib/native/walk-chip.ts` — thin JS wrapper mirroring `lib/native/rest-timer-chip.ts`
  (guarded dynamic import, no-op off native, a `ta_pref_walk_chip` preference toggle like the
  rest chip's).
- [ ] Call `startWalkChip`/`stopWalkChip` from `walk-active.tsx` on each phase transition
  (fast→slow, slow→fast) and on unmount, with a `phaseLabel`/color per current segment kind.
- [ ] Manifest: reuse the already-declared `POST_PROMOTED_NOTIFICATIONS` permission (added
  for the rest chip) — no new permission needed. Register the plugin in `MainActivity.java`
  next to `RestTimerPlugin`. Handle its tap deep-link the same way (`open=guided-walk` intent
  extra → route to `/activity/guided-walk`).

**Verification:** typecheck/lint only in-sandbox (no Android SDK here). **On-device is
authoritative** — note explicitly in the PR which half (native Kotlin, unverifiable here) vs
JS/server (verifiable) each commit touches, per Canonical Runtime policy.

---

## Phase E — Real-time walk/jog nudge notifications from live speed + HR (#8)

**Explicitly gated by the owner's own framing ("once heart rate and speed are actually set
and recording properly") — do this last, after Phases A (speed) and the existing live-HR
plumbing are confirmed working on-device.**

This is different from the existing `lib/walk/walk-cues.ts` (which pre-schedules fixed
fast/slow *transition* cues via `@capacitor/local-notifications`, fire-and-forget, works
backgrounded). This is a **reactive** nudge: during a fast block, if live pace/HR is
under-target, prompt "speed up"; during a slow block, if over-target, prompt "ease off."

**Per the pace-primary/HR-secondary decision above: evaluate pace against its target first.**
Pace is the direct "are you actually walking fast/slow" signal; only fall back to (or
corroborate with) the HR verdict when pace data is unavailable (GPS not yet locked, indoor,
etc.) — don't average or OR the two verdicts together, since a strong pace signal shouldn't be
diluted by a noisy/drift-prone HR reading (see the cardiac-drift note above).

- [ ] Add a throttled check (e.g. every 20-30s within a phase, not every tick) in
  `walk-active.tsx` comparing live pace against the phase's target pace (derived from Phase A),
  falling back to `liveBpm` vs. the existing HR target only when pace isn't available yet
  (`classifyZone` already returns `'push'`/`'ease'` for the HR case — reuse it, don't re-derive
  the verdict; a pace-based equivalent gets the same two-state shape).
- [ ] On a sustained `'push'`/`'ease'` verdict (e.g. still off-target after N consecutive
  checks, to avoid nagging on a single noisy reading), fire a local notification via the same
  `@capacitor/local-notifications` mechanism `walk-cues.ts` already uses — reuse that module's
  scheduling helper shape rather than writing a second notification call site.
- [ ] **Scope constraint:** live HR/pace only update while the app is foregrounded (documented
  limitation of the existing live-HR layer and the web GPS fallback) — so this reactive nudge
  is a foreground-only feature in v1. Say this explicitly in the UI/changelog; don't imply it
  works with the screen off (that's what the pre-scheduled transition cues in `walk-cues.ts`
  are for).

**Verification:** the throttling/threshold logic is a pure function, unit-testable. The full
loop (live BLE HR + GPS + notification firing) is on-device only.

---

## Phase F — Persisted walk history: detail view, map, and records to beat (owner directive
2026-07-23, follow-up conversation)

> **⚠️ Partially superseded (2026-07-26) — read before implementing.** The Cardiovascular
> system redesign's spec decision **D-1 (revised)** explicitly settled that **walks do not
> progress**: *"a guided walk is a tool you use; it contributes zone minutes and steps and
> nothing more."* The **"Records to beat" step below is superseded — do not implement it.**
> PRs/best-efforts survive as a gamification mechanic, but only for the **running program**
> (`docs/superpowers/specs/2026-07-26-cardio-system-spec.md`, item 2 of the cardio batch in
> `docs/implementation-backlog.md` — baseline anchors are the beat-your-best mechanism). The
> detail-view/map steps below also substantially overlap with that redesign's shared
> execution/history screens (the now-shipped per-session visual system,
> `docs/overview/entries/2026-07-27-cardio-session-visuals.md`, and cardio batch item 3,
> explicitly scoped to serve run/walk/activity from one surface) — check those first before
> building a walk-specific detail view here, to avoid building the same map/chart twice.

**Goal:** the owner wants saved walk stats they can try to match/beat next time, plus a proper
"previous walks" section with per-walk detail (stats/map/chart), matching the depth the regular
activity flow already has.

**Key finding — this is cheaper than it sounds, because the app already has a
derive-on-read pattern for exactly this.** `components/activity/activity-detail-sheet.tsx`
does **not** store HR samples at write time — it re-fetches HR readings for the activity's
`[startTime, endTime]` window from raw history via `GET /api/oura/hr-window` when the detail
sheet opens. The guided walk can do the same instead of persisting per-tick samples:

- [ ] **Persist the interval config, not the samples.** Add a small JSONB field (or reuse
  `activity_logs.notes` if that's an acceptable fit, otherwise a new lightweight column — check
  before choosing) storing `{ sets, fastSec, slowSec, warmupSec, cooldownSec }` on the walk's
  `activity_logs` row at save time (`walk-summary.tsx`'s `saveWalk()`). This is the only new
  persistence this phase needs — combined with the row's existing `startTime`/`endTime`, it's
  enough to **reconstruct the exact segment schedule later** (segment N started at
  `startTime + offsetSec(N)`), so per-interval breakdowns can be recomputed on demand rather
  than requiring a samples table.
- [ ] **A guided-walk detail view**, either a variant of `activity-detail-sheet.tsx` or a
  dedicated `components/guided-walk/walk-detail-sheet.tsx` (prefer extending the existing one
  with an optional "phase bands" prop if the config is present on the log, rather than forking
  a second detail component wholesale — same reuse instinct as Phase C's chart prop): shows
  duration/avg/max HR (already saved), the HR chart with fast/slow shading (Phase C's chart,
  fed by re-fetched HR + the reconstructed segments), the route map + pace (once Phase A ships
  the route/pace fields), and a per-segment breakdown table (recomputed from the re-fetched HR
  + GPS data against the reconstructed segment boundaries — the exact computation
  `walk-summary.tsx` already does live, just replayed against historical data instead of
  in-memory samples).
- [ ] **A "Previous walks" list** — filter existing activity history
  (`activityType = 'walk' AND title = 'Interval walk'`, or a more robust discriminator if one
  gets added — check whether title-matching is fragile before relying on it long-term) into
  its own section/tab, each row opening the detail view above.
- [ ] ~~**Records to beat**~~ ⛔ **SUPERSEDED 2026-07-26 — do not implement.** Spec decision
  D-1 (revised) settled that walks don't progress or have PRs; see the note at the top of this
  phase. Kept here only as a historical record of the original scoping.

**Verification:** the detail-view re-fetch pattern is provable in the dev sandbox (same as
`activity-detail-sheet.tsx` today); real GPS-driven map/pace is on-device only (depends on
Phase A).

---

## Phase G — Wire logged activity into the daily activity score + step total (owner directive
2026-07-23, follow-up conversation) — **cross-cutting, not guided-walk-specific**

> **Zone-minutes lane SHIPPED (v1.205.2, 2026-07-23).** See "What shipped" below — it turned out
> not to need `activity_logs` at all, which sidesteps the double-counting risk this phase
> originally worried about for that lane. **Steps remains open** — no intraday step source
> exists to wire in yet (see the steps sub-section below, still gated on Phase A/a broader
> step-source design).

**What shipped:** `computeActivityScore`'s `zoneMinutes` input (already defined in
`lib/health/activity-score.ts` — the scoring formula was ready, just never fed a real value) is
now populated in `app/api/readiness-score/route.ts` from the day's **continuous HR series**
(`todayHrRows`, already fetched in that route for other stats) via the shared
`accumulateZoneSeconds`/`computeHrZones` primitives, with moderate (Zone 2-3) + 2×vigorous
(Zone 4-5) minutes per the CDC/AHA convention the interface already documented. **This is not
an `activity_logs` read at all** — it's the same continuous per-timestamp HR series `/api/hr-profile`
and `/api/zone-minutes` already derive from, which naturally includes time spent in zone during
ANY activity (a workout, a walk, general daytime wear) as long as HR was recording. That
sidesteps the double-count risk entirely for this lane: there's only one HR series, not two
separate sums being added together. Also added a per-walk **time-in-zone + Session Load**
breakdown to the walk summary screen (`components/guided-walk/walk-summary.tsx`), reusing the
exact `ZoneBreakdown` component + `/api/hr-profile` pattern `activity-detail-sheet.tsx` already
uses for regular activities — computed from the walk's own collected samples, no new
persistence.

**Steps — still open, but less blocked than first thought (reconciled against `main`
2026-07-23).** `body_metrics.steps` itself is still a **daily total**, not a time series, so the
zone-minutes trick (derive from an already-continuous series) doesn't directly apply. But the
underlying **model** that produces it — `runStepCounterPipeline` — genuinely can produce
timestamped step windows (`StepWindow[]`, e.g. `{startMs, endMs, steps}`) for an arbitrary span
of raw frames, and that model is now accuracy-confirmed on-device (see Phase A's cadence
reconciliation above). Two real gaps remain before this is usable for a specific activity's
window, not "the newest N frames":
1. `repo.getOuraRawSamplesByTags(userId, tags, limit)` (the only reader today, used by the admin
   step-counter-export console) fetches the **newest N frames**, not a `[from, to]` range — a
   windowed variant would be needed to fetch exactly the frames spanning a past activity's
   `[startTime, endTime]`.
2. Running the pipeline is a real ONNX inference call (`runStepsMotionDecoder` +
   `runStepCounter`), not a cheap pure function like the zone-minutes primitive — cost/latency
   needs considering if this runs at every activity save, vs. on-demand when a detail view opens.

Given this, the double-counting risk below is now **more tractable than "genuinely blocked"** —
once a windowed raw-frame reader exists, a per-activity step count could derive from the same
underlying model that feeds the day's total (not a second independent sum), the same
non-double-counting argument that worked for zone-minutes. Still gated on Phase A (for the
guided walk specifically, since it needs the gate-feed subscription anyway) or a standalone
follow-up plan (for activity_logs generally, given the cross-cutting scope noted below).

**Important finding, still relevant for steps:** neither the activity score nor the day's step
total currently include `activity_logs` **at all**, for *any* activity type — this gap predates
the guided walk and affects every manually-logged or GPS-tracked run/walk/ride in the app, not
just the interval walk. Confirmed by reading the actual call sites:

- `computeActivityScore` (`lib/health/activity-score.ts`) is fed `steps`/`activeCalories` from
  `todayMetrics` (`body_metrics`, i.e. Oura/Health Connect) in `app/api/readiness-score/route.ts`
  — `activity_logs` is never queried there. Its `sessions7d`/`volume7dKg` inputs come from
  `workout_sessions` (lifting only) — cardio/activity sessions contribute nothing.
- Whatever renders "today's steps" elsewhere reads the same `body_metrics.steps` — a walk's own
  `activity_logs.steps` (once Phase A/B populate it) is a completely separate, unconnected
  number today.

**The real risk here is double-counting, not just wiring it up.** If the walker wore their
ring/watch during the walk, the ring/Health-Connect step count for that time window **already
includes** the walk's steps — additively summing `activity_logs.steps` on top would inflate the
day's total. The app already has a precedent for exactly this class of problem:
`lib/data/health-source.ts` (`HEALTH_SOURCES`/`sourceRank`, manual > oura_ble > oura_cloud >
health_connect > legacy) and `lib/health/step-estimate.ts` (`mergeStepSources`,
`mergeStepCounterWithLive` — Tier-2-wins merge for overlapping step sources). Before writing
any code:

- [ ] **Design decision needed, not assumed:** should a guided walk's GPS/cadence-derived steps
  only fill a **gap** in the day's step timeline (no ring data for that window), following the
  existing merge-by-precedence pattern — never additively summed regardless of source overlap?
  This is almost certainly the right answer given the existing precedent, but confirm before
  implementing, since getting it wrong double-counts every walk for anyone wearing a ring.
- [ ] Extend `computeActivityScore`'s inputs (or the route that builds them) to fold in a
  cardio-minutes/session signal from `activity_logs` — mirroring how `sessions7d` already
  represents lifting frequency, a parallel cardio-session signal keeps the "One Formula, One
  Place" activity-score model from having two disconnected inputs (steps from one source,
  strength from another, cardio activity from neither).
- [ ] **Given the cross-cutting scope (touches the shared activity-score formula used by every
  activity type, not just guided walk files), consider splitting this into its own backlog
  item/plan** rather than bundling it with the guided-walk-specific phases above — it will need
  its own sibling-surface sweep (every place `activity_logs.steps`/duration is meant to matter)
  independent of anything guided-walk-specific.

**Verification:** the merge-precedence logic is unit-testable; whether it actually prevents
double-counting in practice needs real ring + real GPS data on-device.

---

## Suggested implementation order for follow-up sessions

1. **GPS/speed/pace/elevation/cadence plan** (`2026-07-23-guided-walk-gps-speed-pace.md`,
   Tasks 1-4) — unblocks Phase F's map/pace and Phase E, and gives immediate visible value.
2. **Phase C** (HR chart w/ phase shading) — independent, can slot in anywhere, good filler.
3. **Phase F** (persisted history + detail view + derived records) — do after the GPS/pace
   plan's Tasks 1-2, since the detail view's map/pace needs those fields; the interval-config
   persistence + records-to-beat query don't strictly need them and could land earlier.
4. **Phase D** (Android pill reuse) — native, biggest single lift, needs its own APK-rebuild
   verification cycle.
5. **Phase E** (reactive nudges) — depends on the GPS/pace plan's Task 4 being verified
   on-device first.
6. **GPS/speed/pace plan's Task 5** (real step counts) — its own scoping pass, not blocking.
7. **Phase G** (activity score + step wiring) — last, and likely worth splitting into its own
   backlog item given its cross-cutting scope (see Phase G's note) rather than staying
   guided-walk-scoped.

Each phase is independently shippable (its own PR, own version bump/changelog line) — don't
bundle them into one mega-PR.

## Sources

- [Interval walking training — Wikipedia](https://en.wikipedia.org/wiki/Interval_walking_training)
- [Development of low-volume, high-intensity, aerobic-type interval training for elderly
  Japanese men — PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5571578/)
