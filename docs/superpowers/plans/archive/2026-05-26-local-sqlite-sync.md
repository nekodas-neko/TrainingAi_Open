> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Local SQLite on Capacitor APK — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local SQLite storage to the Capacitor APK so workout sets can be logged offline and automatically synced to Railway on reconnection.

**Architecture:** `@capacitor-community/sqlite` stores workout data on-device in three mirrored tables. An outbox table holds unsynced writes. `workout-screen.tsx` generates a client-side UUID at session start, so offline records can be merged via UPSERT. A `SyncProvider` component drains the outbox to a new Railway endpoint on mount and app resume. Everything is gated by `Capacitor.isPluginAvailable('CapacitorSQLite')` — the PWA and old APK are unaffected until the new APK is sideloaded.

**Tech Stack:** `@capacitor-community/sqlite@^6`, `@capacitor/app` (already installed), Railway PostgreSQL + Drizzle ORM, Next.js 15 API routes.

---

## File Map

| Action | Path | Role |
|--------|------|------|
| Create | `lib/data/postgres/migrations/012_updated_at.sql` | Add `updated_at` to workout tables for sync ordering |
| Modify | `lib/data/postgres/adapter.ts` | Add `ensureWorkoutSession` (UPSERT by client ID) and `logExerciseWithId` |
| Modify | `lib/data/repository.ts` | Add `ensureWorkoutSession` to interface |
| Modify | `app/api/log-exercise/route.ts` | Use `ensureWorkoutSession` when client supplies a session ID |
| Create | `app/api/sync-workout/route.ts` | Batch-UPSERT endpoint for draining offline outbox |
| Create | `lib/sqlite/sqlite-service.ts` | Plugin wrapper — init, availability check, `runSQL`, `querySQL` |
| Create | `lib/sqlite/migrations.ts` | SQLite schema version history |
| Create | `lib/sqlite/outbox.ts` | Write workout data locally; drain to Railway |
| Create | `components/sync-provider.tsx` | Init SQLite on mount; drain on mount + app resume |
| Modify | `components/workout-screen.tsx` | Generate client UUID at session start; fall back to outbox on network failure |
| Modify | `app/layout.tsx` | Wrap app in `<SyncProvider>` |

---

## Task 1: Railway migration — add `updated_at` to workout tables

**Files:**
- Create: `lib/data/postgres/migrations/012_updated_at.sql`

The migration runner in `lib/data/postgres/client.ts` reads all `.sql` files from the `migrations/` directory alphabetically on server start — no registration needed.

- [ ] **Step 1: Write the migration**

```sql
-- lib/data/postgres/migrations/012_updated_at.sql
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workout_sessions' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE workout_sessions
      ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercise_logs' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE exercise_logs
      ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'set_logs' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE set_logs
      ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;
END $$;
```

- [ ] **Step 2: Commit**

```bash
git add lib/data/postgres/migrations/012_updated_at.sql
git commit -m "add updated_at columns to workout tables for offline sync ordering"
```

---

## Task 2: Add `ensureWorkoutSession` and `logExerciseWithId` to the Postgres adapter

When a client provides its own UUID as `workoutSessionId`, the existing route skips session creation (assuming it already exists). Offline-logged sessions don't exist on the server yet. We need UPSERT methods so clients can supply their own UUIDs without FK violations.

**Files:**
- Modify: `lib/data/postgres/adapter.ts`
- Modify: `lib/data/repository.ts`
- Modify: `app/api/log-exercise/route.ts`

- [ ] **Step 1: Add `ensureWorkoutSession` to the adapter**

In `lib/data/postgres/adapter.ts`, find the `createWorkoutSession` method and add `ensureWorkoutSession` directly after it:

```typescript
async ensureWorkoutSession(
  userId: string,
  sessionId: string,
  programSessionId: string | undefined,
  sessionName: string,
  startedAt: Date,
): Promise<void> {
  await getDb().execute(sql`
    INSERT INTO workout_sessions (id, user_id, session_id, session_name, started_at, updated_at)
    VALUES (
      ${sessionId}::uuid,
      ${userId}::uuid,
      ${programSessionId ?? null}::uuid,
      ${sessionName},
      ${startedAt},
      now()
    )
    ON CONFLICT (id) DO NOTHING
  `);
}
```

