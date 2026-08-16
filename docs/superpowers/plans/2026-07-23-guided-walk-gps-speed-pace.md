# Guided walk — GPS, speed, pace, elevation, cadence (consolidated implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans to work this
> plan task-by-task. Checkbox (`- [ ]`) syntax tracks progress.

## Context

This consolidates the GPS/speed/pace/elevation/cadence items from the owner's guided-walk uplift
notes (originally Phases A/B of
[`docs/superpowers/plans/2026-07-23-guided-walk-uplift.md`](2026-07-23-guided-walk-uplift.md))
into one standalone, implementation-ready plan, per the owner's explicit request to combine them.
The other uplift items (HR chart phase-shading, the Android status-bar pill, persisted
history/records, activity-score/step wiring) stay in that broader doc — this plan is scoped
specifically to "the walk shows where you went, how fast, and whether you hit the target pace."

**Dependency: this plan builds on AD-2** (`feat/ring-cadence-activity-detection`,
[`docs/superpowers/plans/2026-07-23-ring-cadence-activity-detection.md`](2026-07-23-ring-cadence-activity-detection.md)),
implemented the same day for a different problem (fixing false walk-detection) but sharing the
exact signal this plan needs for cadence: `lib/health/gait-classifier.ts` (`classifyGait`) reading
decoded `stride_frequency` from the ring's gate-feed windows. **Merge or rebase onto that branch
before starting Task 3 (cadence)** — Tasks 1-2 (GPS/map/pace/elevation) have no dependency on it
and can start immediately.

**Owner decision carried over from the uplift doc: pace is the primary fast/slow signal, HR is
secondary.** The owner's real walk data showed fast/slow HR readings climbing together
set-over-set (cardiac drift, not a clean effort signal), and the actual Interval Walking Training
research prescribes a target *walking speed*, not heart rate — HR is only the easy-to-measure
proxy. Once this plan ships, pace becomes the headline "are you actually walking fast/slow"
readout during a phase, with HR as the supporting stat — reflected in Task 4 below.

## Non-goals

- No native code — this is entirely JS/server (GPS via existing Capacitor plugins, cadence via
  the already-shipped JS gate-feed subscription). No APK rebuild required for this plan alone.
- No new DB schema — every field this plan writes to already exists on `activity_logs`
  (confirmed by reading `lib/data/postgres/schema.ts:279-304`).
- Real step **counts** (not just cadence) depend on a windowed raw-BLE-frame reader that doesn't
  exist yet — scoped as an explicit follow-on (Task 5), not blocking this plan's Tasks 1-4.

---

## Task 1: GPS point stream + live map in the guided walk

**Files:**
- Modify: `lib/stores/guided-walk-store.ts`, `components/guided-walk/walk-active.tsx`

Mirror `lib/stores/activity-store.ts` + `components/activity/active-activity-screen.tsx`'s
existing pattern exactly — don't re-derive it.

- [ ] **Step 1:** Add to `guided-walk-store.ts`:
  ```typescript
  import type { RoutePoint } from '@/lib/activity/route-encoding'
  import { haversineDistanceKm } from '@/lib/activity/activity-metrics'

  // In GuidedWalkState:
  rawPoints: RoutePoint[]
  distanceKm: number
  currentPaceSecPerKm: number | null

  // In actions:
  appendPoint: (point: RoutePoint) => void

  // In the creator, mirroring activity-store.ts's appendPoint exactly (coalesced distance/pace
  // update per point, not a full recompute):
  appendPoint: (point) => set((s) => {
    const prevPoint = s.rawPoints[s.rawPoints.length - 1]
    const distanceKm = prevPoint ? s.distanceKm + haversineDistanceKm(prevPoint, point) : s.distanceKm
    const elapsedSec = s.startedAtMs != null ? (point.t - s.startedAtMs) / 1000 : 0
    return {
      rawPoints: [...s.rawPoints, point],
      distanceKm,
      currentPaceSecPerKm: distanceKm > 0 && elapsedSec > 0 ? elapsedSec / distanceKm : null,
    }
  }),
  ```
  Reset `rawPoints`/`distanceKm`/`currentPaceSecPerKm` in `start()` and `reset()`.
