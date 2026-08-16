> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Health Progress Tab — Card 1 (1RM Mode Toggle) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Latest vs PR" / "Working Set vs PR" mode toggle to the Estimated 1RM card on the Health > Progress tab, per `docs/superpowers/specs/2026-06-15-health-progress-tab-design.md` §1.

**Architecture:** A new repo method `listMaxReps` feeds an extended `/api/weights-summary` response (`exerciseType`, `lastReps`, `maxReps` added to `ExerciseSummary`). A new pure helper `computeBarMetric(ex, mode)` in `lib/health/strength-progress.ts` encapsulates the Mode A/B bar math (unit-tested with vitest, since there's no adapter/component test harness in this codebase). `components/health/strength-progress-card.tsx` is rewritten to add the segmented-pill mode toggle and use `computeBarMetric`.

**Tech Stack:** Next.js 15 App Router API routes, Drizzle ORM / PostgreSQL, React 19 client components, vitest.

---

## Task 1: `listMaxReps` repository method

**Files:**
- Modify: `lib/data/repository.ts:154`
- Modify: `lib/data/postgres/adapter.ts:2353-2359`

- [ ] **Step 1: Add the interface declaration**

In `lib/data/repository.ts`, the `// ── Personal Records ──` section ends with:

```ts
  // All-time best estimated1rm per exercise, keyed by exercise name.
  listPersonalRecords(userId: string): Promise<Map<string, number>>

  // ── Data Tools ─────────────────────────────────────────────────────────────
```

Change it to:

```ts
  // All-time best estimated1rm per exercise, keyed by exercise name.
  listPersonalRecords(userId: string): Promise<Map<string, number>>
  // All-time max reps logged per exercise, keyed by exercise name — used for
  // bodyweight "Working Set vs PR" comparisons on the Progress tab.
  listMaxReps(userId: string): Promise<Map<string, number>>

  // ── Data Tools ─────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Add the adapter implementation**

In `lib/data/postgres/adapter.ts`, `listPersonalRecords` currently reads:

```ts
  async listPersonalRecords(userId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ exerciseName: s.personalRecords.exerciseName, estimated1rm: s.personalRecords.estimated1rm })
      .from(s.personalRecords)
      .where(eq(s.personalRecords.userId, userId))
    return new Map(rows.map(r => [r.exerciseName, r.estimated1rm]))
  }

  // ── Data Tools ───────────────────────────────────────────────────────────
```

Add a new method between them:

```ts
  async listPersonalRecords(userId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ exerciseName: s.personalRecords.exerciseName, estimated1rm: s.personalRecords.estimated1rm })
      .from(s.personalRecords)
      .where(eq(s.personalRecords.userId, userId))
    return new Map(rows.map(r => [r.exerciseName, r.estimated1rm]))
  }

  async listMaxReps(userId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({
        exerciseName: s.exerciseLogs.exerciseName,
        maxReps: sql<number>`max(${s.setLogs.reps})`,
      })
      .from(s.setLogs)
      .innerJoin(s.exerciseLogs, eq(s.exerciseLogs.id, s.setLogs.exerciseLogId))
      .innerJoin(s.workoutSessions, eq(s.workoutSessions.id, s.exerciseLogs.workoutSessionId))
      .where(eq(s.workoutSessions.userId, userId))
      .groupBy(s.exerciseLogs.exerciseName)
    return new Map(rows.map(r => [r.exerciseName, Number(r.maxReps)]))
  }

  // ── Data Tools ───────────────────────────────────────────────────────────
