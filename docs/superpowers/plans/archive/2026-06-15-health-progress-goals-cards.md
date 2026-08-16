> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Health Progress Tab — Cards 2 & 3 (Goals & Long-Term Goals) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the "Goals" card (Steps/Calories/Water/Sleep/Workouts, Today vs This Week) and the "Long-Term Goals" rows (direction-aware Weight/Body Fat progress) to the Health > Progress tab, per `docs/superpowers/specs/2026-06-15-health-progress-tab-design.md` §2-§6.

**Architecture:** Two new repo methods (`getBodyMetricsBaseline`, used via a new `/api/progress-summary` route) plus a pure helper `getScheduledSessionsPerWeek` in `lib/schedule-utils.ts` (unit-tested). `GoalProgressBar` is extracted from `goal-targets-section.tsx` into a shared component. A new presentational `GoalsProgressCard` renders Card 2 from props supplied by `health-content.tsx`. Card 3 (Weight/Body Fat) is added inline to the existing "Weight Trend" card in `health-content.tsx`, using a new pure helper `goalProgressPct` (unit-tested). Cache invalidation and `CACHE_TASKS` are updated so the new `/api/progress-summary` and `/api/user/goals` data stay fresh.

**Tech Stack:** Next.js 15 App Router API routes, Drizzle ORM / PostgreSQL, React 19 client components, vitest.

**Depends on:** `docs/superpowers/plans/2026-06-15-health-progress-1rm-mode.md` (Plan 1) is independent and can be done in either order, but should land first to establish the `lib/health/` convention used here.

---

## Task 1: `getBodyMetricsBaseline` repository method

**Files:**
- Modify: `lib/data/repository.ts:132`
- Modify: `lib/data/postgres/adapter.ts:2` (import), `lib/data/postgres/adapter.ts:1918-1938` (new method)

- [ ] **Step 1: Add the interface declaration**

In `lib/data/repository.ts`, the `// ── Body & Activity ──` section starts with:

```ts
  // ── Body & Activity ────────────────────────────────────────────────────────
  upsertBodyMetrics(userId: string, metrics: Omit<BodyMetrics, 'id' | 'userId' | 'createdAt'>[]): Promise<void>
  listBodyMetrics(userId: string, from: string, to: string): Promise<BodyMetrics[]>
```

Change it to:

```ts
  // ── Body & Activity ────────────────────────────────────────────────────────
  upsertBodyMetrics(userId: string, metrics: Omit<BodyMetrics, 'id' | 'userId' | 'createdAt'>[]): Promise<void>
  listBodyMetrics(userId: string, from: string, to: string): Promise<BodyMetrics[]>
  // Earliest-ever logged weight/body-fat values — "starting point" baseline for
  // the Progress tab's direction-aware Long-Term Goals bars.
  getBodyMetricsBaseline(userId: string): Promise<{ weightKg: number | null; bodyFatPct: number | null }>
```

- [ ] **Step 2: Add `isNotNull` to the Drizzle import**

In `lib/data/postgres/adapter.ts`, line 2 currently reads:

```ts
import { eq, and, or, inArray, gte, lt, lte, asc, desc, sql, ne } from 'drizzle-orm'
```

Change to:

```ts
import { eq, and, or, inArray, gte, lt, lte, asc, desc, sql, ne, isNotNull } from 'drizzle-orm'
```

- [ ] **Step 3: Add the adapter implementation**

In `lib/data/postgres/adapter.ts`, `listBodyMetrics` ends with:

```ts
      waterMl: r.waterMl ?? undefined,
      createdAt: r.createdAt,
    }))
  }

  async saveActivityLog(userId: string, log: Omit<ActivityLog, 'id' | 'userId' | 'createdAt'>): Promise<ActivityLog> {
```

Insert a new method between them:

```ts
      waterMl: r.waterMl ?? undefined,
      createdAt: r.createdAt,
    }))
  }

  async getBodyMetricsBaseline(userId: string): Promise<{ weightKg: number | null; bodyFatPct: number | null }> {
    const [weightRow] = await this.db
      .select({ weightKg: s.bodyMetrics.weightKg })
      .from(s.bodyMetrics)
      .where(and(eq(s.bodyMetrics.userId, userId), isNotNull(s.bodyMetrics.weightKg)))
      .orderBy(asc(s.bodyMetrics.date))
      .limit(1)

    const [bfRow] = await this.db
      .select({ bodyFatPct: s.bodyMetrics.bodyFatPct })
      .from(s.bodyMetrics)
      .where(and(eq(s.bodyMetrics.userId, userId), isNotNull(s.bodyMetrics.bodyFatPct)))
      .orderBy(asc(s.bodyMetrics.date))
      .limit(1)

    return {
      weightKg: weightRow?.weightKg ?? null,
      bodyFatPct: bfRow?.bodyFatPct ?? null,
    }
  }

  async saveActivityLog(userId: string, log: Omit<ActivityLog, 'id' | 'userId' | 'createdAt'>): Promise<ActivityLog> {
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```
Expected: no new errors.

- [ ] **Step 5: Verify against local dev data**

```bash
PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d trainingai_dev -c "
SELECT date, weight_kg, body_fat_pct FROM body_metrics b
JOIN users u ON u.id = b.user_id
WHERE u.email = 'test@local.dev' AND b.weight_kg IS NOT NULL
ORDER BY b.date ASC LIMIT 1;
"
```

Expected: the oldest of the 14 seeded rows — `weight_kg ≈ 81.85`, `body_fat_pct ≈ 17.35` (seed formula: `82.5 - d*0.05` / `18 - d*0.05` for `d` up to 13).

- [ ] **Step 6: Commit**

```bash
git add lib/data/repository.ts lib/data/postgres/adapter.ts
git commit -m "Add getBodyMetricsBaseline repository method"
```

---

## Task 2: `getScheduledSessionsPerWeek` pure helper

**Files:**
- Create: `lib/schedule-utils.ts`
- Create: `lib/__tests__/schedule-utils.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `lib/__tests__/schedule-utils.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getScheduledSessionsPerWeek } from '../schedule-utils'
import type { Program, ProgramSession, Schedule } from '@/lib/types'

