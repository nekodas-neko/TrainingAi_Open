> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Local-First Sync Strategy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the local browser database the source of truth for reads AND writes — loads are always instant, writes commit locally first and sync to the server in the background, fully offline-capable.

**Architecture:** Dexie.js (IndexedDB) stores structured entity data per user (each user gets their own isolated database). A `LocalStore` interface abstracts both Dexie (web) and the existing Capacitor SQLite (APK). A `/api/sync/pull` endpoint delivers only records changed since `lastSyncAt` (capped at a 90-day window). A `/api/sync/push` endpoint accepts batched local mutations. Components read from the local store and write to it first — no network on the hot path. `SyncEngine` manages both directions: push pending mutations then pull delta on mount (with a 5-minute throttle), drain again on connectivity restore.

**Tech Stack:** Dexie.js (IndexedDB), Next.js API routes, Drizzle ORM, `@/auth` (existing auth pattern), `lib/date-utils` timezone helpers.

---

## Root cause of the current 1-second delay

`SyncProvider` runs 12 `warmCache()` calls **sequentially** — each reads localStorage then fires a `fetch()` if the TTL has expired. On cold cache that's ~12 network requests in series. Task 1 fixes this immediately; Tasks 2–10 replace the warmer with a proper local-first architecture.

---

## File Map

### New files
| File | Responsibility |
|------|----------------|
| `lib/data/postgres/migrations/069_updated_at_all_tables.sql` | Add `updated_at` + auto-trigger to tables that lack it |
| `lib/data/postgres/migrations/070_soft_deletes.sql` | Add `deleted_at` to user-deletable tables |
| `app/api/sync/pull/route.ts` | Delta pull: records changed since `lastSyncAt`, 90-day window max |
| `app/api/sync/push/route.ts` | Mutation push: accept batched body-metric / mood writes |
| `lib/local-store/types.ts` | Entity types + `PendingMutation` (includes `userId` for isolation) |
| `lib/local-store/dexie-backend.ts` | Dexie DB class + `DexieLocalStore` implementation |
| `lib/local-store/index.ts` | `LocalStore` interface + per-user factory `getLocalStore(userId)` |
| `lib/local-store/sync-engine.ts` | `pullDelta(userId)`, `pushMutations(userId)`, polling guard |

### Modified files
| File | Change |
|------|--------|
| `lib/data/postgres/schema.ts` | Add `updatedAt` + `deletedAt` to affected table definitions |
| `lib/data/repository.ts` | Add `getSyncDelta` + `SyncDelta` type; add `pushMutations` method |
| `lib/data/postgres/adapter.ts` | Implement `getSyncDelta` and `pushMutations` |
| `components/sync-provider.tsx` | Parallelize warm tasks (Task 1); wire SyncEngine with userId (Task 8) |

---

## Design decisions locked in

**Per-user Dexie database:** The database is named `trainingai-${userId}` so each user on the same browser origin has completely isolated data. No logout hook needed — a different user simply opens a different IndexedDB database and sees only their own data.

**Write conflict resolution — simple wins over clever:** When a local record has `syncStatus === 'pending'`, incoming server delta updates for that date are skipped entirely. The pending local write is pushed to the server first (SyncProvider always calls `pushMutations` before `pullDelta`). Once confirmed, `syncStatus` becomes `'synced'` and future delta pulls apply normally. This avoids field-level merge complexity while keeping single-device consistency. The only edge case — Samsung Health ingest writing a newer server record while a push is in flight — resolves itself on the next sync cycle.

**weights-summary stays in CACHE_TASKS:** It is computed from `personal_records` and `set_logs`, not from `body_metrics`. Dexie has no equivalent — this endpoint must keep its warm-cache path.

**body-metadata stays in CACHE_TASKS for fusion data:** The GET `/api/body-metadata` endpoint merges `body_metrics` + `food_logs` + `activityLogs` into a single response (weekly macros, calsBurnedToday, etc.). Dexie `LocalBodyMetric` stores only raw body_metrics columns. Components that need the fused shape still use `cachedFetch`. Dexie supplements it for the raw weight/BF%/steps display path, giving those instant loads.

**Lean outbox payloads:** `queueMutation` receives only the user-provided data fields. System fields (`syncStatus`, `updatedAt`, `deletedAt`) are never included in the payload stored in or pushed from the outbox.

**pushMutations checks per-mutation errors:** The server returns `{ processed, errors: [...] }`. Only mutations the server confirmed are removed from the outbox. Failed ones remain for retry on the next mount.

---

## Task 1: Parallelize cache warming (ships alone — immediate fix)

**Files:**
- Modify: `components/sync-provider.tsx:78`

- [ ] **Step 1.1: Replace the sequential loop**

In `components/sync-provider.tsx`, find:
```ts
// Warm caches sequentially to avoid hammering the server
for (const task of CACHE_TASKS) {
  if (cancelled) break;
  await warmCache(task);
}
```

Replace with:
```ts
if (!cancelled) {
  await Promise.all(CACHE_TASKS.map(warmCache));
}
```

- [ ] **Step 1.2: Verify all 12 requests fire simultaneously**

`pnpm dev` → Network tab → hard reload → confirm all cache-warming requests appear in parallel, not staggered. Total time should drop from ~1 s to ~200 ms.

- [ ] **Step 1.3: Commit**

```bash
git add components/sync-provider.tsx
git commit -m "parallelize SyncProvider cache warming to cut cold-load delay"
```

---

## Task 2: DB migrations — `updated_at` and `deleted_at`

**Files:**
- Create: `lib/data/postgres/migrations/069_updated_at_all_tables.sql`
- Create: `lib/data/postgres/migrations/070_soft_deletes.sql`
- Modify: `lib/data/postgres/schema.ts`

Migration 012 already added `updated_at` to `workout_sessions`, `exercise_logs`, `set_logs` at DB level (but not in Drizzle schema.ts). These have **no** `updated_at` at all: `body_metrics`, `sleep_sessions`, `mood_logs`, `activity_logs`, `progression_styles`, `style_sets`, `program_sessions`, `session_exercises`, `schedules`, `schedule_days`.

- [ ] **Step 2.1: Create migration 069**

Create `lib/data/postgres/migrations/069_updated_at_all_tables.sql`:

```sql
ALTER TABLE body_metrics       ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE sleep_sessions     ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE mood_logs          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE activity_logs      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE progression_styles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE style_sets         ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE program_sessions   ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE session_exercises  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE schedules          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE schedule_days      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'body_metrics','sleep_sessions','mood_logs','activity_logs',
    'progression_styles','style_sets','program_sessions','session_exercises',
    'schedules','schedule_days',
    'workout_sessions','exercise_logs','set_logs'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON %I', t);
    EXECUTE format('
      CREATE TRIGGER trg_set_updated_at
      BEFORE UPDATE ON %I
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
  END LOOP;
END;
$$;
```

- [ ] **Step 2.2: Create migration 070 — soft deletes**

Create `lib/data/postgres/migrations/070_soft_deletes.sql`:

```sql
-- Soft deletes allow delta sync to propagate deletions to the local store.
-- Only tables where users can explicitly delete records need this.
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE mood_logs    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
```

- [ ] **Step 2.3: Update Drizzle schema.ts**

Open `lib/data/postgres/schema.ts`. Follow the existing `programs.updatedAt` pattern.

**`workoutSessions`, `exerciseLogs`, `setLogs`** — column already in DB from migration 012, add to schema only:
```ts
// workoutSessions — add after completedAt:
updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

// exerciseLogs — add after loggedAt:
updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

// setLogs — add after useFor1rm:
updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
```

**For each of** `bodyMetrics`, `sleepSessions`, `activityLogs`, `progressionStyles`, `styleSets`, `programSessions`, `sessionExercises`, `schedules`, `scheduleDays` — add at end of column list:
```ts
updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
```

**`moodLogs`** — add both:
```ts
updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
deletedAt: timestamp('deleted_at', { withTimezone: true }),
```

**`bodyMetrics`** — add both:
```ts
updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
deletedAt: timestamp('deleted_at', { withTimezone: true }),
```

- [ ] **Step 2.4: Apply migrations and verify**

```bash
node scripts/local-db/migrate.js
```

```bash
psql "postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433" \
  -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'body_metrics' AND column_name IN ('updated_at','deleted_at') ORDER BY column_name;"
```

Expected: two rows returned.

- [ ] **Step 2.5: Compile check**

```bash
pnpm tsc --noEmit
```

Fix any errors from changed table shapes.

- [ ] **Step 2.6: Commit**

```bash
git add lib/data/postgres/migrations/069_updated_at_all_tables.sql \
        lib/data/postgres/migrations/070_soft_deletes.sql \
        lib/data/postgres/schema.ts
git commit -m "add updated_at and soft-delete columns for delta sync"
```

---

## Task 3: Repository methods — getSyncDelta + pushMutations

**Files:**
- Modify: `lib/data/repository.ts`
- Modify: `lib/data/postgres/adapter.ts`

- [ ] **Step 3.1: Add types and signatures to repository.ts**

In `lib/data/repository.ts`, add near the top:

```ts
export interface SyncDelta {
  programs:           unknown[];
  progressionStyles:  unknown[];
  bodyMetrics:        unknown[];   // includes rows with deletedAt set (tombstones)
  sleepSessions:      unknown[];
  moodLogs:           unknown[];   // includes tombstones
  activityLogs:       unknown[];
  workoutSessions:    unknown[];
  syncedAt:           string;      // ISO — use as next `since` value
}

export type MutationDomain = 'body_metrics' | 'mood_logs';

export interface IncomingMutation {
  domain:  MutationDomain;
  date:    string;              // YYYY-MM-DD — conflict key for upsert
  payload: Record<string, unknown>;
}

export interface PushResult {
  processed: number;
  errors:    Array<{ domain: string; date: string; error: string }>;
}
```

Add to the `WorkoutRepository` interface:
```ts
getSyncDelta(userId: string, since: Date, windowDays?: number): Promise<SyncDelta>;
pushMutations(userId: string, mutations: IncomingMutation[]): Promise<PushResult>;
```

- [ ] **Step 3.2: Implement getSyncDelta in adapter.ts**

```ts
async getSyncDelta(userId: string, since: Date, windowDays = 90): Promise<SyncDelta> {
  // Cap to windowDays to prevent multi-MB first-sync payloads
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const effectiveSince = since > windowStart ? since : windowStart;

  const [programs, progressionStyles, bodyMetrics, sleepSessions,
         moodLogs, activityLogs, workoutSessions] = await Promise.all([
    db.select().from(programsTable)
      .where(and(eq(programsTable.userId, userId), gt(programsTable.updatedAt, effectiveSince))),
    db.select().from(progressionStylesTable)
      .where(and(eq(progressionStylesTable.userId, userId), gt(progressionStylesTable.updatedAt, effectiveSince))),
    db.select().from(bodyMetricsTable)
      .where(and(eq(bodyMetricsTable.userId, userId), gt(bodyMetricsTable.updatedAt, effectiveSince))),
    db.select().from(sleepSessionsTable)
      .where(and(eq(sleepSessionsTable.userId, userId), gt(sleepSessionsTable.updatedAt, effectiveSince))),
    db.select().from(moodLogsTable)
      .where(and(eq(moodLogsTable.userId, userId), gt(moodLogsTable.updatedAt, effectiveSince))),
    db.select().from(activityLogsTable)
      .where(and(eq(activityLogsTable.userId, userId), gt(activityLogsTable.updatedAt, effectiveSince))),
    db.select().from(workoutSessionsTable)
      .where(and(eq(workoutSessionsTable.userId, userId), gt(workoutSessionsTable.updatedAt, effectiveSince))),
  ]);

  return { programs, progressionStyles, bodyMetrics, sleepSessions,
           moodLogs, activityLogs, workoutSessions, syncedAt: new Date().toISOString() };
}
```

Use the correct imported table names from the top of `adapter.ts`.

- [ ] **Step 3.3: Implement pushMutations in adapter.ts**

Note: Strip system fields (`syncStatus`, `updatedAt`, `deletedAt`) defensively before upserting, in case the payload arrived with them.