```

`eq`, `sql` are already imported at the top of `adapter.ts` (line 2) — no new imports needed.

- [ ] **Step 3: Type-check**

Run:
```bash
npx tsc --noEmit
```
Expected: no new errors related to `repository.ts` or `adapter.ts`.

- [ ] **Step 4: Verify the query against local dev data**

The local dev Postgres is already running on port 5433 (started by the session hook). Run:

```bash
PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d trainingai_dev -c "
SELECT el.exercise_name, MAX(sl.reps) AS max_reps
FROM set_logs sl
JOIN exercise_logs el ON el.id = sl.exercise_log_id
JOIN workout_sessions ws ON ws.id = el.workout_session_id
JOIN users u ON u.id = ws.user_id
WHERE u.email = 'test@local.dev'
GROUP BY el.exercise_name;
"
```

Expected output: a single row, `Bench Press | 8` (the seed data logs "Bench Press" with set reps `8, 8, 7` across all 9 sessions — max is 8). This confirms the Drizzle query in Step 2 is equivalent to the SQL the spec specifies.

- [ ] **Step 5: Commit**

```bash
git add lib/data/repository.ts lib/data/postgres/adapter.ts
git commit -m "Add listMaxReps repository method for bodyweight 1RM mode"
```

---

## Task 2: Extend `/api/weights-summary` with `exerciseType`, `lastReps`, `maxReps`

**Files:**
- Modify: `app/api/weights-summary/route.ts`

- [ ] **Step 1: Extend the `ExerciseSummary` interface and populate the new fields**

Current `app/api/weights-summary/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";
import { DEFAULT_TZ, toAestDay } from "@/lib/date-utils";

export interface ExerciseSummary {
  exercise: string;
  weight: number | null;
  date: string | null;
  sessionName: string;
  estimated1rm: number | null;
  target80: number | null;
  personalRecord1rm: number | null;
}

export async function GET(_req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const repo = await getRepository();
  const tz = session.user?.timezone ?? DEFAULT_TZ;
  const [program, latestLogs, personalRecords] = await Promise.all([
    repo.getActiveProgram(userId),
    repo.getExerciseSummary(userId),
    repo.listPersonalRecords(userId),
  ]);

  const logMap = new Map(latestLogs.map(l => [l.exerciseName, l]));

  // Build summary ordered by program session position
  const exercises: ExerciseSummary[] = [];
  if (program) {
    for (const sess of program.sessions) {
      for (const ex of sess.exercises) {
        const log = logMap.get(ex.exerciseName);
        exercises.push({
          exercise: ex.exerciseName,
          weight: log?.sets[0]?.weightKg ?? null,
          date: log?.loggedAt
            ? toAestDay(log.loggedAt, tz).replace(/-/g, '/')
            : null,
          sessionName: sess.name,
          estimated1rm: log?.estimated1rm ?? null,
          target80: log?.target80 ?? null,
          personalRecord1rm: personalRecords.get(ex.exerciseName) ?? null,
        });
      }
    }
  }

  // Group by session for the canonical record used by the UI
  const canonical: Record<string, string[]> = {};
  if (program) {
    for (const sess of program.sessions) {
      canonical[sess.name] = sess.exercises.map(e => e.exerciseName);
    }
  }

  return NextResponse.json({ exercises, canonical });
}
```

Replace the whole file with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";
import { DEFAULT_TZ, toAestDay } from "@/lib/date-utils";

export interface ExerciseSummary {
  exercise: string;
  weight: number | null;
  date: string | null;
  sessionName: string;
  estimated1rm: number | null;
  target80: number | null;
  personalRecord1rm: number | null;
  exerciseType: 'weighted' | 'bodyweight';
  lastReps: number | null;
  maxReps: number | null;
}

export async function GET(_req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const repo = await getRepository();
  const tz = session.user?.timezone ?? DEFAULT_TZ;
  const [program, latestLogs, personalRecords, exerciseLibrary, maxRepsByExercise] = await Promise.all([
    repo.getActiveProgram(userId),
    repo.getExerciseSummary(userId),
    repo.listPersonalRecords(userId),
    repo.listExerciseLibrary(),
    repo.listMaxReps(userId),
  ]);

  const logMap = new Map(latestLogs.map(l => [l.exerciseName, l]));
  const exerciseTypeByName = new Map(exerciseLibrary.map(e => [e.name, e.exerciseType]));

  // Build summary ordered by program session position
  const exercises: ExerciseSummary[] = [];
  if (program) {
    for (const sess of program.sessions) {
      for (const ex of sess.exercises) {
        const log = logMap.get(ex.exerciseName);
        exercises.push({
          exercise: ex.exerciseName,
          weight: log?.sets[0]?.weightKg ?? null,
          date: log?.loggedAt
            ? toAestDay(log.loggedAt, tz).replace(/-/g, '/')
            : null,
          sessionName: sess.name,
          estimated1rm: log?.estimated1rm ?? null,
          target80: log?.target80 ?? null,
          personalRecord1rm: personalRecords.get(ex.exerciseName) ?? null,
          exerciseType: exerciseTypeByName.get(ex.exerciseName) ?? 'weighted',
          lastReps: log?.sets[0]?.reps ?? null,
          maxReps: maxRepsByExercise.get(ex.exerciseName) ?? null,
        });
      }
    }
  }

  // Group by session for the canonical record used by the UI
  const canonical: Record<string, string[]> = {};
  if (program) {
    for (const sess of program.sessions) {
      canonical[sess.name] = sess.exercises.map(e => e.exerciseName);
    }
  }

  return NextResponse.json({ exercises, canonical });
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no new errors.

- [ ] **Step 3: Verify the route response against local dev data**

Make sure the dev server is running (`pnpm dev` in the background, port 3000), then log in as `test@local.dev` / `testpass123` and hit the route directly in the browser (or via curl with the session cookie). Easiest check — from the running dev server, in a second terminal:

```bash
curl -s -b /tmp/cookies.txt -c /tmp/cookies.txt -X POST http://localhost:3000/api/auth/callback/credentials \
  -d "email=test@local.dev&password=testpass123&csrfToken=$(curl -s -c /tmp/cookies.txt http://localhost:3000/api/auth/csrf | sed -E 's/.*\"csrfToken\":\"([^\"]+)\".*/\1/')" \
  -o /dev/null
