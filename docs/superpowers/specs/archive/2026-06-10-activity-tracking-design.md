# Activity Tracking — Design Spec

**Date:** 2026-06-10
**Status:** Approved, ready for implementation plan

## Overview

Add the ability to log non-gym activities (walks, runs, cycling, hikes, swims,
yoga, stretching, HIIT, etc.), either manually or auto-synced from Health
Connect, and show correlated health metrics (distance, calories burned, avg/max
heart rate) for the activity's time window.

This replaces and renames the existing (mostly dormant) `cardio_sessions` table
and wires up the existing "Log Activity" placeholder button on the Workout tab.

## Goals

- Manual activity logging via the existing "Log Activity" placeholder button.
- A history view of logged activities (manual + auto-synced).
- Distance, calories, avg/max HR shown per activity where available.
- Activity types stored in a global, admin-editable DB table (not hardcoded).
- Clean up the now-redundant `cardio_sessions` naming and the deprecated
  Health Connect webhook ingestion path.

## Out of Scope

- Training-streak / activity-feed integration (belongs to the friends-system
  spec — can be revisited separately).
- Full HR-over-time chart / raw sample storage (avg/max only for v1; revisit
  once Oura API access provides richer, more reliable data).
- Direct Oura API integration (future work — current design only reads
  whatever Oura has already pushed into Health Connect).

---

## 1. Data Model

### `activity_types` (new, global catalog table)

```sql
CREATE TABLE activity_types (
  id                TEXT PRIMARY KEY,         -- slug, e.g. 'walk', 'run'
  label             TEXT NOT NULL,            -- display name, e.g. "Walk"
  icon              TEXT NOT NULL,            -- phosphor-icons component name
  is_distance_based BOOLEAN NOT NULL DEFAULT false,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Seeded rows (sort order as listed):

| id      | label      | is_distance_based |
|---------|------------|--------------------|
| walk    | Walk       | true  |
| run     | Run        | true  |
| cycle   | Cycle      | true  |
| hike    | Hike       | true  |
| swim    | Swim       | true  |
| yoga    | Yoga       | false |
| stretch | Stretching | false |
| hiit    | HIIT       | false |
| other   | Other      | false |

`'other'` is the fallback for unmapped Health Connect exercise types and the
default for `activity_logs.activity_type`. It cannot be deleted via the admin
UI (app-level guard).

### `activity_logs` (renamed from `cardio_sessions`)

```sql
CREATE TABLE activity_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  activity_type   TEXT NOT NULL DEFAULT 'other' REFERENCES activity_types(id),
  title           TEXT NOT NULL,
  start_time      TIME,
  end_time        TIME,
  duration_min    FLOAT,
  distance_km     FLOAT,
  calories_burned FLOAT,
  avg_hr          INTEGER,
  max_hr          INTEGER,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_al_user_date ON activity_logs (user_id, date DESC);
