# Density-Progression Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fifth running framework — density-progression — for a runner who wants a **fixed**
session length but still wants to progress, by covering more distance in that same time each week.
Fix two pre-existing bugs in `/api/running-plan` that block any framework's week-over-week growth
from actually happening in production, and close the gap where a completed run never links back to
its prescription.

**Architecture:** `lib/running/frameworks/` already has a clean, framework-agnostic contract
(`RunFramework.nextRun(ctx): Prescription`) — this plan adds a fifth file to the existing registry,
no changes to the engine (`prescription.ts`), the gate (`recovery-gate.ts`), or the route's overall
shape. The two bug fixes (real `weekIndex`, real `goal`) are prerequisites: without them, **every**
framework — not just the new one — computes `WEEKLY_GROWTH ** 0 = 1` forever, so growth silently
never happens today. The completion-linking fix reuses the existing `prescribed_run` mutation
domain and its `PATCH /api/running-plan/runs/[id]` route verbatim — no sync-chain changes, no new
migration for that piece.

**Tech Stack:** Existing `lib/running/` module structure, `date-fns-tz` (already a dependency, used
via `lib/date-utils.ts`), Zustand (`lib/stores/activity-store.ts`), Drizzle ORM migration.

**Depends on:** nothing outstanding — builds directly on `main`.

**Sets up:** the sibling plan `docs/superpowers/plans/2026-07-27-cardio-baseline-anchors.md`
(baseline anchors + push/adherence sessions, spec D-3/D-5) needs this plan's completion-linking fix
(Task 8) to exist first, since grading a push session requires knowing which `activity_logs` row
resulted from which `prescribed_runs` row — implement this plan before that one.

---

### Task 1: Pure week-index helper

**Files:**
- Create: `lib/running/week-index.ts`
- Test: `lib/running/__tests__/week-index.test.ts`

`/api/running-plan/route.ts` currently hardcodes `weekIndex: 0` (confirmed via full-file read) — every
framework's `WEEKLY_GROWTH ** ctx.weekIndex` term is therefore always `** 0 = 1` in production today,
so **no framework has ever actually grown weekly volume past week 0**. This is a pre-existing bug
this plan fixes as a prerequisite, not a regression it introduces.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import { weekIndexSince } from '../week-index'