curl -s -b /tmp/cookies.txt http://localhost:3000/api/weights-summary | python3 -m json.tool
```

Expected: the `"Bench Press"` entry under `"sessionName": "Push"` now includes:
```json
"exerciseType": "weighted",
"lastReps": 8,
"maxReps": 8
```
with `"estimated1rm": 98`, `"personalRecord1rm": 98`, `"weight": 68` (from the seeded d=8 session). All other exercises (never logged) should have `"exerciseType": "weighted"`, `"lastReps": null`, `"maxReps": null`.

- [ ] **Step 4: Commit**

```bash
git add app/api/weights-summary/route.ts
git commit -m "Extend weights-summary with exerciseType, lastReps, maxReps"
```

---

## Task 3: `computeBarMetric` pure helper + unit tests

**Files:**
- Create: `lib/health/strength-progress.ts`
- Create: `lib/health/__tests__/strength-progress.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `lib/health/__tests__/strength-progress.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeBarMetric } from '../strength-progress'
import type { ExerciseSummary } from '@/app/api/weights-summary/route'

function makeExercise(overrides: Partial<ExerciseSummary> = {}): ExerciseSummary {
  return {
    exercise: 'Bench Press',
    weight: null,
    date: null,
    sessionName: 'Push',
    estimated1rm: null,
    target80: null,
    personalRecord1rm: null,
    exerciseType: 'weighted',
    lastReps: null,
    maxReps: null,
    ...overrides,
  }
}

describe('computeBarMetric — mode "latest"', () => {
  it('computes pct against PR and labels with estimated1rm', () => {
    const ex = makeExercise({ estimated1rm: 96, personalRecord1rm: 98 })
    const metric = computeBarMetric(ex, 'latest')
    expect(metric).not.toBeNull()
    expect(metric!.pct).toBeCloseTo((96 / 98) * 100, 5)
    expect(metric!.label).toBe('96 kg')
    expect(metric!.color).toBe('#bf5fff')
  })

  it('uses gold when at or above 99.5% of PR', () => {
    const ex = makeExercise({ estimated1rm: 98, personalRecord1rm: 98 })
    const metric = computeBarMetric(ex, 'latest')
    expect(metric!.pct).toBe(100)
    expect(metric!.color).toBe('#fbbf24')
  })

  it('caps pct at 100 even if estimated1rm exceeds the stored PR', () => {
    const ex = makeExercise({ estimated1rm: 105, personalRecord1rm: 98 })
    const metric = computeBarMetric(ex, 'latest')
    expect(metric!.pct).toBe(100)
    expect(metric!.color).toBe('#fbbf24')
  })

  it('falls back to estimated1rm as the PR when personalRecord1rm is null', () => {
    const ex = makeExercise({ estimated1rm: 96, personalRecord1rm: null })
    const metric = computeBarMetric(ex, 'latest')
    expect(metric!.pct).toBe(100)
    expect(metric!.label).toBe('96 kg')
  })

  it('returns null when estimated1rm is null', () => {
    const ex = makeExercise({ estimated1rm: null, personalRecord1rm: 98 })
    expect(computeBarMetric(ex, 'latest')).toBeNull()
  })
})

describe('computeBarMetric — mode "working", weighted exercises', () => {
  it('compares last working weight against PR', () => {
    const ex = makeExercise({ weight: 92.5, personalRecord1rm: 98, estimated1rm: 96 })
    const metric = computeBarMetric(ex, 'working')
    expect(metric!.pct).toBeCloseTo((92.5 / 98) * 100, 5)
    expect(metric!.label).toBe('92.5 kg')
    expect(metric!.color).toBe('#bf5fff')
  })

  it('returns null when no working weight has been logged', () => {
    const ex = makeExercise({ weight: null, personalRecord1rm: 98 })
    expect(computeBarMetric(ex, 'working')).toBeNull()
  })

  it('treats a missing PR as 100%', () => {
    const ex = makeExercise({ weight: 60, personalRecord1rm: null })
    const metric = computeBarMetric(ex, 'working')
    expect(metric!.pct).toBe(100)
    expect(metric!.color).toBe('#fbbf24')
  })

  it('caps pct at 100 when weight exceeds PR', () => {
    const ex = makeExercise({ weight: 110, personalRecord1rm: 98 })
    const metric = computeBarMetric(ex, 'working')
    expect(metric!.pct).toBe(100)
  })
})

describe('computeBarMetric — mode "working", bodyweight exercises', () => {
  it('compares last reps against all-time max reps', () => {
    const ex = makeExercise({
      exercise: 'Pull-Up',
      exerciseType: 'bodyweight',
      lastReps: 10,
      maxReps: 12,
    })
    const metric = computeBarMetric(ex, 'working')
    expect(metric!.pct).toBeCloseTo((10 / 12) * 100, 5)
    expect(metric!.label).toBe('10 reps')
    expect(metric!.color).toBe('#bf5fff')
  })

  it('uses gold when lastReps meets maxReps', () => {
    const ex = makeExercise({ exerciseType: 'bodyweight', lastReps: 12, maxReps: 12 })
    const metric = computeBarMetric(ex, 'working')
    expect(metric!.pct).toBe(100)
    expect(metric!.color).toBe('#fbbf24')
  })

  it('caps pct at 100 when lastReps exceeds maxReps', () => {
    const ex = makeExercise({ exerciseType: 'bodyweight', lastReps: 15, maxReps: 12 })
    const metric = computeBarMetric(ex, 'working')
    expect(metric!.pct).toBe(100)
  })

  it('returns null when lastReps is null', () => {
    const ex = makeExercise({ exerciseType: 'bodyweight', lastReps: null, maxReps: 12 })
    expect(computeBarMetric(ex, 'working')).toBeNull()
  })

  it('returns null when maxReps is null', () => {
    const ex = makeExercise({ exerciseType: 'bodyweight', lastReps: 10, maxReps: null })
    expect(computeBarMetric(ex, 'working')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test -- lib/health/__tests__/strength-progress.test.ts
```