- [ ] **Step 2: Add `logExerciseWithId` to the adapter**

In `lib/data/postgres/adapter.ts`, find the `logExercise` method and add `logExerciseWithId` directly after it:

```typescript
async logExerciseWithId(log: Omit<ExerciseLog, 'sets'> & { id: string }): Promise<void> {
  await getDb().execute(sql`
    INSERT INTO exercise_logs (
      id, workout_session_id, exercise_name, style_id, style_name,
      estimated_1rm, target_80, volume, avg_reps, time_to_complete,
      logged_at, updated_at
    ) VALUES (
      ${log.id}::uuid,
      ${log.workoutSessionId}::uuid,
      ${log.exerciseName},
      ${log.styleId ?? null}::uuid,
      ${log.styleName ?? null},
      ${log.estimated1rm ?? null},
      ${log.target80 ?? null},
      ${log.volume ?? null},
      ${log.avgReps ?? null},
      ${log.timeToComplete ?? null},
      ${log.loggedAt},
      now()
    )
    ON CONFLICT (id) DO NOTHING
  `);
}
```

- [ ] **Step 3: Add `ensureWorkoutSession` to the `WorkoutRepository` interface**

In `lib/data/repository.ts`, in the `// ── Workout Logging ──` section, add:

```typescript
ensureWorkoutSession(userId: string, sessionId: string, programSessionId: string | undefined, sessionName: string, startedAt: Date): Promise<void>
```

- [ ] **Step 4: Update `log-exercise/route.ts` to use `ensureWorkoutSession` when the client provides an ID**

In `app/api/log-exercise/route.ts`, replace the `wsId` resolution block (the `let wsId = workoutSessionId; if (!wsId) { ... }` section, currently lines ~87–98) with:

```typescript
let wsId = workoutSessionId;
if (wsId) {
  // Client-supplied UUID — ensure the session row exists (UPSERT; idempotent)
  await repo.ensureWorkoutSession(userId, wsId, sessionId, sessionName, startOfDay);
} else {
  const todaySessions = await repo.getDayLog(userId, today);
  const existing = todaySessions.find(ws => ws.sessionName === sessionName && !ws.completedAt);
  if (existing) {
    wsId = existing.id;
  } else {
    const ws = await repo.createWorkoutSession(userId, sessionId, sessionName, startOfDay);
    wsId = ws.id;
  }
}
```

- [ ] **Step 5: Type-check**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/data/repository.ts lib/data/postgres/adapter.ts app/api/log-exercise/route.ts
git commit -m "add ensureWorkoutSession and logExerciseWithId UPSERT methods for offline sync"
```

---

## Task 3: Railway sync endpoint for offline workout data

**Files:**
- Create: `app/api/sync-workout/route.ts`

- [ ] **Step 1: Write the endpoint**

```typescript
// app/api/sync-workout/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getRepository } from '@/lib/data';
import { aestMidnight } from '@/lib/date-utils';
import type { ExerciseLog } from '@/lib/types';

interface SyncSetLog {
  id: string;
  setNumber: number;
  weightKg: number;
  reps: number;
  setTimeSec?: number;
  restTimeSec?: number;
  intensityPct?: number;
  useFor1rm: boolean;
}

