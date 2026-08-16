# Always-on chest-strap HR — strap wins whenever worn, not just during exercise

**Date:** 2026-07-19
**Branch:** `feat/always-on-chest-strap-hr`
**Status:** Phase 1 SHIPPED v1.177.0; Phase 2 (native foreground service) SHIPPED v1.180.0 — both device-verification-gated (BLE is APK-only).

## Problem / motivation

The owner wears the Polar H10 chest strap as the high-fidelity HR source. Today the strap's
BLE connection is **gated to active screens** — `getLiveHrManager().start()`/`.stop()` is
called only by `components/workout-screen.tsx` (active/exercise-summary modes),
`components/guided-walk/walk-active.tsx`, and `components/fitness-tests/test-active.tsx`.
Outside those screens the strap is not connected, so its HR is never captured.

The original rationale for gating was battery. But that rationale does **not** apply to the
strap: the H10 senses and broadcasts HR **whenever it is physically worn** (electrode
contact), regardless of whether our app holds a BLE connection. There is no BLE command to
power-gate its sensor by activity — the only lever on its CR2025 coin cell is physically
removing it. So gating the *connection* to workouts saves the strap nothing.

**Owner decision (2026-07-19):** since we cannot battery-gate the strap anyway, connect to
it whenever it is worn and use its HR over the Oura ring **all day, everywhere in the app** —
not just during exercise. The ring becomes pure fallback for when the strap is off/out of
range.

## Goals

1. Whenever the strap is **paired + connected + worn**, its HR is the live source app-wide,
   preferred over the ring (precedence already exists — see below).
2. Strap HR is captured continuously (subject to the phase limits below), including outside
   workout/walk/test screens.
3. **No new drain on the Oura ring.** The ring's aggressive live path must stay workout-only.

## Non-goals

- **Strap accelerometer as an activity/wake trigger** (owner: no). That would require the
  unbuilt PMD ACC decoder (`polar-h10-ble` skill §3) plus a persistent all-day strap
  connection — cost with no matching benefit, since the phone significant-motion sensor +
  Oura ring gate-feed already detect walks cheaply (`lib/activity/auto-detection-service.ts`).
  Detection trigger order stays **ring > phone** as it is today.
- Changing the strap's own coin-cell behaviour (not controllable).

## What already exists (do not rebuild)

- **Precedence.** `lib/live-hr/manager.ts` `activeSourceId()` returns the first
  non-disconnected source; sources are registered `[ChestStrapSource, OuraRingSource]`, so
  the strap already wins whenever its `connectionState()` is `connected`. The strap reports
  `disconnected` while not GATT-connected **or** not worn (`chest-strap-source.ts:46-51`), so
  the ring auto-covers gaps. **No precedence change needed.**
- **Worn-gating.** `ChestStrapSource.updateWorn` flips `worn=false` after
  `NOT_WORN_GRACE_MS` (15 s) of "off chest", which demotes it to the ring. Reuse as-is.
- **Read-path precedence.** `getHrForWindow` already prefers `chest_strap` over `ble` per
  time bucket (per the `polar-h10-ble` skill §1).
- **Ingest.** `POST /api/hr-ingest` → `oura_heartrate` with `source='chest_strap'`.

## The core design change: decouple the two source lifecycles

Today `manager.start()` starts **every** source together, and `OuraRingSource.start()` is
**aggressive** — it calls `startLiveHr()` (CONNECTED_LIVE) and fires a DHR burst every 10 s
(`oura-ring-source.ts:120-126`). So naïvely "keep the manager running all day" would keep the
**ring** in its 10 s-burst live loop all day and flatten the ring battery. That is the trap.

The ring already records HR to its own history whenever worn, **independent of the manager**
(the normal Oura ambient pipeline). The manager's aggressive ring path is a workout-only
escalation. So the model becomes:

| Source | Ambient (all day) | Workout / walk / test |
|---|---|---|
| **Chest strap** | **connected + streaming** (always-on) | connected + streaming (same) |
| **Oura ring (live)** | **off** (no `startLiveHr`, no burst loop) | aggressive live, **only if strap absent** |
| **Oura ring (history)** | unchanged background pipeline | unchanged |

