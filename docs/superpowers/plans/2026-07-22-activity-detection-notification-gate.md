# Fix: "Activity detected" walk/run notification fires too eagerly (garage false positives)

**Source:** owner report 2026-07-22 — the "Activity detected · Recording your walk or run…"
heads-up fires during stationary garage weight-training. Branch:
`claude/auto-exercise-sensitivity-b53ynd`.

## Problem

The passive walk/run detector posts the **"Activity detected"** heads-up notification while the
owner is lifting in their garage and not going anywhere. No walk is actually being saved — the
session is later discarded by the end-of-session quality gates — but the notification has already
fired, so the owner gets a false "Recording your walk or run…" ping (plus the GPS foreground
service spins up) every time they train.

## Root cause

The notification fires at session **start**, on the *first* GPS point that clears a low rolling-speed
bar, **before** any of the real quality gates run. The gates that would reject a garage "walk"
(distance / duration / pace) only run at session **end**.

Chain (`lib/activity/`):

1. **Trigger — GPS wakes up.** The gate (`motion-gate.ts`) is armed by either the phone's
   significant-motion sensor (`motion-detection.ts`, `armMotionTrigger`) or an Oura-ring "walking"
   gate window (`auto-detection-service.ts` `subscribeGateFeed`). The phone sensor is *any-motion*,
   not walk-specific — lifting or a couple of steps between rack and bench trips it → gate goes
   `idle → probing` → GPS watcher starts.
2. **Confirm — notification fires.** In `auto-detection-service.ts` `onPoint()`, each GPS point
   computes a rolling average speed over the last `SPEED_BUFFER_SIZE` (5) points. The instant that
   average is `>= MIN_MOVE_SPEED_MS` (**0.8 m/s ≈ 2.9 km/h**), it calls `store.startSession()` and
   immediately `notifyActivityDetected()` (`auto-detection-service.ts:207-213`). There is **no**
   minimum-distance, minimum-duration, or GPS-accuracy check at this point.
3. **Why the garage clears the bar.** Indoor/garage GPS is multipath-noisy: the fix drifts and the
   reported position jumps 5–20 m between readings even while stationary (the watcher's
   `distanceFilter: 5` doesn't help — those phantom jumps *are* ≥5 m, so points keep streaming). A
   few seconds of that drift reads as 3–5 km/h, which clears the 0.8 m/s bar and fires the ping.
4. **The real gates run too late.** `auto-detection-store.ts` `endSession()` applies the proper
   quality gates — `MIN_DISTANCE_M` (750 m), `MIN_AVG_SPEED_MS` (2.5 km/h), `MIN_DURATION_SEC`
   (7 min), plus the P80 motorised filter (`detection-thresholds.ts`). A garage session fails these
   and is correctly discarded, so **nothing is saved** — but only *after* the notification already
   fired.

So the bug is specifically the **notification timing**, not what gets saved. The detection/save
behaviour is already correct and must not change.

## Fix

**Gate the notification on the same lower-bound quality signal the *save* path uses, before firing
it — don't fire on the first qualifying point.** Keep starting the session immediately (so the route
is still captured from its true start), but defer `notifyActivityDetected()` until the in-progress
session has accumulated enough evidence that it's a real walk/run.

Concretely, in `lib/activity/auto-detection-service.ts`:

1. **Remove** the `notifyActivityDetected()` call from the first-confirm branch in `onPoint()`
   (`:207-213`), where it currently fires the moment `store.startSession()` is called.
2. **Add a "notified this session" latch** (module-level `let activityNotified = false`, reset to
   `false` in `startGps()` and in `stopAutoDetection()` alongside the other per-session resets).
3. **Fire the notification once the live session crosses a sustained-movement threshold.** After
   `store.addPoint(point)` in the tracking branch, when `!activityNotified`, compute the
   in-progress session's accumulated distance and elapsed time from `store.sessionPoints` /
   `store.sessionStartMs` and only then fire:
   - distance so far `>= NOTIFY_MIN_DISTANCE_M` (**200 m** — well above indoor GPS drift, well below
     the 750 m *save* floor so a genuine walk still pings early), **and**
   - elapsed so far `>= NOTIFY_MIN_ELAPSED_SEC` (**90 s** — filters the brief "walked to the bin"
     move and gives GPS time to settle),

   then `void notifyActivityDetected()` and set `activityNotified = true`.