function makeSessions(count: number): ProgramSession[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i}`, programId: 'p1', name: `Session ${i}`, position: i, exercises: [],
  }))
}

function makeProgram(sessionCount: number, schedule?: Schedule): Program {
  return {
    id: 'p1',
    userId: 'u1',
    name: 'Test Program',
    isActive: true,
    sessions: makeSessions(sessionCount),
    schedule,
    createdAt: new Date(),
    updatedAt: new Date(),
    phaseMode: 'manual',
  }
}

describe('getScheduledSessionsPerWeek', () => {
  it('returns total sessions when there is no schedule', () => {
    const program = makeProgram(3)
    expect(getScheduledSessionsPerWeek(program)).toBe(3)
  })

  it('counts weekly schedule days that have a sessionId assigned', () => {
    const schedule: Schedule = {
      id: 'sch1', programId: 'p1', type: 'weekly',
      days: [
        { dayOfWeek: 0, sessionId: 's0' },
        { dayOfWeek: 1 },
        { dayOfWeek: 2, sessionId: 's1' },
        { dayOfWeek: 3 },
        { dayOfWeek: 4, sessionId: 's0' },
        { dayOfWeek: 5 },
        { dayOfWeek: 6 },
      ],
    }
    const program = makeProgram(2, schedule)
    expect(getScheduledSessionsPerWeek(program)).toBe(3)
  })

  it('returns 0 for a weekly schedule with no scheduled days', () => {
    const schedule: Schedule = { id: 'sch1', programId: 'p1', type: 'weekly', days: [] }
    const program = makeProgram(2, schedule)
    expect(getScheduledSessionsPerWeek(program)).toBe(0)
  })

  it('computes a rotation cadence from sessions + restAfterN (3-session, 1 rest day cycle)', () => {
    const schedule: Schedule = { id: 'sch1', programId: 'p1', type: 'rotation', restAfterN: 1 }
    const program = makeProgram(3, schedule)
    // cycle length = 4 (3 sessions + 1 rest); 3/4 * 7 = 5.25 -> round -> 5
    expect(getScheduledSessionsPerWeek(program)).toBe(5)
  })

  it('matches the seeded Push/Pull/Legs rotation (3 sessions, restAfterN=3)', () => {
    const schedule: Schedule = { id: 'sch1', programId: 'p1', type: 'rotation', restAfterN: 3 }
    const program = makeProgram(3, schedule)
    // cycle length = 6; 3/6 * 7 = 3.5 -> round -> 4
    expect(getScheduledSessionsPerWeek(program)).toBe(4)
  })

  it('floors at 1 even when restAfterN dwarfs the session count', () => {
    const schedule: Schedule = { id: 'sch1', programId: 'p1', type: 'rotation', restAfterN: 20 }
    const program = makeProgram(1, schedule)
    // cycle length = 21; 1/21 * 7 ≈ 0.33 -> round -> 0 -> floored to 1
    expect(getScheduledSessionsPerWeek(program)).toBe(1)
  })

  it('treats a missing restAfterN as 0 rest days (every-session-every-day cadence)', () => {
    const schedule: Schedule = { id: 'sch1', programId: 'p1', type: 'rotation' }
    const program = makeProgram(3, schedule)
    // cycle length = 3; 3/3 * 7 = 7
    expect(getScheduledSessionsPerWeek(program)).toBe(7)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test -- lib/__tests__/schedule-utils.test.ts
```
Expected: FAIL — `Cannot find module '../schedule-utils'`.

- [ ] **Step 3: Implement `getScheduledSessionsPerWeek`**

Create `lib/schedule-utils.ts`:

```ts
import type { Program } from '@/lib/types'

/**
 * Estimates how many training sessions per week the user's active program
 * calls for, used to normalize the "Workouts" goal row on the Progress tab.
 */
export function getScheduledSessionsPerWeek(program: Program): number {
  const schedule = program.schedule
  if (schedule?.type === 'weekly') {
    return (schedule.days ?? []).filter(d => d.sessionId).length
  }
  if (schedule?.type === 'rotation') {
    const cycleLen = program.sessions.length + (schedule.restAfterN ?? 0)
    return cycleLen > 0
      ? Math.max(1, Math.round((program.sessions.length / cycleLen) * 7))
      : program.sessions.length
  }
  return program.sessions.length
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm test -- lib/__tests__/schedule-utils.test.ts
```
Expected: PASS, all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/schedule-utils.ts lib/__tests__/schedule-utils.test.ts
git commit -m "Add getScheduledSessionsPerWeek pure helper"
```

---

## Task 3: New `/api/progress-summary` route

**Files:**
- Create: `app/api/progress-summary/route.ts`

- [ ] **Step 1: Create the route**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";
import { formatInTimeZone } from "date-fns-tz";
import { DEFAULT_TZ, todayInTz, startOfWeekInTz, aestMidnight, toAestDay } from "@/lib/date-utils";
import { getScheduledSessionsPerWeek } from "@/lib/schedule-utils";

export interface ProgressSummaryResponse {
  sleep: { lastNightHours: number | null; thisWeekHours: number };
  workouts: { todayComplete: boolean; completedThisWeek: number; scheduledThisWeek: number };
  bodyBaseline: { weightKg: number | null; bodyFatPct: number | null };
}

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const repo = await getRepository();
  const tz = session.user?.timezone ?? DEFAULT_TZ;
  const today = todayInTz(tz);
  const weekStartStr = startOfWeekInTz(tz);
  const [wy, wm, wd] = weekStartStr.split('-').map(Number);
  const mondayUtc = aestMidnight(wy, wm, wd, tz);
  const sevenDaysAgo = formatInTimeZone(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), tz, 'yyyy-MM-dd');

  const [sleepSessions, program, dayExercises, nextSession, bodyBaseline, weekSessionsAll] = await Promise.all([
    repo.listSleepSessions(userId, sevenDaysAgo, today),
    repo.getActiveProgram(userId),
    repo.getDayExerciseNames(userId, today.replace(/-/g, '/')),
    repo.getNextSession(userId, tz),
    repo.getBodyMetricsBaseline(userId),
    repo.getWorkoutSessionsFrom(userId, mondayUtc),
  ]);

  const sortedSleep = [...sleepSessions].sort((a, b) => b.date.localeCompare(a.date));
  const lastNightHours = sortedSleep[0]?.durationHours ?? null;
  const thisWeekHours = sleepSessions
    .filter(ss => ss.date >= weekStartStr)
    .reduce((sum, ss) => sum + (ss.durationHours ?? 0), 0);

  const trainedToday = dayExercises.length > 0;
  const todayComplete = trainedToday || nextSession.isRestDay;

  const weekSessions = weekSessionsAll.filter(ws => ws.exercises.length > 0);
  const uniqueSessionDays = new Set(
    weekSessions.map(ws => `${toAestDay(ws.startedAt, tz)}|${ws.sessionName}`)
  );
  const completedThisWeek = uniqueSessionDays.size;

  const scheduledThisWeek = program ? getScheduledSessionsPerWeek(program) : 0;

  return NextResponse.json(
    {
      sleep: { lastNightHours, thisWeekHours },
      workouts: { todayComplete, completedThisWeek, scheduledThisWeek },
      bodyBaseline,
    } satisfies ProgressSummaryResponse,
    { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=120" } },
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no new errors.

- [ ] **Step 3: Verify the route response against local dev data**

With `pnpm dev` running and authenticated as `test@local.dev` (see Plan 1 Task 2 Step 3 for the login curl recipe, reusing `/tmp/cookies.txt`):

```bash
curl -s -b /tmp/cookies.txt http://localhost:3000/api/progress-summary | python3 -m json.tool
```

Expected shape:
```json
{
  "sleep": { "lastNightHours": 8, "thisWeekHours": <number> },
  "workouts": { "todayComplete": <bool>, "completedThisWeek": <number>, "scheduledThisWeek": 4 },
  "bodyBaseline": { "weightKg": 81.85, "bodyFatPct": 17.35 }
}
```

`scheduledThisWeek = 4` matches the seeded Push/Pull/Legs rotation (`restAfterN = 3` → `Math.round(3/6*7) = 4`, per Task 2's test). `sleep.lastNightHours = 8` matches the seeded constant `duration_hours = 8`. `bodyBaseline` matches Task 1's psql check.

- [ ] **Step 4: Commit**

```bash
git add app/api/progress-summary/route.ts
git commit -m "Add /api/progress-summary route for Health Progress cards"
```

---

## Task 4: Extract `GoalProgressBar` into a shared component

**Files:**
- Create: `components/health/goal-progress-bar.tsx`
- Modify: `components/profile/goal-targets-section.tsx`

- [ ] **Step 1: Create the shared component**

Create `components/health/goal-progress-bar.tsx`:

```tsx
export function GoalProgressBar({ value, goal, color = 'var(--color-brand)', weekly = false }: { value: number | null; goal: number | null; color?: string; weekly?: boolean }) {
  if (value == null || goal == null || goal <= 0) return null
  const pct = Math.min((value / goal) * 100, 100)
  return (
    <div className="mt-2 space-y-1">
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: `color-mix(in oklch, ${color} 15%, transparent)` }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct.toFixed(1)}%`, background: color }} />
      </div>
      <p className="text-[10px] text-muted-foreground tabular-nums">{weekly ? 'This week: ' : ''}{value.toLocaleString()} / {goal.toLocaleString()}{pct >= 100 ? ' ✓' : ''}</p>
    </div>
  )
}
```

