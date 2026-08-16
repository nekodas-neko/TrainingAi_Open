# Quiet the Persistent "Scale Connected — Listening" Notification

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal (owner request):** the owner doesn't need to be told the scale is "connected — listening
for weigh-ins" — that ongoing status notification sits in the shade with no actionable value
(unlike "Weigh-in logged", which is the actual event they care about). Make it stop showing up as
a normal notification while still satisfying Android's foreground-service requirement.

**Tech Stack:** Kotlin, Android `NotificationManager`. Native-only — **needs a new APK**, no
Railway-only path exists for this.

---

## Current state

`ScaleBleService.kt` runs `START_STICKY` (persistent, since 2026-08-01 — "this is now a persistent
connection, not a bounded one-shot task per scan hit") and shows an ongoing notification via
`startInForeground()`/`updateNotification()` on the `"scale-ble"` channel
(`NotificationChannel(CHANNEL_ID, "Scale sync", NotificationManager.IMPORTANCE_LOW)`,
`ScaleBleService.kt:216-233`). Its text cycles through "Scale nearby — connecting…" →
"Connected — listening for weigh-ins" (`:298`, `:432`) and back, for as long as the service is
alive — which, given `START_STICKY`, is effectively continuously. `IMPORTANCE_LOW` still shows a
persistent status-bar icon and a normal (if silent) shade entry — visible exactly like any other
notification, which is what's being flagged as unwanted.

Android requires **some** notification for a running foreground service — this can't be removed
outright while the service holds a live/opportunistic connection loop. What can change is how
intrusive it is.

## Fix

### Task 1: Drop the ongoing "connected/listening" channel to `IMPORTANCE_MIN`

**Files:**
- Modify: `android/app/src/main/java/com/trainingai/app/scale/ScaleBleService.kt`

- [ ] Change the `CHANNEL_ID` ("Scale sync") channel from `IMPORTANCE_LOW` to `IMPORTANCE_MIN` —
  this drops the status-bar icon and collapses the entry to the bottom of the shade (no user
  action needed to dismiss/mute it), while the service itself keeps running exactly as before.
  `IMPORTANCE_MIN` is a channel-level change; `NotificationChannel` objects are otherwise
  immutable once created; on a device that already has the "Scale sync" channel from before this
  change, Android will **not** retroactively lower an existing channel's importance — bump the
  channel id (e.g. `scale-ble-v2`) so the new importance actually takes effect for existing
  installs, and note this needs testing on an upgraded (not fresh) install.
- [ ] Leave the four one-shot event channels — `SKIPPED_CHANNEL_ID` ("Body composition skipped"),
  `LOGGED_CHANNEL_ID` ("Weigh-in logged"), `FAILED_CHANNEL_ID` ("Weigh-in not captured"), and
  `PENDING_CHANNEL_ID` ("Unusual weigh-ins", already `IMPORTANCE_HIGH`) — **untouched**. Those are
  real events the owner asked to be told about; only the continuous "is it connected right now"
  status ping is unwanted noise.

### Task 2: Sibling-surface check (don't silently fix only one of three identical services)

**Files (read-only for this task — no change without asking):**
- `android/app/src/main/java/com/trainingai/app/oura/OuraRingService.kt`
- `android/app/src/main/java/com/trainingai/app/polar/PolarStrapService.kt`

- [ ] Both of these run the same shape of persistent foreground service with the same
  `IMPORTANCE_LOW` "Connected" notification (confirmed in the same screenshot that reported this
  bug — "TrainingAI · Oura Ring — Connected · 37% battery" was showing alongside the scale one).
  This plan only changes the scale channel because that's what was explicitly reported — **do not
  change Oura/Polar in this PR**, but flag it back to the owner once this ships: "Oura Ring and
  chest-strap show the same kind of persistent 'Connected' notification — want those quieted the
  same way, or is that one useful to you?" Don't guess the answer.

### Task 3: Verification

- [ ] New APK required (native manifest-adjacent change, no Kotlin logic change beyond the
  importance level). Build via CI, install on the S25.
- [ ] Confirm the scale's ongoing notification no longer shows a status-bar icon and sits
  collapsed at the bottom of the shade (or is fully hidden until the shade is expanded, depending
  on OEM/Samsung One UI's exact `IMPORTANCE_MIN` treatment — verify the actual behavior on this
  device, One UI sometimes differs from stock AOSP here).
- [ ] Confirm "Weigh-in logged" still shows normally after an actual weigh-in — this task must not
  regress the notification the owner actually wants.
- [ ] Confirm the scale still connects and logs weigh-ins correctly — this is a notification-only
  change, but verify the service itself wasn't accidentally affected.
