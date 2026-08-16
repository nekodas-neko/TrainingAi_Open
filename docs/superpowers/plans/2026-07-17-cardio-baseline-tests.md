# Cardio Baseline / Fitness Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add guided cardio "baseline" fitness tests (6-Minute Walk, Cooper 12-minute run, Resting-HR + 1-min HR-recovery) that capture distance + live HR, estimate VO₂max via published equations, and store each result as an offline-first synced `fitness_tests` row so later tests show improvement and a future running-plan engine can consume them.

**Architecture:** ONE reusable guided-test flow (`components/fitness-tests/`) parameterised by a data-driven protocol table (`lib/fitness-tests/protocols.ts`) — no per-test hardcoding. Live HR reuses `useLiveHr()`/`getLiveHrManager()`; distance/pace reuses `startGpsWatcher` + `haversineDistanceKm`; HR recovery reuses `analyseHrRecovery`; VO₂max equations live once in `lib/health/fitness-tests.ts` with cited constants. Results are a new **offline-first** domain following the `activity_logs` reference chain end-to-end: local SQLite table + mutation outbox + `pushMutations` branch mirroring the web route + pull-delta mapping. The equations run **once at capture time** and the stored number is read verbatim, keeping the web/read path logic-free.

**Tech Stack:** Next.js 15 / React 19 / TypeScript; Drizzle + Postgres (migration 131); Capacitor SQLite local-store; `@capacitor-community/background-geolocation`; Zustand (persisted store); vitest.

---

## Dependency note — `lib/health/vo2max.ts` (OTS plan, may be absent)

The Oura Training-Stress plan (`docs/superpowers/plans/2026-07-16-training-stress-score-and-vo2max.md`, **Task 1**) introduces `lib/health/vo2max.ts` exporting `deriveVo2Max({ restingHr, measuredMaxHr, age, sex, weightKg, heightCm, activityLevel })`. **It may not exist on disk when this plan is implemented.**

This plan does **not** hard-depend on it:
- Each test's stored `vo2maxEst` comes from the **test-specific** equation in this plan's own `lib/health/fitness-tests.ts` (6MWT → Ross 2010; Cooper → Cooper 1968) — the higher-quality, direct measurement — never from `deriveVo2Max`.
- The **measured max HR** observed during a Cooper/max test is stored in `fitness_tests.max_hr` and is fed to `estimateHrMax({ observed })` (already in `lib/health/hr-zones.ts`) for the live zone banner. That same `max_hr` is later consumable by `deriveVo2Max({ measuredMaxHr })` as its preferred HRmax — the OTS plan's Task 1 already reads `activity_logs.max_hr`; extending it to prefer `fitness_tests.max_hr` is out of scope here and noted as a follow-up.