4. Define `NOTIFY_MIN_DISTANCE_M` and `NOTIFY_MIN_ELAPSED_SEC` as named constants at the top of
   `auto-detection-service.ts` next to the existing threshold constants, with a one-line comment
   explaining they gate only the *notification* (the save gates in `detection-thresholds.ts` remain
   authoritative for what's persisted). Reuse the existing `haversineDistanceKm` /
   `computeTotalDistanceKm` helper rather than re-implementing distance.

Notes / invariants:
- **Do not touch** `MIN_MOVE_SPEED_MS`, the gate reducer (`motion-gate.ts`), the save gates in
  `auto-detection-store.ts`/`detection-thresholds.ts`, or the GPS watcher — behaviour of what gets
  *saved* is unchanged; only the notification's timing moves.
- `clearActivityDetected()` already fires from `stopGps()` and covers the "session ended / probe
  timed out" cleanup; because we now may never have posted the ping, `clearActivityDetected()` must
  stay a safe no-op when nothing was scheduled (it already is — `LocalNotifications.cancel` of an
  absent id is harmless).
- The latch must reset per session (in `startGps()`), so a *second* genuine walk in the same
  detection run still notifies.
- Keep the notification a single one-off heads-up (unchanged `notifyActivityDetected` in
  `lib/notifications.ts`); the persistent "recording" chip is the GPS foreground service's own
  notification and is out of scope.

### Optional hardening (only if the above proves insufficient on-device — do NOT ship speculatively)

- Raise `MIN_MOVE_SPEED_MS` from 0.8 → ~1.1 m/s (≈4 km/h) so GPS jitter alone is less likely to open
  a session at all. This changes what gets *probed/saved*, so it's a behaviour change — leave it out
  of the first PR and only revisit if garage pings persist after the notification gate lands.
- Add a GPS-accuracy filter that ignores low-accuracy points in the speed average. Requires plumbing
  `accuracy` through `RoutePoint` from the watcher — larger change, separate PR if needed.

## Files touched

- `lib/activity/auto-detection-service.ts` — move `notifyActivityDetected()` behind the
  distance+elapsed latch; add `NOTIFY_MIN_DISTANCE_M` / `NOTIFY_MIN_ELAPSED_SEC` constants + the
  `activityNotified` latch (reset in `startGps()` / `stopAutoDetection()`).
- (No change to `lib/notifications.ts`, `lib/activity/motion-gate.ts`,
  `lib/stores/auto-detection-store.ts`, or `lib/activity/detection-thresholds.ts`.)

## Verification

- `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build` green.
- **Add/extend a unit test** for the notification gate. The cleanest testable seam is a small pure
  helper — extract `shouldNotifyActivity({ distanceM, elapsedSec, alreadyNotified })` (or test the
  distance/elapsed predicate directly) so the gate logic is unit-tested without a device:
  - stationary drift (e.g. 40 m over 120 s) → **no** notification;
  - genuine walk (e.g. 220 m over 100 s) → notification fires exactly once;
  - once `alreadyNotified` is true, further points don't re-fire.
- **Device gate (authoritative — this is APK-only behaviour).** `getLocalStore`/Capacitor
  notifications + the significant-motion sensor + real GPS do not run in the web/dev sandbox, so
  `pnpm dev` cannot exercise the real path. Per CLAUDE.md Canonical Runtime, the merge gate is the
  on-device smoke run **or** a Known-Issues row:
  1. On the S25 APK, do a stationary weight session in the garage → confirm **no** "Activity
     detected" ping fires (previously it did).
  2. Take a real short walk (≥ ~200 m) → confirm the ping fires once, ~90 s / 200 m in, and the
     session still saves as before.
  If no device is available in-session, ship with a `projectOverview.md` Known-Issues row marking
  the change **web-verified only, on-device notification-timing not yet confirmed**.

## Rollback

Single-file, additive-then-relocated change (a moved call + two constants + one boolean latch).
Revert the commit to restore the fire-on-first-point behaviour; no data, migration, or schema
involved.
