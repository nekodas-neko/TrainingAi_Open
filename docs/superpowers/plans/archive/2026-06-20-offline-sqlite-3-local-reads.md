# Offline SQLite Plan 3: Local-First UI Reads

**Status:** Pending  
**Branch:** `feat/offline-sqlite`  
**Depends on:** Plans 1 & 2 must be complete first  
**Goal:** Update UI components to read from local SQLite directly instead of hitting the Railway API, so every screen loads instantly with no network dependency for stored data.

---

## What Changes, What Doesn't

### Goes local-first (reads from SQLite, no API call needed)

| Data | Current API call | Local source (after Plans 1+2) |
|------|-----------------|-------------------------------|
| Body metrics (weight, steps, macros, HRV, water) | `/api/body-metadata` | `store.getBodyMetrics()` |
| Sleep sessions | `/api/sleep-sessions` | `store.getSleepSessions()` |
| Today's mood log | `/api/mood?date=today` | `store.getMoodLogs(today)` |
| Training week calendar dots | `/api/calendar-data` | Derived from `store.getWorkoutSessions()` |
| Streak count | `/api/streak-data` | Derived from `store.getWorkoutSessions()` |
| Food logs for today | `/api/nutrition/food-logs?date=today` | `store.getFoodLogs(today)` (Plan 2) |
| Supplement definitions | `/api/supplements` | `store.getSupplements()` (Plan 2) |
| Today's supplement log status | `/api/supplements/{id}/log` | `store.getSupplementLogs(today)` (Plan 2) |

### Stays server-computed (no local equivalent)

| Data | Why it stays |
|------|-------------|
| `next-session` recommendation | Schedule algorithm + program + history — complex server logic |
| `readiness-score` | Multi-variable algorithm (sleep, HRV, RHR, training load) |
| `weekly-stats` | Aggregation over `set_logs` (not in local store) |
| `weights-summary` | 1RM and volume history from `set_logs` JOINs |
| `progress-summary` | Complex trend computation |
| `workout-data:{tab}` | Exercise weights + progression — JOIN with `style_sets` + `exercise_library` |
| `workout-data:meta` | Program phase tracking |
| Exercise library | Large reference table, rarely changes |

The `cachedFetch` + `api_cache` SQLite pattern remains for all server-computed data. The localStorage mirror fix (already shipped) keeps those instant across sessions.

---

## Step 1 — Shared mapper: `LocalBodyMetric` → `BodyMetaRow`

The API returns `BodyMetaRow` (field names like `bodyFat`, `protein`, `carb`) while the local store uses `LocalBodyMetric` (field names like `bodyFatPct`, `proteinG`, `carbsG`). A single mapper function used in every component avoids repeated inline conversions.

**New file: `lib/local-store/mappers.ts`**