**If `lib/health/vo2max.ts` is absent at implementation time:** proceed unchanged — nothing in this plan imports it. Do **not** stub or inline a `deriveVo2Max`; the fitness-test equations are self-contained. (Option B, only if a future task in THIS area needs `deriveVo2Max`: pull the OTS plan's Task 1 forward first as its own PR. Not required for any task below.)

---

## File structure

**Create:**
- `lib/health/fitness-tests.ts` — VO₂max equations (Ross 6MWT, Cooper) + `baselineHrr1`/`restingHrFrom`/`maxHrFrom` helpers. One-Formula-One-Place, cited.
- `lib/health/__tests__/fitness-tests.test.ts` — equation + helper tests.
- `lib/fitness-tests/protocols.ts` — data-driven protocol definitions (`FITNESS_TEST_PROTOCOLS`, `getProtocol`).
- `lib/fitness-tests/__tests__/protocols.test.ts` — protocol-table invariants.
- `lib/validation/fitness-test.ts` — `FitnessTestBody` Zod schema shared by route + push.
- `lib/stores/fitness-test-store.ts` — Zustand flow store (`mode`, `selectedProtocolId`, `startedAtMs`).
- `app/api/fitness-tests/route.ts` — GET/POST/DELETE.
- `app/baselines/page.tsx` — server component (loads profile) → content.
- `components/fitness-tests/fitness-tests-content.tsx` — flow orchestrator.
- `components/fitness-tests/test-select.tsx` — protocol picker + latest result per protocol.
- `components/fitness-tests/test-countdown.tsx` — 3-2-1 countdown (leaf timer).
- `components/fitness-tests/test-timer.tsx` — main test timer (leaf, reads refs).
- `components/fitness-tests/test-hr-display.tsx` — live HR + zone (leaf, `useLiveHr`).
- `components/fitness-tests/test-active.tsx` — the guided test (HR + GPS + timer children).
- `components/fitness-tests/test-result.tsx` — result + comparison to previous, offline-first save.
- `components/fitness-tests/latest-baseline-card.tsx` — health-page surface (self-fetching).

**Modify:**
- `lib/data/postgres/migrations/131_fitness_tests.sql` — new table (create).
- `lib/data/postgres/schema.ts` — `fitnessTests` pgTable.
- `lib/sqlite/migrations.ts` — v14 local table + `RECONCILE_TABLES`/`RECONCILE_COLUMNS`.
- `lib/local-store/types.ts` — `LocalFitnessTest`; add `'fitness_tests'` to `PendingMutation.domain`.
- `lib/local-store/index.ts` — `LocalStore` methods + `applyDelta` delta key; `clearLocalStoreData` DELETE.
- `lib/local-store/sqlite-backend.ts` — `getFitnessTests`, `upsertFitnessTest`, `applyDelta` branch.
- `lib/local-store/sync-engine.ts` — pull mapping + `SyncedDomains.fitnessTests` + count.
- `lib/data/repository.ts` — `SyncDelta.fitnessTests`; `MutationDomain`; repo method signatures.
- `lib/data/postgres/adapter.ts` — `saveFitnessTest`/`listFitnessTests`/`deleteFitnessTest`/`rowToFitnessTest`; `getSyncDelta` select+return; `pushMutations` branch.
- `lib/cache-groups.ts` — `invalidateFitnessTests()`.
- `lib/cache-ttl.ts` — `FITNESS_TESTS_TTL`.
- `app/health/health-content.tsx` — add `"baselineTests"` to `TRAINING_DEFAULT_ORDER`.
- `app/health/health-sections.tsx` — `case "baselineTests"` in `renderTrainingSection`.

---

## Task 1: VO₂max equations module (`lib/health/fitness-tests.ts`)

**Files:**
- Create: `lib/health/fitness-tests.ts`
- Test: `lib/health/__tests__/fitness-tests.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/health/__tests__/fitness-tests.test.ts
import { describe, it, expect } from 'vitest'
import { sixMwtVo2max, cooperVo2max, baselineHrr1, restingHrFrom, maxHrFrom } from '../fitness-tests'
import type { HrReading } from '@/lib/workout/hr-analysis'

describe('sixMwtVo2max (Ross 2010: 4.948 + 0.023·metres)', () => {
  it('computes VO2peak from 6-minute walk distance', () => {
    expect(sixMwtVo2max(500)).toBe(16.4)   // 4.948 + 11.5 = 16.448 → 16.4
  })
})

describe('cooperVo2max (Cooper 1968: (metres − 504.9)/44.73)', () => {
  it('computes VO2max from 12-minute run distance', () => {
    expect(cooperVo2max(2400)).toBe(42.4)  // (2400−504.9)/44.73 = 42.37 → 42.4
  })
})

describe('baselineHrr1 (reuses analyseHrRecovery — no re-implementation)', () => {
  it('returns bpm drop over the 60s after recovery start', () => {
    const t0 = new Date('2026-07-17T10:00:00Z')
    const readings: HrReading[] = [
      { timestamp: t0, bpm: 160 },
      { timestamp: new Date(t0.getTime() + 60_000), bpm: 120 },
    ]
    expect(baselineHrr1(readings, t0)).toBe(40)
  })
})

describe('restingHrFrom / maxHrFrom', () => {
  const readings: HrReading[] = [
    { timestamp: new Date(0), bpm: 62 },
    { timestamp: new Date(1000), bpm: 58 },
    { timestamp: new Date(2000), bpm: 165 },
  ]
  it('resting = min bpm', () => expect(restingHrFrom(readings)).toBe(58))
  it('max = max bpm', () => expect(maxHrFrom(readings)).toBe(165))
  it('empty → null', () => {
    expect(restingHrFrom([])).toBeNull()
    expect(maxHrFrom([])).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/health/__tests__/fitness-tests.test.ts`
Expected: FAIL — `Cannot find module '../fitness-tests'`.

- [ ] **Step 3: Implement the module**

```ts
// lib/health/fitness-tests.ts
// Cardio baseline / fitness-test estimators — One Formula, One Place.
// Every VO2max equation is pinned to a published source, cited inline. Before
// adding a new estimator here, confirm no duplicate exists (grep 'vo2max').
import { analyseHrRecovery, type HrReading } from '@/lib/workout/hr-analysis'

function round1(x: number): number {
  return Math.round(x * 10) / 10
}

/**
 * 6-Minute Walk Test → VO2peak (mL·kg⁻¹·min⁻¹).
 * Ross RM, Murthy JN, Wollak ID, Jackson AS. "The six-minute walk test accurately
 * estimates mean peak oxygen uptake." BMC Pulm Med. 2010;10:31.
 *   VO2peak = 4.948 + 0.023 × distance(metres)
 * Distance-only form chosen for ring-friendliness (the multivariable Burr 2011
 * form needs a rate-pressure product we do not capture). Plausible ~150–700 m.
 */
export function sixMwtVo2max(distanceM: number): number {
  return round1(4.948 + 0.023 * distanceM)
}

/**
 * Cooper 12-minute run → VO2max (mL·kg⁻¹·min⁻¹).
 * Cooper KH. "A means of assessing maximal oxygen intake." JAMA.
 * 1968;203(3):201-204.
 *   VO2max = (distance(metres) − 504.9) / 44.73
 */
export function cooperVo2max(distanceM: number): number {
  return round1((distanceM - 504.9) / 44.73)
}

/**
 * 1-minute heart-rate recovery for a baseline test. Reuses the workout
 * HR-recovery analyser (lib/workout/hr-analysis) — do NOT re-implement HRR.
 * `recoveryStart` is the instant peak effort ended; the result is bpm-at-start
 * minus bpm 60 s later (a larger drop = better recovery).
 */
export function baselineHrr1(readings: HrReading[], recoveryStart: Date): number | null {
  const [stat] = analyseHrRecovery(readings, [
    { exerciseName: 'baseline', setNumber: 1, loggedAt: recoveryStart },
  ])
  return stat.hrr1
}

/** Lowest bpm across the captured readings (resting-HR proxy), or null if none. */
export function restingHrFrom(readings: HrReading[]): number | null {
  if (readings.length === 0) return null
  return Math.min(...readings.map(r => r.bpm))
}

/** Highest bpm across the captured readings (feeds estimateHrMax({observed})). */
export function maxHrFrom(readings: HrReading[]): number | null {
  if (readings.length === 0) return null
  return Math.max(...readings.map(r => r.bpm))
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/health/__tests__/fitness-tests.test.ts`
Expected: PASS (7 assertions).

- [ ] **Step 5: Commit**

```bash
git add lib/health/fitness-tests.ts lib/health/__tests__/fitness-tests.test.ts
git commit -m "Add cited cardio fitness-test VO2max estimators + HRR helpers"
```

---

## Task 2: Protocol definitions (`lib/fitness-tests/protocols.ts`)

**Files:**
- Create: `lib/fitness-tests/protocols.ts`
- Test: `lib/fitness-tests/__tests__/protocols.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/fitness-tests/__tests__/protocols.test.ts
import { describe, it, expect } from 'vitest'
import { FITNESS_TEST_PROTOCOLS, getProtocol } from '../protocols'

describe('FITNESS_TEST_PROTOCOLS', () => {
  it('defines the three baseline protocols with unique ids', () => {
    const ids = FITNESS_TEST_PROTOCOLS.map(p => p.id)
    expect(ids).toEqual(['6mwt', 'cooper12', 'resting_hrr'])
    expect(new Set(ids).size).toBe(3)
  })

  it('6MWT is a fixed 6-minute distance-capturing walk', () => {
    const p = getProtocol('6mwt')!
    expect(p.durationSec).toBe(360)
    expect(p.captureDistance).toBe(true)
    expect(p.vo2Equation).toBe('6mwt')
  })

  it('Cooper is a fixed 12-minute distance-capturing run', () => {
    const p = getProtocol('cooper12')!
    expect(p.durationSec).toBe(720)
    expect(p.captureDistance).toBe(true)
    expect(p.vo2Equation).toBe('cooper')
  })

  it('Resting HRR captures recovery, no distance, no VO2 equation', () => {
    const p = getProtocol('resting_hrr')!
    expect(p.captureHrr).toBe(true)
    expect(p.captureDistance).toBe(false)
    expect(p.vo2Equation).toBeNull()
  })

  it('getProtocol returns undefined for an unknown id', () => {
    expect(getProtocol('nope')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/fitness-tests/__tests__/protocols.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/fitness-tests/protocols.ts
// Data-driven fitness-test protocols. The guided-test flow is parameterised by
// these rows — add a protocol here, never a new hardcoded test screen.

export type FitnessTestId = '6mwt' | 'cooper12' | 'resting_hrr'

export interface FitnessTestProtocol {
  id: FitnessTestId
  name: string
  shortName: string
  /** One-line instruction shown on the picker + pre-test screen. */
  description: string
  /** Fixed active duration (s); null = self-paced (resting_hrr ends on user tap). */
  durationSec: number | null
  captureDistance: boolean
  captureHrr: boolean
  /** Karvonen reserve-fraction effort hint for the live zone banner, or null. */
  effortFrac: number | null
  /** Which lib/health/fitness-tests.ts equation the result screen applies. */
  vo2Equation: '6mwt' | 'cooper' | null
}

export const FITNESS_TEST_PROTOCOLS: FitnessTestProtocol[] = [
  {
    id: '6mwt',
    name: '6-Minute Walk Test',
    shortName: '6MWT',
    description: 'Walk as far as you can on a flat course for 6 minutes.',
    durationSec: 360,
    captureDistance: true,
    captureHrr: false,
    effortFrac: 0.40,          // brisk-walk aerobic zone
    vo2Equation: '6mwt',
  },
  {
    id: 'cooper12',
    name: 'Cooper 12-Minute Run',
    shortName: 'Cooper',
    description: 'Cover as much distance as possible running for 12 minutes.',
    durationSec: 720,
    captureDistance: true,
    captureHrr: false,
    effortFrac: 0.85,          // near-max sustained effort
    vo2Equation: 'cooper',
  },
  {
    id: 'resting_hrr',
    name: 'Resting HR + Recovery',
    shortName: 'HRR',
    description: 'Rest 1 min, do 1 min of hard effort, then rest — measures resting HR and 1-min recovery.',
    durationSec: null,
    captureDistance: false,
    captureHrr: true,
    effortFrac: null,
    vo2Equation: null,
  },
]

export function getProtocol(id: string): FitnessTestProtocol | undefined {
  return FITNESS_TEST_PROTOCOLS.find(p => p.id === id)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/fitness-tests/__tests__/protocols.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/fitness-tests/protocols.ts lib/fitness-tests/__tests__/protocols.test.ts
git commit -m "Add data-driven fitness-test protocol table"
```

---

## Task 3: Postgres migration 131 + Drizzle schema

**Files:**
- Create: `lib/data/postgres/migrations/131_fitness_tests.sql`
- Modify: `lib/data/postgres/schema.ts` (after the `activityLogs` table, ~line 302)

- [ ] **Step 1: Write the migration**

`131` is reserved for this plan (the tree currently ends at `126_set_log_planned_snapshot.sql`; `127–130` are pre-allocated to other parallel plans — do not renumber). `migrate.js` applies in filename sort order and the seed is idempotent.

```sql
-- lib/data/postgres/migrations/131_fitness_tests.sql
-- Cardio baseline / fitness-test results. One row per completed guided test.
-- Offline-first synced domain (mirrors activity_logs): soft-delete via deleted_at,
-- getSyncDelta emits deletedAt so cross-device deletes propagate. `date` is the
-- user's local day (todayInTz), not UTC.
CREATE TABLE IF NOT EXISTS fitness_tests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_type     TEXT NOT NULL,               -- FitnessTestId: '6mwt' | 'cooper12' | 'resting_hrr'
  date          DATE NOT NULL,               -- user-local day
  duration_sec  INTEGER,
  distance_m    DOUBLE PRECISION,
  avg_hr        INTEGER,
  max_hr        INTEGER,
  resting_hr    INTEGER,
  hrr1_bpm      INTEGER,
  vo2max_est    DOUBLE PRECISION,
  method        TEXT,                         -- equation/source label, e.g. 'ross_2010'
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_fitness_tests_user_date ON fitness_tests (user_id, date);
CREATE INDEX IF NOT EXISTS idx_fitness_tests_user_updated ON fitness_tests (user_id, updated_at);
```

- [ ] **Step 2: Add the Drizzle table** in `lib/data/postgres/schema.ts`, immediately after the `activityLogs` table (which ends `deletedAt: timestamp('deleted_at', { withTimezone: true }),\n})` at ~line 302):

```ts
export const fitnessTests = pgTable('fitness_tests', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  testType:    text('test_type').notNull(),
  date:        date('date', { mode: 'string' }).notNull(),
  durationSec: integer('duration_sec'),
  distanceM:   doublePrecision('distance_m'),
  avgHr:       integer('avg_hr'),
  maxHr:       integer('max_hr'),
  restingHr:   integer('resting_hr'),
  hrr1Bpm:     integer('hrr1_bpm'),
  vo2maxEst:   doublePrecision('vo2max_est'),
  method:      text('method'),
  notes:       text('notes'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:   timestamp('deleted_at', { withTimezone: true }),
})
```

(`pgTable`, `uuid`, `text`, `date`, `integer`, `doublePrecision`, `timestamp` are already imported at the top of `schema.ts` — verify, add none.)

- [ ] **Step 3: Apply + verify locally**

Run: `pnpm db:local && psql postgresql://postgres:postgres@localhost:5433/trainingai_dev -c '\d fitness_tests'`
Expected: the table prints with all 15 columns and both indexes.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/data/postgres/migrations/131_fitness_tests.sql lib/data/postgres/schema.ts
git commit -m "Add fitness_tests table (migration 131) + Drizzle schema"
```

---

## Task 4: Local SQLite table + types + outbox domain

**Files:**
- Modify: `lib/sqlite/migrations.ts`, `lib/local-store/types.ts`

- [ ] **Step 1: Add the local table constant + reconcile registration** in `lib/sqlite/migrations.ts`.

After `CREATE_DAY_CHECKINS` (~line 371) add:

```ts
// Local mirror of cardio baseline / fitness-test results so they render and
// write offline-first — the local store is the source of truth.
const CREATE_FITNESS_TESTS = `CREATE TABLE IF NOT EXISTS fitness_tests (
  id            TEXT PRIMARY KEY,
  test_type     TEXT NOT NULL,
  date          TEXT NOT NULL,
  duration_sec  INTEGER,
  distance_m    REAL,
  avg_hr        INTEGER,
  max_hr        INTEGER,
  resting_hr    INTEGER,
  hrr1_bpm      INTEGER,
  vo2max_est    REAL,
  method        TEXT,
  notes         TEXT,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  sync_status   TEXT NOT NULL DEFAULT 'pending'
)`;
```

Add its index to `RECONCILE_INDEXES` (the array ~line 374):

```ts
  `CREATE INDEX IF NOT EXISTS idx_fitness_tests_date ON fitness_tests (date)`,
```

Add `CREATE_FITNESS_TESTS` to `RECONCILE_TABLES` (~line 393, before `...RECONCILE_INDEXES`):

```ts
  CREATE_DAY_CHECKINS,
  CREATE_FITNESS_TESTS,
  ...RECONCILE_INDEXES,
```

Append a new version to `MIGRATIONS` (after the `toVersion: 13` object, ~line 724):

```ts
  {
    toVersion: 14,
    statements: [
      // Cardio baseline / fitness-test results — offline-first synced domain.
      CREATE_FITNESS_TESTS,
    ],
  },
```

Because the whole table is created (not ALTERed), reconcile via `CREATE TABLE IF NOT EXISTS` in `RECONCILE_TABLES` is the partial-upgrade backstop — no per-column `RECONCILE_COLUMNS` entries are needed (the columns can only be missing if the whole table is missing, which the reconcile CREATE restores).

- [ ] **Step 2: Add the local type + outbox domain** in `lib/local-store/types.ts`.

After `LocalActivityLog` (~line 145) add:

```ts
export interface LocalFitnessTest {
  id:          string;
  testType:    string;       // FitnessTestId
  date:        string;       // YYYY-MM-DD (user-local)
  durationSec: number | null;
  distanceM:   number | null;
  avgHr:       number | null;
  maxHr:       number | null;
  restingHr:   number | null;
  hrr1Bpm:     number | null;
  vo2maxEst:   number | null;
  method:      string | null;
  notes:       string | null;
  updatedAt:   string;
  deletedAt:   string | null;
  syncStatus:  'pending' | 'synced';
}
```

Add `'fitness_tests'` to the `PendingMutation.domain` union (~line 298):

```ts
  domain:      'body_metrics' | 'mood_logs' | 'food_logs' | 'food_items' | 'supplement_logs' | 'injuries' | 'supplements' | 'activity_logs' | 'fitness_tests' | 'workout_log' | 'day_checkins' | 'session_rpe' | 'complete_workout';
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (the new type is not yet referenced elsewhere).

- [ ] **Step 4: Commit**

```bash
git add lib/sqlite/migrations.ts lib/local-store/types.ts
git commit -m "Add local fitness_tests table (SQLite v14) + LocalFitnessTest type + outbox domain"
```

---

## Task 5: LocalStore interface + SQLite backend read/upsert/applyDelta

**Files:**
- Modify: `lib/local-store/index.ts`, `lib/local-store/sqlite-backend.ts`

- [ ] **Step 1: Extend the `LocalStore` interface** in `lib/local-store/index.ts`.

Add the import to the `./types` import block (~line 4): append `LocalFitnessTest`.

Add read + write signatures (after `getActivityLogs`, ~line 25, and after `upsertActivityLog`, ~line 56):

```ts
  getFitnessTests(cutoffDate: string): Promise<LocalFitnessTest[]>;
```
```ts
  upsertFitnessTest(record: LocalFitnessTest): Promise<void>;
```

Add `fitnessTests?` to the `applyDelta` delta object (after `activityLogs?`, ~line 74):

```ts
    fitnessTests?:      LocalFitnessTest[];
```

Add the sign-out wipe to `clearLocalStoreData` (~line 129, near the `activity_logs` DELETE):

```ts
    runSQL('DELETE FROM fitness_tests', []),
```

- [ ] **Step 2: Implement reads/writes** in `lib/local-store/sqlite-backend.ts`.

Add `LocalFitnessTest` to the `./types` import block (~line 6).

After `getActivityLogs` (ends ~line 456) add:

```ts
  async getFitnessTests(cutoffDate: string): Promise<LocalFitnessTest[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM fitness_tests WHERE date >= ? AND deleted_at IS NULL ORDER BY date`,
      [cutoffDate],
    );
    return rows.map(r => ({
      id:          String(r.id),
      testType:    String(r.test_type),
      date:        String(r.date),
      durationSec: (r.duration_sec as number) ?? null,
      distanceM:   (r.distance_m as number) ?? null,
      avgHr:       (r.avg_hr as number) ?? null,
      maxHr:       (r.max_hr as number) ?? null,
      restingHr:   (r.resting_hr as number) ?? null,
      hrr1Bpm:     (r.hrr1_bpm as number) ?? null,
      vo2maxEst:   (r.vo2max_est as number) ?? null,
      method:      r.method != null ? String(r.method) : null,
      notes:       r.notes != null ? String(r.notes) : null,
      updatedAt:   String(r.updated_at),
      deletedAt:   r.deleted_at != null ? String(r.deleted_at) : null,
      syncStatus:  (r.sync_status as 'pending' | 'synced') ?? 'synced',
    }));
  }

  async upsertFitnessTest(record: LocalFitnessTest): Promise<void> {
    await runSQL(
      `INSERT INTO fitness_tests
         (id, test_type, date, duration_sec, distance_m, avg_hr, max_hr,
          resting_hr, hrr1_bpm, vo2max_est, method, notes,
          updated_at, deleted_at, sync_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         test_type=excluded.test_type, date=excluded.date,
         duration_sec=excluded.duration_sec, distance_m=excluded.distance_m,
         avg_hr=excluded.avg_hr, max_hr=excluded.max_hr,
         resting_hr=excluded.resting_hr, hrr1_bpm=excluded.hrr1_bpm,
         vo2max_est=excluded.vo2max_est, method=excluded.method, notes=excluded.notes,
         updated_at=excluded.updated_at, deleted_at=excluded.deleted_at,
         sync_status=excluded.sync_status`,
      [
        record.id, record.testType, record.date, record.durationSec,
        record.distanceM, record.avgHr, record.maxHr, record.restingHr,
        record.hrr1Bpm, record.vo2maxEst, record.method, record.notes,
        record.updatedAt, record.deletedAt, record.syncStatus,
      ],
    );
  }
