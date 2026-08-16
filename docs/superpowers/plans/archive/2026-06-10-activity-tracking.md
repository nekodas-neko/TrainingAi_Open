> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Activity Tracking — Implementation Plan

**Date:** 2026-06-10
**Spec:** `docs/superpowers/specs/2026-06-10-activity-tracking-design.md`
**Branch:** `feat/activity-tracking`

## Corrections to the spec (verified against current code)

1. **Webhook removal target clarified.** Two HC ingest routes exist:
   - `app/api/health-connect/webhook/route.ts` — rich payload (steps/calories/distance/nutrition/weight/bodyfat/exercise), writes `cardio_sessions` via `saveCardioSession`. **This is the route to delete** per spec §6.
   - `app/api/health-connect/ingest/route.ts` — simple Tasker payload, body metrics only, **no cardio/activity references at all**. Keep unchanged — this is "the active ingest route."

   Both currently read `HEALTH_CONNECT_INGEST_SECRET` + `WEBHOOK_USER_ID`. Since `ingest/route.ts` stays, **keep both env vars documented** in CLAUDE.md.

2. **`WEBHOOK_SHEET_ID` / `GOOGLE_REFRESH_TOKEN`** — not referenced anywhere in current code or `.env.example`. Remove from CLAUDE.md's env var list as stale docs.

3. **`app/api/log-exercise-session/route.ts`** — thin wrapper around `saveCardioSession`. Delete; superseded by `POST /api/activity-logs`.

4. **Icon registry** — `@phosphor-icons/react` v2.1.10 is installed but unused (codebase uses `lucide-react` everywhere else). Confirmed available icons for the 9 seed types:

   | activity_type | icon |
   |---|---|
   | walk | `PersonSimpleWalk` |
   | run | `PersonSimpleRun` |
   | cycle | `PersonSimpleBike` |
   | hike | `PersonSimpleHike` |
   | swim | `PersonSimpleSwim` |
   | yoga | `PersonSimpleTaiChi` |
   | stretch | `PersonSimple` |
   | hiit | `Lightning` |
   | other | `DotsThreeCircle` |

   `Icon` and `IconProps` types are exported from the package root.

---

## Phase 1 — DB schema, types, repository (foundation)

### 1.1 Migration `lib/data/postgres/migrations/058_activity_logs.sql`
- `CREATE TABLE activity_types` + seed INSERT for the 9 rows above (`ON CONFLICT DO NOTHING`).
- `CREATE TABLE activity_logs` per spec (FK `activity_type` → `activity_types.id`, default `'other'`).
- Copy existing `cardio_sessions` rows into `activity_logs` with `activity_type = 'other'`.
- `DROP TABLE cardio_sessions`.
- `CREATE INDEX idx_al_user_date ON activity_logs (user_id, date DESC)`.

### 1.2 `lib/types/body.ts`
Replace `CardioSession` with `ActivityLog` (+ new `ActivityType`):
```ts
export interface ActivityLog {
  id: string
  userId: string
  date: string
  activityType: string       // FK to activity_types.id
  title: string
  startTime?: string
  endTime?: string
  durationMin?: number
  distanceKm?: number
  caloriesBurned?: number
  avgHr?: number
  maxHr?: number
  notes?: string
  createdAt: Date
}

export interface ActivityType {
  id: string
  label: string
  icon: string
  isDistanceBased: boolean
  sortOrder: number
}
```

### 1.3 `lib/data/postgres/schema.ts`
Replace `cardioSessions` with `activityTypes` + `activityLogs` tables (full column set from spec, FK on `activityType`).

### 1.4 `lib/data/repository.ts`
- `saveCardioSession` → `saveActivityLog(userId, log: Omit<ActivityLog,'id'|'userId'|'createdAt'>): Promise<ActivityLog>`
- `listCardioSessions` → `listActivityLogs(userId, from, to): Promise<ActivityLog[]>`
- New: `updateActivityLogMetrics(userId, id, patch: { distanceKm?; caloriesBurned?; avgHr?; maxHr? }): Promise<void>` — only fills currently-NULL columns.
- New: `listActivityTypes(): Promise<ActivityType[]>`
- New: `createActivityType(data: { label; icon; isDistanceBased; sortOrder }): Promise<ActivityType>` — slug generated server-side from label.
- New: `updateActivityType(id, patch): Promise<ActivityType>`
- New: `deleteActivityType(id): Promise<void>` — throws if referenced by any `activity_logs` row (app-level guard for `'other'` lives in the API route).

### 1.5 `lib/data/postgres/adapter.ts`
- Swap `CardioSession` import for `ActivityLog, ActivityType`.
- Replace `saveCardioSession`/`listCardioSessions` impls with `saveActivityLog`/`listActivityLogs`, mapping new columns.
- Add `updateActivityLogMetrics` using `COALESCE(col, $val)` per provided field.
- Add activity-type CRUD methods (slug: lowercase, non-alnum → `-`, numeric suffix on collision).

**Checkpoint:** do not build yet — call sites still reference old names (Phase 3 fixes that).

---

## Phase 2 — Health Connect sync extensions (self-contained)

### 2.1 `lib/health-connect-sync.ts`
- Add & export `mapExerciseTypeToActivityType(exerciseType: string): string` — static lookup per spec §3 table, default `'other'`.
- Extend `ExerciseSession`: add `activityType: string`, `distanceKm?`, `avgHr?`, `maxHr?`.
- Add `'HeartRate'` to the `read` permissions array (cast as any, same as `BodyFat`/`Nutrition`).
- Inside the `ActivitySession` loop, per session (best-effort, try/catch like neighboring blocks):
  - `HeartRate` records in `[startTime, endTime]` → avg/max BPM from `samples[].beatsPerMinute`.
  - `Distance` aggregate in `[startTime, endTime]` (no `groupBy`) → km.
  - `TotalCaloriesBurned` aggregate in `[startTime, endTime]` → kcal (per-session, overrides daily-bucket value for this session).
  - `activityType: mapExerciseTypeToActivityType(r.exerciseType)`.