- [ ] **Step 2: Remove the local definition and import the shared one**

In `components/profile/goal-targets-section.tsx`, the file currently starts with:

```tsx
'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FITNESS_GOALS, type FitnessGoal } from '@/lib/types/user'
import { MacroTargetsPane } from './macro-targets-pane'

const FITNESS_GOAL_LABELS: Record<FitnessGoal, { label: string; description: string }> = {
  lose_weight:  { label: 'Lose Weight',                       description: 'Calorie deficit to reduce body fat' },
  maintain:     { label: 'Maintain',                          description: 'Stay at current weight and performance' },
  build_muscle: { label: 'Build Muscle',                      description: 'Calorie surplus to support muscle growth' },
  recomp:       { label: 'Lose fat & build muscle (recomp)',  description: 'Slight deficit with high protein' },
}

function GoalProgressBar({ value, goal, color = 'var(--color-brand)', weekly = false }: { value: number | null; goal: number | null; color?: string; weekly?: boolean }) {
  if (value == null || goal == null || goal <= 0) return null
  const pct = Math.min((value / goal) * 100, 100)
  return (
    <div className="mt-2 space-y-1">
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: `color-mix(in oklch, ${color} 15%, transparent)` }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct.toFixed(1)}%`, background: color }} />
      </div>
      <p className="text-[10px] text-muted-foreground tabular-nums">{weekly ? 'This week: ' : ''}{value.toLocaleString()} / {goal.toLocaleString()}{pct >= 100 ? ' ✓' : ''}</p>
    </div>
  )
}