Expected: FAIL — `Cannot find module '../strength-progress'` (file doesn't exist yet).

- [ ] **Step 3: Implement `computeBarMetric`**

Create `lib/health/strength-progress.ts`:

```ts
import type { ExerciseSummary } from '@/app/api/weights-summary/route'

export type StrengthMode = 'latest' | 'working'

export interface BarMetric {
  pct: number
  label: string
  color: string
}

const GOLD = '#fbbf24'
const PURPLE = '#bf5fff'

function colorFor(pct: number): string {
  return pct >= 99.5 ? GOLD : PURPLE
}

/**
 * Computes the progress-bar percentage, label, and color for one exercise row
 * on the Estimated 1RM card.
 *
 * - mode "latest": current estimated1rm vs all-time PR (existing behaviour).
 * - mode "working", weighted exercises: last working set weight vs all-time PR.
 * - mode "working", bodyweight exercises: last reps vs all-time max reps.
 *
 * Returns null when the row has no data to show in the given mode.
 */
export function computeBarMetric(ex: ExerciseSummary, mode: StrengthMode): BarMetric | null {
  if (mode === 'latest') {
    if (ex.estimated1rm == null) return null
    const pr = ex.personalRecord1rm ?? ex.estimated1rm
    const pct = pr > 0 ? Math.min((ex.estimated1rm / pr) * 100, 100) : 100
    return { pct, label: `${ex.estimated1rm} kg`, color: colorFor(pct) }
  }

  if (ex.exerciseType === 'bodyweight') {
    if (ex.lastReps == null || ex.maxReps == null) return null
    const pct = ex.maxReps > 0 ? Math.min((ex.lastReps / ex.maxReps) * 100, 100) : 100
    return { pct, label: `${ex.lastReps} reps`, color: colorFor(pct) }
  }

  if (ex.weight == null) return null
  const pr = ex.personalRecord1rm ?? 0
  const pct = pr > 0 ? Math.min((ex.weight / pr) * 100, 100) : 100
  return { pct, label: `${ex.weight} kg`, color: colorFor(pct) }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm test -- lib/health/__tests__/strength-progress.test.ts
```

Expected: PASS, all 14 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/health/strength-progress.ts lib/health/__tests__/strength-progress.test.ts
git commit -m "Add computeBarMetric pure helper for 1RM mode toggle"
```

---

## Task 4: Rewrite `strength-progress-card.tsx` with the Mode toggle

**Files:**
- Modify: `components/health/strength-progress-card.tsx`

- [ ] **Step 1: Replace the component**

Current `components/health/strength-progress-card.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Dumbbell } from 'lucide-react'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { TTL_MEDIUM } from '@/components/sync-provider'
import { accentCardStyle } from '@/lib/utils'
import type { ExerciseSummary } from '@/app/api/weights-summary/route'

