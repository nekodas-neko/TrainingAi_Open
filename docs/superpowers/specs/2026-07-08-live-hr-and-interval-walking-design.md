# Live HR Streaming + Interval Walking — Design Spec

**Date:** 2026-07-08
**Status:** Design approved (brainstorming), pending implementation-plan authoring.
**Author:** session 220 (continuation of the Oura direct-BLE work).

## 1. Summary

Two user-facing features built on one shared, **source-agnostic live heart-rate layer**:

1. **Live HR during a lifting workout** — a live BPM readout + rolling sparkline on the
   active-workout **rest phase** and the **exercise-summary** screen, so the user can watch
   recovery during rest. The existing **per-set end-of-session HR summary** (done-screen "HR
   Recovery" card + set/rest-shaded chart) is preserved and now populates immediately from the
   dense live data instead of waiting on the hourly ring drain.
2. **Guided interval walk (Japanese Interval Walking Training / IWT)** — a guided activity of
   3 min "fast" / 3 min "slow" blocks (default 5 sets = 30 min, fully configurable), with live
   HR effort zones, audio + haptic interval cues that keep firing while the app is backgrounded,
   and an `activity_log` written on completion.

The live-HR layer abstracts over **multiple HR sources** (Oura Ring today, a standard BLE chest
strap later) with **precedence chest-strap > ring**.

## 2. Goals / Non-goals

**Goals**
- One reusable live-HR capability that both features consume, agnostic to the HR device.
- Effort zones grounded in exercise-physiology (see §6), not guesswork.
- Reliable interval cues that survive app-switching and screen-off on the Samsung S25.
- Preserve the existing per-set end-of-session HR summary; make it faster + denser.
- Graceful degradation: with no HR device, every timer/cue/log still works.

**Non-goals**
- Beat-by-beat fidelity from the *ring* under motion (physically limited — green-LED trend only;
  see §7). A chest strap solves this and is why the source abstraction exists.
- Re-onboarding the Oura app or changing ring firmware (forbidden — breaks the BLE protocol).
- Background HR *ingestion* changes — the existing raw-samples → rollup pipeline already handles
  persistence; live streaming just delivers those frames sooner and forwards them to the UI.

## 3. Current state (what already exists)

- **Ring HR pipeline:** native foreground service (`OuraRingService.kt`) drains the ring history
  buffer ~hourly (`DRAIN_INTERVAL_MS = 3_600_000`), POSTs raw samples → server rollup
  (`aggregateOuraRawSamples`) bins into `oura_heartrate` (`source='ble'`), **15-sec bins inside
  workout windows** (`HR_WORKOUT_BIN_DS`). This is store-and-forward, **not live**.
- **Live-HR native primitive already exists but is unused by features:** `OuraBlePlugin.startLiveHr()`
  / `stopLiveHr()` (→ `SetFeatureMode(DAYTIME_HR, CONNECTED_LIVE)`), wired only to a manual button
  on the `/admin/oura-ble` debug screen. The service already forwards `ouraFrame`/`ouraFrames`
  events to JS, and a client-side decoder exists (`lib/oura-ble/decode.ts`).
- **Done-screen per-set HR summary:** `components/workout/done-screen.tsx` "HR Recovery" card →
  `/api/oura/hr-data` → `getHrForWindow` + `analyseHrRecovery` (peak / HRR1 / adequate per set) +
  `HrRecoveryChart` with set/rest shading (added session 220).
- **HR time-series table:** `oura_heartrate (user_id, timestamp, bpm, source)`, unique on
  `(user_id, timestamp)`, already has a `source` column.
- **Effort-model inputs already in the DB:** `users.dateOfBirth` (→ age), `resting_heart_rate`
  (body_metrics / Oura), and an existing `hrMax` / `hrMaxObserved` concept (body-battery slice).
- **Activities:** `activity_logs` (type walk/run/hiit, avg_hr, max_hr, duration, etc.), with
  auto-detection of walks/runs. No guided/timed activity exists yet.
- **Backlog item absorbed:** "Live exercise HR via a standard BLE chest strap" (implementation
  backlog) — this spec supersedes it as the `ChestStrapSource` in the source abstraction.

## 4. Architecture overview

Three parts + a source abstraction:

```
            ┌─────────────────────────────────────────────┐
            │            LiveHrSource (interface)          │
            │   getBpm()/subscribe()/connectionState       │
            └───────────────▲───────────────▲──────────────┘
                            │               │
             OuraRingSource │               │ ChestStrapSource (later)
        (native CONNECTED_LIVE + ouraLiveHr)│ (BLE HRS 0x180D / 0x2A37)
                            │               │
          precedence: chest strap > ring > none
                            │
        ┌───────────────────┴────────────────────┐
        │              useLiveHr() hook           │  (foreground display)
        └───────▲───────────────────────▲─────────┘
                │                        │
   Part 2: lifting rest/summary   Part 3 UI mirror of ↓
                                         │
                       Part 3: native GuidedSessionService
                       (interval timer + cues + notification,
                        reads active source, survives background)
```

## 5. Part 1 — Source-agnostic live-HR layer

### 5.1 `LiveHrSource` interface (JS)
```
interface LiveHrSample { bpm: number; at: number; rr?: number[] } // rr = RR intervals if available
interface LiveHrSource {
  id: 'oura_ble' | 'chest_strap'
  connectionState(): 'connected' | 'connecting' | 'disconnected'
  subscribe(cb: (s: LiveHrSample) => void): () => void
  start(): Promise<void>   // begin live measurement
  stop(): Promise<void>
}
```

- **OuraRingSource** (Plan 1): `start()` → plugin `startLiveHr()`. New native event **`ouraLiveHr`**
  emits decoded `{ bpm, ts }` so JS need not decode every raw frame. `stop()` → `stopLiveHr()`.
- **ChestStrapSource** (Plan 3): generic Capacitor BLE plugin (`@capacitor-community/bluetooth-le`)
  → connect to HR Service `0x180D`, subscribe Heart Rate Measurement `0x2A37` (parses flags byte
  for 8/16-bit BPM + optional RR intervals). No reverse-engineering; standard GATT.

### 5.2 Source manager + precedence
- A `liveHrManager` picks the **active source**: chest strap if connected & streaming, else ring,
  else none. Exposes a single stream to consumers. Emits `stale` if no sample within N seconds
  (default 8s) so the UI can dim.

### 5.3 `useLiveHr()` hook (JS)
- Subscribes to the manager while mounted; returns `{ bpm, at, sourceId, connected, stale }`.
- Pure display concern; owns no persistence.

### 5.4 Persistence (reuse, minimal new code)
- Ring live frames continue to flow through the **existing raw-samples → rollup** path (delivered
  sooner because the link is live), landing in `oura_heartrate` (`source='ble'`, 15-sec workout
  bins). Chest-strap samples POST to a small ingest that upserts `oura_heartrate` with
  `source='chest_strap'`.
- **Merge precedence on read:** when a window has both `chest_strap` and `ble` rows, the summary/
  chart prefer `chest_strap`. (Implemented in the read/aggregation, not by deleting rows.)
- On workout/walk completion, trigger the rollup/aggregation so `oura_heartrate` is populated
  promptly (no waiting for the hourly cycle) — feeding the per-set summary immediately.

## 6. Effort model — HR-reserve (Karvonen)

Chosen from the research (§References):
- The original IWT protocol targets **≥70% VO₂peak (fast)** and **≤40% VO₂peak (slow)**.
- **%HRR (heart-rate reserve / Karvonen) tracks %VO₂-reserve ~1:1** (slope 1.00, intercept ≈0),
  whereas %HRmax diverges — worst at the low (40%) end. ACSM recommends Karvonen for VO₂-matched
  prescription.

**Zone math** (single source of truth in `lib/`, per the One-Formula rule):
```
target(pct) = restingHr + pct * (maxHr - restingHr)
fastTarget  = target(0.70)   // "fast" block lower bound
slowTarget  = target(0.40)   // "slow" block upper bound
```
- `maxHr` = `hrMaxObserved` if present, else **Tanaka `208 − 0.7·age`** from `dateOfBirth`, else a
  sane default with a "estimate" flag surfaced in the UI.
- `restingHr` = latest resting HR (body_metrics / Oura), with a default fallback.
- **Zone classification** for the live cue: `below` / `in` / `above` the current block's target
  band (fast block: at-or-above `fastTarget` = in; slow block: at-or-below `slowTarget` = in).
- **The timer is never gated by HR** — HR is a cue only, resilient to dropouts and true to how IWT
  was validated (perceived effort in the field).

## 7. Part 2 — Lifting live HR

- `useLiveHr()` on the **active-workout rest phase** and **exercise-summary** screen: compact live
  BPM + short rolling sparkline (memoized leaf, reads its own selector — per the render-discipline
  rules; no 1 Hz whole-screen re-render).
- `start()` the active source when the workout goes active; `stop()` on complete.
- **Preserved unchanged:** the done-screen per-set HR summary (peak / HRR1 / adequate) + the
  set/rest-shaded `HrRecoveryChart`, now fed by dense live data.
- **Ring caveat surfaced honestly:** under motion the ring is a green-LED trend, not beat-by-beat,
  and its PPG can power-gate at rest; the UI shows "—"/stale rather than implying false precision.
  (A chest strap removes this caveat.)

## 8. Part 3 — Guided interval walk

### 8.1 Native `GuidedSessionService` (foreground service)
- Owns the interval **state machine**: optional warm-up → `[fast N / slow N] × sets` → optional
  cool-down. Block lengths + set count configurable (default fast=slow=3 min, 5 sets).
- Fires **audio + haptic cues** at each transition (distinct fast vs slow cue; optional TTS
  "fast"/"slow"). Reads the **active HR source** for the live zone.
- Maintains an **ongoing notification** (phase, time remaining, live BPM, in/out of zone, set
  progress) so the session is legible and cues fire while backgrounded / screen-off.
- Survives app-switch + screen-off (foreground service, like `OuraRingService`); optional wake-lock.

### 8.2 JS UI (Activity area — new "Interval Walk")
- **Config:** presets (default 5×3/3; a shorter "quick" 3×3/3) **+ full custom** (sets, fast len,
  slow len, warm-up/cool-down toggles).
- **Live screen:** current phase, countdown, HR ring with the target band, zone cue
  (in-zone / push / ease), set progress. **Mirrors the native service state** so it's correct after
  returning from background.
- Start/pause/resume/stop controls.

### 8.3 Completion + save
- Write an `activity_log` (type walk) with duration, avg/max HR, **interval metadata** (structure +
  per-interval avg HR / time-in-zone) and the HR trace. Invalidate activity caches via a cache group.
- **Post-walk summary:** time-in-zone, per-interval avg HR, and the HR trace with **fast/slow
  shading** — the set/rest-shading component generalised (fast blocks shaded like "working sets").

## 9. Data model

- **HR series:** reuse `oura_heartrate` with `source` provenance (`ble` | `chest_strap` | future).
  No rename now (optional future cleanup); table already carries `source`.
- **Chest-strap ingest (Plan 3):** a small route upserting `oura_heartrate (source='chest_strap')`
  with a Zod schema at creation (per the ingest-route rule); a paired-device record for the strap.
- **activity_logs:** add interval-walk metadata (structure + per-interval/zone summary) — either a
  JSONB column or a child table; decided in the plan. Every new column added to *all* row→object
  mappers in the same PR (per the missed-field rule).
- **Migrations:** number-claimed against the directory + open PRs; local SQLite mirror registered in
  `RECONCILE_TABLES`/`RECONCILE_COLUMNS` in the same commit.

## 10. Native vs JS split (runtime reality)

- **Kotlin / APK rebuild required (on-device is the only real verification):** the `ouraLiveHr`
  event, `GuidedSessionService` (timer + cues + notification + background survival), and later the
  chest-strap BLE plugin wiring.
- **JS/server (ships via Railway, no rebuild):** `LiveHrSource`/manager/`useLiveHr`, zone math,
  lifting rest/summary UI, walk config + live UI + save, post-walk summary, ingest routes, cache
  wiring. `startLiveHr`/`stopLiveHr` already exist in the current plugin surface.

## 11. Error handling / graceful degradation

- No source connected, or HR stale → BPM "—", zone cue neutral; timer, cues, and logging proceed.
- Source hand-off (strap connects mid-session) → manager switches active source; consumers unaffected.
- Ring power-gating at rest is expected, not an error — surfaced as stale, never a crash.
- All new routes follow the project route rules: Zod schema at creation, SWR headers on aggregate
  GETs, and the standard rate limit matched to sibling routes.

## 12. Testing & verification

- **JS unit:** Karvonen zone math + zone classification (boundary cases at fast/slow thresholds),
  Tanaka max-HR fallback selection, interval state-machine transitions (JS mirror), HR-trace
  fast/slow shading.
- **Server:** activity_log write + HR-window merge precedence (chest_strap > ble) — a vitest against
  the local DB (pattern already used for the workout HR chart verification).
- **On-device (authoritative — sandbox cannot exercise BLE/native):** live HR appears on rest/summary
  and the walk screen; interval cues fire while backgrounded and screen-off; source precedence; ring
  battery/connection behaviour; end-of-session per-set summary populated promptly. Run
  `docs/device-smoke-checklist.md`; any unverified path gets a Known-Issues row.

## 13. Sequencing → implementation plans

- **Plan 1 — Shared live-HR layer + lifting feature.** Source abstraction (ring only), `ouraLiveHr`
  native event, `useLiveHr`, lifting rest/summary display, prompt end-of-session summary. Smaller;
  validates the live-HR primitive on-device. (Native: `ouraLiveHr` event → APK rebuild.)
- **Plan 2 — Guided interval walk.** `GuidedSessionService` (native), config + live UI, Karvonen
  zones, cues, save + post-walk summary. Builds on the validated layer. (Native → APK rebuild.)
- **Plan 3 — Chest-strap source (when acquired).** `ChestStrapSource` (BLE HRS 0x180D), pairing UI,
  precedence, ingest. Absorbs the existing chest-strap backlog item.

Each plan becomes a `docs/superpowers/plans/` doc + a backlog entry per the project's plan-then-build
protocol. Native parts cannot ship from the sandbox (compile-gated only) — they need an owner APK
rebuild + on-device pass.

## 14. Open questions / risks

- **Does `CONNECTED_LIVE` override the ring's worn-idle PPG power-gating** enough to show live HR
  during lifting *rest* (stationary)? Unknown until on-device — the honest fallback is "—"/stale, and
  the chest strap is the definitive fix. (Validate early in Plan 1.)
- **Ring battery cost** of holding `CONNECTED_LIVE` for a whole session — measure on-device; if steep,
  consider limiting live mode to rest windows or recommending the strap for long sessions.
- **activity_log interval metadata shape** (JSONB vs child table) — decide in Plan 2.

## 15. References

- Interval walking protocol (≥70% / ≤40% VO₂peak, 3-min blocks, 5–10 sets):
  https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0285762
- IWT origin & outcomes (Nose & Masuki, Shinshu Univ.):
  https://www.sciencedaily.com/releases/2019/11/191101093903.htm
- %HRR ≈ %VO₂R (~1:1), superior to %HRmax:
  https://pmc.ncbi.nlm.nih.gov/articles/PMC4831852/
- Karvonen/HRR is ACSM-recommended for VO₂-matched prescription:
  https://fitnessrec.com/articles/karvonen-formula-for-athletes-personalized-heart-rate-training-zones
- BLE Heart Rate Service `0x180D` / Heart Rate Measurement `0x2A37` (chest-strap standard).