```ts
async pushMutations(userId: string, mutations: IncomingMutation[]): Promise<PushResult> {
  let processed = 0;
  const errors: PushResult['errors'] = [];

  for (const mut of mutations) {
    try {
      // Strip any local-store-only fields the client may have included
      const { syncStatus, updatedAt, deletedAt, ...clean } = mut.payload as Record<string, unknown>;
      void syncStatus; void updatedAt; void deletedAt;

      if (mut.domain === 'body_metrics') {
        const p = clean as {
          weightKg?: number | null; bodyFatPct?: number | null; calories?: number | null;
          proteinG?: number | null; carbsG?: number | null; fatG?: number | null;
          steps?: number | null; distanceKm?: number | null; waterMl?: number | null;
          restingHeartRate?: number | null; hrvMs?: number | null; spo2Pct?: number | null;
        };
        await repo.upsertBodyMetrics(userId, [{ date: mut.date, ...p }]);
        processed++;
      } else if (mut.domain === 'mood_logs') {
        const p = clean as {
          energyLevel: string; sleepQuality: string;
          bodyState: string[]; soreMuscles: string[];
        };
        await repo.saveMoodLog(userId, { logDate: mut.date, ...p });
        processed++;
      }
    } catch (err) {
      errors.push({ domain: mut.domain, date: mut.date, error: String(err) });
    }
  }

  return { processed, errors };
}
```

- [ ] **Step 3.4: Compile check**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 3.5: Commit**

```bash
git add lib/data/repository.ts lib/data/postgres/adapter.ts
git commit -m "add getSyncDelta and pushMutations repository methods"
```

---

## Task 4: API endpoints — pull and push

**Files:**
- Create: `app/api/sync/pull/route.ts`
- Create: `app/api/sync/push/route.ts`

- [ ] **Step 4.1: Create the pull endpoint**

Create `app/api/sync/pull/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { repo } from '@/lib/data/postgres/adapter';

export async function GET(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sinceParam = req.nextUrl.searchParams.get('since');
  const since = sinceParam ? new Date(sinceParam) : new Date(0);

  const delta = await repo.getSyncDelta(userId, since);
  return NextResponse.json(delta, { headers: { 'Cache-Control': 'private, no-store' } });
}
```

- [ ] **Step 4.2: Create the push endpoint**

Create `app/api/sync/push/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { repo } from '@/lib/data/postgres/adapter';
import { z } from 'zod';

const MutationSchema = z.object({
  domain:  z.enum(['body_metrics', 'mood_logs']),
  date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payload: z.record(z.unknown()),
});

const PushSchema = z.object({
  mutations: z.array(MutationSchema).max(100),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = PushSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });

  const result = await repo.pushMutations(userId, parsed.data.mutations);
  return NextResponse.json(result);
}
```

- [ ] **Step 4.3: Test pull endpoint**

With `pnpm dev` running and signed in:
```js
const r = await fetch('/api/sync/pull?since=1970-01-01T00:00:00.000Z');
const d = await r.json();
console.log(Object.keys(d), 'bodyMetrics:', d.bodyMetrics?.length, 'syncedAt:', d.syncedAt);
```

Expected: all domain keys present; `bodyMetrics` returns last 90 days only (not all history); `syncedAt` is a recent ISO string.

- [ ] **Step 4.4: Test push endpoint**

```js
const r = await fetch('/api/sync/push', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    mutations: [{ domain: 'mood_logs', date: '2026-06-16',
      payload: { energyLevel: 'high', sleepQuality: 'good', bodyState: [], soreMuscles: [] } }]
  })
});
console.log(await r.json()); // { processed: 1, errors: [] }
```

- [ ] **Step 4.5: Commit**

```bash
git add app/api/sync/pull/route.ts app/api/sync/push/route.ts
git commit -m "add delta sync pull and push endpoints"
```

---

## Task 5: Dexie local store — types and database class

**Files:**
- Create: `lib/local-store/types.ts`
- Create: `lib/local-store/dexie-backend.ts`

- [ ] **Step 5.1: Install Dexie**

```bash
pnpm add dexie
git add package.json pnpm-lock.yaml
git commit -m "add dexie for IndexedDB local store"
```

- [ ] **Step 5.2: Create types.ts**

Create `lib/local-store/types.ts`:

```ts
// date-keyed tables use YYYY-MM-DD as primary key (one record per day).
// id-keyed tables use server-assigned UUIDs.

export interface LocalBodyMetric {
  date:             string;       // primary key — YYYY-MM-DD
  weightKg:         number | null;
  bodyFatPct:       number | null;
  steps:            number | null;
  calories:         number | null;
  proteinG:         number | null;
  carbsG:           number | null;
  fatG:             number | null;
  waterMl:          number | null;
  restingHeartRate: number | null;
  hrvMs:            number | null;
  spo2Pct:          number | null;
  updatedAt:        string;       // ISO
  deletedAt:        string | null;
  syncStatus:       'pending' | 'synced';
}

export interface LocalMoodLog {
  logDate:      string;           // primary key — YYYY-MM-DD
  energyLevel:  string;
  sleepQuality: string;
  bodyState:    string[];
  soreMuscles:  string[];
  updatedAt:    string;
  deletedAt:    string | null;
  syncStatus:   'pending' | 'synced';
}

export interface LocalSleepSession {
  id:              string;
  date:            string;
  durationHours:   number | null;
  deepSleepHours:  number | null;
  remSleepHours:   number | null;
  lightSleepHours: number | null;
  updatedAt:       string;
}

export interface LocalWorkoutSession {
  id:          string;
  sessionName: string;
  startedAt:   string;
  completedAt: string | null;
  updatedAt:   string;
}

export interface LocalActivityLog {
  id:           string;
  date:         string;
  activityType: string;
  title:        string;
  durationMin:  number | null;
  distanceKm:   number | null;
  updatedAt:    string;
}

export interface LocalProgram {
  id:        string;
  name:      string;
  isActive:  boolean;
  updatedAt: string;
}

export interface LocalProgressionStyle {
  id:        string;
  name:      string;
  updatedAt: string;
}

// Lean outbox entry — payload contains ONLY user-provided fields,
// never syncStatus / updatedAt / deletedAt.
export interface PendingMutation {
  id:        string;    // client UUID for this outbox record
  userId:    string;    // owner — ensures mutations aren't pushed under wrong session
  domain:    'body_metrics' | 'mood_logs';
  date:      string;    // entity date key (YYYY-MM-DD)
  payload:   Record<string, unknown>;
  createdAt: string;
}

export interface SyncMeta {
  key:   string;
  value: string;
}
```

- [ ] **Step 5.3: Create dexie-backend.ts**

Create `lib/local-store/dexie-backend.ts`. This file contains both the Dexie DB class and the `DexieLocalStore` implementation of `LocalStore`.