interface SyncItem {
  workoutSessionId: string;
  sessionName: string;
  startedAt: string;        // ISO8601
  exerciseLogId: string;
  exercise: string;
  loggedAt: string;         // ISO8601
  styleId?: string;
  styleName?: string;
  estimated1rm: number;
  target80: number;
  volume: number;
  avgReps: number;
  timeToCompleteSet?: number;
  setLogs: SyncSetLog[];
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let items: SyncItem[];
  try {
    items = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ synced: 0 });
  }

  const repo = await getRepository();
  const pgRepo = repo as import('@/lib/data/postgres/adapter').PostgresWorkoutRepository;

  for (const item of items) {
    const [y, m, d] = item.startedAt.slice(0, 10).split('-').map(Number);
    const dayStart = aestMidnight(y, m, d);

    await repo.ensureWorkoutSession(
      userId,
      item.workoutSessionId,
      item.styleId,   // programSessionId — not stored offline, best-effort null
      item.sessionName,
      dayStart,
    );

    await pgRepo.logExerciseWithId({
      id: item.exerciseLogId,
      workoutSessionId: item.workoutSessionId,
      exerciseName: item.exercise,
      styleId: item.styleId,
      styleName: item.styleName,
      estimated1rm: item.estimated1rm,
      target80: item.target80,
      volume: item.volume,
      avgReps: item.avgReps,
      timeToComplete: item.timeToCompleteSet,
      muscleGroups: [],
      loggedAt: new Date(item.loggedAt),
    });

    await pgRepo.logSets(
      item.exerciseLogId,
      item.setLogs.map(s => ({
        setNumber: s.setNumber,
        weightKg: s.weightKg,
        reps: s.reps,
        setTimeSec: s.setTimeSec,
        restTimeSec: s.restTimeSec,
        intensityPct: s.intensityPct,
        useFor1rm: s.useFor1rm,
      })),
    );
  }

  return NextResponse.json({ synced: items.length });
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/sync-workout/route.ts
git commit -m "add sync-workout endpoint for draining offline workout outbox to Railway"
```

---

## Task 4: Install `@capacitor-community/sqlite`

This is the only step that requires an APK rebuild. All previous tasks are Railway-deployable and safe for existing APKs because the `isSQLiteAvailable()` guard (Task 5) ensures old builds without the plugin are unaffected.

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`
- Modify: `android/` (via `cap sync`)

- [ ] **Step 1: Install the package**

```bash
cd /home/user/TrainingAI && pnpm add @capacitor-community/sqlite@^6
```

Expected: package added to `package.json` and `node_modules`.

- [ ] **Step 2: Sync to Android**

```bash
npx cap sync android
```

Expected: output contains `✔ Updating Android plugins` and `✔ update android`. The plugin registers itself via Capacitor's auto-discovery in `MainActivity`.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml android/
git commit -m "install @capacitor-community/sqlite and sync to Android"
```

- [ ] **Step 4: Build and sideload APK**

Build from Android Studio or:
```bash
npx cap build android
```

Sideload the resulting `.apk` to the device. The SQLite feature will activate automatically once the new APK is installed.

---

## Task 5: SQLite service wrapper

**Files:**
- Create: `lib/sqlite/sqlite-service.ts`

- [ ] **Step 1: Write the service**

```typescript
// lib/sqlite/sqlite-service.ts
import { Capacitor } from '@capacitor/core';

export interface UpgradeStatement {
  toVersion: number;
  statements: string[];
}

// Lazily imported — avoids crash when module loads in browser where plugin is absent
type SQLiteDBConnection = import('@capacitor-community/sqlite').SQLiteDBConnection;

const DB_NAME = 'trainingai';
let _db: SQLiteDBConnection | null = null;
let _initPromise: Promise<void> | null = null;

export function isSQLiteAvailable(): boolean {
  return (
    Capacitor.isNativePlatform() &&
    Capacitor.isPluginAvailable('CapacitorSQLite')
  );
}

export async function initSQLite(upgrades: UpgradeStatement[]): Promise<void> {
  if (!isSQLiteAvailable()) return;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite');
    const conn = new SQLiteConnection(CapacitorSQLite);
    const dbVersion = upgrades[upgrades.length - 1]?.toVersion ?? 1;

    await conn.addUpgradeStatement({
      database: DB_NAME,
      upgrade: upgrades.map(u => ({
        toVersion: u.toVersion,
        statements: u.statements,
      })),
    });

    _db = await conn.createConnection(DB_NAME, false, 'no-encryption', dbVersion, false);
    await _db.open();
  })();

  return _initPromise;
}