- New `lib/health-connect-sync.test.ts` (vitest) for `mapExerciseTypeToActivityType`.

**Checkpoint:** `pnpm test` (vitest doesn't full-typecheck, so independent of Phase 1/3 state).

---

## Phase 3 — Wire up renamed repo methods, remove dead routes (build checkpoint)

### 3.1 `app/api/sync-health/route.ts`
- `listCardioSessions`/`saveCardioSession` → `listActivityLogs`/`saveActivityLog`.
- Map new `ExerciseSession` fields → `ActivityLog` fields.
- After processing, compute `enrichmentCandidates`: last-3-days `activity_logs` (via `listActivityLogs` + `session.user.timezone`/`DEFAULT_TZ`) where `avgHr`/`distanceKm`/`caloriesBurned` are all null → return `{ id, date, startTime, endTime }[]` in the response.

### 3.2 `app/api/body-metadata/route.ts`
- `listCardioSessions` → `listActivityLogs`; rename local var; `calsBurnedToday` logic unchanged.

### 3.3 Delete
- `app/api/log-exercise-session/route.ts`
- `app/api/health-connect/webhook/route.ts`

### 3.4 Build checkpoint
- `pnpm build` — clean, no remaining `cardioSessions`/`CardioSession`/`saveCardioSession`/`listCardioSessions`.
- `pnpm test`.

---

## Phase 4 — New API routes

### 4.1 `app/api/activity-types/route.ts` (GET)
- Auth required. Returns `repo.listActivityTypes()` ordered by `sortOrder`.
- Add to the client cache-task registry (wherever `exercise-library` etc. are warmed) with a long TTL.

### 4.2 `app/api/admin/activity-types/route.ts` (GET/POST/PATCH/DELETE)
- Mirror `app/api/admin/exercises/...` pattern (`requireAdmin()`).
- DELETE: 400 if `id === 'other'`; 409 if in-use.

### 4.3 `app/api/activity-logs/route.ts`
- `GET ?days=N` — `listActivityLogs(userId, from, today)` via `todayInTz(session.user.timezone)`.
- `POST` — Zod-validated body → `saveActivityLog`.

### 4.4 `app/api/activity-logs/[id]/metrics/route.ts`
- `PATCH` — Zod-validated `{ distanceKm?, caloriesBurned?, avgHr?, maxHr? }` → `updateActivityLogMetrics`.

**Checkpoint:** `pnpm build`.

---

## Phase 5 — UI

### 5.1 `lib/constants/activity-icons.ts`
- `ACTIVITY_ICONS: Record<string, Icon>` for the 9 seed slugs + `getActivityIcon(name): Icon` with `DotsThreeCircle` fallback.

### 5.2 `components/workout/log-activity-sheet.tsx` (new)
- Modeled on `components/profile/water-log-sheet.tsx`. Fetches `/api/activity-types`. Fields per spec §2.1 (type icon grid, title, date via `todayInTz()`, start time, duration, distance if `isDistanceBased`, calories, notes). POSTs to `/api/activity-logs`.

### 5.3 `app/workout-select/workout-select-content.tsx`
- Replace `toast.info("Activity logging coming soon!")` button (~line 348) with sheet open state + `<LogActivitySheet>`.

### 5.4 `components/health/activity-history-card.tsx` (new)
- `GET /api/activity-logs?days=14`; rows show icon/title/time/duration/distance/calories, expand for avg/max HR + notes. Add to Health → Training tab near `WeeklySummaryCard` (~`health-content.tsx:948`).

### 5.5 `components/admin/activity-type-manager.tsx` (new)
- Modeled on `components/admin/exercise-manager.tsx`. Wire into `app/admin/admin-content.tsx` (`Tab` union + "Activities" tab button + render block).

**Checkpoint:** `pnpm build`; manual smoke test via dev server.

---

## Phase 6 — HC sync enrichment client pass

### 6.1 `lib/health-connect-sync.ts`
- New exported `enrichActivityLogs(candidates): Promise<void>` — per candidate, build `[start,end]` window, reuse the HR/Distance/Calories helper from Phase 2.1, `PATCH /api/activity-logs/:id/metrics`.
- `syncHealthConnect()` reads `enrichmentCandidates` from `/api/sync-health` response and calls `enrichActivityLogs` (native-only, try/catch).

**Checkpoint:** `pnpm build`.

---

## Phase 7 — Docs & cleanup

### 7.1 `CLAUDE.md` env vars
- Remove `GOOGLE_REFRESH_TOKEN` + `WEBHOOK_SHEET_ID` line.
- Keep `HEALTH_CONNECT_INGEST_SECRET` + `WEBHOOK_USER_ID`, scope description to `ingest/route.ts` only.

### 7.2 `projectOverview.md`
- Tick off "Activity logging" (line 184) and the Known Issues entry (line 592).
- New session entry: summary, files changed, migration, caveats (HR/distance enrichment depends on periodic native sync).
- Flag: user must disable the Tasker automation hitting `/api/health-connect/webhook` (now removed).

### 7.3 Version bump
- `package.json` 1.23.1 → 1.24.0 (minor).
- `lib/changelog.ts` new entry.