```ts
import Dexie, { type Table } from 'dexie';
import type {
  LocalBodyMetric, LocalMoodLog, LocalSleepSession, LocalWorkoutSession,
  LocalActivityLog, LocalProgram, LocalProgressionStyle, PendingMutation, SyncMeta,
} from './types';
import type { LocalStore } from './index';

// ── Dexie DB class ──────────────────────────────────────────────────────────

class TrainingAILocalDB extends Dexie {
  bodyMetrics!:       Table<LocalBodyMetric, string>;
  moodLogs!:          Table<LocalMoodLog, string>;
  sleepSessions!:     Table<LocalSleepSession, string>;
  workoutSessions!:   Table<LocalWorkoutSession, string>;
  activityLogs!:      Table<LocalActivityLog, string>;
  programs!:          Table<LocalProgram, string>;
  progressionStyles!: Table<LocalProgressionStyle, string>;
  mutationsOutbox!:   Table<PendingMutation, string>;
  syncMeta!:          Table<SyncMeta, string>;

  constructor(userId: string) {
    // Per-user database — each user on this browser gets isolated storage.
    super(`trainingai-${userId}`);
    this.version(1).stores({
      bodyMetrics:       'date, updatedAt, syncStatus',
      moodLogs:          'logDate, updatedAt, syncStatus',
      sleepSessions:     'id, date, updatedAt',
      workoutSessions:   'id, startedAt, updatedAt',
      activityLogs:      'id, date, updatedAt',
      programs:          'id, isActive, updatedAt',
      progressionStyles: 'id, updatedAt',
      mutationsOutbox:   'id, userId, domain, date, createdAt',
      syncMeta:          'key',
    });
  }
}

// ── DexieLocalStore ─────────────────────────────────────────────────────────

export class DexieLocalStore implements LocalStore {
  private db: TrainingAILocalDB;

  constructor(userId: string) {
    this.db = new TrainingAILocalDB(userId);
  }

  async getBodyMetrics(cutoffDate: string): Promise<LocalBodyMetric[]> {
    return this.db.bodyMetrics
      .where('date').aboveOrEqual(cutoffDate)
      .filter(r => r.deletedAt == null)
      .toArray();
  }

  async getMoodLogs(cutoffDate: string): Promise<LocalMoodLog[]> {
    return this.db.moodLogs
      .where('logDate').aboveOrEqual(cutoffDate)
      .filter(r => r.deletedAt == null)
      .toArray();
  }

  async getSleepSessions(cutoffDate: string): Promise<LocalSleepSession[]> {
    return this.db.sleepSessions.where('date').aboveOrEqual(cutoffDate).toArray();
  }

  async getWorkoutSessions(cutoffDate: string): Promise<LocalWorkoutSession[]> {
    return this.db.workoutSessions.where('startedAt').aboveOrEqual(cutoffDate).toArray();
  }

  async getActivityLogs(cutoffDate: string): Promise<LocalActivityLog[]> {
    return this.db.activityLogs.where('date').aboveOrEqual(cutoffDate).toArray();
  }

  async getPrograms(): Promise<LocalProgram[]> {
    return this.db.programs.toArray();
  }

  async getProgressionStyles(): Promise<LocalProgressionStyle[]> {
    return this.db.progressionStyles.toArray();
  }

  async upsertBodyMetric(record: LocalBodyMetric): Promise<void> {
    await this.db.bodyMetrics.put(record);
  }

  async upsertMoodLog(record: LocalMoodLog): Promise<void> {
    await this.db.moodLogs.put(record);
  }

  async applyDelta(delta: Parameters<LocalStore['applyDelta']>[0]): Promise<void> {
    const { db } = this;
    await db.transaction('rw',
      [db.bodyMetrics, db.moodLogs, db.sleepSessions,
       db.workoutSessions, db.activityLogs, db.programs, db.progressionStyles],
      async () => {
        // bodyMetrics and moodLogs: skip server update if local write is pending.
        // Rationale: SyncProvider always pushes before pulling, so if a record is
        // still pending it means push failed. Let the pending write win; the correct
        // server state will arrive on the next successful push+pull cycle.
        if (delta.bodyMetrics?.length) {
          for (const r of delta.bodyMetrics) {
            if (r.deletedAt) {
              await db.bodyMetrics.delete(r.date);
            } else {
              const existing = await db.bodyMetrics.get(r.date);
              if (!existing || existing.syncStatus === 'synced') {
                await db.bodyMetrics.put({ ...r, syncStatus: 'synced' });
              }
              // If existing.syncStatus === 'pending': skip — local write takes priority
            }
          }
        }

        if (delta.moodLogs?.length) {
          for (const r of delta.moodLogs) {
            if (r.deletedAt) {
              await db.moodLogs.delete(r.logDate);
            } else {
              const existing = await db.moodLogs.get(r.logDate);
              if (!existing || existing.syncStatus === 'synced') {
                await db.moodLogs.put({ ...r, syncStatus: 'synced' });
              }
            }
          }
        }

        // These tables have no local-first writes yet — bulkPut is safe.
        if (delta.sleepSessions?.length)
          await db.sleepSessions.bulkPut(delta.sleepSessions);
        if (delta.workoutSessions?.length)
          await db.workoutSessions.bulkPut(delta.workoutSessions);
        if (delta.activityLogs?.length)
          await db.activityLogs.bulkPut(delta.activityLogs);
        if (delta.programs?.length)
          await db.programs.bulkPut(delta.programs);
        if (delta.progressionStyles?.length)
          await db.progressionStyles.bulkPut(delta.progressionStyles);
      }
    );
  }

  async queueMutation(m: Omit<PendingMutation, 'id' | 'createdAt'>): Promise<void> {
    await this.db.mutationsOutbox.put({
      ...m,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    });
  }

  async getPendingMutations(userId: string): Promise<PendingMutation[]> {
    return this.db.mutationsOutbox
      .where('userId').equals(userId)
      .sortBy('createdAt');
  }

  async deleteMutations(ids: string[]): Promise<void> {
    await this.db.mutationsOutbox.bulkDelete(ids);
  }

  async getLastSyncAt(): Promise<Date> {
    const row = await this.db.syncMeta.get('lastSyncAt');
    return row ? new Date(row.value) : new Date(0);
  }

  async setLastSyncAt(iso: string): Promise<void> {
    await this.db.syncMeta.put({ key: 'lastSyncAt', value: iso });
  }
}
```

- [ ] **Step 5.4: Verify Dexie opens in browser**