export async function runSQL(sql: string, values?: unknown[]): Promise<void> {
  if (!_db) return;
  await _db.run(sql, values ?? []);
}

export async function querySQL<T = Record<string, unknown>>(
  sql: string,
  values?: unknown[],
): Promise<T[]> {
  if (!_db) return [];
  const result = await _db.query(sql, values ?? []);
  return (result.values ?? []) as T[];
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/sqlite/sqlite-service.ts
git commit -m "add SQLite service wrapper with lazy plugin import and availability guard"
```

---

## Task 6: SQLite schema migrations

**Files:**
- Create: `lib/sqlite/migrations.ts`

- [ ] **Step 1: Write the migrations file**

```typescript
// lib/sqlite/migrations.ts
import type { UpgradeStatement } from './sqlite-service';

// To add a new field in future: add a new { toVersion: N+1, statements: ['ALTER TABLE ...'] }
// entry. The plugin runs only the statements for versions the device hasn't seen yet.
export const MIGRATIONS: UpgradeStatement[] = [
  {
    toVersion: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS workout_sessions (
        id TEXT PRIMARY KEY,
        session_name TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        synced INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS exercise_logs (
        id TEXT PRIMARY KEY,
        workout_session_id TEXT NOT NULL,
        exercise_name TEXT NOT NULL,
        style_id TEXT,
        style_name TEXT,
        estimated_1rm REAL,
        target_80 REAL,
        volume REAL,
        avg_reps REAL,
        time_to_complete INTEGER,
        logged_at TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        synced INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS set_logs (
        id TEXT PRIMARY KEY,
        exercise_log_id TEXT NOT NULL,
        set_number INTEGER NOT NULL,
        weight_kg REAL NOT NULL,
        reps INTEGER NOT NULL,
        set_time_sec INTEGER,
        rest_time_sec INTEGER,
        intensity_pct REAL,
        use_for_1rm INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        synced INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS sync_outbox (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )`,
      `CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
    ],
  },
];
```

- [ ] **Step 2: Commit**

```bash
git add lib/sqlite/migrations.ts
git commit -m "add SQLite schema v1: workout_sessions, exercise_logs, set_logs, outbox"
```

---

## Task 7: Outbox service

**Files:**
- Create: `lib/sqlite/outbox.ts`

- [ ] **Step 1: Write the outbox module**

```typescript
// lib/sqlite/outbox.ts
import { runSQL, querySQL, isSQLiteAvailable } from './sqlite-service';

export interface OutboxPayload {
  workoutSessionId: string;
  sessionName: string;
  startedAt: string;          // ISO8601
  exerciseLogId: string;
  exercise: string;
  loggedAt: string;           // ISO8601
  weights: number[];
  reps: number[];
  sets: number;
  timeToCompleteSet?: number;
  setTimes?: number[];
  restTimes?: number[];
  styleName?: string;
  styleId?: string;
  estimated1rm: number;
  target80: number;
  volume: number;
  avgReps: number;
  setLogs: {
    id: string;
    setNumber: number;
    weightKg: number;
    reps: number;
    setTimeSec?: number;
    restTimeSec?: number;
    intensityPct?: number;
    useFor1rm: boolean;
  }[];
}

export async function writeLocalWorkout(
  payload: OutboxPayload,
  synced: boolean,
): Promise<void> {
  if (!isSQLiteAvailable()) return;

  await runSQL(
    `INSERT OR REPLACE INTO workout_sessions (id, session_name, started_at, synced)
     VALUES (?, ?, ?, ?)`,
    [payload.workoutSessionId, payload.sessionName, payload.startedAt, synced ? 1 : 0],
  );

  await runSQL(
    `INSERT OR REPLACE INTO exercise_logs
     (id, workout_session_id, exercise_name, style_id, style_name,
      estimated_1rm, target_80, volume, avg_reps, time_to_complete, logged_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.exerciseLogId,
      payload.workoutSessionId,
      payload.exercise,
      payload.styleId ?? null,
      payload.styleName ?? null,
      payload.estimated1rm,
      payload.target80,
      payload.volume,
      payload.avgReps,
      payload.timeToCompleteSet ?? null,
      payload.loggedAt,
      synced ? 1 : 0,
    ],
  );

  for (const s of payload.setLogs) {
    await runSQL(
      `INSERT OR REPLACE INTO set_logs
       (id, exercise_log_id, set_number, weight_kg, reps,
        set_time_sec, rest_time_sec, intensity_pct, use_for_1rm, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        s.id,
        payload.exerciseLogId,
        s.setNumber,
        s.weightKg,
        s.reps,
        s.setTimeSec ?? null,
        s.restTimeSec ?? null,
        s.intensityPct ?? null,
        s.useFor1rm ? 1 : 0,
        synced ? 1 : 0,
      ],
    );
  }
}

export async function addToOutbox(payload: OutboxPayload): Promise<void> {
  if (!isSQLiteAvailable()) return;
  await runSQL(
    'INSERT INTO sync_outbox (id, payload) VALUES (?, ?)',
    [crypto.randomUUID(), JSON.stringify(payload)],
  );
}

export async function drainOutbox(): Promise<void> {
  if (!isSQLiteAvailable()) return;

  const rows = await querySQL<{ id: string; payload: string }>(
    'SELECT id, payload FROM sync_outbox ORDER BY created_at ASC',
  );
  if (rows.length === 0) return;

  const items: OutboxPayload[] = rows.map(r => JSON.parse(r.payload));

  try {
    const res = await fetch('/api/sync-workout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(items),
    });
    if (!res.ok) return; // Leave outbox intact — retry next open

    for (const row of rows) {
      await runSQL('DELETE FROM sync_outbox WHERE id = ?', [row.id]);
    }
    await runSQL('UPDATE exercise_logs SET synced = 1 WHERE synced = 0');
    await runSQL('UPDATE workout_sessions SET synced = 1 WHERE synced = 0');
    await runSQL('UPDATE set_logs SET synced = 1 WHERE synced = 0');
  } catch {
    // Network unavailable — leave outbox intact for next attempt
  }
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/sqlite/outbox.ts
git commit -m "add SQLite outbox: write local workout data and drain to Railway on reconnect"
```

---

## Task 8: SyncProvider component

**Files:**
- Create: `components/sync-provider.tsx`

- [ ] **Step 1: Write the SyncProvider**

```typescript
// components/sync-provider.tsx
'use client';

import { createContext, useContext, useEffect, useRef } from 'react';
import { isSQLiteAvailable, initSQLite } from '@/lib/sqlite/sqlite-service';
import { MIGRATIONS } from '@/lib/sqlite/migrations';
import { drainOutbox } from '@/lib/sqlite/outbox';

interface SyncContextValue {
  drainOutbox: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue>({ drainOutbox: async () => {} });

export function useSyncContext() {
  return useContext(SyncContext);
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    if (!isSQLiteAvailable()) return;

    let cleanupAppListener: (() => void) | undefined;

    (async () => {
      await initSQLite(MIGRATIONS);
      await drainOutbox();

      try {
        const { App } = await import('@capacitor/app');
        const handle = await App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) drainOutbox();
        });
        cleanupAppListener = () => handle.remove();
      } catch {
        // Running outside Capacitor — no-op
      }
    })();

    const handleOnline = () => drainOutbox();
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('online', handleOnline);
      cleanupAppListener?.();
    };
  }, []);

  return (
    <SyncContext.Provider value={{ drainOutbox }}>
      {children}
    </SyncContext.Provider>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/sync-provider.tsx
git commit -m "add SyncProvider: init SQLite and drain outbox on mount and app resume"
```

---

## Task 9: Modify `workout-screen.tsx` to generate client UUID and buffer offline sets

**Files:**
- Modify: `components/workout-screen.tsx`

The current `handleCompleteSet` calls `/api/log-exercise` and updates UI only on success. The catch block shows a toast and discards the set. This task replaces that with:
1. A stable client UUID for the session generated at component mount
2. Pre-computed 1RM/volume values (needed for both online write-to-SQLite and offline outbox)
3. On success: write to SQLite as `synced = true`
4. On failure: write to SQLite as `synced = false`, add to outbox, **and advance the UI as if it succeeded** (optimistic update)

- [ ] **Step 1: Add imports at the top of `workout-screen.tsx`**

After the existing imports, add:

```typescript
import { writeLocalWorkout, addToOutbox } from '@/lib/sqlite/outbox';
import type { OutboxPayload } from '@/lib/sqlite/outbox';
```

- [ ] **Step 2: Change `workoutSessionIdRef` to hold a pre-generated UUID**

Find line ~73:
```typescript
const workoutSessionIdRef = useRef<string | null>(null);
```

Replace with:
```typescript
const workoutSessionIdRef = useRef<string>(crypto.randomUUID());
```

- [ ] **Step 3: Replace the `handleCompleteSet` try/catch block**

The existing `try` block spans from `const res = await fetch(...)` to the end of the state updates, with a `catch` that just shows a toast. Replace the **entire try/catch/finally** block with:

```typescript
// Pre-compute values needed for both online SQLite write and offline outbox
const newEst1rm = snapWeights.length > 0
  ? Math.max(...snapWeights.map((w, i) => calc1RM(w, snapReps[i] ?? 0)))
  : 0;
const computedVolume = Math.round(
  snapReps.reduce((sum, r, i) => sum + (snapWeights[i] ?? snapWeights[snapWeights.length - 1]) * r, 0) * 10,
) / 10;
const computedAvgReps = Math.round(
  snapReps.reduce((a, b) => a + b, 0) / snapReps.length * 10,
) / 10;

const outboxPayload: OutboxPayload = {
  workoutSessionId: workoutSessionIdRef.current,
  sessionName: sessionType,
  startedAt: workoutStartRef.current
    ? new Date(workoutStartRef.current).toISOString()
    : new Date().toISOString(),
  exerciseLogId: crypto.randomUUID(),
  exercise: ex.name,
  loggedAt: new Date().toISOString(),
  weights: snapWeights,
  reps: snapReps,
  sets,
  timeToCompleteSet: totalTime,
  setTimes: snapLapTimes.length > 0 ? snapLapTimes : undefined,
  restTimes: restTimes.length > 0 ? restTimes : undefined,
  styleName: ex.styleName ?? undefined,
  styleId: ex.styleId,
  estimated1rm: newEst1rm,
  target80: Math.round(newEst1rm * 0.8 * 4) / 4,
  volume: computedVolume,
  avgReps: computedAvgReps,
  setLogs: snapWeights.map((w, i) => ({
    id: crypto.randomUUID(),
    setNumber: i + 1,
    weightKg: w,
    reps: snapReps[i] ?? snapReps[snapReps.length - 1],
    setTimeSec: snapLapTimes[i],
    restTimeSec: restTimes[i],
    intensityPct: newEst1rm > 0
      ? Math.round(w / newEst1rm * 1000) / 10
      : undefined,
    useFor1rm: ex.progressionStyle?.[i]?.useFor1rm ?? false,
  })),
};

// Shared UI update — runs for both online and offline paths
const advanceUI = () => {
  invalidateCalendarCache();
  sessionStorage.removeItem(`ta_wc_${sessionType.toLowerCase()}`);
  setLoggedCount((c) => c + 1);
  setTodayLogged((prev) => new Set([...prev, ex.name]));
  setSessionLog((prev) => [...prev, { name: ex.name, setWeights: snapWeights, reps: snapReps }]);
  setSummaryData({
    exName: ex.name,
    setWeights: snapWeights,
    sets,
    reps: snapReps,
    lapTimes: snapLapTimes,
    restSec: accumulatedRestMs > 0 ? Math.round(accumulatedRestMs / 1000) : 0,
    prevEst1rm: ex.estimated1rm ?? null,
    newEst1rm,
    target80: Math.round(newEst1rm * 0.8 * 4) / 4,
    progressionStyle: ex.progressionStyle?.map((s) => ({ pct: s.pct, reps: s.reps })),
  });
  setCurrentSet(0);
  setLapTimes([]);
  setRestTimes([]);
  lapStartRef.current = null;
  setAccumulatedRestMs(0);
  restStartRef.current = null;
  setMode('exercise-summary');
};

try {
  const res = await fetch('/api/log-exercise', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionName: sessionType,
      workoutSessionId: workoutSessionIdRef.current,
      exercise: ex.name,
      weights: snapWeights,
      sets,
      reps: snapReps,
      localDate: localDatetimeString(),
      timeToCompleteSet: totalTime,
      setTimes: snapLapTimes.length > 0 ? snapLapTimes : undefined,
      restTimes: restTimes.length > 0 ? restTimes : undefined,
      progressionStyle: ex.progressionStyle ?? undefined,
      styleName: ex.styleName ?? undefined,
      styleId: ex.styleId,
      muscleGroups: ex.muscleGroups?.length ? ex.muscleGroups : undefined,
    }),
  });
  if (!res.ok) throw new Error('Write failed');
  const logResult = await res.json();
  if (logResult.workoutSessionId) workoutSessionIdRef.current = logResult.workoutSessionId;
  await writeLocalWorkout(
    { ...outboxPayload, workoutSessionId: workoutSessionIdRef.current },
    true,
  );
  advanceUI();
} catch {
  // Offline or server error — buffer locally and advance UI optimistically
  await writeLocalWorkout(outboxPayload, false);
  await addToOutbox(outboxPayload);
  advanceUI();
} finally {
  setLogging(false);
}
```

- [ ] **Step 4: Remove the now-duplicated inline state updates**

The original code had `setCurrentSet(0); setLapTimes([]); setRestTimes([]); lapStartRef.current = null; setAccumulatedRestMs(0); restStartRef.current = null; setMode("exercise-summary")` inside the try block. These are now in `advanceUI()`. Delete the originals inside the try block to avoid calling them twice.

- [ ] **Step 5: Type-check**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/workout-screen.tsx
git commit -m "generate stable client UUID at session start and buffer offline sets to SQLite outbox"
```