```ts
import type { LocalBodyMetric, LocalFoodLog, LocalWorkoutSession } from './types';
import type { BodyMetaRow, WeekToDate } from '@/app/api/body-metadata/route';
import { startOfWeekInTz } from '@/lib/date-utils';

export function localMetricToRow(m: LocalBodyMetric): BodyMetaRow {
  return {
    date:             m.date,
    weightKg:         m.weightKg,
    bodyFat:          m.bodyFatPct,
    calories:         m.calories,
    protein:          m.proteinG,
    carb:             m.carbsG,
    fat:              m.fatG,
    steps:            m.steps,
    distanceKm:       null,        // not stored locally yet
    restingHeartRate: m.restingHeartRate,
    hrvMs:            m.hrvMs,
    spo2Pct:          m.spo2Pct,
    waterMl:          m.waterMl,
  };
}

// Compute body-metadata response shape from local data.
// foodLogs overrides calorie/macro totals for today when present (same logic as
// the server's /api/body-metadata, which prefers food_logs over body_metrics
// macros for accuracy when the user logs food in the app).
export function computeBodyMeta(
  metrics: LocalBodyMetric[],
  foodLogs: LocalFoodLog[],
  tz: string,
): { today: BodyMetaRow | null; recent: BodyMetaRow[]; weekToDate: WeekToDate } {
  const today = new Date().toLocaleDateString('sv', { timeZone: tz });
  const weekStart = startOfWeekInTz(tz);

  const recent = metrics.map(localMetricToRow);
  let todayRow = recent.find(r => r.date === today) ?? null;

  // Food logs override macros/calories for today (matching server logic)
  if (foodLogs.length > 0) {
    const totals = foodLogs.reduce(
      (acc, l) => ({
        calories: acc.calories + l.calories,
        protein:  acc.protein  + l.proteinG,
        carb:     acc.carb     + l.carbsG,
        fat:      acc.fat      + l.fatG,
      }),
      { calories: 0, protein: 0, carb: 0, fat: 0 },
    );
    todayRow = {
      ...(todayRow ?? {
        date: today, weightKg: null, bodyFat: null, steps: null, distanceKm: null,
        restingHeartRate: null, hrvMs: null, spo2Pct: null, waterMl: null,
      }),
      calories: Math.round(totals.calories),
      protein:  Math.round(totals.protein  * 10) / 10,
      carb:     Math.round(totals.carb     * 10) / 10,
      fat:      Math.round(totals.fat      * 10) / 10,
    };
  }

  const weekRows = metrics.filter(m => m.date >= weekStart);
  const weekToDate: WeekToDate = {
    steps:    weekRows.reduce((s, r) => s + (r.steps    ?? 0), 0),
    waterMl:  weekRows.reduce((s, r) => s + (r.waterMl  ?? 0), 0),
    // For weekly calories: use food_log totals where available, body_metrics otherwise
    calories: (() => {
      const foodDates = new Set(foodLogs.map(l => l.date));
      const foodCals = foodLogs.reduce((s, l) => s + l.calories, 0);
      const metricCals = weekRows
        .filter(r => !foodDates.has(r.date))
        .reduce((s, r) => s + (r.calories ?? 0), 0);
      return foodCals + metricCals;
    })(),
  };

  return { today: todayRow, recent, weekToDate };
}

// Derive calendarDays map from local workout sessions.
// Keys are 'YYYY/MM/DD', values are session names trained that day.
export function sessionsToCalendarDays(
  sessions: LocalWorkoutSession[],
  tz: string,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const s of sessions) {
    if (!s.completedAt) continue;  // only count completed workouts
    const dateKey = new Date(s.startedAt)
      .toLocaleDateString('sv', { timeZone: tz })
      .replace(/-/g, '/');
    if (!result[dateKey]) result[dateKey] = [];
    if (s.sessionName && !result[dateKey].includes(s.sessionName)) {
      result[dateKey].push(s.sessionName);
    }
  }
  return result;
}
```

**Note on `distanceKm`:** The local `body_metrics` SQLite table (migration v4) does not include `distance_km` — this field comes from `activity_logs` on the server. For now it returns `null` from local reads. If distance becomes important to display locally, add `distance_km REAL` to the migration and include it in `LocalBodyMetric`.

---

## Step 2 — Local read helper: `lib/local-store/local-reads.ts`

Centralise the local-read logic so each component calls one function instead of duplicating store access + mapper calls.

```ts
import { getLocalStore } from './index';
import { computeBodyMeta, sessionsToCalendarDays } from './mappers';
import type { BodyMetaRow, WeekToDate } from '@/app/api/body-metadata/route';
import type { LocalMoodLog, LocalSleepSession } from './types';
import type { MoodLog } from '@/lib/types/mood';

// ── Body metadata ────────────────────────────────────────────────────────────

export interface LocalBodyMetaResult {
  today: BodyMetaRow | null;
  recent: BodyMetaRow[];
  weekToDate: WeekToDate;
}

export async function readLocalBodyMeta(
  userId: string,
  tz: string,
): Promise<LocalBodyMetaResult | null> {
  const store = getLocalStore(userId);
  if (!store) return null;

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toLocaleDateString('sv', { timeZone: tz });
  const today = new Date().toLocaleDateString('sv', { timeZone: tz });

  const [metrics, foodLogs] = await Promise.all([
    store.getBodyMetrics(cutoff),
    store.getFoodLogs(today),
  ]);

  if (!metrics.length && !foodLogs.length) return null;  // store empty — let API handle first load

  return computeBodyMeta(metrics, foodLogs, tz);
}

// ── Sleep sessions ────────────────────────────────────────────────────────────

export async function readLocalSleepSessions(
  userId: string,
  tz: string,
  daysBack = 14,
): Promise<LocalSleepSession[] | null> {
  const store = getLocalStore(userId);
  if (!store) return null;

  const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
    .toLocaleDateString('sv', { timeZone: tz });
  const rows = await store.getSleepSessions(cutoff);
  return rows.length ? rows : null;
}

// ── Mood log ─────────────────────────────────────────────────────────────────

export async function readLocalMoodLog(
  userId: string,
  today: string,
): Promise<MoodLog | null | undefined> {
  const store = getLocalStore(userId);
  if (!store) return undefined;  // undefined = "store not available, fallback to API"

  const rows = await store.getMoodLogs(today);
  const row = rows.find(r => r.logDate === today);
  if (!row) return null;   // null = "no log today"

  return {
    logDate:      row.logDate,
    energyLevel:  row.energyLevel,
    sleepQuality: row.sleepQuality,
    bodyState:    row.bodyState,
    soreMuscles:  row.soreMuscles,
    updatedAt:    row.updatedAt,
  } as MoodLog;
}

// ── Calendar days from workout sessions ──────────────────────────────────────

export async function readLocalCalendarDays(
  userId: string,
  tz: string,
  monthsBack = 3,
): Promise<Record<string, string[]> | null> {
  const store = getLocalStore(userId);
  if (!store) return null;

  const cutoff = new Date(Date.now() - monthsBack * 30 * 24 * 60 * 60 * 1000)
    .toLocaleDateString('sv', { timeZone: tz });
  const sessions = await store.getWorkoutSessions(cutoff);
  if (!sessions.length) return null;

  return sessionsToCalendarDays(sessions, tz);
}
```