Concretely, the manager needs an **ambient mode** that starts *only* the strap source, and a
**workout mode** (today's behaviour) that additionally escalates the ring. Proposed manager
surface (additive, no change to existing `start()/stop()` callers' semantics):

- Add per-source **role tags** so the manager can start a subset. Simplest: `startAmbient()`
  starts only sources flagged `ambient: true` (strap), `stop()`/`start()` unchanged for the
  workout path. Reconcile double-start: if ambient already connected the strap, the
  workout-path `start()` must be idempotent per source (guard `running`/connection state)
  rather than re-connecting.
- The ring stays out of ambient entirely. During a workout, escalate the ring **only when
  `activeSourceId() !== 'chest_strap'`** (strap absent/not worn) — otherwise the strap covers
  and the ring burst loop is pure waste.

> Implementation note: keep the change **additive and idempotent**. `ChestStrapSource.start()`
> already no-ops cleanly when re-entered mid-connection is *not* guaranteed — add a `running`
> guard so ambient+workout starts don't double-connect or double-arm the flush timer.

## Phase 1 — foreground always-on (JS only, ships via Railway)

Delivers strap-preferred HR whenever the **app is foregrounded** and the strap is worn.
Background/screen-off is Phase 2.

1. Manager: add the ambient-mode surface above; make per-source start idempotent; gate the
   ring escalation on strap-absence.
2. App-level provider (e.g. a client component mounted in the root layout / an existing
   top-level provider) that calls `manager.startAmbient()` on mount when a strap is paired
   (`getPairedStrap()` non-null) and `manager.stop()`/ambient-stop on unmount. Must **not**
   fight the workout screens' own `start()/stop()` — those escalate/de-escalate the ring on
   top of the always-on strap.
3. Ingest volume: all-day 1 Hz strap streaming is far more than workout-only. **Before
   shipping**, decide the ambient sample cadence: either (a) downsample ambient (non-workout)
   strap samples to ~1 sample / 30–60 s at the client before `POST /api/hr-ingest`, keeping
   full 1 Hz only during workouts, or (b) roll up server-side. Prefer (a) — smaller writes,
   and it mirrors the ring's 5-min-binned ambient rows. Coordinate with the BLE
   rollup/retention plan (`2026-07-19-ble-rollup-efficiency-and-retention.md`) so
   `oura_heartrate` growth stays bounded.
4. Verify on `pnpm dev` that nothing regresses in the workout/walk/test live-HR paths (the
   ring escalation still runs when no strap is paired — the sandbox has no strap, so this is
   the exercised path). **BLE itself is not verifiable in the sandbox.**

**Phase 1 limitation to document as a Known Issue:** the strap source is JS in the WebView;
Android suspends the WebView when backgrounded, so Phase 1 captures strap HR reliably only
while the app is foregrounded (screen on). This does **not** yet meet the "phone in pocket,
screen off, intermittent walks all day" goal — that is Phase 2.

## Phase 1 add-on — "walk in progress" notification (JS only, ships via Railway)

Independent of the strap HR work but requested alongside it (owner, 2026-07-19). Today the only
activity-detection surface is the **in-app** `ExerciseDetectedCard` ("Walk detected"), shown
*after* a session finalizes (`components/activity/exercise-detected-card.tsx`, reads
`pendingSessions`). There is **no** live notification that a walk was detected and is recording.
(The background-geolocation foreground-service chip `backgroundMessage: 'Tracking your activity'`
in `lib/activity/gps-tracking.ts:31-32` does **not** count — GPS turns on at the *probing* stage,
before a walk is confirmed, so it also shows during false alarms.)

**Design:** fire a dedicated **ongoing** local notification at the confirmed-walk transition —
i.e. where `store.startSession()` is called and the gate goes `probing → tracking`
(`lib/activity/auto-detection-service.ts:203-209`). Never on a probe (so false alarms don't
notify). Clear it on `sessionEnded` (`endSession()`), on the store's stale-session finalize path
(`auto-detection-store.ts` `onRehydrateStorage`), and reconcile-cancel on app start so a killed
session can't strand it.

- Add a helper in `lib/notifications.ts` (mirror `scheduleRestCompleteNotification`): a stable
  reserved id (e.g. `9101`), `ongoing: true`, its own channel, `LocalNotifications` guarded to
  native (web no-ops). Cancel helper for the end/reconcile paths.
- Wire from the auto-detection service at the same transition points that drive the gate.
- **Works in the background** (screen off): the JS service is kept alive while a walk records by
  the geolocation plugin's foreground service (that's how GPS points keep arriving), so scheduling
  at `startSession()` runs even screen-off. **No native rebuild** — this is why it lands in Phase 1.
- **Reconcile notification clutter:** the geolocation "Tracking your activity" chip coexists with
  this one (and later the Phase 2 strap FG-service chip). Prefer rewording the geolocation copy
  over stacking multiple ongoing notifications; decide the final set during implementation.

Verification: `pnpm dev` exercises the gate transitions (the notification call itself no-ops on
web); the on-device firing (confirmed-walk → chip appears, walk-end → clears) is APK-only and
gets a Known-Issues row until smoked on the S25.

## Phase 2 — native background foreground-service (owner APK rebuild)

Promote the strap to a **native foreground service**, mirroring the Oura ring's
`android/app/src/main/java/com/trainingai/app/oura/OuraRingService.kt`, so the BLE connection
and 0x2A37 notifications survive backgrounding and run all day.

- New Kotlin foreground service holding the standard-GATT HR connection (no PMD, no auth — the
  strap uses the standard Heart Rate Service, far simpler than the Oura protocol). Persistent
  notification (required for an Android FG service), started when a strap is paired.
- Bridge decoded HR/RR up to JS (or POST to `/api/hr-ingest` natively) with the same
  worn-gating and re-buffer-on-failure semantics as `chest-strap-source.ts`.
- Reconcile precedence with the ring's own service so the two coexist (they already coexist at
  the `LiveHrSource` layer; the FG-service layer must not fight over the BLE adapter).
- **Kotlin change → compile-gated only in the sandbox; requires an owner APK rebuild**
  (`npx cap sync android && ./gradlew assembleDebug`). On-device is the only real verification.
- Phone-battery cost: a persistent FG service + all-day BLE connection is a real phone-battery
  draw (accepted tradeoff for all-day strap HR). Surface strap battery % (already read at pair
  time in `chest-strap-pairing.tsx`) so a dying coin cell is visible.

## Risks / verification surfaces NOT exercised in the sandbox

- **BLE (both phases):** `@capacitor-community/bluetooth-le` and the native FG service are
  device-only. Only the manager lifecycle logic and the `0x2A37` parser are unit-testable.
- **Ring-drain regression:** the whole point is to *not* run the ring live loop all day —
  verify on-device (ring battery over a day) that ambient mode never escalates the ring.
- **`oura_heartrate` growth:** confirm the ambient downsample actually caps write volume
  before enabling all-day streaming on-device.
- Per Canonical Runtime rules, both phases need the on-device smoke run or an explicit
  `projectOverview.md` Known-Issues row marking them not-yet-device-verified.