---

## Task 10: Wire SyncProvider into the root layout

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Import and add SyncProvider**

In `app/layout.tsx`, add the import:

```typescript
import { SyncProvider } from '@/components/sync-provider';
```

Find where `{children}` is rendered and wrap it:

```tsx
<SyncProvider>
  {children}
</SyncProvider>
```

Keep it inside any existing auth/session providers but outside workout-specific components.

- [ ] **Step 2: Type-check**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit and push to feature branch**

```bash
git add app/layout.tsx
git commit -m "wrap root layout in SyncProvider to activate SQLite on APK launch"
git push -u origin feat/local-sqlite-sync
```

---

## Testing Checklist

After Railway deploys and the new APK is sideloaded:

**SQLite initialises:**
- Open app → no crash
- Check Logcat: `adb logcat | grep -i sqlite` — no errors during init

**Online logging still works:**
- Log a set with wifi on
- Open Railway DB browser → `exercise_logs` row appears with correct data

**Offline logging works:**
- Turn off wifi on device
- Complete a full exercise (all sets) → UI advances to exercise-summary screen normally (optimistic)
- Turn wifi back on
- Re-open app or bring it to foreground
- Railway DB browser → the offline exercise appears within a few seconds

**Mixed session (online then offline):**
- Log 2 exercises online, then turn off wifi, log 1 exercise offline
- Reconnect
- All 3 exercises appear in Railway DB under the same `workout_session_id`

**Old APK unaffected:**
- Install old APK (without plugin), load app via Railway
- `isSQLiteAvailable()` returns false → all SQLite calls are no-ops
- Online logging works exactly as before