---

## Step 3 — Update `app/session-select/session-select-content.tsx`

This is the home screen (most visible, highest priority).

### 3a — Body metadata

Replace the `fetchMeta` + `fetchMeta useEffect` block with a two-pass approach: local read first (instant), then API refresh in background.

Find the `fetchMeta` callback and the `useEffect(() => { fetchMeta(); })` that calls it. Replace both:

```ts
// ── Body metadata ──────────────────────────────────────────────────────────

// Pass 1: local SQLite — instant, no network (APK only)
useEffect(() => {
  if (!userId) return;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  readLocalBodyMeta(userId, tz).then(local => {
    if (!local) return;  // store empty or web — let Pass 2 handle it
    setMetaToday(local.today);
    setMetaRecent(local.recent);
    setWeekToDate(local.weekToDate);
    setMetaLoading(false);
  }).catch(() => {});
}, [userId]);

// Pass 2: API refresh — stale-while-revalidate (updates local with server data)
const fetchMeta = useCallback(async () => {
  await cachedFetch<{ today: BodyMetaRow | null; recent: BodyMetaRow[]; weekToDate?: WeekToDate | null; calsBurnedToday?: number | null }>(
    'body-metadata', '/api/body-metadata', TTL_MEDIUM,
    (data) => {
      setMetaToday(data.today ?? null);
      setMetaRecent(data.recent ?? []);
      setWeekToDate(data.weekToDate ?? null);
      setCalsBurnedToday(data.calsBurnedToday ?? null);
      setMetaLoading(false);
    },
  );
  setMetaLoading(false);
}, []);

useEffect(() => { fetchMeta(); }, [fetchMeta]);
```

**Import to add:** `import { readLocalBodyMeta } from '@/lib/local-store/local-reads';`

**Result:** Body weight tile, step count, calorie tile, water — all populate from SQLite in 1-5ms. The API call then updates if the server has newer data (e.g. from a Health Connect sync that happened while offline).

### 3b — Sleep data

Replace:
```ts
useEffect(() => {
  cachedFetch<SleepRow[]>(
    'sleep-sessions', '/api/sleep-sessions', TTL_MEDIUM,
    (data) => setSleepData(Array.isArray(data) ? data : []),
  ).catch(() => {});
}, []);
```

With:
```ts
// Pass 1: local SQLite
useEffect(() => {
  if (!userId) return;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  readLocalSleepSessions(userId, tz).then(rows => {
    if (rows) setSleepData(rows.map(r => ({
      date:            r.date,
      durationHours:   r.durationHours,
      deepSleepHours:  r.deepSleepHours,
      remSleepHours:   r.remSleepHours,
      lightSleepHours: r.lightSleepHours,
      awakHours:       null,  // not in local store
    })));
  }).catch(() => {});
}, [userId]);

// Pass 2: API refresh
useEffect(() => {
  cachedFetch<SleepRow[]>(
    'sleep-sessions', '/api/sleep-sessions', TTL_MEDIUM,
    (data) => setSleepData(Array.isArray(data) ? data : []),
  ).catch(() => {});
}, []);
```

**Note on `awakHours`:** The server computes awake hours from sleep stage data. This field isn't stored locally — the sleep widget shows it as `null` from the local read, then the API updates it when the response arrives. This is invisible to the user because the API update happens within 300ms.

### 3c — Mood log

Replace:
```ts
useEffect(() => {
  const today = todayInTz();
  cachedFetch<import("@/lib/types/mood").MoodLog | null>(
    `mood:${today}`, `/api/mood?date=${today}`, TTL_SHORT,
    (d) => setMoodLog(d ?? null),
  ).catch(() => setMoodLog(null));
}, []);
```