```

### Migration `058_activity_logs.sql`

1. Create `activity_types`, seed the 9 rows above.
2. Create `activity_logs` (as above).
3. Copy existing `cardio_sessions` rows into `activity_logs` with
   `activity_type = 'other'`.
4. `DROP TABLE cardio_sessions`.

### Type / repo renames

- `lib/types/body.ts`: `CardioSession` → `ActivityLog` (add `activityType`,
  `distanceKm`, `avgHr`, `maxHr`, `notes` fields). New `ActivityType` interface
  matching `activity_types` columns.
- `lib/data/postgres/schema.ts`: `cardioSessions` → `activityLogs`; add
  `activityTypes` table.
- `lib/data/repository.ts` / `adapter.ts`:
  - `saveCardioSession` → `saveActivityLog`
  - `listCardioSessions` → `listActivityLogs`
  - new `updateActivityLogMetrics(userId, id, { distanceKm?, caloriesBurned?, avgHr?, maxHr? })`
    — only sets fields that are currently `NULL`, never overwrites a
    user-provided value.
  - new global methods: `listActivityTypes`, `createActivityType`,
    `updateActivityType`, `deleteActivityType`.

### Call sites to update

- `app/api/log-exercise-session/route.ts` → replaced by `app/api/activity-logs/route.ts` (see §4).
- `app/api/sync-health/route.ts` — uses `listActivityLogs`/`saveActivityLog`, plus enrichment (§3).
- `app/api/body-metadata/route.ts` — `calsBurnedToday` now sums from `listActivityLogs`.
- `app/api/health-connect/webhook/route.ts` — removed entirely (§5).

---

## 2. UI

### 2.1 Manual "Log Activity" form

Replaces the placeholder button at
`app/workout-select/workout-select-content.tsx:346-352` (currently
`toast.info("Activity logging coming soon!")`).

Opens a bottom `Sheet` (consistent with the existing logging sheets on the
Health page) containing:

- **Activity type** — icon grid populated from `GET /api/activity-types`.
- **Title** — auto-filled from the selected type's label, editable.
- **Date** — defaults to `todayInTz(session.user.timezone)`.
- **Start time** — defaults to current time.
- **Duration (min)**.
- **Distance (km)** — shown only when the selected type has
  `is_distance_based = true`. Optional.
- **Calories burned** — optional.
- **Notes** — optional free text.

Submits to `POST /api/activity-logs`. `avg_hr`/`max_hr` are left `NULL` at
creation — no live Health Connect query at submit time (see §3 for why).

### 2.2 History / Activities section

New "Activities" section in Health → Training tab, below
`WeeklySummaryCard`, backed by `GET /api/activity-logs?days=14`.

Each row shows: type icon, title, time, duration, distance (if any), calories
(if any). Tapping a row expands to show avg/max HR (if backfilled yet) and
notes.

### 2.3 Admin: Activity Types management

New "Activity Types" tab in `/admin` (alongside Users/Invites/Exercises),
backed by `components/admin/activity-type-manager.tsx` — modeled directly on
`components/admin/exercise-manager.tsx`:

- List of types showing icon, label, distance-based toggle, sort order.
- Add/edit form: label, icon (phosphor icon name + live preview), distance-based
  checkbox.
- Delete (blocked for `'other'`).

Backed by `GET/POST/PATCH/DELETE /api/admin/activity-types`.

---

## 3. Health Connect Sync Changes

`lib/health-connect-sync.ts`:

- New permission requested: `HeartRate` (continuous BPM samples — not
  currently requested).
- For each detected `ActivitySession` record, additionally query its exact
  `[startTime, endTime]` window for:
  - `HeartRate` samples → `avgHr` / `maxHr` (mean / max of all
    `beatsPerMinute` values across returned records' `samples[]`).
  - `Distance` aggregate → `distanceKm`.
  - `TotalCaloriesBurned` aggregate → per-session `caloriesBurned`.
- Map Health Connect's `exerciseType` string constant to our `activity_type`
  slug, e.g.:

  | HC exerciseType (examples)                          | activity_type |
  |------------------------------------------------------|----------------|
  | `EXERCISE_TYPE_WALKING`                               | walk    |
  | `EXERCISE_TYPE_RUNNING`, `EXERCISE_TYPE_RUNNING_TREADMILL` | run |
  | `EXERCISE_TYPE_BIKING`, `EXERCISE_TYPE_BIKING_STATIONARY`  | cycle |
  | `EXERCISE_TYPE_HIKING`                                | hike    |
  | `EXERCISE_TYPE_SWIMMING_POOL`, `EXERCISE_TYPE_SWIMMING_OPEN_WATER` | swim |
  | `EXERCISE_TYPE_YOGA`                                  | yoga    |
  | `EXERCISE_TYPE_STRETCHING`                            | stretch |
  | `EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING`      | hiit    |
  | anything else                                         | other   |

  This mapping is a static lookup in code (separate from the editable
  `activity_types` table — admin-added types are for manual logging /
  display; auto-mapping from HC always falls back to `'other'` for types it
  doesn't recognize).

- `ExerciseSession` type gains optional `distanceKm`, `avgHr`, `maxHr`,
  `caloriesBurned`, `activityType` fields, threaded through `SyncPayload`.

## 4. Backfill / Enrichment Pass

Heart rate (and sometimes distance/calories) data from wearables often isn't
in Health Connect yet at the moment an activity ends or is logged — Samsung
Health syncs within minutes if continuous HR is on, but Oura's Health Connect
integration can lag by hours.

To handle this without re-fetching at submit time:

1. `POST /api/sync-health` (existing route, called on every periodic sync)
   additionally returns recent `activity_logs` rows (last ~3 days) where
   `avg_hr`, `max_hr`, `distance_km`, or `calories_burned` are still `NULL`,
   each with its `date`/`startTime`/`endTime`.
2. The client (native only) queries Health Connect for each returned window
   using the same HR/Distance/Calories logic as §3.
3. Client `POST`s any newly-available values to a small enrichment endpoint
   (e.g. `PATCH /api/activity-logs/:id/metrics`), which calls
   `updateActivityLogMetrics` — only fills fields that are still `NULL`,
   never overwrites a user-entered value.

This applies uniformly to manually-logged and HC-auto-synced activities, and
self-heals as wearable data arrives.

## 5. New / Changed / Removed API Routes

| Method | Route | Change |
|--------|-------|--------|
| GET | `/api/activity-types` | New — list activity types for the picker |
| GET/POST/PATCH/DELETE | `/api/admin/activity-types` | New — admin CRUD |
| GET | `/api/activity-logs?days=N` | New — history list for Health → Training |
| POST | `/api/activity-logs` | New — manual log entry (replaces `log-exercise-session`) |
| PATCH | `/api/activity-logs/:id/metrics` | New — backfill enrichment (§4) |
| ~~POST~~ | ~~`/api/log-exercise-session`~~ | Removed |
| GET/POST | `/api/sync-health` | Updated — `activity_logs` naming, enrichment candidates in response |
| GET | `/api/body-metadata` | Updated — `calsBurnedToday` from `listActivityLogs` |

## 6. Webhook Removal

- Delete `app/api/health-connect/webhook/route.ts` and its types.
- Remove `HEALTH_CONNECT_INGEST_SECRET`, `WEBHOOK_USER_ID`, `WEBHOOK_SHEET_ID`
  (and the `GOOGLE_REFRESH_TOKEN` usage tied solely to this path, if any) from
  the env var list in `CLAUDE.md`.
- User will disable the corresponding Tasker automation on their phone — the
  endpoint will 404 after this ships.

## 7. Future Considerations

- Direct Oura API integration for richer/lower-latency HR data — once
  available, the enrichment pass (§4) could query Oura directly in addition
  to Health Connect.
- Full HR-over-time chart per activity (would need a raw-samples table +
  chart.js component) — revisit once data density from Oura/Samsung is known.
- Activities counting toward training streaks / friend activity feed.