- [ ] **Step 2:** In `walk-active.tsx`, add the GPS effect (mirrors
  `active-activity-screen.tsx`'s effect — no pause/resume needed here, GPS just runs for the
  whole `active` mode):
  ```typescript
  import { startGpsWatcher, type GpsWatcher } from '@/lib/activity/gps-tracking'

  useEffect(() => {
    let watcher: GpsWatcher | null = null
    let cancelled = false
    startGpsWatcher((point) => useGuidedWalkStore.getState().appendPoint(point)).then(w => {
      if (cancelled) w.stop(); else watcher = w
    })
    return () => { cancelled = true; watcher?.stop() }
  }, [])
  ```
- [ ] **Step 3:** Render the map + live distance/pace. Reuse the dynamic import pattern:
  ```typescript
  const ActivityRouteMap = dynamic(() => import('@/components/activity/activity-route-map').then(m => m.ActivityRouteMap), { ssr: false })
  ```
  Add distance + pace readouts (mirroring `active-activity-screen.tsx`'s stat row) and
  `{rawPoints.length > 1 && <ActivityRouteMap points={rawPoints} className="h-48 w-full max-w-xs" />}`
  into the existing phase/timer/HR layout — don't replace the phase/timer UI, add alongside it.
- [ ] **Step 4:** Location permission — reuse whatever
  `components/activity/background-location-card.tsx` / `lib/activity/location-permission.ts`
  already do for the regular activity flow. Do not build a second permission-prompt UI.
- [ ] **Step 5:** Typecheck + lint + commit.

---

## Task 2: Save GPS-derived fields to the completed walk

**Files:**
- Modify: `components/guided-walk/walk-summary.tsx`

- [ ] **Step 1:** In `walk-summary.tsx`, compute the same fields `activity-store.ts`'s finish
  path computes, from `useGuidedWalkStore.getState().rawPoints` at save time:
  ```typescript
  import { computeTotalDistanceKm, computeSplits, computePaceSeries, computeElevationChange, computeAvgPaceSecPerKm, computeBestEfforts } from '@/lib/activity/activity-metrics'
  import { encodeRoute, simplifyRoute } from '@/lib/activity/route-encoding'

  const rawPoints = useGuidedWalkStore.getState().rawPoints
  const hasRoute = rawPoints.length > 1
  const distanceKm = hasRoute ? computeTotalDistanceKm(rawPoints) : 0
  const splits = hasRoute ? computeSplits(rawPoints) : []
  const paceSeries = hasRoute ? computePaceSeries(rawPoints) : []
  const { gainM, lossM } = hasRoute ? computeElevationChange(rawPoints) : { gainM: 0, lossM: 0 }
  const avgPaceSecPerKm = hasRoute ? computeAvgPaceSecPerKm(distanceKm, plan.totalSec) : null
  const bestEfforts = hasRoute ? computeBestEfforts(rawPoints) : {}
  const routePolyline = hasRoute ? encodeRoute(simplifyRoute(rawPoints, 5)) : ''
  ```
  Confirm the exact helper names/signatures against `lib/activity/activity-metrics.ts` before
  wiring — do not guess parameter order.
- [ ] **Step 2:** Add these fields to **both** the `store.upsertActivityLog(...)` call and the
  `store.queueMutation(...)` payload (and the web-fallback `fetch('/api/activity-logs', ...)`
  body) — the payload already has slots for every one of these fields (`activity_logs` schema
  confirmed to already have `route_polyline`/`splits`/`pace_series`/`avg_pace_sec_per_km`/
  `elevation_gain_m`/`elevation_loss_m`/`best_efforts` — check whether `best_efforts` exists as a
  column; if not already read/written by the regular activity path either, match whatever that
  path does exactly, don't invent a new column).
- [ ] **Step 3:** Typecheck + lint + dev-server smoke: complete a guided walk in the sandbox
  (GPS unavailable there, so `rawPoints` will be empty/short — confirm the `hasRoute` guards
  degrade gracefully to the pre-Task-1 behaviour, not a crash) + commit.

**Verification for Tasks 1-2:** the distance/pace/elevation math is unit-tested already
(`activity-metrics.ts`'s existing test suite) — no new pure-function tests needed here since
nothing new is being computed, just wired. **GPS itself is on-device only**
(`navigator.geolocation` in the web sandbox is unreliable/absent) — this needs the on-device
smoke run (`docs/device-smoke-checklist.md`) before it can be called done.

---

## Task 3: Live cadence from the ring (depends on AD-2)

**Files:**
- Modify: `components/guided-walk/walk-active.tsx`

Reuse AD-2's shipped pipeline directly rather than building a second gate-feed consumer:

- [ ] **Step 1:** Subscribe to the gate feed during the walk's active phase, mirroring the
  decode step `lib/activity/auto-detection-service.ts` already does:
  ```typescript
  import { subscribeGateFeed } from '@/lib/oura-ble/gate-feed'
  import { runStepsMotionDecoder, STRIDE_FREQUENCY_COLUMN, STRIDE_AMPLITUDE_FRAC_COLUMN, TOTAL_AMPLITUDE_MG_COLUMN } from '@/lib/oura-models/steps-motion-decoder'
  import { classifyGait } from '@/lib/health/gait-classifier'

  useEffect(() => {
    let unsub: (() => void) | null = null
    subscribeGateFeed((ev) => {
      if (ev.type === 'disconnect') { setRingCadence(null); return }
      const decoded = runStepsMotionDecoder({ timestamps: [Date.now()], data: [ev.columns] })
      const median = (vals: number[]) => { /* same helper as auto-detection-service.ts — consider extracting to a shared util if a third caller appears */ }
      const classification = classifyGait({
        strideHz: median(decoded.data.map(r => r[STRIDE_FREQUENCY_COLUMN])),
        strideAmpFrac: median(decoded.data.map(r => r[STRIDE_AMPLITUDE_FRAC_COLUMN])),
        totalAmplitudeMg: median(decoded.data.map(r => r[TOTAL_AMPLITUDE_MG_COLUMN])),
      })
      setRingCadence(classification.state === 'idle' ? null : classification.strideHz)
    }).then(u => { unsub = u })
    return () => unsub?.()
  }, [])
  ```
  If a third caller of this exact decode+classify snippet appears (this plan is the second,
  after `auto-detection-service.ts`), extract the shared "decode one gate-feed window into a
  classification" helper into `lib/health/gait-classifier.ts` itself instead of copy-pasting a
  third time.
- [ ] **Step 2:** Display cadence as **relative/experimental**, per AD-2's own calibration
  caveat — e.g. a simple rising/falling indicator or raw Hz reading labelled "cadence (beta)",
  not a confident "you're at 132 steps/min." Do not present it as a calibrated number until the
  on-device Hz-band calibration (tracked in AD-2's plan) lands.
- [ ] **Step 3:** Ring-disconnected fallback: when `ev.type === 'disconnect'` fires (or no gate
  feed windows have arrived for a while), fall back to a GPS-pace-derived rough cadence estimate
  (assume a typical stride length, derive from `currentPaceSecPerKm`) rather than showing
  nothing — labelled "estimated," never presented with the same confidence as the ring signal.
- [ ] **Step 4:** Typecheck + lint + commit.

**Verification:** the classify/decode call itself already has unit coverage from AD-2
(`gait-classifier.test.ts`, `gait-confirm.test.ts`) — no new pure-function tests needed for the
decode step itself; add a test only for the new GPS-pace-fallback cadence estimate if it has any
non-trivial math. Live ring cadence is on-device only (inert in the sandbox, same as all of AD-2).

---

## Task 4: Per-phase avg speed/HR stats + pace-primary UI

**Files:**
- Modify: `components/guided-walk/walk-active.tsx`, `components/guided-walk/walk-summary.tsx`

- [ ] **Step 1: Extract the shared windowing filter.** `walk-summary.tsx` already computes
  per-segment avg HR by filtering `samples` into each segment's `[startSec, endSec)` window
  (`walk-summary.tsx`'s `perSegment` computation). Extract this exact filter-by-time-window
  logic into one small shared helper (e.g. `lib/walk/segment-window.ts`,
  `samplesInWindow(samples, fromMs, toMs)`) and use it for **both** the existing HR windowing and
  the new GPS-point windowing below — don't write the same filter twice.
- [ ] **Step 2:** Compute per-segment avg pace/speed the same way per-segment avg HR is computed
  today: filter `rawPoints` (from Task 1) into each segment's time window, run
  `computeTotalDistanceKm`/`computeAvgPaceSecPerKm` on that slice.
- [ ] **Step 3:** Extend the "Per interval" summary rows to show avg pace next to avg HR for
  each fast/slow segment (`Set N · Fast — 8:45/km · 132bpm`).
- [ ] **Step 4 (pace-primary UI, per the owner decision above):** In `walk-active.tsx`, make the
  live pace readout the headline stat during a phase (alongside the phase name/countdown, at the
  same visual weight as the current bpm readout today), with HR as a secondary supporting line.
  The phase in/push/ease verdict (`classifyZone`) should evaluate pace against a target pace
  first once one exists, falling back to the existing HR-based verdict only when pace data isn't
  available yet (GPS not locked, indoor) — **do not average the two verdicts together**, since a
  strong pace signal shouldn't be diluted by a noisy HR reading (the cardiac-drift finding this
  whole decision is based on). A calibrated pace *target* per phase (vs. just a raw pace
  *readout*) needs a walker's typical/comfortable pace baseline — if that baseline doesn't exist
  yet anywhere in the app, scope target-pace calculation as its own small follow-up rather than
  inventing a number; the readout-only version (showing pace, not grading it) is still a real
  improvement and doesn't require one.
- [ ] **Step 5:** Typecheck + lint + dev-server smoke + commit.

**Verification:** the windowing helper is a pure function — unit test it directly (segments with
0, 1, and multiple points in-window; boundary points at exactly `fromMs`/`toMs`). UI changes get
a dev-server smoke pass; real pace numbers need on-device GPS.

---

## Task 5 (follow-on, not blocking Tasks 1-4): Real step counts for the walk

Cadence (Task 3) is a live *rate* signal, not a step **count**. A real step count for the whole
walk needs `lib/oura-ble/step-counter-pipeline.ts`'s `runStepCounterPipeline` — already
accuracy-confirmed on-device (a counted 100-step walk matched almost exactly) — run over the raw
BLE frames spanning exactly the walk's `[startTime, endTime]`. Two gaps block this today,
identified during the broader uplift plan's Phase G reconciliation:

1. `repo.getOuraRawSamplesByTags(userId, tags, limit)` (the only reader today) fetches the
   **newest N frames**, not a `[from, to]` range. A windowed variant is needed.
2. Running the pipeline is a real ONNX inference call, not a cheap pure function — consider
   whether it runs at walk-save time or on-demand when a detail view opens (ties into Phase F of
   the broader uplift doc, which wants a persisted walk-detail view).

**Do not build this speculatively as part of Tasks 1-4** — it's a real, separate piece of work
(a new repository method + a save-time or on-demand pipeline call) that deserves its own
scoping pass once Tasks 1-4 are shipped and the pattern for "query BLE data for an arbitrary past
window" has a concrete first use case to design against.

---

## Suggested order

1. Task 1 (GPS/map) — no dependencies, immediate visible value.
2. Task 2 (save GPS fields) — follows directly from Task 1.
3. Task 4 (per-phase stats + pace-primary UI) — depends on Task 1's `rawPoints`, not on Task 3.
4. Task 3 (live ring cadence) — do this once AD-2 (`feat/ring-cadence-activity-detection`) has
   merged to `main`; can run in parallel with Task 2/4 otherwise since it touches different code.
5. Task 5 (real step counts) — explicit follow-on, own scoping pass.

Each task is independently shippable (its own commit/PR, own version bump/changelog line).
