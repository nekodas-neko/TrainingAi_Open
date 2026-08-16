# Live-Timer Activity Tracking — Design Spec

**Date:** 2026-06-11
**Status:** Approved, ready for implementation plan

## Overview

Replace the after-the-fact "Log Activity" form with a live pre→active→done
flow (mirroring the workout flow's `WorkoutMode` pattern), with a running
timer for all activity types. For distance-based types (Walk, Run, Cycle,
Hike, Swim — `activity_types.is_distance_based`), additionally track live GPS
distance/pace, including in the background with the screen off, store a
simplified route + computed metrics, and let the user review the route on a
map afterwards from the calendar/history.

This builds on top of `2026-06-10-activity-tracking-design.md` (the
`activity_logs` / `activity_types` tables already exist).

## Goals

- All activity types get a live timer (start/pause/resume/finish), replacing
  manual duration entry.
- Distance-based types additionally get: live GPS tracking (works with screen
  off via background location + foreground service), live distance/pace
  display, and route storage.
- After finishing, computed stats (duration, distance, pace, splits, best
  efforts, elevation gain/loss) are shown on a "done" screen and saved.
- Past activities are viewable from the History calendar (and the existing
  `ActivityHistoryCard`), including a route map for distance-based activities.

## Out of Scope

- Cadence tracking (requires accelerometer/pedometer/watch sensor data, not
  derivable from GPS — revisit once a sensor data source exists, e.g. Oura
  via Health Connect).
- Pace-over-time / elevation-profile charts (the `pace_series` data will
  exist to support this later, but rendering it is a future addition).
- Showing routes from `cardio_sessions`-era / pre-existing activity logs
  (they have no `route_polyline` data — map section simply won't show for
  those rows).

---

## 1. Entry Point & Flow

- "Log Activity" button (`app/workout-select/workout-select-content.tsx`)
  opens a trimmed `log-activity-sheet.tsx` — just the activity-type icon grid
  (duration/distance/calorie/notes inputs removed).
- Selecting a type calls `useActivityStore.startActivity(typeId, label)` and
  navigates to `/activity`.
- `/activity` (`ActivityScreen` orchestrator) renders one of three screens
  based on `mode: 'pre' | 'active' | 'done'`:
  - **pre**: shows chosen type + title (editable), "Start" button. For
    distance-based types, primes location permissions before allowing start.
  - **active**: live elapsed time, live distance/pace (distance-based only),
    live mini route map, pause/resume + finish buttons.
  - **done**: computed summary stats + full route map, optional notes field,
    Save/Discard.

## 2. Data Model

New migration `059_activity_route_data.sql`, adding columns to
`activity_logs`:

```sql
ALTER TABLE activity_logs
  ADD COLUMN route_polyline TEXT,
  ADD COLUMN splits JSONB,
  ADD COLUMN best_efforts JSONB,
  ADD COLUMN pace_series JSONB,
  ADD COLUMN avg_pace_sec_per_km DOUBLE PRECISION,
  ADD COLUMN elevation_gain_m DOUBLE PRECISION,
  ADD COLUMN elevation_loss_m DOUBLE PRECISION;
```

- `route_polyline` — Douglas-Peucker simplified + polyline-encoded lat/lng
  route (map display only, lossy).
- `splits` — per-km pace breakdown, e.g. `[{km: 1, paceSec: 320}, ...]`.
- `best_efforts` — fastest N-distance segments (e.g. fastest 1km/5km),
  computed via sliding window over the full-resolution trace.
- `pace_series` — pace bucketed every ~30s, for a future pace-over-time
  chart.
- `avg_pace_sec_per_km`, `elevation_gain_m`, `elevation_loss_m` — summary
  stats for instant display without decoding other fields.

All of `splits`/`best_efforts`/`pace_series`/summary stats are computed once
from the **full-resolution raw trace** (held only in the client-side
`activity-store` during tracking) before that raw trace is discarded —
only `route_polyline` is lossy/simplified.

**Drizzle schema** (`lib/data/postgres/schema.ts`) — add to `activityLogs`:
```ts
routePolyline:    text('route_polyline'),
splits:           jsonb('splits').$type<{ km: number; paceSec: number }[]>(),
bestEfforts:      jsonb('best_efforts').$type<Record<string, number>>(),
paceSeries:       jsonb('pace_series').$type<{ tSec: number; paceSec: number }[]>(),
avgPaceSecPerKm:  doublePrecision('avg_pace_sec_per_km'),
elevationGainM:   doublePrecision('elevation_gain_m'),
elevationLossM:   doublePrecision('elevation_loss_m'),
```

**`lib/types/body.ts`** — extend `ActivityLog` with the corresponding
optional fields (camelCase, matching the Drizzle `$inferSelect` shapes).

**`POST /api/activity-logs`** (`app/api/activity-logs/route.ts`) — extend the
request body schema to accept `endTime` plus the new fields above.

## 3. GPS / Background Tracking

- New dependency: `@capacitor-community/background-geolocation` (v1.2.26,
  Capacitor 8 compatible). Provides `addWatcher()` with
  `backgroundMessage`/`backgroundTitle`, which runs a foreground service +
  persistent notification on Android so tracking continues with the screen
  off.
- New dependency: `@mapbox/polyline` for encode/decode.
- New dependency: `leaflet` + `react-leaflet` for map rendering (chosen over
  Google Maps to avoid new API/billing setup).

**Android manifest** (`android/app/src/main/AndroidManifest.xml`) — add:
```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
```

Permission flow: request fine/coarse location when starting the first
distance-based activity; separately prompt for "Allow all the time" via an
Android settings deep link (required on Android 10+ for background location).

## 4. State — `lib/stores/activity-store.ts`

Persisted Zustand store (mirrors `lib/stores/workout-store.ts`'s
`persist` + `createJSONStorage(localStorage)` pattern, key
`ta_activity_state`):

```ts
interface ActivityState {
  activitySessionId: string
  activityType: string | null
  title: string
  mode: 'pre' | 'active' | 'done'
  isPaused: boolean

  startMs: number | null
  endMs: number | null
  accumulatedPauseMs: number

  // Live GPS (distance-based types only)
  rawPoints: { lat: number; lng: number; ele?: number; t: number }[]
  distanceKm: number
  currentPaceSecPerKm: number | null

  summaryData: ActivityLog | null
}
```

- `rawPoints` persists to localStorage during tracking, so an in-progress
  activity survives app restart/crash (same guarantee as `workout-store`).
- Watcher lifecycle: `addWatcher()` while `mode === 'active' && !isPaused`;
  `removeWatcher()` on pause/finish. Each callback appends to `rawPoints` and
  recomputes `distanceKm`/pace via Haversine distance between consecutive
  points.
- Non-distance activity types never start a GPS watcher — timer only.
- On finish: compute splits/best-efforts/elevation/pace from `rawPoints`,
  Douglas-Peucker-simplify + polyline-encode the route, POST to
  `/api/activity-logs`, then clear `rawPoints` (only `summaryData` is kept
  for the done screen).

## 5. Components

**New route:** `app/activity/page.tsx` → `ActivityScreen` orchestrator
(mirrors `app/workout/page.tsx` → `components/workout-screen.tsx`).

`components/activity/`:
| File | Role |
|------|------|
| `activity-screen.tsx` | Orchestrator — state, GPS watcher lifecycle, save/finish |
| `pre-activity-screen.tsx` | Type/title display + Start button + permission priming |
| `active-activity-screen.tsx` | Elapsed time, live distance/pace, pause/resume/finish, live mini map |
| `done-activity-screen.tsx` | Summary stats, full route map, notes, Save/Discard |
| `activity-route-map.tsx` | Shared Leaflet/react-leaflet map (live points or decoded polyline) |
| `activity-detail-sheet.tsx` | Read-only detail view for past activities (map + stats + notes) |
| `types.ts` | `ActivityMode = 'pre' \| 'active' \| 'done'` |

`lib/activity/`:
| File | Role |
|------|------|
| `route-encoding.ts` | Douglas-Peucker simplification + polyline encode/decode |
| `activity-metrics.ts` | Haversine distance, pace, splits, best-efforts, elevation gain/loss |

## 6. Calendar / History Integration

- `app/history/history-content.tsx` day overlay — add an "Activity" section
  listing that day's `activityLogs` (icon, title, duration, distance/pace),
  using data already returned by `/api/day-log` (`activityLogs` field
  already exists, just unused in the overlay).
- Tapping a row opens `activity-detail-sheet.tsx` (map + stats + notes for
  distance-based; stats + notes only for others).
- `components/health/activity-history-card.tsx` — tapping a row opens the
  same `activity-detail-sheet.tsx` instead of/in addition to its current
  inline expand.
- Calendar day markers (`activityDays` from `getCalendarData`) — no changes
  needed, already implemented.

## Open Questions / Risks

- Polyline encoding precision needs separate tuning for elevation (meters,
  larger jumps) and time-offset (seconds, can be large) streams vs the
  standard lat/lng precision — to be validated during implementation with
  real GPS traces.
- `rawPoints`/`route_points`/streams indices must stay aligned between
  `route_polyline`, `pace_series` etc. — owned exclusively by
  `lib/activity/route-encoding.ts` and `activity-metrics.ts` to avoid drift.