describe('weekIndexSince', () => {
  it('returns 0 for the plan-creation day itself', () => {
    const created = new Date('2026-07-01T00:00:00Z')
    const today = new Date('2026-07-01T00:00:00Z')
    expect(weekIndexSince(created, today)).toBe(0)
  })

  it('returns 0 for any day within the first 7 days', () => {
    const created = new Date('2026-07-01T00:00:00Z')
    const today = new Date('2026-07-06T00:00:00Z')
    expect(weekIndexSince(created, today)).toBe(0)
  })

  it('returns 1 once 7 days have elapsed', () => {
    const created = new Date('2026-07-01T00:00:00Z')
    const today = new Date('2026-07-08T00:00:00Z')
    expect(weekIndexSince(created, today)).toBe(1)
  })

  it('returns 3 after 3 full weeks plus a few days', () => {
    const created = new Date('2026-07-01T00:00:00Z')
    const today = new Date('2026-07-25T00:00:00Z') // 24 days later
    expect(weekIndexSince(created, today)).toBe(3)
  })

  it('clamps to 0 if today is somehow before plan creation', () => {
    const created = new Date('2026-07-10T00:00:00Z')
    const today = new Date('2026-07-01T00:00:00Z')
    expect(weekIndexSince(created, today)).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/running/__tests__/week-index.test.ts`
Expected: FAIL — `weekIndexSince` is not exported

- [ ] **Step 3: Write the implementation**

```typescript
const MS_PER_DAY = 86_400_000
const DAYS_PER_WEEK = 7

/** 0-based week index since a plan's creation, floor-divided — day 0-6 is week 0, day 7-13 is
 *  week 1, etc. Clamped at 0 so a clock skew or bad input never produces a negative index (which
 *  would make `WEEKLY_GROWTH ** weekIndex` grow instead of holding at the floor). */
export function weekIndexSince(createdAt: Date, today: Date): number {
  const daysElapsed = Math.floor((today.getTime() - createdAt.getTime()) / MS_PER_DAY)
  return Math.max(0, Math.floor(daysElapsed / DAYS_PER_WEEK))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/running/__tests__/week-index.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/running/week-index.ts lib/running/__tests__/week-index.test.ts
git commit -m "feat: add weekIndexSince — the real week-over-week index frameworks need to grow"
```

---

### Task 2: Wire the real week index and the real goal into `/api/running-plan`

**Files:**
- Modify: `app/api/running-plan/route.ts`

Two fixes in `assembleInputs` (confirmed via full-file read, lines 105-110):
1. `weekIndex: 0` → `weekIndexSince(plan.createdAt, todayMidnightUtc(tz))`.
2. `goal: { kind: 'cardio_health', targetDistanceKm: null, targetDate: null }` → the plan's actual
   `goalKind`/`targetDistanceKm`/`targetDate`. This has been silently wrong since the route shipped —
   frameworks that branch on `ctx.goal` (none do yet, but the density-progression framework in Task 5
   will) were always being fed a fake goal regardless of what the user picked.

`assembleInputs` needs the `plan` to compute both, so its signature gains one parameter.

- [ ] **Step 1: Add the import and extend the signature**

```typescript
import { weekIndexSince } from '@/lib/running/week-index'
import type { RunningPlan } from '@/lib/data/repository'
```

Change `assembleInputs`'s signature (currently lines 35-38):

```typescript
async function assembleInputs(
  repo: Awaited<ReturnType<typeof getRepository>>,
  userId: string, tz: string, fitness: FitnessSnapshot, plan: RunningPlan,
): Promise<{ ctx: Parameters<typeof prescribeNextRun>[0]; gate: RecoveryGateInputs }> {
```

- [ ] **Step 2: Replace the hardcoded `ctx` construction**

Replace (currently lines 105-110):

```typescript
  const ctx = {
    fitness,
    weekIndex: weekIndexSince(plan.createdAt, todayMid),
    runsThisWeek: runsThisWeek.map(r => ({ type: r.runType as RunType, durationMin: r.durationMin })),
    goal: {
      kind: plan.goalKind as RunningGoal['kind'],
      targetDistanceKm: plan.targetDistanceKm,
      targetDate: plan.targetDate,
    } as RunningGoal,
  }
```

- [ ] **Step 3: Update both call sites**

In `GET` (currently line 158): `const { ctx, gate } = await assembleInputs(repo, userId, tz, fitness, plan)`.

In `POST` (currently line 213): `const { ctx, gate } = await assembleInputs(repo, userId, tz, fitness, plan)`.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 5: Manual verification**

Start `pnpm dev`, sign in, `GET /api/running-plan` for a user with an active plan created more than
7 days ago in the seed (or temporarily backdate a seed plan's `created_at` via `psql` for this
check) — confirm the response's implied volume differs from a freshly-created plan's, proving
`weekIndex` is no longer always 0. Revert any manual DB edit made only for this check.

- [ ] **Step 6: Commit**

```bash
git add app/api/running-plan/route.ts
git commit -m "fix: thread the real week index and the plan's actual goal into the prescription context"
```

---

### Task 3: `timePerSessionMinutes` on `RunningGoal` and `running_plans`

**Files:**
- Modify: `lib/running/types.ts`
- Modify: `lib/data/repository.ts`
- Modify: `lib/data/postgres/schema.ts`
- Create: `lib/data/postgres/migrations/145_running_plan_session_length.sql` (verify `145` is still
  the next free number against `main` at implementation time — `144_claude_ro_views_rescope.sql` was
  the latest at plan-writing time)
- Modify: `lib/data/postgres/adapter.ts`
- Modify: `app/api/running-plan/route.ts`

Density-progression is *defined* by a fixed session length — the plan needs somewhere to store it.
Per the spec's carried-over note ("Goal ≠ time constraint — separate wizard steps"), this is a
**plan-level** field, independent of `goalKind`.

- [ ] **Step 1: Add the field to `RunningGoal`**

In `lib/running/types.ts`, extend `RunningGoal` (currently lines 39-43):

```typescript
export interface RunningGoal {
  kind: GoalKind
  targetDistanceKm: number | null
  targetDate: string | null             // YYYY-MM-DD (user-tz), normalized on write
  /** Fixed minutes per session, when the user chose a fixed-time plan (density-progression).
   *  Null for the four existing frameworks, which grow session length over time instead. */
  timePerSessionMinutes: number | null
}
```

- [ ] **Step 2: Migration**

```sql
-- 145_running_plan_session_length.sql
ALTER TABLE running_plans ADD COLUMN IF NOT EXISTS time_per_session_minutes INTEGER;
```

- [ ] **Step 3: Schema**

In `lib/data/postgres/schema.ts`, add to `runningPlans` (currently lines 328-339), after `frameworkKey`:

```typescript
  timePerSessionMinutes: integer('time_per_session_minutes'),
```

- [ ] **Step 4: Repository type + adapter**

In `lib/data/repository.ts`, extend `RunningPlan` (currently lines 293-296):

```typescript
export interface RunningPlan {
  id: string; userId: string; goalKind: string; targetDistanceKm: number | null
  targetDate: string | null; frameworkKey: string; fitnessSnapshot: unknown
  timePerSessionMinutes: number | null
  isActive: boolean; createdAt: Date; updatedAt: Date
}
```

In `lib/data/postgres/adapter.ts`'s `saveRunningPlan` (currently lines 2127-2144), add
`timePerSessionMinutes` to `values` and the insert:

```typescript
    const values = {
      id: plan.id, userId,
      goalKind: plan.goalKind,
      targetDistanceKm: plan.targetDistanceKm ?? null,
      targetDate: plan.targetDate ?? null,
      frameworkKey: plan.frameworkKey,
      timePerSessionMinutes: plan.timePerSessionMinutes ?? null,
      fitnessSnapshot: plan.fitnessSnapshot ?? {},
      isActive: plan.isActive,
    }
```

And `rowToRunningPlan` (currently lines 2187-2194):

```typescript
  private rowToRunningPlan(r: typeof s.runningPlans.$inferSelect): RunningPlan {
    return {
      id: r.id, userId: r.userId, goalKind: r.goalKind,
      targetDistanceKm: r.targetDistanceKm ?? null, targetDate: r.targetDate ?? null,
      frameworkKey: r.frameworkKey, fitnessSnapshot: r.fitnessSnapshot,
      timePerSessionMinutes: r.timePerSessionMinutes ?? null,
      isActive: r.isActive, createdAt: r.createdAt, updatedAt: r.updatedAt,
    }
  }
```

- [ ] **Step 5: Thread it through the route**

In `app/api/running-plan/route.ts`, extend `CreateBody` (currently lines 26-31):

```typescript
const CreateBody = z.object({
  goalKind: z.enum(['speed', 'endurance', 'heart_health', 'recovery', 'cardio_health', 'distance_event']).default('heart_health'),
  targetDistanceKm: z.number().positive().optional(),
  targetDate: z.string().optional(),
  frameworkKey: z.string().optional(),
  timePerSessionMinutes: z.number().int().positive().max(180).optional(),
})
```

In `POST`'s `saveRunningPlan` call (currently lines 204-211), add
`timePerSessionMinutes: parsed.data.timePerSessionMinutes ?? null,`.

In both `assembleInputs`'s `ctx.goal` construction (Task 2, Step 2), add
`timePerSessionMinutes: plan.timePerSessionMinutes,` to the `RunningGoal` object.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors — this step touches a lot of call sites, so a clean `tsc` is the real
verification that every one was updated.

- [ ] **Step 7: Apply the migration locally and verify**

```bash
node scripts/local-db/migrate.js
```
Expected: migration `145_running_plan_session_length.sql` applies with no error, `\d running_plans`
via `psql` shows the new nullable `time_per_session_minutes` column.

- [ ] **Step 8: Commit**

```bash
git add lib/running/types.ts lib/data/repository.ts lib/data/postgres/schema.ts lib/data/postgres/migrations/145_running_plan_session_length.sql lib/data/postgres/adapter.ts app/api/running-plan/route.ts
git commit -m "feat: add timePerSessionMinutes to running plans, independent of goal"
```

---

### Task 4: Zone-weight entry for the new framework

**Files:**
- Modify: `lib/running/zone-targets.ts`

Confirmed via full-file read: an unrecognized `frameworkKey` **silently falls back to the polarized
80/20 weight shape** (`ZONE_WEIGHTS[frameworkKey] ?? ZONE_WEIGHTS[DEFAULT_KEY]`) — without this step,
the density-progression framework would render a wrong (heavily-interval-weighted) weekly zone
quota on the `/cardio` hub despite every actual session being easy-paced Zone 2 work.

- [ ] **Step 1: Add the entry**

In `lib/running/zone-targets.ts`, add to `ZONE_WEIGHTS` (currently lines 4-9 area), after
`'aerobic-recovery'`:

```typescript
  'density-progression': { model: 'zone2-base', weights: [0.15, 0.70, 0.10, 0.05, 0.00] },
```

Mostly Zone 2 (matching every session's `easy` type — see Task 5), with a little more Zone-3
tolerance than `zone2-base`'s own `[0.20, 0.72, 0.05, 0.03, 0.00]` since holding a growing distance
in a fixed time will occasionally drift a session's effort up a notch as fitness improves.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add lib/running/zone-targets.ts
git commit -m "feat: add zone-weight shape for the density-progression framework"
```

---

### Task 5: The density-progression framework itself

**Files:**
- Create: `lib/running/frameworks/density-progression.ts`
- Test: `lib/running/frameworks/__tests__/density-progression.test.ts`
- Modify: `lib/running/framework.ts`

Where the four existing frameworks scale `durationMin` by `WEEKLY_GROWTH ** weekIndex` and always
leave `distanceKm: null`, this framework holds `durationMin` **fixed** at
`ctx.goal.timePerSessionMinutes` and instead grows `distanceKm` — "cover more ground in the same
time" is the density axis. Every session is `type: 'easy'` / Zone 1-2 (v1 keeps this framework as
simple as the four it sits beside — no interval/tempo/long branching yet; that sequencing can be
added later without changing this plan's contract).

Pace-at-week-0 comes from `pacesFromVdot(vo2max).easySecPerKm` when a VO2max estimate exists
(`ctx.fitness.vo2max`), else a documented flat fallback. `ctx.fitness.vo2max` is a **field-test**
VO2max estimate (Cooper/6MWT, see `lib/health/fitness-tests.ts`), not a race-derived Daniels VDOT —
feeding it into `pacesFromVdot` (built for VDOT) is a deliberate, documented approximation for v1,
not a formula error; both numbers describe the same underlying "VO2max-equivalent" quantity and
Daniels' own tables are commonly read this way in practice.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import { densityProgressionFramework } from '../density-progression'
import type { FrameworkContext } from '../../types'

function baseCtx(overrides: Partial<FrameworkContext> = {}): FrameworkContext {
  return {
    fitness: { maxHr: 185, restingHr: 55, vo2max: 42, thresholdHr: null, weeklyBaseMinutes: 90, source: 'baseline' },
    weekIndex: 0,
    runsThisWeek: [],
    goal: { kind: 'endurance', targetDistanceKm: null, targetDate: null, timePerSessionMinutes: 30 },
    ...overrides,
  }
}

describe('densityProgressionFramework', () => {
  it('holds duration fixed at timePerSessionMinutes across weeks', () => {
    const week0 = densityProgressionFramework.nextRun(baseCtx({ weekIndex: 0 }))
    const week5 = densityProgressionFramework.nextRun(baseCtx({ weekIndex: 5 }))
    expect(week0.durationMin).toBe(30)
    expect(week5.durationMin).toBe(30)
  })

  it('grows the distance target week over week', () => {
    const week0 = densityProgressionFramework.nextRun(baseCtx({ weekIndex: 0 }))
    const week4 = densityProgressionFramework.nextRun(baseCtx({ weekIndex: 4 }))
    expect(week4.distanceKm).toBeGreaterThan(week0.distanceKm!)
  })

  it('falls back to a flat default duration when the goal has no timePerSessionMinutes', () => {
    const ctx = baseCtx({ goal: { kind: 'endurance', targetDistanceKm: null, targetDate: null, timePerSessionMinutes: null } })
    const p = densityProgressionFramework.nextRun(ctx)
    expect(p.durationMin).toBe(30) // DEFAULT_SESSION_MIN
  })

  it('falls back to a flat default pace when no VO2max estimate exists', () => {
    const ctx = baseCtx({ fitness: { maxHr: 185, restingHr: 55, vo2max: null, thresholdHr: null, weeklyBaseMinutes: 90, source: 'age-estimate' } })
    const p = densityProgressionFramework.nextRun(ctx)
    // 30 min at the documented fallback pace (400 sec/km) = 4.5 km
    expect(p.distanceKm).toBeCloseTo(4.5, 1)
  })

  it('always prescribes an easy-effort, Zone 1-2 session', () => {
    const p = densityProgressionFramework.nextRun(baseCtx())
    expect(p.type).toBe('easy')
    expect(p.targets.zoneIds).toEqual([1, 2])
  })

  it('stamps its own frameworkKey', () => {
    const p = densityProgressionFramework.nextRun(baseCtx())
    expect(p.frameworkKey).toBe('density-progression')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/running/frameworks/__tests__/density-progression.test.ts`
Expected: FAIL — module `../density-progression` not found

- [ ] **Step 3: Write the implementation**

```typescript
import { pacesFromVdot } from '@/lib/health/vdot'
import { targetsForRunType } from '../hr-targets'
import type { FrameworkContext, Prescription, RunFramework } from '../types'

const KEY = 'density-progression'
const DEFAULT_SESSION_MIN = 30
// v1 growth is intentionally gentler than the other frameworks' WEEKLY_GROWTH (1.05-1.10) —
// holding pace/effort steady while distance grows in a FIXED duration is a harder ask on the
// body per week than simply running longer, so the density axis grows more conservatively.
const DENSITY_GROWTH = 1.03
// Used only when no VO2max estimate exists yet — a conservative recreational easy pace
// (10:43/mile), matching the "age-estimate" fallback tier fitness-snapshot.ts already uses
// for maxHr in the same no-baseline-data situation.
const FALLBACK_EASY_PACE_SEC_PER_KM = 400

function easyPaceSecPerKm(vo2max: number | null): number {
  if (vo2max == null) return FALLBACK_EASY_PACE_SEC_PER_KM
  return pacesFromVdot(vo2max).easySecPerKm
}

function nextRun(ctx: FrameworkContext): Prescription {
  const durationMin = ctx.goal.timePerSessionMinutes ?? DEFAULT_SESSION_MIN
  const paceSecPerKm = easyPaceSecPerKm(ctx.fitness.vo2max)
  const baseDistanceKm = (durationMin * 60) / paceSecPerKm
  const distanceKm = Math.round(baseDistanceKm * DENSITY_GROWTH ** ctx.weekIndex * 100) / 100

  return {
    type: 'easy',
    durationMin,
    distanceKm,
    targets: targetsForRunType('easy', ctx.fitness),
    rationale: `${durationMin} minutes, aiming to cover ${distanceKm.toFixed(2)} km — the same time as always, a little more ground each week. Stay conversational; this is about density, not pace.`,
    frameworkKey: KEY,
  }
}

export const densityProgressionFramework: RunFramework = {
  key: KEY,
  label: 'Density progression (fixed time)',
  nextRun,
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/running/frameworks/__tests__/density-progression.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Register it**

In `lib/running/framework.ts`, add the import and registry entry:

```typescript
import { densityProgressionFramework } from './frameworks/density-progression'
```

```typescript
const FRAMEWORKS: Record<string, RunFramework> = {
  [polarizedFramework.key]: polarizedFramework,
  [speedVo2maxFramework.key]: speedVo2maxFramework,
  [zone2BaseFramework.key]: zone2BaseFramework,
  [aerobicRecoveryFramework.key]: aerobicRecoveryFramework,
  [densityProgressionFramework.key]: densityProgressionFramework,
}
```

- [ ] **Step 6: Type-check and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean, all tests passing

- [ ] **Step 7: Commit**

```bash
git add lib/running/frameworks/density-progression.ts lib/running/frameworks/__tests__/density-progression.test.ts lib/running/framework.ts
git commit -m "feat: add the density-progression running framework"
```

---

### Task 6: Display the distance target on the prescribed-run card

**Files:**
- Modify: `components/running/prescribed-run-card.tsx`

Confirmed via full-file read: `RunPrescription.distanceKm` exists on the type but is **never
rendered** — harmless while every framework left it `null`, but the density-progression framework
(Task 5) sets a real, growing number every session. Without this, the framework's entire progression
axis is invisible to the user.

- [ ] **Step 1: Render it when present**

In `components/running/prescribed-run-card.tsx`, destructure `distanceKm` (currently line 33):

```typescript
  const { type, durationMin, distanceKm, targets, rationale } = prescription
```

Add it to the stat row (currently lines 64-70), right after the `durationMin` span:

```tsx
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[color:var(--muted-foreground)]">
        {durationMin != null && <span>{durationMin} min</span>}
        {distanceKm != null && <span>{distanceKm.toFixed(2)} km target</span>}
        <span className="inline-flex items-center gap-1">
          <TrendingUp className="h-4 w-4" aria-hidden />
          Zone {targets.zoneIds.join('–')} · {targets.hrLowBpm}–{targets.hrHighBpm} bpm
        </span>
      </div>
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add components/running/prescribed-run-card.tsx
git commit -m "feat: show the prescribed distance target on the running card when present"
```

---

### Task 7: Wizard step — fixed time vs growing time

**Files:**
- Modify: `components/running/plan-setup-sheet.tsx`

Per the spec's carried-over note, goal and time-constraint are separate wizard steps. Add one more
screen-state to the existing single-sheet flow: after picking a goal (and distance, if needed), ask
whether the user has a fixed session length; if so, collect it and force
`frameworkKey: 'density-progression'`.

- [ ] **Step 1: Add the new state and submit logic**

In `components/running/plan-setup-sheet.tsx`, add state (after the existing `targetDistanceKm`
state, currently line 29):

```typescript
  const [sessionMode, setSessionMode] = useState<'growing' | 'fixed'>('growing')
  const [timePerSessionMinutes, setTimePerSessionMinutes] = useState<number>(30)
```

Replace `submit()`'s body (currently lines 35-54):

```typescript
  async function submit() {
    setSaving(true)
    try {
      const body: Record<string, unknown> = needsDistance ? { goalKind, targetDistanceKm } : { goalKind }
      if (sessionMode === 'fixed') {
        body.frameworkKey = 'density-progression'
        body.timePerSessionMinutes = timePerSessionMinutes
      }
      const res = await fetch('/api/running-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('failed')
      hapticSuccess()
      await invalidateRunningPlan()
      onOpenChange(false)
      onCreated()
    } catch {
      // Keep the sheet open for retry, but surface the failure (A-2).
      toast.error('Couldn’t create your plan — try again')
    } finally {
      setSaving(false)
    }
  }
```

- [ ] **Step 2: Add the UI step**

In the JSX, after the target-distance block (currently lines 83-104, right before `</div>` at
line 105), add:

```tsx
          <div className="pt-1">
            <p className="mb-1.5 text-xs font-medium text-[color:var(--muted-foreground)]">Session length</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSessionMode('growing')}
                className="flex-1 rounded-xl border p-2.5 text-left text-sm transition-colors"
                style={
                  sessionMode === 'growing'
                    ? { borderColor: 'var(--accent-cyan)', background: 'color-mix(in oklch, var(--accent-cyan) 10%, transparent)' }
                    : { borderColor: 'var(--border)', background: 'var(--card)' }
                }
              >
                <div className="font-semibold">Grows over time</div>
                <div className="text-xs text-[color:var(--muted-foreground)]">Sessions get longer as you build up</div>
              </button>
              <button
                type="button"
                onClick={() => setSessionMode('fixed')}
                className="flex-1 rounded-xl border p-2.5 text-left text-sm transition-colors"
                style={
                  sessionMode === 'fixed'
                    ? { borderColor: 'var(--accent-cyan)', background: 'color-mix(in oklch, var(--accent-cyan) 10%, transparent)' }
                    : { borderColor: 'var(--border)', background: 'var(--card)' }
                }
              >
                <div className="font-semibold">Fixed time</div>
                <div className="text-xs text-[color:var(--muted-foreground)]">Same time each session — do more in it</div>
              </button>
            </div>

            {sessionMode === 'fixed' && (
              <div className="mt-2 flex flex-wrap gap-2">
                {[20, 30, 45, 60].map((min) => (
                  <button
                    key={min}
                    type="button"
                    onClick={() => setTimePerSessionMinutes(min)}
                    className="rounded-lg border px-3 py-1.5 text-sm transition-colors"
                    style={
                      timePerSessionMinutes === min
                        ? { borderColor: 'var(--accent-cyan)', background: 'color-mix(in oklch, var(--accent-cyan) 12%, transparent)', fontWeight: 600 }
                        : { borderColor: 'var(--border)', background: 'var(--card)' }
                    }
                  >
                    {min} min
                  </button>
                ))}
              </div>
            )}
          </div>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 4: Manual verification (dev server + Playwright)**

Run `pnpm dev`, sign in, open `/running`, tap "Set up my running plan", pick any goal, tap "Fixed
time", pick 30 min, create the plan. Confirm the created plan's prescription in the response (or via
`psql`) shows `framework_key = 'density-progression'` and `time_per_session_minutes = 30`.

- [ ] **Step 5: Commit**

```bash
git add components/running/plan-setup-sheet.tsx
git commit -m "feat: add a fixed-time-vs-growing wizard step, wired to density-progression"
```

---

### Task 8: Link a completed run back to its prescription

**Files:**
- Modify: `lib/stores/activity-store.ts`
- Modify: `components/running/running-plan-content.tsx`
- Modify: `components/activity/done-activity-screen.tsx`

Confirmed via full-file reads: `onStart` in `running-plan-content.tsx` only does
`router.push('/activity')` — no id is passed anywhere — and `done-activity-screen.tsx`'s `handleSave`
never touches `prescribed_runs` at all. The only thing that ever flips a `prescribed_runs.status`
away from `'pending'` today is the **Skip** button. This plan reuses the exact mechanism `markRun`
already uses (the `prescribed_run` mutation domain + `PATCH /api/running-plan/runs/[id]`) — no new
migration, no sync-chain changes, since both write paths already exist and already accept
`activityLogId`.

- [ ] **Step 1: Add `prescribedRunId` to the activity store**

In `lib/stores/activity-store.ts`, add to `ActivityState` (currently lines 17-37), after `activitySessionId`:

```typescript
  prescribedRunId: string | null
```

Add to `ActivityActions` (currently lines 39-48):

```typescript
  linkPrescribedRun: (id: string) => void
```

Add to `INITIAL_STATE` (currently lines 54-71):

```typescript
  prescribedRunId: null,
```

Add the action implementation, alongside `setTitle` (currently line 113):

```typescript
      linkPrescribedRun: (id) => set({ prescribedRunId: id }),
```

This field persists across a reload the same way `activityType`/`title` already do (an in-progress
session recovering after a kill should still know which prescription it's for) — no special
`onRehydrateStorage` handling needed since `resetSession()` already clears it via the `INITIAL_STATE`
spread.

- [ ] **Step 2: Call it from `onStart`**

In `components/running/running-plan-content.tsx`, add the import:

```typescript
import { useActivityStore } from '@/lib/stores/activity-store'
```

Replace `onStart` (currently lines 92-96):

```typescript
  const onStart = useCallback(() => {
    // Hand off to the guided-activity flow to execute + log the run; completion links
    // the resulting activity_logs row back to this prescription (device round-trip).
    if (data?.run?.id) useActivityStore.getState().linkPrescribedRun(data.run.id)
    router.push('/activity')
  }, [router, data?.run?.id])
```

- [ ] **Step 3: Fire the completion link from `done-activity-screen.tsx`**

In `components/activity/done-activity-screen.tsx`, add the import:

```typescript
import { useActivityStore } from '@/lib/stores/activity-store'
```

Read `prescribedRunId` from the store alongside the existing selected fields (currently lines 32-37):

```typescript
  const { activityType, title, activityLabel, startMs, endMs, draftSummary, resetSession, prescribedRunId } = useActivityStore(
    useShallow(s => ({
      activityType: s.activityType, title: s.title, activityLabel: s.activityLabel,
      startMs: s.startMs, endMs: s.endMs, draftSummary: s.draftSummary, resetSession: s.resetSession,
      prescribedRunId: s.prescribedRunId,
    }))
  )
```

Add a small helper above `handleSave` (after `msToHHMM`, currently line 28):

```typescript
async function linkPrescribedRun(userId: string | undefined, prescribedRunId: string, activityLogId: string) {
  const store = userId ? getLocalStore(userId) : null
  if (store) {
    const today = todayInTz()
    const runs = await store.getPrescribedRuns(today)
    const existing = runs.find((r) => r.id === prescribedRunId)
    if (existing) {
      await store.upsertPrescribedRun({ ...existing, status: 'completed', activityLogId, updatedAt: new Date().toISOString(), syncStatus: 'pending' })
    }
    await store.queueMutation({ userId: userId!, domain: 'prescribed_run', date: today, payload: { id: prescribedRunId, status: 'completed', activityLogId } })
    return
  }
  await fetch(`/api/running-plan/runs/${prescribedRunId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'completed', activityLogId }),
  }).catch(() => {})
}
```

Call it right after the local-store save succeeds (currently right after `savedLocally = true` at
line 173, before the `catch`):

```typescript
        savedLocally = true
        if (activityType === 'run' && prescribedRunId) {
          linkPrescribedRun(userId, prescribedRunId, logId).catch(() => {})
        }
```

And right after the web-fallback POST succeeds (currently right after `if (!res.ok) throw new
Error()` at line 205, before `await invalidateActivityWrites()`):

```typescript
      if (!res.ok) throw new Error()
      const { activityLog } = await res.json()
      if (activityType === 'run' && prescribedRunId) {
        linkPrescribedRun(userId, prescribedRunId, activityLog.id).catch(() => {})
      }
```

(`POST /api/activity-logs` already returns `{ activityLog }` with the generated `id` — confirmed via
full-file read of `app/api/activity-logs/route.ts`.)

Both calls are fire-and-forget (`.catch(() => {})`) — a failed link must never block the "Activity
saved" toast or navigation the user is already seeing; the run simply stays `pending` and can still
be marked via the existing Skip/Complete affordance if the automatic link fails.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 5: Manual verification (dev server + Playwright)**

Run `pnpm dev`, sign in, ensure an active running plan exists with a pending prescription for today
(create one via the wizard if needed). Open `/running`, tap "Start" — confirm you land on
`/activity` with the run type pre-selected or selectable. Log a run (GPS or manual) and save.
Navigate back to `/running` and confirm the prescription card now shows the completed state, not
"pending" — and via `psql`, confirm `prescribed_runs.status = 'completed'` and `activity_log_id` is
set to the newly-created `activity_logs.id` for today's row.

- [ ] **Step 6: Commit**

```bash
git add lib/stores/activity-store.ts components/running/running-plan-content.tsx components/activity/done-activity-screen.tsx
git commit -m "feat: link a completed run back to its prescription automatically"
```

---

### Task 9: Full gate, version bump, session bookkeeping

**Files:**
- Modify: `package.json`, `lib/changelog.ts`, `projectOverview.md`
- Create: `docs/overview/entries/2026-07-27-cardio-density-progression.md`
- Modify: `docs/implementation-backlog.md`

- [ ] **Step 1: Run the full local gate**

```bash
pnpm lint
node scripts/check-reconcile.js
node scripts/check-push-mutations.js
pnpm typecheck
pnpm test
```

- [ ] **Step 2: Isolated production build**

```bash
rm -rf .next
npm run build
```

(Stop any running `pnpm dev` first.)

- [ ] **Step 3: Version bump + changelog**

Minor bump; changelog entry describing the fixed-time plan option and the two prescription-context
bug fixes (in plain, non-technical language — see other entries for the established tone).

- [ ] **Step 4: Journal entry**

`docs/overview/entries/2026-07-27-cardio-density-progression.md` — what shipped (the framework, the
two bug fixes, the completion-link fix), and explicitly flag as **not verified**: real multi-week
growth (the seed can't fast-forward calendar time, so `weekIndex > 0` behavior was only checked via
the unit tests and a manual backdated-row check, not a real multi-week user history); on-device.

- [ ] **Step 5: `projectOverview.md`**

Update Current Status chain; add a Known Issues row for the above not-verified items.

- [ ] **Step 6: Backlog update**

In `docs/implementation-backlog.md`'s cardio batch: mark this item shipped with a pointer note (same
style as prior items in this batch), and **do not** remove the sibling baseline-anchors item — it
still has its own plan and branch, now unblocked.

- [ ] **Step 7: Commit and push**

```bash
git add -A
git commit -m "chore: version bump, journal entry and backlog update for the density-progression framework"
git push -u origin feat/cardio-density-progression
```

---

## Self-Review Notes

- **Spec coverage:** density-progression framework (fixed time, distance grows) ✅ Task 5 (+ display
  fix, Task 6); wizard goal≠time-constraint split ✅ Task 7; the two `weekIndex`/`goal` bugs blocking
  ALL frameworks' growth ✅ Tasks 1-2 (found during research, not speculative — confirmed by reading
  the route's actual hardcoded values); completion round-trip (needed for the sibling
  anchors/push-session plan to grade anything) ✅ Task 8.
- **Out of scope, by design:** baseline anchors, push/adherence session grading (D-3), environment
  tagging (D-5) — all in the sibling `2026-07-27-cardio-baseline-anchors.md` plan, which depends on
  this plan's Task 8.
- **No sync-chain changes:** Task 8 reuses the `prescribed_run` mutation domain's existing
  `{id, status, activityLogId}` shape verbatim — verified against `PrescribedRunPatchBody`
  (`lib/validation/prescribed-run.ts`) and the `pushMutations` branch
  (`lib/data/postgres/adapter.ts:3590`), neither of which needs to change.