With `pnpm dev` running and signed in, open DevTools console:
```js
// Replace USER_ID with the actual user ID from the session
const { DexieLocalStore } = await import('/lib/local-store/dexie-backend.js');
const store = new DexieLocalStore('test-user-id');
console.log('DB name:', store.db?.name);
```

Expected: `DB name: trainingai-test-user-id`

Check Application → IndexedDB: a `trainingai-test-user-id` database should appear with all object stores.

- [ ] **Step 5.5: Commit**

```bash
git add lib/local-store/types.ts lib/local-store/dexie-backend.ts
git commit -m "add per-user Dexie local store with entity schemas and DexieLocalStore implementation"
```

---

## Task 6: LocalStore interface and factory

**Files:**
- Create: `lib/local-store/index.ts`

The interface is kept in this file alongside the factory. The implementation lives in `dexie-backend.ts` (Task 5). When APK SQLite support is added later, a `SQLiteLocalStore` can be dropped in as a second implementation without touching this file.

- [ ] **Step 6.1: Create index.ts**

Create `lib/local-store/index.ts`:

```ts
import type {
  LocalBodyMetric, LocalMoodLog, LocalSleepSession, LocalWorkoutSession,
  LocalActivityLog, LocalProgram, LocalProgressionStyle, PendingMutation,
} from './types';

export interface LocalStore {
  // Reads
  getBodyMetrics(cutoffDate: string): Promise<LocalBodyMetric[]>;
  getMoodLogs(cutoffDate: string): Promise<LocalMoodLog[]>;
  getSleepSessions(cutoffDate: string): Promise<LocalSleepSession[]>;
  getWorkoutSessions(cutoffDate: string): Promise<LocalWorkoutSession[]>;
  getActivityLogs(cutoffDate: string): Promise<LocalActivityLog[]>;
  getPrograms(): Promise<LocalProgram[]>;
  getProgressionStyles(): Promise<LocalProgressionStyle[]>;

  // Local-first writes (write to store first, then queue for push)
  upsertBodyMetric(record: LocalBodyMetric): Promise<void>;
  upsertMoodLog(record: LocalMoodLog): Promise<void>;

  // Bulk write from delta sync
  applyDelta(delta: {
    bodyMetrics?:       LocalBodyMetric[];
    moodLogs?:          LocalMoodLog[];
    sleepSessions?:     LocalSleepSession[];
    workoutSessions?:   LocalWorkoutSession[];
    activityLogs?:      LocalActivityLog[];
    programs?:          LocalProgram[];
    progressionStyles?: LocalProgressionStyle[];
  }): Promise<void>;

  // Outbox
  queueMutation(m: Omit<PendingMutation, 'id' | 'createdAt'>): Promise<void>;
  getPendingMutations(userId: string): Promise<PendingMutation[]>;
  deleteMutations(ids: string[]): Promise<void>;

  // Sync meta
  getLastSyncAt(): Promise<Date>;
  setLastSyncAt(iso: string): Promise<void>;
}

// Per-user factory. Each call with the same userId returns the same instance.
const _stores = new Map<string, LocalStore>();

export function getLocalStore(userId: string): LocalStore | null {
  if (typeof window === 'undefined') return null;
  if (!_stores.has(userId)) {
    // Dynamic import keeps Dexie out of the SSR bundle
    const { DexieLocalStore } = require('./dexie-backend') as typeof import('./dexie-backend');
    _stores.set(userId, new DexieLocalStore(userId));
  }
  return _stores.get(userId)!;
}
```

- [ ] **Step 6.2: Compile check**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 6.3: Commit**

```bash
git add lib/local-store/index.ts
git commit -m "add LocalStore interface and per-user factory"
```

---

## Task 7: SyncEngine — pullDelta, pushMutations, polling guard

**Files:**
- Create: `lib/local-store/sync-engine.ts`

- [ ] **Step 7.1: Create sync-engine.ts**

Create `lib/local-store/sync-engine.ts`:

```ts
import { getLocalStore } from './index';
import type { SyncDelta } from '@/lib/data/repository';
import type {
  LocalBodyMetric, LocalMoodLog, LocalSleepSession,
  LocalWorkoutSession, LocalActivityLog, LocalProgram, LocalProgressionStyle,
} from './types';

const MIN_SYNC_INTERVAL_MS = 5 * 60 * 1000;

// Module-level cache of last sync time to avoid an async Dexie read on the
// hot path (connectivity restore, mount).
let lastSyncMs = 0;

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export async function pullDelta(userId: string): Promise<{ synced: number } | null> {
  const store = getLocalStore(userId);
  if (!store) return null;

  // Throttle to once every 5 minutes
  if (Date.now() - lastSyncMs < MIN_SYNC_INTERVAL_MS) return null;

  // Fall back to Dexie for the authoritative timestamp (survives page refresh)
  const lastSync = await store.getLastSyncAt();

  let raw: SyncDelta;
  try {
    const res = await fetch(`/api/sync/pull?since=${lastSync.toISOString()}`);
    if (!res.ok) return null;
    raw = (await res.json()) as SyncDelta;
  } catch {
    return null;
  }

  const bodyMetrics = (raw.bodyMetrics as Record<string, unknown>[]).map(r => ({
    date:             String(r.date),
    weightKg:         (r.weightKg as number) ?? null,
    bodyFatPct:       (r.bodyFatPct as number) ?? null,
    steps:            (r.steps as number) ?? null,
    calories:         (r.calories as number) ?? null,
    proteinG:         (r.proteinG as number) ?? null,
    carbsG:           (r.carbsG as number) ?? null,
    fatG:             (r.fatG as number) ?? null,
    waterMl:          (r.waterMl as number) ?? null,
    restingHeartRate: (r.restingHeartRate as number) ?? null,
    hrvMs:            (r.hrvMs as number) ?? null,
    spo2Pct:          (r.spo2Pct as number) ?? null,
    updatedAt:        toIso(r.updatedAt),
    deletedAt:        r.deletedAt ? toIso(r.deletedAt) : null,
    syncStatus:       'synced' as const,
  } satisfies LocalBodyMetric));

  const moodLogs = (raw.moodLogs as Record<string, unknown>[]).map(r => ({
    logDate:      String(r.logDate),
    energyLevel:  String(r.energyLevel),
    sleepQuality: String(r.sleepQuality),
    bodyState:    (r.bodyState as string[]) ?? [],
    soreMuscles:  (r.soreMuscles as string[]) ?? [],
    updatedAt:    toIso(r.updatedAt),
    deletedAt:    r.deletedAt ? toIso(r.deletedAt) : null,
    syncStatus:   'synced' as const,
  } satisfies LocalMoodLog));

  const sleepSessions = (raw.sleepSessions as Record<string, unknown>[]).map(r => ({
    id:              String(r.id),
    date:            String(r.date),
    durationHours:   (r.durationHours as number) ?? null,
    deepSleepHours:  (r.deepSleepHours as number) ?? null,
    remSleepHours:   (r.remSleepHours as number) ?? null,
    lightSleepHours: (r.lightSleepHours as number) ?? null,
    updatedAt:       toIso(r.updatedAt),
  } satisfies LocalSleepSession));

  const workoutSessions = (raw.workoutSessions as Record<string, unknown>[]).map(r => ({
    id:          String(r.id),
    sessionName: String(r.sessionName),
    startedAt:   toIso(r.startedAt),
    completedAt: r.completedAt ? toIso(r.completedAt) : null,
    updatedAt:   toIso(r.updatedAt),
  } satisfies LocalWorkoutSession));

  const activityLogs = (raw.activityLogs as Record<string, unknown>[]).map(r => ({
    id:           String(r.id),
    date:         String(r.date),
    activityType: String(r.activityType),
    title:        String(r.title),
    durationMin:  (r.durationMin as number) ?? null,
    distanceKm:   (r.distanceKm as number) ?? null,
    updatedAt:    toIso(r.updatedAt),
  } satisfies LocalActivityLog));

  const programs = (raw.programs as Record<string, unknown>[]).map(r => ({
    id:        String(r.id),
    name:      String(r.name),
    isActive:  Boolean(r.isActive),
    updatedAt: toIso(r.updatedAt),
  } satisfies LocalProgram));

  const progressionStyles = (raw.progressionStyles as Record<string, unknown>[]).map(r => ({
    id:        String(r.id),
    name:      String(r.name),
    updatedAt: toIso(r.updatedAt),
  } satisfies LocalProgressionStyle));

  const count = bodyMetrics.length + moodLogs.length + sleepSessions.length +
    workoutSessions.length + activityLogs.length + programs.length + progressionStyles.length;

  await store.applyDelta({ bodyMetrics, moodLogs, sleepSessions,
    workoutSessions, activityLogs, programs, progressionStyles });
  await store.setLastSyncAt(raw.syncedAt);
  lastSyncMs = Date.now();

  return { synced: count };
}

export async function pushMutations(userId: string): Promise<{ pushed: number } | null> {
  const store = getLocalStore(userId);
  if (!store) return null;

  const pending = await store.getPendingMutations(userId);
  if (pending.length === 0) return { pushed: 0 };

  let res: Response;
  try {
    res = await fetch('/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mutations: pending.map(m => ({ domain: m.domain, date: m.date, payload: m.payload })),
      }),
    });
    if (!res.ok) return null;
  } catch {
    return null;
  }

  const result = await res.json() as { processed: number; errors: Array<{ domain: string; date: string }> };

  // Only remove outbox entries that the server confirmed. Failed ones stay for retry.
  const failedKeys = new Set(result.errors.map(e => `${e.domain}:${e.date}`));
  const confirmed = pending.filter(m => !failedKeys.has(`${m.domain}:${m.date}`));

  await store.deleteMutations(confirmed.map(m => m.id));

  // Mark confirmed local records as synced
  for (const m of confirmed) {
    if (m.domain === 'body_metrics') {
      const recs = await store.getBodyMetrics(m.date);
      const rec = recs.find(r => r.date === m.date);
      if (rec) await store.upsertBodyMetric({ ...rec, syncStatus: 'synced' });
    } else if (m.domain === 'mood_logs') {
      const recs = await store.getMoodLogs(m.date);
      const rec = recs.find(r => r.logDate === m.date);
      if (rec) await store.upsertMoodLog({ ...rec, syncStatus: 'synced' });
    }
  }

  return { pushed: confirmed.length };
}
```

- [ ] **Step 7.2: Commit**

```bash
git add lib/local-store/sync-engine.ts
git commit -m "add SyncEngine with per-user pull/push, error-checking, and 5-minute polling guard"
```

---

## Task 8: Wire SyncEngine into SyncProvider

**Files:**
- Modify: `components/sync-provider.tsx`

Important: `weights-summary` stays in CACHE_TASKS — it is computed from `personal_records` and `set_logs`, not from body metrics, and has no Dexie replacement. `body-metadata` also stays, as the GET endpoint merges food_logs and activity calories that are not in `LocalBodyMetric`. Only `sleep-sessions` is removed since `LocalSleepSession` covers the raw data components need.

- [ ] **Step 8.1: Add imports and update CACHE_TASKS**

Add to imports in `components/sync-provider.tsx`:
```ts
import { pullDelta, pushMutations } from '@/lib/local-store/sync-engine';
```

Update `CACHE_TASKS` — remove `sleep-sessions` only (now served from Dexie):
```ts
const CACHE_TASKS: CacheTask[] = [
  { key: 'body-metadata',      url: '/api/body-metadata',         ttl: TTL_MEDIUM },
  // sleep-sessions removed — now served from Dexie local store
  { key: 'next-session',       url: '/api/next-session',          ttl: TTL_SHORT  },
  { key: 'weekly-stats',       url: '/api/weekly-stats',          ttl: TTL_MEDIUM },
  { key: 'workout-data:meta',  url: '/api/workout-data?tab=meta', ttl: TTL_LONG   },
  { key: 'progression-styles', url: '/api/progression-styles',    ttl: TTL_LONG   },
  { key: 'workout-templates',  url: '/api/workout-templates',     ttl: TTL_LONG   },
  { key: 'exercise-library',   url: '/api/exercise-library',      ttl: TTL_LONG   },
  { key: 'activity-types',     url: '/api/activity-types',        ttl: TTL_LONG   },
  { key: 'weights-summary',    url: '/api/weights-summary',       ttl: TTL_MEDIUM },
  { key: 'progress-summary',   url: '/api/progress-summary',      ttl: TTL_MEDIUM },
  { key: 'user-goals',         url: '/api/user/goals',            ttl: TTL_MEDIUM },
];
```

- [ ] **Step 8.2: Add SyncEngine calls with userId**

The SyncProvider needs the current user's ID. Check how the existing code gets it — look for `useSession` or a prop. If not already available, import and use `useSession` from the auth library:

```ts
import { useSession } from '@/auth/react'; // check exact import path from other components

export function SyncProvider() {
  const { data: session } = useSession();
  const userId = session?.user?.id;

  useEffect(() => {
    if (!userId) return; // wait for session before syncing
    let cancelled = false;

    (async () => {
      try { await initSQLite(MIGRATIONS); } catch { return; }
      if (cancelled) return;

      // Push pending local mutations first, then pull server changes.
      // Order matters: push ensures the server has latest local data before
      // we pull, preventing the server from overwriting un-pushed local writes.
      try { await pushMutations(userId); } catch { /* network unavailable */ }
      if (cancelled) return;

      try { await drainOutbox(); } catch { /* network unavailable */ }
      if (cancelled) return;

      try { await pullDelta(userId); } catch { /* network unavailable */ }
      if (cancelled) return;

      if (!cancelled) await Promise.all(CACHE_TASKS.map(warmCache));
    })();

    return () => { cancelled = true; };
  }, [userId]);

  // On connectivity restore
  useEffect(() => {
    if (!userId) return;
    let handle: { remove: () => void } | undefined;
    import('@capacitor/network').then(({ Network }) => {
      Network.addListener('networkStatusChange', (status) => {
        if (status.connected) {
          pushMutations(userId).catch(() => {});
          drainOutbox().catch(() => {});
          pullDelta(userId).catch(() => {});
        }
      }).then(h => { handle = h; });
    });
    return () => { handle?.remove(); };
  }, [userId]);

  // ... existing meal reminder useEffect unchanged ...
```

- [ ] **Step 8.3: Verify sync sequence**

Reload app → DevTools Network:
1. Confirm `POST /api/sync/push` fires first (if there are pending mutations)
2. Confirm `GET /api/sync/pull?since=...` fires after
3. On second reload within 5 minutes: confirm `/api/sync/pull` does NOT fire (polling guard)

- [ ] **Step 8.4: Commit**

```bash
git add components/sync-provider.tsx
git commit -m "wire SyncEngine into SyncProvider with push-before-pull ordering and userId scoping"
```

---

## Task 9: Component reads — instant loads from local store

**Files:**
- The sleep-sessions consumer (find with: `grep -r "sleep-sessions\|sleepSessions" app/ components/ --include="*.tsx" -l`)

**Scope:** Only sleep sessions are moved to Dexie reads in this task. Body weight display also benefits, but `body-metadata` stays in CACHE_TASKS because the merged response (food_logs macros, calsBurnedToday) is still needed by some components. Add Dexie as a supplemental fast-path for raw weight/BF% display only — do not remove the cachedFetch call.

- [ ] **Step 9.1: Find sleep-sessions consumer**

```bash
grep -r "sleep-sessions\|cachedFetch.*sleep" app/ components/ lib/ \
  --include="*.ts" --include="*.tsx" -l
```

Read each file found. Locate the `cachedFetch('sleep-sessions', ...)` call and its state setter.

- [ ] **Step 9.2: Add Dexie fast-path for sleep**

Import the needed helpers:
```ts
import { getLocalStore } from '@/lib/local-store';
import { todayMidnightUtc, toAestDay } from '@/lib/date-utils';
import { useSession } from '@/auth/react'; // check exact import from other components
```

Before the existing `cachedFetch('sleep-sessions', ...)` call, add:

```ts
const { data: session } = useSession();
const userId = session?.user?.id;

// Fast-path: read from local store (instant, no network)
const store = userId ? getLocalStore(userId) : null;
if (store) {
  const cutoff = new Date(todayMidnightUtc().getTime() - 14 * 24 * 60 * 60 * 1000);
  const cutoffStr = toAestDay(cutoff); // 'YYYY-MM-DD' in AEST — never UTC slice(0,10)
  const localSleep = await store.getSleepSessions(cutoffStr);
  if (localSleep.length > 0) setSleepData(localSleep);
}
// cachedFetch call below remains as fallback for first install (Dexie empty)
```

- [ ] **Step 9.3: Add Dexie fast-path for raw body weight display**

Find the component that shows the weight chart / recent weight values (not the full body-metadata fused response). For the raw weight/BF%/steps values specifically:

```ts
const store = userId ? getLocalStore(userId) : null;
if (store) {
  const cutoff = new Date(todayMidnightUtc().getTime() - 30 * 24 * 60 * 60 * 1000);
  const cutoffStr = toAestDay(cutoff);
  const localMetrics = await store.getBodyMetrics(cutoffStr);
  if (localMetrics.length > 0) setWeightData(localMetrics);
}
// cachedFetch('body-metadata', ...) still runs for merged macros/food totals
```

- [ ] **Step 9.4: Verify instant loads**

After the first `pullDelta()` has populated Dexie (check Application → IndexedDB → `trainingai-${userId}` in DevTools), reload the app. Sleep and weight sections should populate without any loading skeleton. Open DevTools Network — no `/api/sleep-sessions` fetch should fire if the local store has recent data.

- [ ] **Step 9.5: Commit**

```bash
git add <modified component files>
git commit -m "read sleep and weight data from local Dexie store for instant loads"
```

---

## Task 10: Local-first writes — body metrics and mood logs

**Files:**
- The body-metadata write handler
- The mood log write handler

Find them:
```bash
grep -r "upsertBodyMetrics\|POST.*body\|saveMoodLog\|POST.*mood" \
  app/ components/ --include="*.tsx" --include="*.ts" -l | grep -v "node_modules\|api/"
```

- [ ] **Step 10.1: Read both write handlers**

Read each file found. Identify the exact `fetch(...)` call and the state update that follows it.

- [ ] **Step 10.2: Replace body-metric write with local-first**

Import at the top of the component:
```ts
import { getLocalStore } from '@/lib/local-store';
import { todayInTz } from '@/lib/date-utils';
import { pushMutations } from '@/lib/local-store/sync-engine';
import { todayMidnightUtc, toAestDay } from '@/lib/date-utils';
```

Replace the `fetch('/api/body-metadata', { method: 'POST', ... })` call with:

```ts
const userId = session?.user?.id;
const tz = session?.user?.timezone;
const date = todayInTz(tz); // AEST-correct current date

// Lean payload — only user-provided fields, never syncStatus/updatedAt/deletedAt
const leanPayload = {
  weightKg:   formValues.weightKg   ?? null,
  bodyFatPct: formValues.bodyFatPct ?? null,
  calories:   formValues.calories   ?? null,
  proteinG:   formValues.proteinG   ?? null,
  carbsG:     formValues.carbsG     ?? null,
  fatG:       formValues.fatG       ?? null,
  steps:      formValues.steps      ?? null,
  waterMl:    formValues.waterMl    ?? null,
};

const store = userId ? getLocalStore(userId) : null;
if (store) {
  // Write to local store first — UI updates instantly without network
  const record = {
    date,
    ...leanPayload,
    restingHeartRate: null,
    hrvMs: null,
    spo2Pct: null,
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    syncStatus: 'pending' as const,
  };
  await store.upsertBodyMetric(record);

  // Queue for background sync — payload is lean (no system fields)
  await store.queueMutation({ userId, domain: 'body_metrics', date, payload: leanPayload });

  // Attempt immediate push (non-blocking — fails silently if offline)
  pushMutations(userId).catch(() => {});

  // Re-read from store so UI reflects the new value immediately
  const cutoff = new Date(todayMidnightUtc().getTime() - 30 * 24 * 60 * 60 * 1000);
  const fresh = await store.getBodyMetrics(toAestDay(cutoff));
  setBodyMetrics(fresh);
} else {
  // Fallback: IndexedDB unavailable (private browsing / very old browser)
  await fetch('/api/body-metadata', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ localDate: date, ...leanPayload }),
  });
}
```

- [ ] **Step 10.3: Replace mood log write with local-first**

```ts
const userId = session?.user?.id;
const date = todayInTz(session?.user?.timezone);

const leanPayload = {
  energyLevel:  formValues.energyLevel,
  sleepQuality: formValues.sleepQuality,
  bodyState:    formValues.bodyState   ?? [],
  soreMuscles:  formValues.soreMuscles ?? [],
};

const store = userId ? getLocalStore(userId) : null;
if (store) {
  await store.upsertMoodLog({
    logDate: date,
    ...leanPayload,
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    syncStatus: 'pending' as const,
  });
  await store.queueMutation({ userId, domain: 'mood_logs', date, payload: leanPayload });
  pushMutations(userId).catch(() => {});

  // Re-read so UI is current
  const cutoff = new Date(todayMidnightUtc().getTime() - 14 * 24 * 60 * 60 * 1000);
  const freshMood = await store.getMoodLogs(toAestDay(cutoff));
  setMoodData(freshMood);
} else {
  await fetch('/api/mood', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(leanPayload),
  });
}
```

- [ ] **Step 10.4: Verify offline-first write flow**

1. Open DevTools → Application → Network → tick "Offline".
2. Submit a body weight. Entry should appear in the UI immediately — no error, no spinner.
3. Open Application → IndexedDB → `trainingai-${userId}` → `bodyMetrics`: new entry should be present with `syncStatus: 'pending'`.
4. Open `mutationsOutbox`: one entry should be visible with lean payload (no `syncStatus` field in the payload).
5. Un-tick Offline. Within seconds `pushMutations()` fires (on connectivity restore via Network listener).
6. `mutationsOutbox` should be empty. `bodyMetrics` entry should have `syncStatus: 'synced'`.

- [ ] **Step 10.5: Commit**

```bash
git add <modified component files>
git commit -m "local-first writes for body metrics and mood logs — instant UI, background sync to server"
```

---

## Deliberate scope cuts (follow-on work)

1. **Nutrition food logs** — complex FK relationships (`food_items`, `meal_types`). Add to outbox after the simpler body/mood pattern is proven.
2. **Sleep session writes** — ingest via Samsung Health webhook, not manual UI. Delta pull handles ingest-then-sync.
3. **APK SQLite parity** — implement `SQLiteLocalStore` using the existing Capacitor SQLite (`lib/sqlite/`) as a drop-in replacement for `DexieLocalStore`, using the same `LocalStore` interface defined in Task 6.
4. **Manual full-resync** — add a "Sync now" button in settings that resets `lastSyncAt` to epoch and calls `pullDelta()`. Useful for resolving stale data after edge-case failures.
5. **Two outbox systems** — workouts use `lib/sqlite/outbox.ts` (APK SQLite), health data uses Dexie `mutationsOutbox`. Unify into a single outbox backed by `LocalStore` when APK SQLite parity is implemented.

---

## Self-review against all review findings

| Finding | Fix |
|---------|-----|
| Wrong auth import (`@/lib/session`) | ✅ All routes use `import { auth } from '@/auth'` |
| Write path server-first | ✅ Task 10 — writes go to Dexie + outbox first |
| Soft deletes not handled | ✅ Migration 070; applyDelta removes tombstoned rows |
| Timezone `.toISOString().slice(0,10)` | ✅ All cutoffs use `toAestDay(cutoff)` from `lib/date-utils` |
| No pagination on initial sync | ✅ `getSyncDelta` caps at 90-day window |
| Double work pullDelta + CACHE_TASKS | ✅ Only `sleep-sessions` removed; weights-summary kept |
| Post-write invalidation broken | ✅ Task 10 writes to Dexie + re-reads; no invalidateCache needed |
| No sync throttle | ✅ Module-level `lastSyncMs` + `MIN_SYNC_INTERVAL_MS = 5 min` |
| No unified LocalStore interface | ✅ Task 6 defines interface; APK impl deferred but interface is ready |
| PendingMutation no userId — cross-user mutation push | ✅ `PendingMutation.userId` added; `getPendingMutations(userId)` filters; per-user DB name |
| Dexie not user-scoped — data leaks between users | ✅ DB named `trainingai-${userId}` — complete isolation per user |
| pushMutations ignores result.errors | ✅ Task 7 only deletes confirmed outbox entries; errors stay for retry |
| weights-summary removed without replacement | ✅ Kept in CACHE_TASKS — not Dexie-backed |
| body-metadata fusion lost | ✅ body-metadata kept in CACHE_TASKS; Dexie supplements raw weight display only |
| applyDelta overwrites pending writes (Samsung Health conflict) | ✅ Simplified guard: skip server update when `syncStatus === 'pending'` |
| queueMutation payload includes system fields | ✅ `leanPayload` constructed without syncStatus/updatedAt/deletedAt |
| applyDelta row-by-row performance | ⚠️ Still row-by-row for bodyMetrics/moodLogs (required for pending guard); acceptable for 90-row delta |
| Two parallel outbox systems | ⚠️ Acknowledged; unification deferred to APK SQLite parity task |