With:
```ts
useEffect(() => {
  const today = todayInTz();
  // Local read first
  if (userId) {
    readLocalMoodLog(userId, today).then(log => {
      if (log !== undefined) setMoodLog(log);  // undefined means "store not available"
    }).catch(() => {});
  }
  // API refresh
  cachedFetch<import("@/lib/types/mood").MoodLog | null>(
    `mood:${today}`, `/api/mood?date=${today}`, TTL_SHORT,
    (d) => setMoodLog(d ?? null),
  ).catch(() => setMoodLog(null));
}, [userId]);
```

### 3d — Calendar days and streak (training week strip)

The home screen already has `fetchWorkoutData` which calls:
- `cachedFetch('calendar-data:...')` → sets `calendarDays`
- `cachedFetch('streak-data', ...)` → merges into `calendarDays`

Add a local-first read before `fetchWorkoutData` fires:

```ts
// Local calendar — instant, derives from SQLite workout_sessions
useEffect(() => {
  if (!userId) return;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  readLocalCalendarDays(userId, tz).then(days => {
    if (days) setCalendarDays(prev => ({ ...days, ...prev }));
    // prev takes priority: if a prior readCacheSync/sessionStorage read already
    // populated calendarDays, don't erase it — merge local SQLite on top
  }).catch(() => {});
}, [userId]);
```

The existing `fetchWorkoutData` then calls the API in the background and overwrites with server data, which is the authoritative source for the calendar API endpoint (includes activity log dots too, not just workouts).

---

## Step 4 — Update `app/health/health-content.tsx`

The health tab has the most body metric fetches.

### 4a — Body metadata (useLayoutEffect seed)

Currently reads `readCacheSync('body-metadata')` in `useLayoutEffect` — already instant via localStorage fix. No change needed here.

### 4b — Body metrics async read

Find the `cachedFetch` for `body-metadata` in `useEffect` and add a local-first pass before it:

```ts
// Pass 1: local SQLite (APK only)
useEffect(() => {
  if (!userId) return;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  readLocalBodyMeta(userId, tz).then(local => {
    if (!local) return;
    setMetaToday(local.today);
    setMetaRecent(local.recent);
    setWeekToDate(local.weekToDate);
    setMetaLoading(false);
  }).catch(() => {});
}, [userId]);
```

Leave the existing `cachedFetch` call for `body-metadata` untouched — it runs in parallel and updates the UI when the network response arrives.

### 4c — Sleep sessions

Same two-pass pattern as home screen Step 3b.

---

## Step 5 — Update `app/nutrition/nutrition-content.tsx`

### 5a — Food logs

Currently:
```ts
cachedFetch<FoodLogWithItem[]>(
  `nutrition-food-logs-${today}`, `/api/nutrition/food-logs?date=${today}`, TTL_SHORT, 
  (d) => setFoodLogs(Array.isArray(d) ? d : []),
)
```

With local-first (after Plan 2 adds `getFoodLogs`):

```ts
// Local read: food log IDs + quantities (no food item details — those need API)
useEffect(() => {
  if (!userId) return;
  const today = todayInTz();
  const store = getLocalStore(userId);
  if (!store) return;
  store.getFoodLogs(today).then(logs => {
    if (logs.length) {
      // We have local logs, but food item details (name, macros per gram)
      // aren't cached locally yet. Show count as placeholder, let API fill in.
      setLocalFoodLogCount(logs.length);
    }
  }).catch(() => {});
}, [userId]);

// API still needed for food item details (name, macros)
cachedFetch<FoodLogWithItem[]>(...)
```

**Important caveat:** Local `food_logs` entries only store `foodItemId` and `quantityMultiplier` — not the food item's name or macro details. The full `FoodLogWithItem` response requires a JOIN with `food_items`. Two options:
1. **Simple approach:** show a placeholder count from local, let API fill in full details — the API response includes all the detail needed
2. **Full local approach:** also cache `food_items` locally in SQLite (adds complexity, plan separately if needed)

**Recommendation:** Use option 1 for now. The food log screen always needs the API for food item macros anyway. The main benefit of writing to SQLite first is offline write reliability (mutations_outbox), not offline read display. The nutrition tab reads are less critical than the home screen for instant display.

### 5b — Supplement status

After Plan 2, `supplements-section.tsx` reads supplement definitions from the API. Switch to local when available:

```ts
const store = userId ? getLocalStore(userId) : null;

// Read supplements and today's logs from local store
const [supplements, supplementLogs] = store
  ? await Promise.all([
      store.getSupplements(),
      store.getSupplementLogs(todayInTz()),
    ])
  : [null, null];

if (supplements?.length) {
  // Render from local — instant
  setSupplements(supplements.map(s => ({
    ...s,
    loggedToday: supplementLogs?.some(l => l.supplementId === s.id) ?? false,
  })));
} else {
  // Fall back to API (first load, or web)
  fetchSupplementsFromApi();
}
```

---

## Step 6 — Update `components/mood-checkin-sheet.tsx`

The mood sheet already writes to local store via `queueMutation`. It should also read from local store on open to pre-populate today's existing check-in.

Currently it receives `initialLog` as a prop from the parent. After Step 3c, the parent already reads from local store and passes the result as `moodLog` → `initialLog`. So no change needed in the sheet itself — the parent's local read handles it.

---

## Step 7 — `app/workout-select/workout-select-content.tsx` — no action needed

This screen reads:
- `workout-data:meta` → program structure (still server, cached 6h)
- `workout-card:{id}` → exercise details (still server, cached 6h)
- `exercise-library` → reference data (still server, cached 6h)
- `muscle-recovery` → computed from set_logs (still server)

All of these are server-computed and go through `cachedFetch` → SQLite `api_cache` → localStorage mirror. The localStorage fix means they load instantly on APK relaunch. No local-first changes needed here.

---

## Step 8 — `components/workout-screen.tsx` — no action needed

Same as Step 7. `workout-data:{sessionTab}` (exercise list with progression weights) requires a server JOIN across multiple tables. The 6h TTL + localStorage mirror means the workout screen loads instantly after the first use. No local-first changes needed.

---

## Files Changed (summary)

| File | Action |
|------|--------|
| `lib/local-store/mappers.ts` | **Create** — type mappers + `computeBodyMeta` + `sessionsToCalendarDays` |
| `lib/local-store/local-reads.ts` | **Create** — `readLocalBodyMeta`, `readLocalSleepSessions`, `readLocalMoodLog`, `readLocalCalendarDays` |
| `app/session-select/session-select-content.tsx` | Add local-first passes for body meta, sleep, mood, calendar |
| `app/health/health-content.tsx` | Add local-first pass for body meta + sleep |
| `app/nutrition/nutrition-content.tsx` | Add local-first supplement read; food logs partial (placeholder count) |

---

## Load order after all three plans are implemented

| ms | What happens |
|----|-------------|
| 0 | `useLayoutEffect` fires — `readCacheSync` → localStorage → recommendation card, streak, week strip, metric tiles all render with last session's values. Zero network needed. |
| 1–5 | Local SQLite reads complete — body metrics, sleep, mood, calendar dots all update with authoritative local data |
| 50–200 | `initSQLite` completes — `api_cache` reads now available for server-computed keys |
| 200–500 | Network responses arrive — next-session recommendation, readiness score, weekly stats update |

The user sees a fully-populated home screen within 5ms of mount. The 200-500ms network phase only updates computed/aggregated values that weren't available locally.

---

## Implementation order

Do these in order — each step is independently testable:

1. `lib/local-store/mappers.ts` — pure functions, no side effects, easy to unit test
2. `lib/local-store/local-reads.ts` — depends on mappers + store interface
3. `session-select-content.tsx` — highest user-visible impact
4. `health-content.tsx` — second highest impact
5. `nutrition-content.tsx` — supplements read (food logs partial)

---

## Testing checklist

1. **APK fresh launch (no network):** Open app in airplane mode. Home screen should show last session's data within 5ms — no skeleton on the recommendation card, metric tiles, week strip.
2. **Body metric read:** Log a body weight. Kill the APK. Reopen — the weight tile should show the new value instantly (from local SQLite), before the API responds.
3. **Mood log read:** Log today's mood check-in. Kill the APK. Reopen — the mood widget should show the logged emoji instantly.
4. **Calendar dots:** Complete a workout. Kill the APK. Reopen — today's training week dot should appear instantly (from local `workout_sessions`).
5. **Food log count:** Log two meals. Kill the APK. Reopen — placeholder count (e.g. "2 items") visible until food item details arrive from API.
6. **Web fallback:** All screens behave exactly as before on desktop browser — `getLocalStore()` returns null, API path used for everything.
7. **Data freshness:** Log a body metric remotely (via admin SQL on Railway). Open APK on network. Local data shows first (slightly stale), then API response updates it within 300ms.
8. **Supplement status:** Take a supplement (toggle). Kill APK. Reopen — supplement already shows checked (from local `supplement_logs` read).