interface GoalTargetsSectionProps {
```

Change to:

```tsx
'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FITNESS_GOALS, type FitnessGoal } from '@/lib/types/user'
import { GoalProgressBar } from '@/components/health/goal-progress-bar'
import { MacroTargetsPane } from './macro-targets-pane'

const FITNESS_GOAL_LABELS: Record<FitnessGoal, { label: string; description: string }> = {
  lose_weight:  { label: 'Lose Weight',                       description: 'Calorie deficit to reduce body fat' },
  maintain:     { label: 'Maintain',                          description: 'Stay at current weight and performance' },
  build_muscle: { label: 'Build Muscle',                      description: 'Calorie surplus to support muscle growth' },
  recomp:       { label: 'Lose fat & build muscle (recomp)',  description: 'Slight deficit with high protein' },
}

interface GoalTargetsSectionProps {
```

- [ ] **Step 3: Type-check and run tests**

```bash
npx tsc --noEmit && pnpm test
```
Expected: no new errors, all tests pass.

- [ ] **Step 4: Manual sanity check**

With `pnpm dev` running, open Profile > Goals (expand the section) and confirm the Steps/Water/Calorie goal bars still render exactly as before (no visual change expected — this step is a pure extraction).

- [ ] **Step 5: Commit**

```bash
git add components/health/goal-progress-bar.tsx components/profile/goal-targets-section.tsx
git commit -m "Extract GoalProgressBar into a shared health component"
```

---

## Task 5: `goalProgressPct` pure helper

**Files:**
- Create: `lib/health/long-term-goal-progress.ts`
- Create: `lib/health/__tests__/long-term-goal-progress.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `lib/health/__tests__/long-term-goal-progress.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { goalProgressPct } from '../long-term-goal-progress'

describe('goalProgressPct', () => {
  it('returns 100 when starting equals target (already at goal)', () => {
    expect(goalProgressPct(80, 82, 80)).toBe(100)
  })

  it('computes progress toward a decreasing target (losing weight)', () => {
    // starting 82, target 78 (lose 4kg), currently at 80 (lost 2kg) -> 50%
    expect(goalProgressPct(82, 80, 78)).toBeCloseTo(50, 5)
  })

  it('computes progress toward an increasing target (gaining weight)', () => {
    // starting 78, target 82 (gain 4kg), currently at 80 (gained 2kg) -> 50%
    expect(goalProgressPct(78, 80, 82)).toBeCloseTo(50, 5)
  })

  it('clamps to 0 when movement is away from a decreasing target', () => {
    // starting 81.85, target 78, currently 82.5 (went up, away from goal)
    expect(goalProgressPct(81.85, 82.5, 78)).toBe(0)
  })

  it('clamps to 0 when movement is away from an increasing target', () => {
    // starting 18, target 22 (gain), currently 17 (went down, away from goal)
    expect(goalProgressPct(18, 17, 22)).toBe(0)
  })

  it('clamps to 100 when current has overshot the target', () => {
    // starting 82, target 78, currently 75 (already past target)
    expect(goalProgressPct(82, 75, 78)).toBe(100)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test -- lib/health/__tests__/long-term-goal-progress.test.ts
```
Expected: FAIL — `Cannot find module '../long-term-goal-progress'`.

- [ ] **Step 3: Implement `goalProgressPct`**

Create `lib/health/long-term-goal-progress.ts`:

```ts
/**
 * Direction-aware progress from a starting baseline toward a target value.
 * Works for both decreasing goals (target < starting, e.g. lose weight/fat)
 * and increasing goals (target > starting): movement toward target increases
 * the result, movement away clamps to 0 rather than going negative.
 */
export function goalProgressPct(starting: number, current: number, target: number): number {
  if (starting === target) return 100
  const pct = ((current - starting) / (target - starting)) * 100
  return Math.max(0, Math.min(100, pct))
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm test -- lib/health/__tests__/long-term-goal-progress.test.ts
```
Expected: PASS, all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/health/long-term-goal-progress.ts lib/health/__tests__/long-term-goal-progress.test.ts
git commit -m "Add goalProgressPct pure helper for Long-Term Goals card"
```

---

## Task 6: New `GoalsProgressCard` component

**Files:**
- Create: `components/health/goals-progress-card.tsx`

- [ ] **Step 1: Create the component**

Create `components/health/goals-progress-card.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Footprints, Flame, Droplet, Moon, Dumbbell, type LucideIcon } from 'lucide-react'
import { accentCardStyle } from '@/lib/utils'
import { GoalProgressBar } from './goal-progress-bar'
import type { UserGoals } from '@/lib/data/repository'
import type { BodyMetaRow, WeekToDate } from '@/app/api/body-metadata/route'
import type { ProgressSummaryResponse } from '@/app/api/progress-summary/route'

function normalizeGoal(goal: number, goalType: 'daily' | 'weekly', view: 'today' | 'week'): number {
  if (goalType === 'daily') return view === 'today' ? goal : goal * 7
  return view === 'today' ? goal / 7 : goal
}

interface GoalRow {
  key: string
  icon: LucideIcon
  color: string
  value: number | null
  goal: number | null
  weekly: boolean
}

interface GoalsProgressCardProps {
  metaToday: Pick<BodyMetaRow, 'steps' | 'calories' | 'waterMl'> | null
  weekToDate: WeekToDate | null
  userGoals: UserGoals | null
  progressSummary: ProgressSummaryResponse | null
}

export function GoalsProgressCard({ metaToday, weekToDate, userGoals, progressSummary }: GoalsProgressCardProps) {
  const [view, setView] = useState<'today' | 'week'>('today')

  const rows: GoalRow[] = []

  if (userGoals?.stepsGoal != null) {
    rows.push({
      key: 'Steps', icon: Footprints, color: '#22c55e', weekly: view === 'week',
      value: view === 'today' ? metaToday?.steps ?? null : weekToDate?.steps ?? null,
      goal: normalizeGoal(userGoals.stepsGoal, userGoals.stepsGoalType ?? 'daily', view),
    })
  }

  if (userGoals?.calorieGoal != null) {
    rows.push({
      key: 'Calories', icon: Flame, color: '#f97316', weekly: view === 'week',
      value: view === 'today' ? metaToday?.calories ?? null : weekToDate?.calories ?? null,
      goal: normalizeGoal(userGoals.calorieGoal, userGoals.calorieGoalType ?? 'daily', view),
    })
  }

  if (userGoals?.waterGoalMl != null) {
    rows.push({
      key: 'Water', icon: Droplet, color: '#38bdf8', weekly: view === 'week',
      value: view === 'today' ? metaToday?.waterMl ?? null : weekToDate?.waterMl ?? null,
      goal: normalizeGoal(userGoals.waterGoalMl, userGoals.waterGoalType ?? 'daily', view),
    })
  }

  if (userGoals?.sleepGoalHours != null) {
    rows.push({
      key: 'Sleep', icon: Moon, color: '#a78bfa', weekly: view === 'week',
      value: view === 'today' ? progressSummary?.sleep.lastNightHours ?? null : progressSummary?.sleep.thisWeekHours ?? null,
      goal: view === 'today' ? userGoals.sleepGoalHours : userGoals.sleepGoalHours * 7,
    })
  }

  if (progressSummary?.workouts) {
    rows.push({
      key: 'Workouts', icon: Dumbbell, color: '#fbbf24', weekly: view === 'week',
      value: view === 'today' ? (progressSummary.workouts.todayComplete ? 1 : 0) : progressSummary.workouts.completedThisWeek,
      goal: view === 'today' ? 1 : progressSummary.workouts.scheduledThisWeek,
    })
  }

  const visibleRows = rows.filter(r => r.value != null && r.goal != null && r.goal > 0)
  if (visibleRows.length === 0) return null

  return (
    <div className="rounded-2xl p-4" style={accentCardStyle('#22c55e')}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Goals</p>
        <div className="flex items-center gap-0.5 rounded-xl bg-muted p-0.5 text-xs font-semibold border border-border">
          <button
            type="button"
            onClick={() => setView('today')}
            className={`rounded-lg px-2.5 py-1 transition ${view === 'today' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setView('week')}
            className={`rounded-lg px-2.5 py-1 transition ${view === 'week' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
          >
            This Week
          </button>
        </div>
      </div>
      <div className="space-y-3">
        {visibleRows.map(row => {
          const Icon = row.icon
          return (
            <div key={row.key}>
              <div className="flex items-center gap-2 text-xs font-medium">
                <Icon className="h-3.5 w-3.5" style={{ color: row.color }} />
                <span>{row.key}</span>
              </div>
              <GoalProgressBar value={row.value} goal={row.goal} color={row.color} weekly={row.weekly} />
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
Expected: no new errors (the component isn't wired into any page yet, so it won't render — this just confirms the types line up against `UserGoals`, `BodyMetaRow`, `WeekToDate`, `ProgressSummaryResponse`).

- [ ] **Step 3: Commit**

```bash
git add components/health/goals-progress-card.tsx
git commit -m "Add GoalsProgressCard component for Health Progress tab"
```

---

## Task 7: Cache invalidation updates

**Files:**
- Modify: `lib/cache-groups.ts`
- Modify: `lib/__tests__/cache-groups.test.ts`
- Modify: `components/sync-provider.tsx`

- [ ] **Step 1: Update the failing tests first**

In `lib/__tests__/cache-groups.test.ts`, the current content is:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invalidated: string[] = []

vi.mock('@/lib/sqlite/cache', () => ({
  invalidateCache: (k: string) => { invalidated.push(k); return Promise.resolve() },
}))

import { invalidateWorkoutSummaries, invalidateReadinessInputs, invalidateProgramStructure } from '../cache-groups'

beforeEach(() => { invalidated.length = 0 })

describe('cache group helpers', () => {
  it('invalidateWorkoutSummaries clears all derived workout caches including the achievements prefix', async () => {
    await invalidateWorkoutSummaries()
    expect(invalidated).toEqual(expect.arrayContaining([
      'weekly-stats', 'weights-summary', 'next-session',
      'muscle-recovery', 'readiness-score', 'achievements:',
    ]))
  })

  it('invalidateReadinessInputs clears readiness + weekly', async () => {
    await invalidateReadinessInputs()
    expect(invalidated).toEqual(expect.arrayContaining(['readiness-score', 'weekly-stats']))
  })

  it('invalidateProgramStructure clears program + next-session + styles', async () => {
    await invalidateProgramStructure()
    expect(invalidated).toEqual(expect.arrayContaining([
      'workout-data', 'next-session', 'progression-styles', 'muscle-recovery',
    ]))
  })
})
```

Replace with:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invalidated: string[] = []

vi.mock('@/lib/sqlite/cache', () => ({
  invalidateCache: (k: string) => { invalidated.push(k); return Promise.resolve() },
}))

import { invalidateWorkoutSummaries, invalidateReadinessInputs, invalidateProgramStructure, invalidateGoalRecommendations } from '../cache-groups'

beforeEach(() => { invalidated.length = 0 })

describe('cache group helpers', () => {
  it('invalidateWorkoutSummaries clears all derived workout caches including the achievements prefix', async () => {
    await invalidateWorkoutSummaries()
    expect(invalidated).toEqual(expect.arrayContaining([
      'weekly-stats', 'weights-summary', 'next-session',
      'muscle-recovery', 'readiness-score', 'achievements:', 'progress-summary',
    ]))
  })

  it('invalidateReadinessInputs clears readiness + weekly + progress-summary', async () => {
    await invalidateReadinessInputs()
    expect(invalidated).toEqual(expect.arrayContaining(['readiness-score', 'weekly-stats', 'progress-summary']))
  })

  it('invalidateProgramStructure clears program + next-session + styles', async () => {
    await invalidateProgramStructure()
    expect(invalidated).toEqual(expect.arrayContaining([
      'workout-data', 'next-session', 'progression-styles', 'muscle-recovery',
    ]))
  })

  it('invalidateGoalRecommendations clears nutrition/body/progress/user-goals caches', async () => {
    await invalidateGoalRecommendations()
    expect(invalidated).toEqual(expect.arrayContaining([
      'nutrition-targets', 'body-metadata', 'progress-summary', 'user-goals',
    ]))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test -- lib/__tests__/cache-groups.test.ts
```
Expected: FAIL — the new `'progress-summary'`/`'user-goals'` entries aren't invalidated yet by the current implementation.

- [ ] **Step 3: Update `lib/cache-groups.ts`**

Current content:

```ts
import { invalidateCache } from '@/lib/sqlite/cache'

/** Caches that derive from workout/set data — invalidate after completing a workout. */
export async function invalidateWorkoutSummaries(): Promise<void> {
  await Promise.all([
    invalidateCache('weekly-stats'),
    invalidateCache('weights-summary'),
    invalidateCache('next-session'),
    invalidateCache('muscle-recovery'),
    invalidateCache('readiness-score'),
    // prefix-invalidate every `achievements:<userId>` entry (one per logged-in device user)
    invalidateCache('achievements:'),
  ])
}

/** Caches that derive from sleep/mood/body inputs — invalidate after those writes. */
export async function invalidateReadinessInputs(): Promise<void> {
  await Promise.all([
    invalidateCache('readiness-score'),
    invalidateCache('weekly-stats'),
  ])
}

/** Caches that derive from program/style structure — invalidate after config edits. */
export async function invalidateProgramStructure(): Promise<void> {
  await Promise.all([
    invalidateCache('workout-data'),
    invalidateCache('next-session'),
    invalidateCache('progression-styles'),
    invalidateCache('muscle-recovery'),
  ])
}

/** Caches that derive from goals/activity-level/nutrition targets — invalidate after
 *  applying a goal recommendation or editing activity level/fitness goal in Profile. */
export async function invalidateGoalRecommendations(): Promise<void> {
  await Promise.all([
    invalidateCache('nutrition-targets'),
    invalidateCache('body-metadata'),
  ])
}
```

Replace with:

```ts
import { invalidateCache } from '@/lib/sqlite/cache'

/** Caches that derive from workout/set data — invalidate after completing a workout. */
export async function invalidateWorkoutSummaries(): Promise<void> {
  await Promise.all([
    invalidateCache('weekly-stats'),
    invalidateCache('weights-summary'),
    invalidateCache('next-session'),
    invalidateCache('muscle-recovery'),
    invalidateCache('readiness-score'),
    // prefix-invalidate every `achievements:<userId>` entry (one per logged-in device user)
    invalidateCache('achievements:'),
    invalidateCache('progress-summary'),
  ])
}

/** Caches that derive from sleep/mood/body inputs — invalidate after those writes. */
export async function invalidateReadinessInputs(): Promise<void> {
  await Promise.all([
    invalidateCache('readiness-score'),
    invalidateCache('weekly-stats'),
    invalidateCache('progress-summary'),
  ])
}

/** Caches that derive from program/style structure — invalidate after config edits. */
export async function invalidateProgramStructure(): Promise<void> {
  await Promise.all([
    invalidateCache('workout-data'),
    invalidateCache('next-session'),
    invalidateCache('progression-styles'),
    invalidateCache('muscle-recovery'),
  ])
}

/** Caches that derive from goals/activity-level/nutrition targets — invalidate after
 *  applying a goal recommendation or editing activity level/fitness goal in Profile. */
export async function invalidateGoalRecommendations(): Promise<void> {
  await Promise.all([
    invalidateCache('nutrition-targets'),
    invalidateCache('body-metadata'),
    invalidateCache('progress-summary'),
    invalidateCache('user-goals'),
  ])
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm test -- lib/__tests__/cache-groups.test.ts
```
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Add `CACHE_TASKS` entries**

In `components/sync-provider.tsx`, the `CACHE_TASKS` array currently ends with:

```ts
const CACHE_TASKS: CacheTask[] = [
  { key: 'body-metadata',      url: '/api/body-metadata',         ttl: TTL_MEDIUM },
  { key: 'sleep-sessions',     url: '/api/sleep-sessions',        ttl: TTL_MEDIUM },
  { key: 'next-session',       url: '/api/next-session',          ttl: TTL_SHORT  },
  { key: 'weekly-stats',       url: '/api/weekly-stats',          ttl: TTL_MEDIUM },
  { key: 'workout-data:meta',  url: '/api/workout-data?tab=meta', ttl: TTL_LONG   },
  { key: 'progression-styles', url: '/api/progression-styles',    ttl: TTL_LONG   },
  { key: 'workout-templates',  url: '/api/workout-templates',     ttl: TTL_LONG   },
  { key: 'exercise-library',   url: '/api/exercise-library',      ttl: TTL_LONG   },
  { key: 'activity-types',     url: '/api/activity-types',        ttl: TTL_LONG   },
  { key: 'weights-summary',    url: '/api/weights-summary',       ttl: TTL_MEDIUM },
];
```

Change to:

```ts
const CACHE_TASKS: CacheTask[] = [
  { key: 'body-metadata',      url: '/api/body-metadata',         ttl: TTL_MEDIUM },
  { key: 'sleep-sessions',     url: '/api/sleep-sessions',        ttl: TTL_MEDIUM },
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

- [ ] **Step 6: Type-check and run the full test suite**

```bash
npx tsc --noEmit && pnpm test
```
Expected: no errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/cache-groups.ts lib/__tests__/cache-groups.test.ts components/sync-provider.tsx
git commit -m "Invalidate and prewarm progress-summary and user-goals caches"
```

---

## Task 8: Wire Cards 2 & 3 into `app/health/health-content.tsx`

**Files:**
- Modify: `app/health/health-content.tsx`

- [ ] **Step 1: Add new imports**

The import block currently includes (around line 23-32):

```ts
import { ActivityHistoryCard } from "@/components/health/activity-history-card";
import { StrengthProgressCard } from "@/components/health/strength-progress-card";
import { ActivityDetailSheet } from "@/components/activity/activity-detail-sheet";
import { getPaletteEntry } from "@/lib/session-palette";
import { getActivityIcon } from "@/lib/constants/activity-icons";

import type { WeeklyStatsResponse } from "@/app/api/weekly-stats/route";
import type { DayLogResult, DayExercise } from "@/app/api/day-log/route";
import type { ProgramSession } from "@/lib/types/program";
import type { ActivityLog, ActivityType } from "@/lib/types";
```

Change to:

```ts
import { ActivityHistoryCard } from "@/components/health/activity-history-card";
import { StrengthProgressCard } from "@/components/health/strength-progress-card";
import { GoalsProgressCard } from "@/components/health/goals-progress-card";
import { ActivityDetailSheet } from "@/components/activity/activity-detail-sheet";
import { getPaletteEntry } from "@/lib/session-palette";
import { getActivityIcon } from "@/lib/constants/activity-icons";
import { goalProgressPct } from "@/lib/health/long-term-goal-progress";

import type { WeeklyStatsResponse } from "@/app/api/weekly-stats/route";
import type { DayLogResult, DayExercise } from "@/app/api/day-log/route";
import type { WeekToDate } from "@/app/api/body-metadata/route";
import type { ProgressSummaryResponse } from "@/app/api/progress-summary/route";
import type { ProgramSession } from "@/lib/types/program";
import type { ActivityLog, ActivityType } from "@/lib/types";
import type { UserGoals } from "@/lib/data/repository";
```

- [ ] **Step 2: Add new state**

The state block currently has (around line 210-216):

```ts
  const [targetBfPct, setTargetBfPct] = useState<number | null>(() => {
    try {
      if (typeof window === "undefined") return null;
      const raw = localStorage.getItem("ta_target_bf_pct");
      return raw ? parseFloat(raw) : null;
    } catch { return null; }
  });

  useLayoutEffect(() => {
```

Change to:

```ts
  const [targetBfPct, setTargetBfPct] = useState<number | null>(() => {
    try {
      if (typeof window === "undefined") return null;
      const raw = localStorage.getItem("ta_target_bf_pct");
      return raw ? parseFloat(raw) : null;
    } catch { return null; }
  });
  const [weekToDate, setWeekToDate] = useState<WeekToDate | null>(null);
  const [progressSummary, setProgressSummary] = useState<ProgressSummaryResponse | null>(null);
  const [userGoals, setUserGoals] = useState<UserGoals | null>(null);

  useLayoutEffect(() => {
```

- [ ] **Step 3: Seed from sessionStorage mirror**

The seeding `useLayoutEffect` currently reads (around line 234-243):

```ts
  // Seed from sessionStorage mirror synchronously before first paint
  useLayoutEffect(() => {
    const meta = readCacheSync<{ today: BodyMetaRow | null; recent: BodyMetaRow[] }>('body-metadata');
    if (meta) {
      setMetaToday(meta.today ?? null);
      setMetaRecent(meta.recent ?? []);
      setMetaLoading(false);
    }
    const sleep = readCacheSync<SleepRow[]>('sleep-sessions');
    if (sleep) setSleepRows(Array.isArray(sleep) ? sleep : []);
  }, []);
```

Change to:

```ts
  // Seed from sessionStorage mirror synchronously before first paint
  useLayoutEffect(() => {
    const meta = readCacheSync<{ today: BodyMetaRow | null; recent: BodyMetaRow[]; weekToDate?: WeekToDate | null }>('body-metadata');
    if (meta) {
      setMetaToday(meta.today ?? null);
      setMetaRecent(meta.recent ?? []);
      setWeekToDate(meta.weekToDate ?? null);
      setMetaLoading(false);
    }
    const sleep = readCacheSync<SleepRow[]>('sleep-sessions');
    if (sleep) setSleepRows(Array.isArray(sleep) ? sleep : []);
    const progress = readCacheSync<ProgressSummaryResponse>('progress-summary');
    if (progress) setProgressSummary(progress);
    const goals = readCacheSync<UserGoals>('user-goals');
    if (goals) setUserGoals(goals);
  }, []);
```

- [ ] **Step 4: Capture `weekToDate` in `fetchMeta`**

`fetchMeta` currently reads (around line 245-262):

```ts
  const fetchMeta = useCallback(async () => {
    await Promise.all([
      cachedFetch<{ today: BodyMetaRow | null; recent: BodyMetaRow[]; calsBurnedToday?: number | null }>(
        'body-metadata', '/api/body-metadata', TTL_MEDIUM,
        (data) => {
          setMetaToday(data.today ?? null);
          setMetaRecent(data.recent ?? []);
          setCalsBurnedToday(data.calsBurnedToday ?? null);
          setMetaLoading(false);
        },
      ),
      cachedFetch<SleepRow[]>(
        'sleep-sessions', '/api/sleep-sessions', TTL_MEDIUM,
        (data) => setSleepRows(Array.isArray(data) ? data : []),
      ),
    ]);
    setMetaLoading(false);
  }, []);
```

Change to:

```ts
  const fetchMeta = useCallback(async () => {
    await Promise.all([
      cachedFetch<{ today: BodyMetaRow | null; recent: BodyMetaRow[]; weekToDate?: WeekToDate | null; calsBurnedToday?: number | null }>(
        'body-metadata', '/api/body-metadata', TTL_MEDIUM,
        (data) => {
          setMetaToday(data.today ?? null);
          setMetaRecent(data.recent ?? []);
          setWeekToDate(data.weekToDate ?? null);
          setCalsBurnedToday(data.calsBurnedToday ?? null);
          setMetaLoading(false);
        },
      ),
      cachedFetch<SleepRow[]>(
        'sleep-sessions', '/api/sleep-sessions', TTL_MEDIUM,
        (data) => setSleepRows(Array.isArray(data) ? data : []),
      ),
    ]);
    setMetaLoading(false);
  }, []);
```

- [ ] **Step 5: Fetch `progress-summary` and `user-goals`**

The data-fetching `useEffect` currently ends with (around line 265-287):

```ts
    cachedFetch<{ activityTypes: ActivityType[] }>(
      'activity-types', '/api/activity-types', TTL_LONG,
      d => setActivityTypes(d?.activityTypes ?? []),
    ).catch(() => {});
  }, [fetchMeta]);
```

Change to:

```ts
    cachedFetch<{ activityTypes: ActivityType[] }>(
      'activity-types', '/api/activity-types', TTL_LONG,
      d => setActivityTypes(d?.activityTypes ?? []),
    ).catch(() => {});
    cachedFetch<ProgressSummaryResponse>(
      'progress-summary', '/api/progress-summary', TTL_MEDIUM,
      d => { if (d) setProgressSummary(d) },
    ).catch(() => {});
    cachedFetch<UserGoals>(
      'user-goals', '/api/user/goals', TTL_MEDIUM,
      d => { if (d) setUserGoals(d) },
    ).catch(() => {});
  }, [fetchMeta]);
```

- [ ] **Step 6: Derive `bodyBaseline`**

The derivations block currently reads (around line 392-397):

```ts
  const latestWeight = metaToday?.weightKg ?? metaRecent.find(r => r.weightKg != null)?.weightKg ?? null;
  const latestSteps  = metaToday?.steps ?? null;
  const latestDistanceKm = metaToday?.distanceKm ?? null;
  const latestBf = [...metaRecent].reverse().map(r => r.bodyFat).find((v): v is number => v != null) ?? null;

  const todayWaterMl = (metaToday as (typeof metaToday & { waterMl?: number | null }) | null)?.waterMl ?? null;
```

Change to:

```ts
  const latestWeight = metaToday?.weightKg ?? metaRecent.find(r => r.weightKg != null)?.weightKg ?? null;
  const latestSteps  = metaToday?.steps ?? null;
  const latestDistanceKm = metaToday?.distanceKm ?? null;
  const latestBf = [...metaRecent].reverse().map(r => r.bodyFat).find((v): v is number => v != null) ?? null;

  const todayWaterMl = (metaToday as (typeof metaToday & { waterMl?: number | null }) | null)?.waterMl ?? null;
  const bodyBaseline = progressSummary?.bodyBaseline ?? { weightKg: null, bodyFatPct: null };
```

- [ ] **Step 7: Replace the Progress tab JSX**

The Progress tab currently reads (around line 993-1027):

```tsx
        {tab === "progress" && (
          <div className="space-y-4">
            <StrengthProgressCard />
            <div className="rounded-2xl p-4 bg-muted/30 border border-border/40">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Weight Trend</p>
              {metaRecent.length >= 2 ? (
                <WeightSparkline data={metaRecent} color="var(--color-brand)" />
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">Log body weight to see trend</p>
              )}
            </div>
            {targetWeightKg != null && latestWeight != null && (
              <div className="rounded-2xl p-4 bg-muted/30 border border-border/40">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Goal Progress</p>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span>Weight goal</span>
                      <span className="font-semibold">{latestWeight} / {targetWeightKg} kg</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, Math.round((1 - Math.abs(latestWeight - targetWeightKg) / Math.max(latestWeight, targetWeightKg)) * 100))}%`,
                          background: 'var(--color-brand)',
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
```

Replace with:

```tsx
        {tab === "progress" && (
          <div className="space-y-4">
            <StrengthProgressCard />
            <GoalsProgressCard
              metaToday={metaToday}
              weekToDate={weekToDate}
              userGoals={userGoals}
              progressSummary={progressSummary}
            />
            <div className="rounded-2xl p-4 bg-muted/30 border border-border/40">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Weight Trend</p>
              {metaRecent.length >= 2 ? (
                <WeightSparkline data={metaRecent} color="var(--color-brand)" />
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">Log body weight to see trend</p>
              )}
              {((latestWeight != null && bodyBaseline.weightKg != null && targetWeightKg != null) ||
                (latestBf != null && bodyBaseline.bodyFatPct != null && targetBfPct != null)) && (
                <div className="space-y-3 mt-3">
                  {latestWeight != null && bodyBaseline.weightKg != null && targetWeightKg != null && (
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span>Weight</span>
                        <span className="font-semibold">{latestWeight} → {targetWeightKg} kg</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${goalProgressPct(bodyBaseline.weightKg, latestWeight, targetWeightKg)}%`,
                            background: 'var(--color-brand)',
                          }}
                        />
                      </div>
                    </div>
                  )}
                  {latestBf != null && bodyBaseline.bodyFatPct != null && targetBfPct != null && (
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span>Body Fat</span>
                        <span className="font-semibold">{latestBf}% → {targetBfPct}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${goalProgressPct(bodyBaseline.bodyFatPct, latestBf, targetBfPct)}%`,
                            background: '#2dd4bf',
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
```

- [ ] **Step 8: Type-check and run the full test suite**

```bash
npx tsc --noEmit && pnpm test
```
Expected: no new errors, all tests pass.

- [ ] **Step 9: Commit**

```bash
git add app/health/health-content.tsx
git commit -m "Add Goals and Long-Term Goals cards to Health Progress tab"
```

---

## Task 9: Manual verification on local dev

**Files:** none (verification only)

- [ ] **Step 1: Set goal targets via Profile**

With `pnpm dev` running, log in as `test@local.dev` / `testpass123`, go to **Profile**, expand **Goals**, and set:
- Steps Goal: `8000` (Daily)
- Sleep Goal (hours): `8`
- Calorie Goal: `2400` (Daily)
- Daily Water Goal: `2500` (Daily)
- Target Weight: `85` (kg)
- Target Body Fat: `20` (%)

Wait a moment after each field for the debounced PATCH (`/api/user/goals`) to fire — a toast isn't shown for these, but no error toast should appear either.

- [ ] **Step 2: Verify Card 1 (Estimated 1RM)**

Go to **Health > Progress**. The Estimated 1RM card should appear first, with the Latest/Working Set toggle from Plan 1 — confirm it still works (this plan doesn't touch Card 1, but confirms no regressions from the shared `accentCardStyle`/layout).

- [ ] **Step 3: Verify Card 2 (Goals)**

Below Card 1, the **Goals** card should appear with a Today/This Week toggle (defaulting to Today). In **Today** view, confirm:
- **Steps** row: `8,000 / 8,000 ✓` (gold-filled bar at 100%) — seed data has `steps = 8000` for today.
- **Calories** row: `2,400 / 2,400 ✓` — seed data has `calories = 2400` for today.
- **Water** row: `2,500 / 2,500 ✓` — seed data has `water_ml = 2500` for today.
- **Sleep** row: `8 / 8 ✓` — seed data has `duration_hours = 8` for every seeded night.
- **Workouts** row: either `0 / 1` or `1 / 1 ✓` depending on whether today is a rest day or a logged session in the rotation — confirm it renders without `NaN`/`undefined`.

Switch to **This Week** and confirm all five rows update to weekly figures (e.g. Steps `≈56,000 / 56,000`, Sleep `≈<n>*8 / 56`, Workouts `<completed> / 4`) without crashing.

- [ ] **Step 4: Verify Card 3 (Long-Term Goals)**

Below Card 2, the existing **Weight Trend** card should still show the sparkline, plus two new rows beneath it:
- **Weight**: `82.5 → 85 kg` with a bar at roughly **21%** (`goalProgressPct(81.85, 82.5, 85) ≈ 20.6%`).
- **Body Fat**: `18% → 20%` with a bar at roughly **25%** (`goalProgressPct(17.35, 18, 20) ≈ 24.5%`).

- [ ] **Step 5: Regression check — Profile Goals section**

Go back to **Profile > Goals** and confirm the Steps/Water/Calorie progress bars (rendered via the now-shared `GoalProgressBar`) still display correctly with the same values entered in Step 1.

---

## Self-Review

**Spec coverage (design spec §2-§6):**
- §2 Card 2 "Goals" — header + Today/This Week toggle, 5 rows (Steps/Calories/Water/Sleep/Workouts), per-row hide-on-`null`/`<=0`, whole-card hide when empty — ✅ Task 6 (`GoalsProgressCard`).
- §2.1 `normalizeGoal` — ✅ Task 6, local helper.
- §2.2 Sleep row (`lastNightHours`/`thisWeekHours`, always-daily goal) — ✅ Task 3 (`/api/progress-summary`) + Task 6.
- §2.3 Workouts row (`todayComplete`, `completedThisWeek`, `scheduledThisWeek`) — ✅ Task 3 + Task 6.
- §3 Card 3 "Long-Term Goals" — Weight/Body Fat rows added to the existing Weight Trend card, hidden unless all three values present — ✅ Task 8 Step 7.
- §3.1 `goalProgressPct` direction-aware progress — ✅ Task 5.
- §3.2 UI (label, `current → target` text, existing bar markup, brand/`#2dd4bf` colors) — ✅ Task 8 Step 7.
- §4.1 `getBodyMetricsBaseline` — ✅ Task 1, matches spec SQL (earliest non-null row per column), verified via psql.
- §4.2 `getScheduledSessionsPerWeek` in `lib/schedule-utils.ts` — ✅ Task 2, identical to spec implementation, unit-tested for weekly/rotation/no-schedule/edge cases.
- §4.3 `/api/progress-summary` route — ✅ Task 3, matches spec's `sleep`/`workouts`/`bodyBaseline` shape and cache headers (`private, max-age=60, stale-while-revalidate=120`).
- §4.4 Client fetches (`progress-summary`, `user-goals`) in `health-content.tsx` — ✅ Task 8 Steps 2-5. (`targetWeightKg`/`targetBfPct` intentionally continue to come from existing localStorage state, per the spec's "Out of Scope" note that re-anchoring/editing goals stays Profile-only — no redundant fetch added for those two fields.)
- §4.5 `GoalProgressBar` extraction to `components/health/goal-progress-bar.tsx`, used by both `goal-targets-section.tsx` and `goals-progress-card.tsx` — ✅ Task 4 + Task 6.
- §5 Cache invalidation (`invalidateWorkoutSummaries`, `invalidateReadinessInputs`, `invalidateGoalRecommendations` all gain `'progress-summary'`; the latter also gains `'user-goals'`) — ✅ Task 7.
- §6 Edge cases — no active program (`scheduledThisWeek === 0` hides Workouts in "This Week"), sleep never logged (`lastNightHours == null` hides "Today" sleep row), Mode B/baseline drift (N/A to this plan), rotation `restAfterN >= sessions.length` floor (`Math.max(1, ...)`) — ✅ all handled by existing `GoalProgressBar`/`getScheduledSessionsPerWeek` logic from Tasks 2 & 6, no extra special-casing added.

**Placeholder scan:** No "TBD"/"TODO"/"add error handling" placeholders — all code blocks are complete, runnable replacements with exact before/after snippets for every `health-content.tsx` edit.

**Type consistency:**
- `getBodyMetricsBaseline(userId): Promise<{ weightKg: number | null; bodyFatPct: number | null }>` (Task 1) matches `ProgressSummaryResponse['bodyBaseline']` (Task 3) and `health-content.tsx`'s `bodyBaseline` derivation (Task 8 Step 6).
- `getScheduledSessionsPerWeek(program: Program): number` (Task 2) — `Program` imported from `@/lib/types`, matches `repo.getActiveProgram`'s return type used in Task 3.
- `ProgressSummaryResponse` (Task 3) is imported identically by `GoalsProgressCard` (Task 6) and `health-content.tsx` (Task 8).
- `GoalProgressBar`'s props (`value`, `goal`, `color?`, `weekly?`) are unchanged by the Task 4 extraction — both call sites (`goal-targets-section.tsx`, `goals-progress-card.tsx`) use the same signature.
- `goalProgressPct(starting, current, target): number` (Task 5) is consumed with `(bodyBaseline.weightKg, latestWeight, targetWeightKg)` and `(bodyBaseline.bodyFatPct, latestBf, targetBfPct)` in Task 8 — all three arguments are non-null at each call site due to the surrounding `!= null` guards.
- `UserGoals` (Task 6, 8) imported from `@/lib/data/repository` — same type returned by `/api/user/goals` `GET` (`app/api/user/goals/route.ts`).
- `WeekToDate` (Task 6, 8) imported from `@/app/api/body-metadata/route` — already exported there, unchanged.