```

(A fitness test is written whole from the result screen — no single-field read-merge is needed, unlike body_metrics. The insert always carries every column.)

- [ ] **Step 3: Add the `applyDelta` branch** in `applyDeltaBody`, immediately after the `for (const r of delta.activityLogs ?? [])` block (ends ~line 901):

```ts
    for (const r of delta.fitnessTests ?? []) {
      if (r.deletedAt) {
        await runSQL(`DELETE FROM fitness_tests WHERE id = ? AND sync_status='synced'`, [r.id]);
        continue;
      }
      await runSQL(
        `INSERT INTO fitness_tests
           (id, test_type, date, duration_sec, distance_m, avg_hr, max_hr,
            resting_hr, hrr1_bpm, vo2max_est, method, notes,
            updated_at, deleted_at, sync_status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'synced')
         ON CONFLICT(id) DO UPDATE SET
           test_type=excluded.test_type, date=excluded.date,
           duration_sec=excluded.duration_sec, distance_m=excluded.distance_m,
           avg_hr=excluded.avg_hr, max_hr=excluded.max_hr,
           resting_hr=excluded.resting_hr, hrr1_bpm=excluded.hrr1_bpm,
           vo2max_est=excluded.vo2max_est, method=excluded.method, notes=excluded.notes,
           updated_at=excluded.updated_at, deleted_at=excluded.deleted_at,
           sync_status='synced'
         WHERE fitness_tests.sync_status='synced'`,
        [r.id, r.testType, r.date, r.durationSec, r.distanceM, r.avgHr, r.maxHr,
         r.restingHr, r.hrr1Bpm, r.vo2maxEst, r.method, r.notes, r.updatedAt, r.deletedAt],
      );
    }
```

The `WHERE fitness_tests.sync_status='synced'` guard on the UPDATE arm is the pull-clobber protection: a pull never overwrites a still-pending local edit (matches the `activity_logs` branch).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/local-store/index.ts lib/local-store/sqlite-backend.ts
git commit -m "Local store: fitness_tests read/upsert + pull-delta apply branch"
```

---

## Task 6: Repository contract + Postgres adapter + shared validation

**Files:**
- Create: `lib/validation/fitness-test.ts`
- Modify: `lib/data/repository.ts`, `lib/data/postgres/adapter.ts`

- [ ] **Step 1: Shared Zod schema** (`lib/validation/fitness-test.ts`):

```ts
// lib/validation/fitness-test.ts
// Shared by the web route (app/api/fitness-tests/route.ts) and pushMutations so
// an outbox payload can never write through unvalidated (SYNC-P3 discipline).
import { z } from 'zod'

export const FitnessTestBody = z.object({
  testType:    z.enum(['6mwt', 'cooper12', 'resting_hrr']),
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationSec: z.number().int().positive().max(7200).optional(),
  distanceM:   z.number().nonnegative().max(100000).optional(),
  avgHr:       z.number().int().positive().max(250).optional(),
  maxHr:       z.number().int().positive().max(250).optional(),
  restingHr:   z.number().int().positive().max(250).optional(),
  hrr1Bpm:     z.number().int().max(250).optional(),
  vo2maxEst:   z.number().positive().max(100).optional(),
  method:      z.string().max(60).optional(),
  notes:       z.string().max(1000).optional(),
})
export type FitnessTestInput = z.infer<typeof FitnessTestBody>
```

