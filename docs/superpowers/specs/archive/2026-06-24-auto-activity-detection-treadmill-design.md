# Auto Activity Detection + Treadmill Session Design

**Date:** 2026-06-24  
**Status:** Approved

---

## Overview

Two features that extend the existing activity tracking system:

1. **Auto Activity Detection** — phone-native background detection of walks/runs with GPS route capture, surfaced as an "Exercise Detected" review card. Oura Ring acts as fallback for sessions where the phone wasn't present.
2. **Treadmill Session** — existing activity session flow adapted for treadmill: timer-based session with manual distance entry on completion, auto-calculated steps (from height + distance), and Oura HR pulled for the session window.

---

## Feature 1: Auto Activity Detection

### Detection Architecture

Two-tier detection with phone-native as primary:

**Primary — Phone (Android Activity Recognition API):**
- Google's Activity Recognition API monitors device motion via accelerometer in batch mode (~0.5% battery/hr)
- Triggers GPS when `WALKING` or `RUNNING` detected continuously for 60+ seconds
- Stops GPS when `STILL` or `IN_VEHICLE` detected for 3+ continuous minutes
- GPS uses existing `@capacitor-community/background-geolocation` at `distanceFilter: 5m`
- Result: GPS is only hot during actual movement, not 24/7

**Fallback — Oura Ring (post-sync):**
- After each Oura sync, check `GET /v2/usercollection/workout` for detected workouts on days with no phone-tracked session
- If found: create a pending session from Oura data (duration, distance, calories, intensity) with no GPS route
- Used only for the ~10% case where the phone wasn't with the user

**Why phone-native primary over Oura primary:**
- Real-time: Activity Recognition fires immediately → GPS starts from the first step → full route captured
- Single confirmation: only our app prompts the user (no double-confirm in Oura app + our app)
- No cloud roundtrip lag (Oura webhook path: ring → Oura app → cloud → webhook → our server = 2–30 min delay)

### Background Service Lifecycle

- Service starts when app launches (or is restored to background)
- Runs as Android foreground service with a silent/minimal notification (required by OS)
- Persists across app backgrounding; stops only if app is explicitly killed
- On app kill: pending GPS points and in-progress session flushed to SQLite before service stops (best-effort)

### Pending Session Storage

Detected sessions stored in a new `pending_activity_sessions` SQLite table (on-device):

```
id              TEXT PRIMARY KEY
start_ms        INTEGER   -- epoch ms
end_ms          INTEGER   -- epoch ms (null if in-progress)
route_points    TEXT      -- JSON array of { lat, lng, ele?, t }
distance_km     REAL
duration_min    REAL
source          TEXT      -- 'phone' | 'oura'
oura_workout_id TEXT      -- if source = 'oura'
reviewed        INTEGER   -- 0 = pending, 1 = saved, 2 = dismissed
created_at      INTEGER
```

Sessions survive app restarts. Reviewed/dismissed sessions are deleted after 7 days.

### "Exercise Detected" Review Card

Displayed on the home/health screen when one or more pending sessions exist. Card shows:
- Activity type icon (walk if avg pace ≥ 8 min/km, run if avg pace < 8 min/km)
- Start time and date
- Duration, distance
- "Review" CTA

Tapping opens a bottom sheet with:
- Route map (decoded from stored points) — or "No map available" if source is Oura
- Duration, distance, estimated calories
- Oura HR graph for the session window (avg HR, max HR, bpm over time)
- "Save as Walk" / "Save as Run" buttons + "Dismiss" option

On save: creates an `activity_log` record with all available fields. On dismiss: marks session as dismissed.

### Oura HR Enrichment

HR is fetched from `oura_heartrate` table for the session's `start_ms → end_ms` window:
- If that day's HR is already synced locally: reads from DB instantly
- If not: fetches from Oura API on-demand for the specific datetime window

Computes `avg_hr` (mean of all bpm samples in window) and `max_hr` (peak sample).

### Session-in-Progress Indicator

While an active session is being recorded in the background, a subtle indicator appears on the home screen: "Recording walk…" with elapsed time. Tapping it offers "Stop recording early" if the user wants to finish manually.

---

## Feature 2: Treadmill Session

### Activity Type

"Treadmill" added to the `activity_types` table:

```
id:              'treadmill'
label:           'Treadmill'
icon:            'PersonSimpleWalk'
isDistanceBased: false                -- no GPS
sortOrder:       9
```

`isDistanceBased: false` means no GPS watcher starts and no map is shown.

### Session Flow

Identical to existing activity screen flow:
1. User selects Treadmill from activity picker
2. Timer starts — no pace/distance display (indoor, no GPS)
3. Pause/resume works as normal
4. User taps Finish

### Done Screen

Done screen adds one field above notes: **"Distance covered"** — a numeric input in km (same weight dial pattern as other numeric inputs).

On distance entry, immediately computes and displays:
- **Steps** = `Math.round((distanceKm × 1000) / (heightCm × 0.00415))`
- **Avg HR** and **Max HR** — fetched from `oura_heartrate` for the session window
- Shown as summary chips before saving, so user sees what will be recorded

User can still edit notes and save/discard as normal.

### User Height

Required for stride length calculation (`stride_m = height_m × 0.415`).

**Source priority:**
1. `users.height_cm` if already populated
2. On first treadmill save: call `fetchPersonalInfo()` (already in `lib/oura/client.ts`) → write `height_cm` to `users` table
3. If Oura not connected: prompt user to enter height in profile settings (one-time)

`height_cm` added as a nullable column to the `users` table.

### Storage

- `steps` added as nullable integer column to `activity_logs` table
- `avg_hr` / `max_hr` populated from Oura HR window (existing columns, currently unused)
- `duration_min`, `distance_km` populated from session timer and user input respectively
- `start_time` / `end_time` derived from session `startMs` and `startMs + durationMs`

Steps are stored on `activity_logs`, not `body_metrics`, to avoid double-counting with Health Connect daily step totals.

---

## Shared Infrastructure

### `oura_heartrate` Table

Already exists from prior work. Both features read from it for HR enrichment. Sync behaviour unchanged — HR data for a given day is populated during Oura sync or on-demand fetch.

### `activity_logs` Schema Changes

New columns (single migration):
```sql
ALTER TABLE activity_logs ADD COLUMN steps INTEGER;
```

### `users` Table Change

```sql
ALTER TABLE users ADD COLUMN height_cm DOUBLE PRECISION;
```

---

## What's Out of Scope

- Auto-detection on iOS (Android only for Phase 1; Capacitor plugin has iOS support that can be enabled later)
- GPS tracking when app is completely killed (OS limitation; background service covers minimised state)
- Detecting gym weight-training sessions automatically (accelerometer signal too ambiguous without dedicated ML model)
- Syncing treadmill steps back to Health Connect
- Editing a saved auto-detected session's route