export function StrengthProgressCard() {
  const [exercises, setExercises] = useState<ExerciseSummary[]>([])

  useEffect(() => {
    const cached = readCacheSync<{ exercises: ExerciseSummary[] }>('weights-summary')
    if (cached) setExercises(cached.exercises ?? [])
    cachedFetch<{ exercises: ExerciseSummary[] }>(
      'weights-summary', '/api/weights-summary', TTL_MEDIUM,
      d => setExercises(d?.exercises ?? []),
    ).catch(() => {})
  }, [])

  const withData = exercises.filter(e => e.estimated1rm != null)
  if (withData.length === 0) return null

  const sessionOrder: string[] = []
  const bySession = new Map<string, ExerciseSummary[]>()
  for (const ex of withData) {
    if (!bySession.has(ex.sessionName)) {
      bySession.set(ex.sessionName, [])
      sessionOrder.push(ex.sessionName)
    }
    bySession.get(ex.sessionName)!.push(ex)
  }

  return (
    <div className="rounded-2xl p-4" style={accentCardStyle('#bf5fff')}>
      <div className="flex items-center gap-2 mb-3">
        <Dumbbell className="h-4 w-4" style={{ color: '#bf5fff' }} />
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Estimated 1RM</p>
      </div>
      <div className="space-y-3">
        {sessionOrder.map(sessionName => (
          <div key={sessionName}>
            <p className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: '#bf5fff' }}>
              {sessionName}
            </p>
            <div className="space-y-1.5">
              {bySession.get(sessionName)!.map(ex => {
                const pr = ex.personalRecord1rm ?? ex.estimated1rm ?? 0
                const pct = pr > 0 ? Math.min(((ex.estimated1rm ?? 0) / pr) * 100, 100) : 100
                const atPr = pct >= 99.5
                return (
                  <div key={ex.exercise} className="flex items-center gap-2">
                    <p className="text-xs flex-1 truncate">{ex.exercise}</p>
                    <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden flex-none">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.max(pct, 4)}%`, background: atPr ? '#fbbf24' : '#bf5fff' }}
                      />
                    </div>
                    <p className="text-xs font-bold tabular-nums flex-none w-14 text-right">{ex.estimated1rm} kg</p>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

Replace the whole file with:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Dumbbell } from 'lucide-react'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { TTL_MEDIUM } from '@/components/sync-provider'
import { accentCardStyle } from '@/lib/utils'
import { computeBarMetric, type BarMetric, type StrengthMode } from '@/lib/health/strength-progress'
import type { ExerciseSummary } from '@/app/api/weights-summary/route'

export function StrengthProgressCard() {
  const [exercises, setExercises] = useState<ExerciseSummary[]>([])
  const [mode, setMode] = useState<StrengthMode>('latest')

  useEffect(() => {
    const cached = readCacheSync<{ exercises: ExerciseSummary[] }>('weights-summary')
    if (cached) setExercises(cached.exercises ?? [])
    cachedFetch<{ exercises: ExerciseSummary[] }>(
      'weights-summary', '/api/weights-summary', TTL_MEDIUM,
      d => setExercises(d?.exercises ?? []),
    ).catch(() => {})
  }, [])

  const withData = exercises.filter(e => e.estimated1rm != null)
  if (withData.length === 0) return null

  const sessionOrder: string[] = []
  const bySession = new Map<string, ExerciseSummary[]>()
  for (const ex of withData) {
    if (!bySession.has(ex.sessionName)) {
      bySession.set(ex.sessionName, [])
      sessionOrder.push(ex.sessionName)
    }
    bySession.get(ex.sessionName)!.push(ex)
  }

  return (
    <div className="rounded-2xl p-4" style={accentCardStyle('#bf5fff')}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Dumbbell className="h-4 w-4" style={{ color: '#bf5fff' }} />
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Estimated 1RM</p>
        </div>
        <div className="flex items-center gap-0.5 rounded-xl bg-muted p-0.5 text-xs font-semibold border border-border">
          <button
            type="button"
            onClick={() => setMode('latest')}
            className={`rounded-lg px-2.5 py-1 transition ${mode === 'latest' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
          >
            Latest
          </button>
          <button
            type="button"
            onClick={() => setMode('working')}
            className={`rounded-lg px-2.5 py-1 transition ${mode === 'working' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
          >
            Working Set
          </button>
        </div>
      </div>
      <div className="space-y-3">
        {sessionOrder.map(sessionName => {
          const rows: { ex: ExerciseSummary; metric: BarMetric }[] = []
          for (const ex of bySession.get(sessionName)!) {
            const metric = computeBarMetric(ex, mode)
            if (metric) rows.push({ ex, metric })
          }
          if (rows.length === 0) return null

          return (
            <div key={sessionName}>
              <p className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: '#bf5fff' }}>
                {sessionName}
              </p>
              <div className="space-y-1.5">
                {rows.map(({ ex, metric }) => (
                  <div key={ex.exercise} className="flex items-center gap-2">
                    <p className="text-xs flex-1 truncate">{ex.exercise}</p>
                    <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden flex-none">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.max(metric.pct, 4)}%`, background: metric.color }}
                      />
                    </div>
                    <p className="text-xs font-bold tabular-nums flex-none w-14 text-right">{metric.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no new errors.

- [ ] **Step 3: Run the full test suite**

```bash
pnpm test
```
Expected: all tests pass, including the new `strength-progress.test.ts`.

- [ ] **Step 4: Manual verification in the browser**

1. Ensure the local dev DB is running (it is, per the session hook) and start the dev server: `pnpm dev`.
2. Open the app, log in as `test@local.dev` / `testpass123`.
3. Go to **Health > Progress**.
4. Confirm the **Estimated 1RM** card shows a "Latest / Working Set" pill toggle in the header, defaulting to "Latest".
5. In **Latest** mode: "Bench Press" under "Push" should show `98 kg` with a **gold** bar at 100% (seed data: `estimated1rm=98`, `personalRecord1rm=98`).
6. Switch to **Working Set**: "Bench Press" should now show `68 kg` with a **purple** bar at ~69% (seed data: last logged `weight=68`, `personalRecord1rm=98`).
7. Confirm no other rows appear (no other exercises have logged sets in the seed data), and the card doesn't crash or show `NaN`/`undefined` anywhere.

- [ ] **Step 5: Commit**

```bash
git add components/health/strength-progress-card.tsx
git commit -m "Add Latest/Working Set mode toggle to Estimated 1RM card"
```

---

## Self-Review

**Spec coverage (design spec §1):**
- §1.1 Mode A "Latest" (existing behaviour, default) — ✅ Task 4, `computeBarMetric` mode `'latest'`.
- §1.2 Mode B weighted exercises (working weight vs PR, skip if `weight == null`) — ✅ `computeBarMetric` mode `'working'`, weighted branch.
- §1.3 Mode B bodyweight exercises (reps vs maxReps, skip if `lastReps`/`maxReps == null`) — ✅ `computeBarMetric` mode `'working'`, bodyweight branch.
- Gold/purple thresholds (`pct >= 99.5`) unchanged across both modes — ✅ `colorFor` helper shared by all three branches.
- Per-session grouping/headers unchanged — ✅ `bySession`/`sessionOrder` logic preserved verbatim; sessions with zero visible rows in the active mode are skipped (`rows.length === 0`).
- §1.4 `/api/weights-summary` extension (`exerciseType`, `lastReps`, `maxReps`, `listMaxReps`) — ✅ Tasks 1 & 2.
- §4.1 `listMaxReps` SQL — ✅ Task 1, Drizzle query matches the spec's SQL (same joins/group-by), verified via psql.

**Placeholder scan:** No "TBD"/"TODO"/"add error handling" placeholders — all code blocks are complete, runnable replacements.

**Type consistency:** `ExerciseSummary` (Task 2) gains `exerciseType: 'weighted' | 'bodyweight'`, `lastReps: number | null`, `maxReps: number | null` — consumed identically by `computeBarMetric` (Task 3) and the rewritten card (Task 4). `BarMetric { pct, label, color }` and `StrengthMode = 'latest' | 'working'` are defined once in `lib/health/strength-progress.ts` and imported by the card. `listMaxReps(userId): Promise<Map<string, number>>` signature matches between `repository.ts` (Task 1 Step 1) and `adapter.ts` (Task 1 Step 2), and its return type matches `personalRecords`'s `Map<string, number>` pattern already used in the route (Task 2).

---

## Notes for Plan 2 (Cards 2 + 3 — Goals & Long-Term Goals)

Out of scope for this plan. Plan 2 covers: `getBodyMetricsBaseline` + `getScheduledSessionsPerWeek` helpers, new `/api/progress-summary` route, `GoalProgressBar` extraction, new `goals-progress-card.tsx`, the `health-content.tsx` Progress tab layout rework (replacing the old "Goal Progress" block), and related cache invalidation / `CACHE_TASKS` entries. This plan does not touch `health-content.tsx` at all, so the two plans can be executed independently in either order — but Plan 2 should be executed second since Plan 1 establishes the `lib/health/` directory convention.