- [ ] **Step 2: Extend the repository contract** in `lib/data/repository.ts`.

Add to the `SyncDelta` interface (after `activityLogs:` at ~line 221):

```ts
  fitnessTests:       unknown[];
```

Add `'fitness_tests'` to the `MutationDomain` union (the `export type MutationDomain =` block ~line 237):

```ts
  | 'fitness_tests'
```

Add the domain type + repo method signatures. Near the top type imports (~line 4) add `FitnessTest` to the exported model types (defined in step 3 of this task in the adapter's types file — declare it in `repository.ts`):

```ts
export interface FitnessTest {
  id: string
  userId: string
  testType: string
  date: string
  durationSec?: number
  distanceM?: number
  avgHr?: number
  maxHr?: number
  restingHr?: number
  hrr1Bpm?: number
  vo2maxEst?: number
  method?: string
  notes?: string
}
```

Add the methods to the repository interface (near `deleteActivityLog`, ~line 408):

```ts
  saveFitnessTest(userId: string, test: Omit<FitnessTest, 'userId'>): Promise<FitnessTest>
  listFitnessTests(userId: string, from: string, to: string): Promise<FitnessTest[]>
  deleteFitnessTest(userId: string, id: string): Promise<void>
```

- [ ] **Step 3: Implement in the adapter** (`lib/data/postgres/adapter.ts`).

Add imports at the top: `import { FitnessTestBody } from '@/lib/validation/fitness-test'` and add `FitnessTest` to the `@/lib/data/repository` type import list.

Add the methods (place near `saveActivityLog`, e.g. after `deleteActivityLog` ~line 2008):

```ts
  async saveFitnessTest(userId: string, test: Omit<FitnessTest, 'userId'>): Promise<FitnessTest> {
    const values = {
      id: test.id, userId, testType: test.testType, date: test.date,
      durationSec: test.durationSec ?? null, distanceM: test.distanceM ?? null,
      avgHr: test.avgHr ?? null, maxHr: test.maxHr ?? null,
      restingHr: test.restingHr ?? null, hrr1Bpm: test.hrr1Bpm ?? null,
      vo2maxEst: test.vo2maxEst ?? null, method: test.method ?? null,
      notes: test.notes ?? null,
    }
    // Client-minted id; last-write-wins on replay (bump updated_at so getSyncDelta
    // re-emits). No external source writes fitness_tests, so an id-only conflict
    // target is safe (unlike activity_logs' same-minute collision case).
    const [r] = await this.db.insert(s.fitnessTests).values(values)
      .onConflictDoUpdate({
        target: s.fitnessTests.id,
        set: { ...values, updatedAt: new Date() },
        setWhere: eq(s.fitnessTests.userId, userId),
      })
      .returning()
    return this.rowToFitnessTest(r)
  }

  async listFitnessTests(userId: string, from: string, to: string): Promise<FitnessTest[]> {
    const rows = await this.db.select().from(s.fitnessTests)
      .where(and(
        eq(s.fitnessTests.userId, userId),
        gte(s.fitnessTests.date, from),
        lte(s.fitnessTests.date, to),
        isNull(s.fitnessTests.deletedAt),
      ))
      .orderBy(desc(s.fitnessTests.date))
    return rows.map(r => this.rowToFitnessTest(r))
  }

  async deleteFitnessTest(userId: string, id: string): Promise<void> {
    await this.db.update(s.fitnessTests)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(s.fitnessTests.id, id), eq(s.fitnessTests.userId, userId)))
  }

  private rowToFitnessTest(r: typeof s.fitnessTests.$inferSelect): FitnessTest {
    return {
      id: r.id, userId: r.userId, testType: r.testType, date: r.date,
      durationSec: r.durationSec ?? undefined, distanceM: r.distanceM ?? undefined,
      avgHr: r.avgHr ?? undefined, maxHr: r.maxHr ?? undefined,
      restingHr: r.restingHr ?? undefined, hrr1Bpm: r.hrr1Bpm ?? undefined,
      vo2maxEst: r.vo2maxEst ?? undefined, method: r.method ?? undefined,
      notes: r.notes ?? undefined,
    }
  }
```

- [ ] **Step 4: Wire `getSyncDelta`.** Add the query to the `Promise.all` array (after the `activityLogs` select, ~line 2824) and to the destructuring at ~line 2804:

Destructuring — add `fitnessTests` to the list:
```ts
    const [programs, progressionStyles, bodyMetrics, sleepSessions,
           moodLogs, activityLogs, fitnessTests, workoutSessions,
```
Query (insert right after the `activityLogs` select block):
```ts
      this.db.select().from(s.fitnessTests)
        .where(and(eq(s.fitnessTests.userId, userId), gt(s.fitnessTests.updatedAt, effectiveSince)))
        .orderBy(asc(s.fitnessTests.updatedAt)).limit(pageLimit),
```
Add `fitnessTests` to the `resolveSyncCursor` page list (~line 3014):
```ts
      page(workoutSessions), page(foodLogs), page(supplementLogs), page(injuries),
      page(exerciseLogs), page(setLogs), page(dayCheckins), page(fitnessTests),
```
Add `fitnessTests` to the returned object (~line 3023, next to `activityLogs`):
```ts
             moodLogs, activityLogs, fitnessTests, workoutSessions,
```
(Rows already carry `id/date/.../updatedAt/deletedAt` verbatim — `page()` reads `updatedAt`; the raw select rows serialize directly, exactly like `activityLogs`.)

- [ ] **Step 5: Add the `pushMutations` branch.** After the `activity_logs` branch (ends ~line 3264) add:

```ts
        } else if (mut.domain === 'fitness_tests') {
          const p = clean as Record<string, unknown>
          if (typeof p.id !== 'string') {
            errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'Invalid fitness_tests payload: missing id' })
            continue
          }
          const parsed = FitnessTestBody.safeParse({ ...p, date: mut.date })
          if (!parsed.success) {
            errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'Invalid fitness_tests payload' })
            continue
          }
          await this.saveFitnessTest(userId, { ...parsed.data, id: p.id })
          processed++
```

Both write paths (route + push) now go through `saveFitnessTest` — the One-Write-Function-Per-Domain rule. `check-push-mutations.js` passes because this branch touches no `this.db`/`sql` directly.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`eq`, `and`, `gte`, `lte`, `gt`, `isNull`, `asc`, `desc` are already imported in `adapter.ts`.)

- [ ] **Step 7: Commit**

```bash
git add lib/validation/fitness-test.ts lib/data/repository.ts lib/data/postgres/adapter.ts
git commit -m "fitness_tests repository contract + adapter save/list/delta/push"
```

---

## Task 7: Sync-engine pull mapping

**Files:**
- Modify: `lib/local-store/sync-engine.ts`

- [ ] **Step 1: Add the type import** to the `./types` block (~line 5): append `LocalFitnessTest`.

- [ ] **Step 2: Add `fitnessTests` to `SyncedDomains`** (~line 36):

```ts
  activity:    boolean
  fitnessTests: boolean
  injuries:    boolean
```

- [ ] **Step 3: Map the pulled rows** inside `pullPage`, right after the `activityLogs` mapping block (ends ~line 218):

```ts
  const fitnessTests = ((raw.fitnessTests ?? []) as Record<string, unknown>[]).map(r => ({
    id:          String(r.id),
    testType:    String(r.testType),
    date:        String(r.date),
    durationSec: (r.durationSec as number) ?? null,
    distanceM:   (r.distanceM as number) ?? null,
    avgHr:       (r.avgHr as number) ?? null,
    maxHr:       (r.maxHr as number) ?? null,
    restingHr:   (r.restingHr as number) ?? null,
    hrr1Bpm:     (r.hrr1Bpm as number) ?? null,
    vo2maxEst:   (r.vo2maxEst as number) ?? null,
    method:      r.method != null ? String(r.method) : null,
    notes:       r.notes != null ? String(r.notes) : null,
    updatedAt:   toIso(r.updatedAt),
    deletedAt:   r.deletedAt ? toIso(r.deletedAt) : null,
    syncStatus:  'synced' as const,
  } satisfies LocalFitnessTest));
```

- [ ] **Step 4: Include in `count`, `applyDelta`, and the returned `domains`.**

`count` (~line 367) — add `+ fitnessTests.length`.

`applyDelta` call (~line 375):
```ts
  await store!.applyDelta({ bodyMetrics, moodLogs, sleepSessions,
    workoutSessions, activityLogs, fitnessTests, programs, programSessions, sessionExercises,
```

Per-page `domains` object (~line 392):
```ts
      activity:    activityLogs.length > 0,
      fitnessTests: fitnessTests.length > 0,
      injuries:    injuries.length > 0,
```

The outer loop's initial `domains` literal (~line 406) and the `||=` merge block (~line 424) — add `fitnessTests: false,` and `domains.fitnessTests ||= pageResult.domains.fitnessTests;` respectively.

(No `pushMutations` confirmation branch is needed here beyond the generic `deleteMutations` — but add the synced-flip so a pulled row can't clobber it. In the `for (const m of confirmed)` block ~line 553, after the `activity_logs` arm, add:)

```ts
    } else if (m.domain === 'fitness_tests') {
      const recs = await store.getFitnessTests(m.date);
      const rec = recs.find(r => r.id === (m.payload.id as string));
      if (rec) await store.upsertFitnessTest({ ...rec, syncStatus: 'synced' });
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/local-store/sync-engine.ts
git commit -m "Sync-engine: pull-map + confirm fitness_tests domain"
```

---

## Task 8: API route + cache group + TTL

**Files:**
- Create: `app/api/fitness-tests/route.ts`
- Modify: `lib/cache-groups.ts`, `lib/cache-ttl.ts`

- [ ] **Step 1: Cache group** in `lib/cache-groups.ts` (after `invalidateActivityWrites`, ~line 187):

```ts
/** Every cache that renders a saved fitness-test / baseline. */
export async function invalidateFitnessTests(): Promise<void> {
  await Promise.all([
    invalidateCache('fitness-tests'),
    invalidateCache('home-day-timeline'),
  ])
}
```

- [ ] **Step 2: TTL constant** in `lib/cache-ttl.ts` (after `HR_PROFILE_TTL`, ~line 32):

```ts
/** /api/fitness-tests — baseline results change only when a test is completed
 *  (which explicitly invalidates the key), so a medium TTL is safe. */
export const FITNESS_TESTS_TTL = TTL_MEDIUM
```

- [ ] **Step 3: The route** (`app/api/fitness-tests/route.ts`) — mirrors `app/api/activity-logs/route.ts`, incl. SWR headers at creation:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, toAestDay, todayInTz, todayMidnightUtc } from '@/lib/date-utils'
import { z } from 'zod'
import { FitnessTestBody } from '@/lib/validation/fitness-test'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tz = session.user.timezone ?? DEFAULT_TZ
  const { searchParams } = new URL(req.url)
  const days = Math.min(parseInt(searchParams.get('days') ?? '365', 10) || 365, 730)

  const today = todayInTz(tz)
  const from = toAestDay(new Date(todayMidnightUtc(tz).getTime() - (days - 1) * 86_400_000), tz)

  const repo = await getRepository()
  const fitnessTests = await repo.listFitnessTests(session.user.id, from, today)
  return NextResponse.json({ fitnessTests }, { headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=120' } })
}

const CreateBody = FitnessTestBody.extend({ id: z.string().uuid().optional() })

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = CreateBody.safeParse(await req.json())
  if (!body.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const repo = await getRepository()
  const fitnessTest = await repo.saveFitnessTest(session.user.id, {
    ...body.data,
    id: body.data.id ?? crypto.randomUUID(),
  })
  return NextResponse.json({ fitnessTest }, { status: 201 })
}

const DeleteBody = z.object({ id: z.string().uuid() })

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = DeleteBody.safeParse(await req.json())
  if (!body.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const repo = await getRepository()
  await repo.deleteFitnessTest(session.user.id, body.data.id)
  return NextResponse.json({ success: true })
}
```

- [ ] **Step 4: Verify the route against the local DB.**

Run: `pnpm dev` then, after signing in (`test@local.dev` / `testpass123`):
```bash
curl -s -X POST localhost:3000/api/fitness-tests -H 'Content-Type: application/json' \
  --cookie "$COOKIE" -d '{"testType":"cooper12","date":"2026-07-17","durationSec":720,"distanceM":2400,"avgHr":165,"maxHr":182,"vo2maxEst":42.4,"method":"cooper_1968"}'
curl -s localhost:3000/api/fitness-tests --cookie "$COOKIE"
```
Expected: POST returns `{"fitnessTest":{...}}` (201); GET returns the row inside `fitnessTests`.

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/api/fitness-tests/route.ts lib/cache-groups.ts lib/cache-ttl.ts
git commit -m "GET/POST/DELETE /api/fitness-tests + cache group + TTL"
```

---

## Task 9: Zustand flow store

**Files:**
- Create: `lib/stores/fitness-test-store.ts`

- [ ] **Step 1: Implement** (persisted, but transient flow state resets on rehydration per the persisted-store rule):

```ts
// lib/stores/fitness-test-store.ts
'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { FitnessTestId } from '@/lib/fitness-tests/protocols'

export type FitnessTestMode = 'select' | 'countdown' | 'active' | 'done'

interface FitnessTestState {
  mode: FitnessTestMode
  selectedProtocolId: FitnessTestId | null
  startedAtMs: number | null
  choose: (id: FitnessTestId) => void
  beginCountdown: () => void
  start: (atMs: number) => void
  finish: () => void
  reset: () => void
}

export const useFitnessTestStore = create<FitnessTestState>()(
  persist(
    (set) => ({
      mode: 'select',
      selectedProtocolId: null,
      startedAtMs: null,
      choose: (id) => set({ selectedProtocolId: id, mode: 'countdown' }),
      beginCountdown: () => set({ mode: 'countdown' }),
      start: (atMs) => set({ mode: 'active', startedAtMs: atMs }),
      finish: () => set({ mode: 'done' }),
      reset: () => set({ mode: 'select', selectedProtocolId: null, startedAtMs: null }),
    }),
    {
      name: 'ta-fitness-test',
      // Only the chosen protocol survives a reload; the flow mode + timer are
      // transient and must never rehydrate mid-test (Zustand persisted-store rule).
      partialize: (s) => ({ selectedProtocolId: s.selectedProtocolId }),
      onRehydrateStorage: () => (state) => {
        if (state) { state.mode = 'select'; state.startedAtMs = null }
      },
    },
  ),
)
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/stores/fitness-test-store.ts
git commit -m "Fitness-test flow store (transient state resets on rehydration)"
```

---

## Task 10: Timer + HR-display leaf components

**Files:**
- Create: `components/fitness-tests/test-timer.tsx`, `components/fitness-tests/test-hr-display.tsx`, `components/fitness-tests/test-countdown.tsx`

Leaf-timer discipline: each of these owns its own 1 Hz tick and re-renders only itself, never the ~orchestrator.

- [ ] **Step 1: `test-timer.tsx`** — counts elapsed from a start ms, renders mm:ss, fires `onExpire` once at `durationSec` (null = counts up forever until the parent stops it):

```tsx
'use client'
import { useEffect, useRef, useState } from 'react'

export function TestTimer({ startedAtMs, durationSec, onExpire }: {
  startedAtMs: number
  durationSec: number | null
  onExpire: () => void
}) {
  const [elapsed, setElapsed] = useState(0)
  const firedRef = useRef(false)
  const onExpireRef = useRef(onExpire)
  onExpireRef.current = onExpire

  useEffect(() => {
    const tick = () => {
      const e = Math.floor((Date.now() - startedAtMs) / 1000)
      setElapsed(e)
      if (durationSec != null && e >= durationSec && !firedRef.current) {
        firedRef.current = true
        onExpireRef.current()
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAtMs, durationSec])

  // Count DOWN for fixed protocols, UP for self-paced.
  const shown = durationSec != null ? Math.max(0, durationSec - elapsed) : elapsed
  const mm = Math.floor(shown / 60)
  const ss = shown % 60
  return (
    <p className="text-6xl font-bold tabular-nums" aria-label="Time remaining">
      {mm}:{String(ss).padStart(2, '0')}
    </p>
  )
}
```

- [ ] **Step 2: `test-hr-display.tsx`** — reads `useLiveHr()` (the leaf's only timer) + a Karvonen target for the zone banner. Uses theme tokens + a label (never colour-only):

```tsx
'use client'
import { useLiveHr } from '@/lib/live-hr/use-live-hr'
import { HeartIcon } from 'lucide-react'

export function TestHrDisplay({ target }: { target: number | null }) {
  const { bpm, live, stale } = useLiveHr()
  const inZone = bpm != null && target != null && bpm >= target
  return (
    <div className="flex flex-col items-center gap-1" style={{ opacity: live ? 1 : 0.5 }}>
      <div className="flex items-baseline gap-2">
        <HeartIcon className="h-5 w-5" style={{ color: 'var(--color-brand)' }} aria-hidden />
        <span className="text-3xl font-bold tabular-nums">{bpm ?? '—'}</span>
        <span className="text-sm text-muted-foreground">bpm{stale ? ' (stale)' : ''}</span>
      </div>
      {target != null && (
        <p className="text-sm font-semibold" style={{ color: inZone ? 'var(--color-brand)' : 'var(--color-muted-foreground)' }}>
          {inZone ? `In target zone (≥${target} bpm)` : `Aim for ≥${target} bpm`}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 3: `test-countdown.tsx`** — a 3-2-1 pre-start countdown leaf that calls `onDone` when it hits 0:

```tsx
'use client'
import { useEffect, useRef, useState } from 'react'

export function TestCountdown({ onDone }: { onDone: () => void }) {
  const [n, setN] = useState(3)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  useEffect(() => {
    const id = setInterval(() => {
      setN(prev => {
        if (prev <= 1) { clearInterval(id); onDoneRef.current(); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="flex h-full flex-col items-center justify-center pt-safe pb-safe">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">Get ready</p>
      <p className="text-8xl font-black tabular-nums" style={{ color: 'var(--color-brand)' }}>{n}</p>
    </div>
  )
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/fitness-tests/test-timer.tsx components/fitness-tests/test-hr-display.tsx components/fitness-tests/test-countdown.tsx
git commit -m "Fitness-test leaf components: timer, live-HR display, countdown"
```

---

## Task 11: Active test screen (`test-active.tsx`)

**Files:**
- Create: `components/fitness-tests/test-active.tsx`

Owns the live-HR + GPS lifecycle (like `walk-active.tsx`), collects HR samples + GPS points into refs, delegates the ticking clock/HR to the leaves from Task 10, and calls `onFinish` with the captured data.

- [ ] **Step 1: Implement**

```tsx
'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { getLiveHrManager } from '@/lib/live-hr/manager'
import { startGpsWatcher, type GpsWatcher } from '@/lib/activity/gps-tracking'
import { haversineDistanceKm } from '@/lib/activity/activity-metrics'
import { hrReserveTarget, estimateHrMax } from '@/lib/health/hr-zones'
import { hapticSuccess } from '@/lib/haptics'
import type { LiveHrSample } from '@/lib/live-hr/types'
import type { RoutePoint } from '@/lib/activity/route-encoding'
import type { FitnessTestProtocol } from '@/lib/fitness-tests/protocols'
import { TestTimer } from './test-timer'
import { TestHrDisplay } from './test-hr-display'

export interface CapturedHr { at: number; bpm: number }
export interface TestCapture {
  hrSamples: CapturedHr[]
  distanceM: number
  startMs: number
  endMs: number
}

export function TestActive({ protocol, profile, startedAtMs, onFinish }: {
  protocol: FitnessTestProtocol
  profile: { age: number | null; restingHr: number; hrMaxObserved: number | null }
  startedAtMs: number
  onFinish: (c: TestCapture) => void
}) {
  const hrRef = useRef<CapturedHr[]>([])
  const pointsRef = useRef<RoutePoint[]>([])
  const distKmRef = useRef(0)
  const finishedRef = useRef(false)
  const onFinishRef = useRef(onFinish)
  onFinishRef.current = onFinish
  const [distanceM, setDistanceM] = useState(0)
  const [gpsError, setGpsError] = useState<string | null>(null)

  const hrMax = estimateHrMax({ age: profile.age, observed: profile.hrMaxObserved })
  const target = useMemo(
    () => (protocol.effortFrac != null ? hrReserveTarget(protocol.effortFrac, profile.restingHr, hrMax) : null),
    [protocol.effortFrac, profile.restingHr, hrMax],
  )

  const finish = () => {
    if (finishedRef.current) return
    finishedRef.current = true
    hapticSuccess()
    onFinishRef.current({
      hrSamples: hrRef.current,
      distanceM: Math.round(distKmRef.current * 1000),
      startMs: startedAtMs,
      endMs: Date.now(),
    })
  }

  // Live-HR lifecycle — this screen owns start()/stop().
  useEffect(() => {
    const mgr = getLiveHrManager()
    mgr.start().catch(() => {})
    const unsub = mgr.subscribe((sm: LiveHrSample) => { hrRef.current.push({ at: sm.at, bpm: sm.bpm }) })
    return () => { unsub(); mgr.stop().catch(() => {}) }
  }, [])

  // GPS lifecycle — only for distance-capturing protocols.
  useEffect(() => {
    if (!protocol.captureDistance) return
    let watcher: GpsWatcher | null = null
    let cancelled = false
    startGpsWatcher(
      (pt) => {
        const pts = pointsRef.current
        if (pts.length > 0) distKmRef.current += haversineDistanceKm(pts[pts.length - 1], pt)
        pts.push(pt)
        setDistanceM(Math.round(distKmRef.current * 1000))
      },
      (msg) => setGpsError(msg),
    ).then(w => { if (cancelled) w.stop().catch(() => {}); else watcher = w })
    return () => { cancelled = true; watcher?.stop().catch(() => {}) }
  }, [protocol.captureDistance])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6 pt-safe pb-safe text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{protocol.name}</p>
      <TestTimer startedAtMs={startedAtMs} durationSec={protocol.durationSec} onExpire={finish} />

      {protocol.captureDistance && (
        <div>
          <p className="text-4xl font-bold tabular-nums">{(distanceM / 1000).toFixed(2)}<span className="text-lg text-muted-foreground ml-1">km</span></p>
          {gpsError && <p className="mt-1 text-xs text-amber-500">GPS: {gpsError}</p>}
        </div>
      )}

      <TestHrDisplay target={target} />

      <Button variant="outline" className="mt-2 h-12 w-full max-w-xs" onClick={finish}>
        {protocol.durationSec != null ? 'End test early' : 'Finish'}
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`getLiveHrManager`, `LiveHrSample`, `startGpsWatcher`/`GpsWatcher`, `RoutePoint`, `hapticSuccess` all exist at the imported paths — verify `@/lib/haptics` exports `hapticSuccess` as used by `walk-active.tsx`.)

- [ ] **Step 3: Commit**

```bash
git add components/fitness-tests/test-active.tsx
git commit -m "Fitness-test active screen: live HR + GPS distance + leaf timer"
```

---

## Task 12: Result screen with offline-first save (`test-result.tsx`)

**Files:**
- Create: `components/fitness-tests/test-result.tsx`

Computes the estimate ONCE from the capture (equations from Task 1), saves offline-first (local store + outbox, mirroring `done-activity-screen.tsx`), and shows a comparison against the previous test of this type.

- [ ] **Step 1: Implement**

```tsx
'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { TrendingUpIcon, TrendingDownIcon, MinusIcon } from 'lucide-react'
import { getLocalStore } from '@/lib/local-store'
import { pushMutations } from '@/lib/local-store/sync-engine'
import { invalidateFitnessTests } from '@/lib/cache-groups'
import { todayInTz } from '@/lib/date-utils'
import { sixMwtVo2max, cooperVo2max, baselineHrr1, restingHrFrom, maxHrFrom } from '@/lib/health/fitness-tests'
import type { HrReading } from '@/lib/workout/hr-analysis'
import type { FitnessTestProtocol } from '@/lib/fitness-tests/protocols'
import type { LocalFitnessTest } from '@/lib/local-store/types'
import type { TestCapture } from './test-active'

export function TestResult({ protocol, capture, previous, userId, onDone }: {
  protocol: FitnessTestProtocol
  capture: TestCapture
  previous: LocalFitnessTest | null
  userId?: string
  onDone: () => void
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  // Equations run ONCE here, at capture time — the stored value is read verbatim.
  const computed = useMemo(() => {
    const readings: HrReading[] = capture.hrSamples.map(s => ({ timestamp: new Date(s.at), bpm: s.bpm }))
    const avgHr = readings.length ? Math.round(readings.reduce((a, r) => a + r.bpm, 0) / readings.length) : null
    const maxHr = maxHrFrom(readings)
    let vo2maxEst: number | null = null
    let method: string | null = null
    if (protocol.vo2Equation === '6mwt') { vo2maxEst = sixMwtVo2max(capture.distanceM); method = 'ross_2010' }
    else if (protocol.vo2Equation === 'cooper') { vo2maxEst = cooperVo2max(capture.distanceM); method = 'cooper_1968' }
    let restingHr: number | null = null
    let hrr1Bpm: number | null = null
    if (protocol.captureHrr) {
      restingHr = restingHrFrom(readings)
      // Recovery begins when the captured effort ends — the last sample's instant.
      const recoveryStart = new Date(capture.endMs)
      hrr1Bpm = baselineHrr1(readings, recoveryStart)
    }
    return { avgHr, maxHr, vo2maxEst, method, restingHr, hrr1Bpm }
  }, [protocol, capture])

  const primary = protocol.vo2Equation != null
    ? { label: 'Est. VO₂max', value: computed.vo2maxEst != null ? `${computed.vo2maxEst}` : '—', unit: 'mL/kg/min' }
    : { label: '1-min HR recovery', value: computed.hrr1Bpm != null ? `${computed.hrr1Bpm}` : '—', unit: 'bpm drop' }

  const prevVal = protocol.vo2Equation != null ? previous?.vo2maxEst ?? null : previous?.hrr1Bpm ?? null
  const curVal = protocol.vo2Equation != null ? computed.vo2maxEst : computed.hrr1Bpm
  const delta = prevVal != null && curVal != null ? Math.round((curVal - prevVal) * 10) / 10 : null

  async function handleSave() {
    if (saving) return
    setSaving(true)
    const today = todayInTz()
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const durationSec = Math.round((capture.endMs - capture.startMs) / 1000)
    const record: LocalFitnessTest = {
      id, testType: protocol.id, date: today, durationSec,
      distanceM: protocol.captureDistance ? capture.distanceM : null,
      avgHr: computed.avgHr, maxHr: computed.maxHr,
      restingHr: computed.restingHr, hrr1Bpm: computed.hrr1Bpm,
      vo2maxEst: computed.vo2maxEst, method: computed.method, notes: null,
      updatedAt: now, deletedAt: null, syncStatus: 'pending',
    }
    const store = userId ? getLocalStore(userId) : null
    if (store) {
      try {
        await store.upsertFitnessTest(record)
        await store.queueMutation({
          userId: userId!, domain: 'fitness_tests', date: today,
          payload: {
            id, testType: protocol.id, durationSec,
            distanceM: record.distanceM ?? undefined,
            avgHr: record.avgHr ?? undefined, maxHr: record.maxHr ?? undefined,
            restingHr: record.restingHr ?? undefined, hrr1Bpm: record.hrr1Bpm ?? undefined,
            vo2maxEst: record.vo2maxEst ?? undefined, method: record.method ?? undefined,
          },
        })
        invalidateFitnessTests().catch(() => {})
        toast.success('Baseline saved')
        onDone()
        router.push('/health?tab=training')
        pushMutations(userId!).catch(() => {})
        return
      } catch (e) {
        console.error('Fitness test SQLite write failed, falling back to API:', e)
      }
    }
    // Web fallback (dev/QA only) — pure POST, no extra logic.
    try {
      const res = await fetch('/api/fitness-tests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id, testType: protocol.id, date: today, durationSec,
          distanceM: record.distanceM ?? undefined,
          avgHr: record.avgHr ?? undefined, maxHr: record.maxHr ?? undefined,
          restingHr: record.restingHr ?? undefined, hrr1Bpm: record.hrr1Bpm ?? undefined,
          vo2maxEst: record.vo2maxEst ?? undefined, method: record.method ?? undefined,
        }),
      })
      if (!res.ok) throw new Error()
      await invalidateFitnessTests()
      toast.success('Baseline saved')
      onDone()
      router.push('/health?tab=training')
    } catch {
      toast.error('Failed to save baseline')
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 pt-safe pb-safe">
      <h1 className="mb-1 text-xl font-bold">{protocol.name}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{protocol.shortName} complete</p>

      <div className="mb-4 rounded-2xl bg-muted/60 border border-border p-5 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{primary.label}</p>
        <p className="mt-1 text-5xl font-black tabular-nums" style={{ color: 'var(--color-brand)' }}>{primary.value}</p>
        <p className="text-sm text-muted-foreground">{primary.unit}</p>
        {delta != null && (
          <p className="mt-2 flex items-center justify-center gap-1 text-sm font-semibold"
             style={{ color: delta > 0 ? '#22c55e' : delta < 0 ? '#ef4444' : 'var(--color-muted-foreground)' }}>
            {delta > 0 ? <TrendingUpIcon className="h-4 w-4" /> : delta < 0 ? <TrendingDownIcon className="h-4 w-4" /> : <MinusIcon className="h-4 w-4" />}
            {delta > 0 ? '+' : ''}{delta} vs last test
          </p>
        )}
      </div>

      <div className="mb-6 grid grid-cols-3 gap-2 text-center">
        {protocol.captureDistance && (
          <Stat label="Distance" value={`${(capture.distanceM / 1000).toFixed(2)} km`} />
        )}
        {computed.avgHr != null && <Stat label="Avg HR" value={`${computed.avgHr}`} />}
        {computed.maxHr != null && <Stat label="Max HR" value={`${computed.maxHr}`} />}
        {computed.restingHr != null && <Stat label="Resting HR" value={`${computed.restingHr}`} />}
      </div>

      <div className="mt-auto flex gap-3">
        <Button variant="outline" className="flex-1 h-12" onClick={() => { onDone(); router.push('/health?tab=training') }} disabled={saving}>
          Discard
        </Button>
        <Button className="flex-1 h-12" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save baseline'}
        </Button>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/60 border border-border px-2 py-3">
      <p className="text-base font-bold tabular-nums">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/fitness-tests/test-result.tsx
git commit -m "Fitness-test result screen: compute-once estimate + offline-first save + trend"
```

---

## Task 13: Flow orchestrator + protocol picker + page route

**Files:**
- Create: `components/fitness-tests/test-select.tsx`, `components/fitness-tests/fitness-tests-content.tsx`, `app/baselines/page.tsx`

- [ ] **Step 1: `test-select.tsx`** — the picker; reads latest result per protocol **local-first** (offline-first rule), API fallback:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { getLocalStore } from '@/lib/local-store'
import { cachedFetch } from '@/lib/sqlite/cache'
import { FITNESS_TESTS_TTL } from '@/lib/cache-ttl'
import { FITNESS_TEST_PROTOCOLS } from '@/lib/fitness-tests/protocols'
import type { FitnessTestId, FitnessTestProtocol } from '@/lib/fitness-tests/protocols'
import type { LocalFitnessTest } from '@/lib/local-store/types'
import { ChevronRightIcon } from 'lucide-react'

export function TestSelect({ userId, onChoose }: {
  userId?: string
  onChoose: (id: FitnessTestId) => void
}) {
  const [latest, setLatest] = useState<Record<string, LocalFitnessTest>>({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      const store = userId ? getLocalStore(userId) : null
      let rows: LocalFitnessTest[] = []
      if (store) {
        rows = await store.getFitnessTests('0000-00-00')      // all history
      } else {
        // Web dev/QA fallback — pure fetch → render, no logic.
        await cachedFetch<{ fitnessTests: LocalFitnessTest[] }>(
          'fitness-tests', '/api/fitness-tests', FITNESS_TESTS_TTL,
          d => { if (!cancelled) applyLatest(d.fitnessTests) },
        ).catch(() => {})
        return
      }
      if (!cancelled) applyLatest(rows)
    }
    function applyLatest(rows: LocalFitnessTest[]) {
      const map: Record<string, LocalFitnessTest> = {}
      for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date))) map[r.testType] = r
      setLatest(map)
    }
    load()
    return () => { cancelled = true }
  }, [userId])

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto px-4 pt-safe pb-safe">
      <h1 className="mb-1 text-xl font-bold">Fitness Baselines</h1>
      <p className="mb-2 text-sm text-muted-foreground">Measure your cardio fitness. Repeat later to see progress.</p>
      {FITNESS_TEST_PROTOCOLS.map((p: FitnessTestProtocol) => {
        const last = latest[p.id]
        const lastVal = p.vo2Equation != null ? last?.vo2maxEst : last?.hrr1Bpm
        const unit = p.vo2Equation != null ? 'VO₂max' : 'HRR bpm'
        return (
          <button key={p.id} onClick={() => onChoose(p.id)}
            className="flex items-center justify-between rounded-2xl bg-muted/60 border border-border p-4 text-left active:scale-[0.98] transition">
            <div className="flex-1">
              <p className="text-base font-bold">{p.name}</p>
              <p className="text-xs text-muted-foreground">{p.description}</p>
              {lastVal != null && (
                <p className="mt-1 text-xs font-semibold" style={{ color: 'var(--color-brand)' }}>
                  Last: {lastVal} {unit} · {last!.date}
                </p>
              )}
            </div>
            <ChevronRightIcon className="h-5 w-5 text-muted-foreground flex-none" />
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: `fitness-tests-content.tsx`** — the orchestrator (mode switch, mirrors `guided-walk-content.tsx`):

```tsx
'use client'
import { useEffect, useMemo, useState } from 'react'
import { useFitnessTestStore } from '@/lib/stores/fitness-test-store'
import { getProtocol } from '@/lib/fitness-tests/protocols'
import { getLocalStore } from '@/lib/local-store'
import { TestSelect } from './test-select'
import { TestCountdown } from './test-countdown'
import { TestActive, type TestCapture } from './test-active'
import { TestResult } from './test-result'
import type { LocalFitnessTest } from '@/lib/local-store/types'

interface UserProfile { age: number | null; restingHr: number; hrMaxObserved: number | null }

export function FitnessTestsContent({ userId, profile }: { userId?: string; profile: UserProfile }) {
  const mode = useFitnessTestStore(s => s.mode)
  const selectedProtocolId = useFitnessTestStore(s => s.selectedProtocolId)
  const startedAtMs = useFitnessTestStore(s => s.startedAtMs)
  const choose = useFitnessTestStore(s => s.choose)
  const start = useFitnessTestStore(s => s.start)
  const finish = useFitnessTestStore(s => s.finish)
  const reset = useFitnessTestStore(s => s.reset)
  const [capture, setCapture] = useState<TestCapture | null>(null)
  const [previous, setPrevious] = useState<LocalFitnessTest | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])   // avoid persisted-store hydration mismatch

  const protocol = useMemo(() => (selectedProtocolId ? getProtocol(selectedProtocolId) : undefined), [selectedProtocolId])

  // On finish, look up the most recent prior test of this type for the trend.
  useEffect(() => {
    if (mode !== 'done' || !protocol || !capture) return
    let cancelled = false
    async function loadPrev() {
      const store = userId ? getLocalStore(userId) : null
      if (!store) { setPrevious(null); return }
      const rows = (await store.getFitnessTests('0000-00-00')).filter(r => r.testType === protocol!.id)
      rows.sort((a, b) => b.date.localeCompare(a.date))
      if (!cancelled) setPrevious(rows[0] ?? null)
    }
    loadPrev()
    return () => { cancelled = true }
  }, [mode, protocol, capture, userId])

  if (!mounted) return null

  if (mode === 'countdown' && protocol) {
    return <TestCountdown onDone={() => start(Date.now())} />
  }
  if (mode === 'active' && protocol && startedAtMs != null) {
    return <TestActive protocol={protocol} profile={profile} startedAtMs={startedAtMs}
      onFinish={(c) => { setCapture(c); finish() }} />
  }
  if (mode === 'done' && protocol && capture) {
    return <TestResult protocol={protocol} capture={capture} previous={previous} userId={userId} onDone={reset} />
  }
  return <TestSelect userId={userId} onChoose={choose} />
}
```

- [ ] **Step 3: `app/baselines/page.tsx`** — server component; loads the same profile shape `guided-walk/page.tsx` builds:

```tsx
import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { getRepositoryAsync } from '@/lib/data'
import { ageFromDob, todayInTz, shiftDateStr } from '@/lib/date-utils'
import { FitnessTestsContent } from '@/components/fitness-tests/fitness-tests-content'

export default async function BaselinesPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')

  const repo = await getRepositoryAsync()
  const tz = session.user.timezone ?? undefined
  const today = todayInTz(tz)
  const [user, metrics] = await Promise.all([
    repo.getUserById(session.user.id),
    repo.listBodyMetrics(session.user.id, shiftDateStr(today, -30), today),
  ])

  const rhr = metrics.filter(m => m.restingHeartRate != null && m.restingHeartRate > 0)
  const restingHr = rhr.length
    ? Math.round(rhr.reduce((s, m) => s + (m.restingHeartRate as number), 0) / rhr.length)
    : 60
  const age = ageFromDob(user?.dateOfBirth, new Date())
  const profile = { age, restingHr, hrMaxObserved: null as number | null }

  return (
    <div className="h-screen w-full">
      <FitnessTestsContent userId={session.user.id} profile={profile} />
    </div>
  )
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: clean. (Confirm `getRepositoryAsync`, `ageFromDob`, `shiftDateStr`, `listBodyMetrics` exist — all used by `app/activity/guided-walk/page.tsx`.)

- [ ] **Step 5: Exercise the web flow.**

Run: `pnpm dev`, open `localhost:3000/baselines`. Pick "Cooper 12-Minute Run" → countdown → active screen shows a counting-down timer + live-HR placeholder (`—` in the web sandbox; no ring) + a live distance readout (0.00 km — `navigator.geolocation` in the sandbox yields no fix, expected) → tap "End test early" → result screen shows `Est. VO₂max` computed from distance (0 → `(0−504.9)/44.73` = negative; use the browser devtools to inject a distance via a manual POST for a realistic value) → "Save baseline" → redirected to `/health?tab=training`, toast "Baseline saved". Then `curl` GET `/api/fitness-tests` and confirm the row persisted.

- [ ] **Step 6: Commit**

```bash
git add components/fitness-tests/test-select.tsx components/fitness-tests/fitness-tests-content.tsx app/baselines/page.tsx
git commit -m "Fitness-test flow orchestrator, protocol picker, /baselines page"
```

---

## Task 14: Health-page surface (latest baseline card)

**Files:**
- Create: `components/fitness-tests/latest-baseline-card.tsx`
- Modify: `app/health/health-content.tsx`, `app/health/health-sections.tsx`

- [ ] **Step 1: The card** — self-fetching, local-first, with an explicit empty/CTA state (a self-fetching card needs an explicit failure/empty state):

```tsx
'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getLocalStore } from '@/lib/local-store'
import { cachedFetch } from '@/lib/sqlite/cache'
import { FITNESS_TESTS_TTL } from '@/lib/cache-ttl'
import { getProtocol } from '@/lib/fitness-tests/protocols'
import { accentCardStyle } from '@/lib/utils'
import { ActivityIcon, ChevronRightIcon } from 'lucide-react'
import type { LocalFitnessTest } from '@/lib/local-store/types'

export function LatestBaselineCard({ userId }: { userId?: string }) {
  const [rows, setRows] = useState<LocalFitnessTest[] | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const store = userId ? getLocalStore(userId) : null
      if (store) {
        const all = await store.getFitnessTests('0000-00-00')
        if (!cancelled) setRows(all)
        return
      }
      await cachedFetch<{ fitnessTests: LocalFitnessTest[] }>(
        'fitness-tests', '/api/fitness-tests', FITNESS_TESTS_TTL,
        d => { if (!cancelled) setRows(d.fitnessTests) },
      ).catch(() => { if (!cancelled) setRows([]) })
    }
    load()
    return () => { cancelled = true }
  }, [userId])

  // Latest per protocol.
  const latest: Record<string, LocalFitnessTest> = {}
  for (const r of [...(rows ?? [])].sort((a, b) => a.date.localeCompare(b.date))) latest[r.testType] = r
  const entries = Object.values(latest)

  return (
    <Link href="/baselines" className="block rounded-2xl p-4" style={accentCardStyle('#14b8a6')}>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ActivityIcon className="h-4 w-4" style={{ color: '#14b8a6' }} aria-hidden />
          <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#14b8a6' }}>Cardio Baselines</p>
        </div>
        <ChevronRightIcon className="h-4 w-4 text-muted-foreground" />
      </div>
      {rows == null ? (
        <div className="h-7 w-32 animate-pulse rounded-lg bg-muted" />
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Take a fitness test to set your baseline</p>
      ) : (
        <div className="flex flex-wrap gap-4">
          {entries.map(e => {
            const p = getProtocol(e.testType)
            const val = p?.vo2Equation != null ? e.vo2maxEst : e.hrr1Bpm
            const unit = p?.vo2Equation != null ? 'VO₂max' : 'HRR'
            return (
              <div key={e.testType}>
                <p className="text-[10px] text-muted-foreground">{p?.shortName ?? e.testType}</p>
                <p className="text-xl font-bold tabular-nums">{val ?? '—'}<span className="ml-1 text-[10px] font-normal text-muted-foreground">{unit}</span></p>
              </div>
            )
          })}
        </div>
      )}
    </Link>
  )
}
```

- [ ] **Step 2: Register the card key** in `app/health/health-content.tsx`. Change `TRAINING_DEFAULT_ORDER` (line 69):

```ts
const TRAINING_DEFAULT_ORDER = ["calendar","weeklyStats","aiPeriodization","muscleSets","baselineTests","activityHistory","workoutDensity"];
```

- [ ] **Step 3: Render it** in `app/health/health-sections.tsx`. Add the import near the other card imports (~line 13):

```ts
import { LatestBaselineCard } from "@/components/fitness-tests/latest-baseline-card";
```

Add the case to `renderTrainingSection` (~line 706, next to `activityHistory`):

```ts
      case "baselineTests":   return <LatestBaselineCard key="baselineTests" userId={userId} />;
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: clean.

- [ ] **Step 5: Verify in dev.**

Run: `pnpm dev`, open `localhost:3000/health?tab=training`. The "Cardio Baselines" card renders (shows the empty CTA if no test yet, or the latest per-protocol values after Task 13's save). Tapping it routes to `/baselines`.

- [ ] **Step 6: Commit**

```bash
git add components/fitness-tests/latest-baseline-card.tsx app/health/health-content.tsx app/health/health-sections.tsx
git commit -m "Surface latest cardio baseline card on the health training tab"
```

---

## Task 15: Full offline-sync integration check

**Files:** none (verification task).

- [ ] **Step 1: Run the whole suite + gates**

Run: `npx vitest run lib/health/__tests__/fitness-tests.test.ts lib/fitness-tests/__tests__/protocols.test.ts && npx tsc --noEmit && pnpm lint && node scripts/check-push-mutations.js`
Expected: tests PASS; typecheck/lint clean; `check-push-mutations.js` reports OK (the `fitness_tests` push branch calls `saveFitnessTest`, never `this.db`/`sql`).

- [ ] **Step 2: Walk the sync chain once** (per the offline-sync checklist) and confirm every hop names `fitness_tests`:
  - local table (migrations.ts v14 + reconcile) ✓
  - `store.upsertFitnessTest` + `queueMutation({domain:'fitness_tests'})` (test-result.tsx) ✓
  - `pushMutations` branch → `saveFitnessTest` (adapter.ts) ✓
  - `getSyncDelta` select + return (adapter.ts) ✓
  - `pullDelta` mapping → `applyDelta` branch (sync-engine.ts + sqlite-backend.ts) ✓
  - render reads local-first (test-select.tsx, latest-baseline-card.tsx, fitness-tests-content.tsx) ✓
  - `clearLocalStoreData` wipe (index.ts) ✓

- [ ] **Step 3: Commit (if any lint autofix)** — otherwise skip.

---

## Verification summary — what IS and IS NOT sandbox-verifiable

**Verified in the sandbox (`pnpm dev` + local Postgres on :5433 + vitest):**
- Equation correctness (Ross 6MWT, Cooper, HRR reuse) — Task 1 unit tests.
- Protocol table invariants — Task 2 unit tests.
- Migration 131 applies; `fitness_tests` table + indexes exist — Task 3.
- `POST`/`GET`/`DELETE /api/fitness-tests` round-trip against local Postgres — Task 8.
- Web flow renders end-to-end (picker → countdown → active → result → save → health card) — Tasks 13–14.
- Typecheck, lint, and `check-push-mutations.js` all pass.

**NOT verifiable in the sandbox — requires the S25 APK on-device (`docs/device-smoke-checklist.md`), so treat as unverified until the owner runs it:**
- **Live HR** (`useLiveHr`/`getLiveHrManager`): the Oura ring BLE / Polar H10 sources only exist on-device. In the web sandbox `TestHrDisplay` shows `—`; avg/max/resting/HRR are all null there. Ring radio also power-gates when worn-idle at a desk (firmware, not a bug), so a real HR capture needs the ring worn + moving or during the actual test effort.
- **GPS distance** (`startGpsWatcher` → `@capacitor-community/background-geolocation`): the native background/foreground-service watcher is APK-only; `navigator.geolocation` in the sandbox returns no fix, so `distanceM` stays 0. VO₂max from a real 6MWT/Cooper is therefore only obtainable on-device, outdoors. Background-tracking with the screen off (the whole point of a 6/12-minute timed test) is unverifiable off-device.
- **Native SQLite offline-first path** (`getLocalStore` returns null in the sandbox): the local write, outbox queue, `pushMutations`, `pullDelta`/`applyDelta` round-trip, and the offline render all run only through the web API fallback here. The local table create (SQLite v14), the pull-clobber `sync_status` guard, and cross-device delete propagation must be confirmed on the APK.
- **Safe-area insets** (`pt-safe`/`pb-safe` on all four full-screen fitness-test surfaces): render as 0 in the sandbox — verify header/footer clearance on the S25's status + gesture bars.
- **Haptics** (`hapticSuccess` on finish): no-op in the browser.

**Merge gate:** green `pnpm dev` + vitest is necessary but NOT sufficient (Canonical Runtime). Because this change touches an offline-first domain, a native plugin (BLE + GPS), and safe-area, the merge gate is the on-device smoke run — or an explicit `projectOverview.md` Known-Issues row marking the fitness-test flow NOT-yet-device-verified.
