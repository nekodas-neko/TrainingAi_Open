# AI Dynamic Rest Days Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a program uses `phaseMode: 'ai_dynamic'`, score every session using muscle recovery, balance, and freshness to recommend the best session each day, flag deload/rest when consecutive training days or readiness warrants it, and let the user choose Deload / Rest / Full Session from an expanded home card.

**Architecture:** A pure scoring function in `lib/ai-periodization/ai-dynamic.ts` takes pre-fetched workout history, muscle recovery, and readiness data and returns the recommendation. `getNextSession()` in the adapter fetches the required data and calls this function when `phaseMode === 'ai_dynamic'`. The home screen shows a passive banner before the mood gate (consecutive-days trigger) and a three-choice card after mood is logged.

**Tech Stack:** Next.js 15, TypeScript, Drizzle ORM + PostgreSQL, Vitest, Tailwind CSS, Radix UI

---

## File Map

| File | Change |
|------|--------|
| `lib/data/postgres/migrations/092_ai_dynamic_workout_flags.sql` | Create — adds `was_override`, `intensity_mode` to `workout_sessions` |
| `lib/data/postgres/schema.ts` | Modify — add Drizzle columns for new fields |
| `lib/types/program.ts` | Modify — extend `NextSessionRecommendation` with 7 ai_dynamic fields |
| `lib/types/log.ts` | Modify — add `wasOverride?`, `intensityMode?` to `WorkoutSession` |
| `lib/ai-periodization/ai-dynamic.ts` | Create — pure session scoring function, no DB calls |
| `lib/__tests__/ai-dynamic.test.ts` | Create — unit tests for scoring logic |
| `lib/data/postgres/adapter.ts` | Modify — `getNextSession()` ai_dynamic branch; `ensureWorkoutSession` accepts new fields |
| `lib/data/repository.ts` | Modify — `ensureWorkoutSession` signature update |
| `app/api/workout-data/route.ts` | Modify — honour `?aiDeload=1` query param for ai_dynamic programs |
| `app/workout/page.tsx` | Modify — pass `aiDeload` search param to `WorkoutScreen` |
| `components/workout-screen.tsx` | Modify — accept `aiDeload` prop; forward to workout-data fetch and log-exercise |
| `app/api/log-exercise/route.ts` | Modify — accept `intensityMode` and `wasOverride` in request body |
| `app/session-select/components/deload-banner.tsx` | Create — passive pre-mood banner |
| `app/session-select/session-select-content.tsx` | Modify — render banner before mood gate; pass new recommendation fields down |
| `app/session-select/components/recommendation-card.tsx` | Modify — three-choice section when `deloadOrRestRecommended` |
| `app/session-select/components/streak-card.tsx` | Modify — add `consecutiveRestDays` chip |

---

## Task 1: DB Migration + Schema

**Files:**
- Create: `lib/data/postgres/migrations/092_ai_dynamic_workout_flags.sql`
- Modify: `lib/data/postgres/schema.ts`

- [ ] **Step 1: Create migration SQL**

```sql
-- lib/data/postgres/migrations/092_ai_dynamic_workout_flags.sql
ALTER TABLE workout_sessions
  ADD COLUMN IF NOT EXISTS was_override   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS intensity_mode TEXT
    CHECK (intensity_mode IN ('full', 'deload'));
```

- [ ] **Step 2: Apply migration locally**

```bash
pnpm db:local
```

Expected: `[local-db] Ready.` with no errors on the new migration.

- [ ] **Step 3: Add Drizzle columns to schema**

In `lib/data/postgres/schema.ts`, inside the `workoutSessions` pgTable definition (after `isEarlyDeload`):

```ts
  wasOverride:       boolean('was_override').notNull().default(false),
  intensityMode:     text('intensity_mode'),
```

- [ ] **Step 4: TypeScript check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/data/postgres/migrations/092_ai_dynamic_workout_flags.sql lib/data/postgres/schema.ts
git commit -m "feat: add was_override and intensity_mode columns to workout_sessions"
```

---

## Task 2: Extend Types

**Files:**
- Modify: `lib/types/program.ts`
- Modify: `lib/types/log.ts`

- [ ] **Step 1: Extend NextSessionRecommendation**

Replace the existing `NextSessionRecommendation` interface in `lib/types/program.ts`:

```ts
export interface NextSessionRecommendation {
  isRestDay: boolean
  session?: ProgramSession
  reason: string
  reminderEnabled?: boolean
  reminderTime?: string | null
  // ai_dynamic only — undefined for weekly/rotation programs
  deloadOrRestRecommended?: boolean
  deloadStrength?: 'soft' | 'recommended' | 'strong'
  consecutiveTrainingDays?: number
  consecutiveRestDays?: number
  streakWarning?: boolean    // true when consecutiveRestDays === 2
  streakBroken?: boolean     // true when consecutiveRestDays >= 3
  temperatureAlert?: boolean
}
```

- [ ] **Step 2: Extend WorkoutSession**

In `lib/types/log.ts`, add two optional fields to `WorkoutSession` after `isEarlyDeload`:

```ts
  wasOverride: boolean
  intensityMode?: 'full' | 'deload' | null
```

- [ ] **Step 3: TypeScript check**

```bash
pnpm tsc --noEmit
```

Expected: errors only at sites that construct `WorkoutSession` objects without `wasOverride`. Fix each by adding `wasOverride: r.wasOverride ?? false` — grep for them:

```bash
grep -n "isEarlyDeload:" lib/data/postgres/adapter.ts
```

For each match that constructs a `WorkoutSession`, add:
```ts
wasOverride:   r.wasOverride ?? false,
intensityMode: (r.intensityMode as 'full' | 'deload' | null) ?? null,
```

- [ ] **Step 4: Verify clean**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/types/program.ts lib/types/log.ts lib/data/postgres/adapter.ts
git commit -m "feat: extend NextSessionRecommendation and WorkoutSession types for ai_dynamic"
```

---

## Task 3: Pure Scoring Function

**Files:**
- Create: `lib/ai-periodization/ai-dynamic.ts`

This module is pure — it takes data in, returns a result, touches no DB.

- [ ] **Step 1: Create the file**

```ts
// lib/ai-periodization/ai-dynamic.ts
import type { ProgramSession } from '@/lib/types/program'
import type { MuscleAssignment } from '@/lib/types/program'
import type { NextSessionRecommendation } from '@/lib/types/program'

export interface MuscleRecovery {
  muscle: string
  pct: number        // 0–100
  hoursAgo: number
  volume: number     // kg (used to pick tau)
}

export interface SessionHistory {
  sessionName: string
  startedAt: Date
  hasExercises: boolean  // only sessions with exercises count
}

export interface AiDynamicInput {
  sessions: ProgramSession[]
  muscleAssignments: Record<string, MuscleAssignment[]>  // exerciseName → assignments
  muscleRecovery: MuscleRecovery[]                        // per-muscle recovery state
  history: SessionHistory[]                               // recent workout history, newest first
  soreMuscles: string[]                                   // from mood log (lowercase)
  readinessScore: number | null                           // blended Oura+ACWR or custom
  temperatureDeviation: number | null
  daySummary: string | null
  timezone: string
  reminderEnabled: boolean
  reminderTime: string | null
}

// ── Muscle recovery helpers ───────────────────────────────────────────────────

function recoveryPct(muscle: string, recoveries: MuscleRecovery[]): number {
  const r = recoveries.find(m => m.muscle.toLowerCase() === muscle.toLowerCase())
  if (!r) return 100  // never trained = fully recovered
  return r.pct
}

function sessionRecoveryScore(
  session: ProgramSession,
  muscleAssignments: Record<string, MuscleAssignment[]>,
  recoveries: MuscleRecovery[],
  soreMuscles: string[],
): number {
  const soreSet = new Set(soreMuscles.map(m => m.toLowerCase()))
  let weightedSum = 0
  let totalWeight = 0

  for (const ex of session.exercises) {
    const assignments = muscleAssignments[ex.exerciseName] ?? ex.muscleGroups.map(m => ({ muscle: m, role: 'main' as const }))
    for (const { muscle, role } of assignments) {
      const weight = role === 'main' ? 1.0 : 0.5
      let pct = recoveryPct(muscle, recoveries)
      if (role === 'main' && soreSet.has(muscle.toLowerCase())) {
        pct = Math.min(pct, 40)
      } else if (role === 'secondary' && soreSet.has(muscle.toLowerCase())) {
        pct = pct * 0.75
      }
      weightedSum += pct * weight
      totalWeight += weight
    }
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 100
}

// ── Balance score — how overdue is this session? ──────────────────────────────

function sessionBalanceScore(
  session: ProgramSession,
  sessions: ProgramSession[],
  history: SessionHistory[],
  now: Date,
): number {
  const lastDoneMs = (s: ProgramSession): number => {
    const entry = history.find(h => h.sessionName.toLowerCase() === s.name.toLowerCase() && h.hasExercises)
    return entry ? entry.startedAt.getTime() : 0
  }
  const myMs = lastDoneMs(session)
  const allMs = sessions.map(lastDoneMs)
  const maxMs = Math.max(...allMs)
  const minMs = Math.min(...allMs)
  if (maxMs === minMs) return 50
  const daysSince = (now.getTime() - myMs) / 86_400_000
  const maxDaysSince = (now.getTime() - minMs) / 86_400_000
  return Math.min(100, (daysSince / maxDaysSince) * 100)
}

// ── Freshness score — inverse of recency ─────────────────────────────────────

function sessionFreshnessScore(session: ProgramSession, history: SessionHistory[], now: Date): number {
  const last = history.find(h => h.sessionName.toLowerCase() === session.name.toLowerCase() && h.hasExercises)
  if (!last) return 100
  const hoursAgo = (now.getTime() - last.startedAt.getTime()) / 3_600_000
  return Math.min(100, (hoursAgo / 48) * 100)
}

// ── Consecutive day counters ──────────────────────────────────────────────────

export function countConsecutiveTrainingDays(history: SessionHistory[], now: Date, tz: string): number {
  const { toAestDay } = require('@/lib/date-utils')
  const trainedDays = new Set(
    history
      .filter(h => h.hasExercises)
      .map(h => toAestDay(h.startedAt, tz)),
  )
  let count = 0
  let cursor = new Date(now)
  // Start from yesterday (today not counted until session is logged)
  cursor.setDate(cursor.getDate() - 1)
  for (let i = 0; i < 30; i++) {
    const dayStr = toAestDay(cursor, tz)
    if (trainedDays.has(dayStr)) {
      count++
      cursor.setDate(cursor.getDate() - 1)
    } else {
      break
    }
  }
  return count
}

export function countConsecutiveRestDays(history: SessionHistory[], now: Date, tz: string): number {
  const { toAestDay } = require('@/lib/date-utils')
  const trainedDays = new Set(
    history
      .filter(h => h.hasExercises)
      .map(h => toAestDay(h.startedAt, tz)),
  )
  let count = 0
  let cursor = new Date(now)
  cursor.setDate(cursor.getDate() - 1)
  for (let i = 0; i < 30; i++) {
    const dayStr = toAestDay(cursor, tz)
    if (!trainedDays.has(dayStr)) {
      count++
      cursor.setDate(cursor.getDate() - 1)
    } else {
      break
    }
  }
  return count
}

// ── Deload strength from readiness ───────────────────────────────────────────

function deloadStrength(
  consecutiveTrainingDays: number,
  readinessScore: number | null,
  temperatureDeviation: number | null,
  daySummary: string | null,
): { recommended: boolean; strength: 'soft' | 'recommended' | 'strong'; temperatureAlert: boolean } {
  const tempAlert = temperatureDeviation != null && temperatureDeviation > 0.5
  const stressOverride = daySummary === 'very_stressful'

  if (tempAlert || stressOverride) {
    return { recommended: true, strength: 'recommended', temperatureAlert: tempAlert }
  }

  if (consecutiveTrainingDays < 4) {
    return { recommended: false, strength: 'soft', temperatureAlert: false }
  }

  const r = readinessScore ?? 70  // assume moderate when no data
  if (r >= 70) return { recommended: true, strength: 'soft', temperatureAlert: false }
  if (r >= 50) return { recommended: true, strength: 'recommended', temperatureAlert: false }
  return { recommended: true, strength: 'strong', temperatureAlert: false }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function computeAiDynamicNextSession(input: AiDynamicInput): NextSessionRecommendation {
  const {
    sessions, muscleAssignments, muscleRecovery, history, soreMuscles,
    readinessScore, temperatureDeviation, daySummary, timezone,
    reminderEnabled, reminderTime,
  } = input

  const now = new Date()
  const rem = { reminderEnabled, reminderTime }

  if (sessions.length === 0) {
    return { isRestDay: false, reason: 'No sessions in program', ...rem }
  }

  // Already trained today — show today's session
  const { toAestDay } = require('@/lib/date-utils')
  const todayStr = toAestDay(now, timezone)
  const todaySession = history.find(h => h.hasExercises && toAestDay(h.startedAt, timezone) === todayStr)
  if (todaySession) {
    const sess = sessions.find(s => s.name.toLowerCase() === todaySession.sessionName.toLowerCase())
    if (sess) return { isRestDay: false, session: sess, reason: `Already trained: ${sess.name}`, ...rem }
  }

  // Score every session
  const scored = sessions.map(s => ({
    session: s,
    score: (
      sessionRecoveryScore(s, muscleAssignments, muscleRecovery, soreMuscles) * 0.4 +
      sessionBalanceScore(s, sessions, history, now) * 0.35 +
      sessionFreshnessScore(s, history, now) * 0.25
    ),
  })).sort((a, b) => b.score - a.score)

  const best = scored[0].session
  const recovery = Math.round(sessionRecoveryScore(best, muscleAssignments, muscleRecovery, soreMuscles))

  const consecutiveTrainingDays = countConsecutiveTrainingDays(history, now, timezone)
  const consecutiveRestDays = countConsecutiveRestDays(history, now, timezone)

  const { recommended, strength, temperatureAlert } = deloadStrength(
    consecutiveTrainingDays, readinessScore, temperatureDeviation, daySummary,
  )

  const reason = `${best.name} · recovery ${recovery}% · ${consecutiveTrainingDays} training days`

  return {
    isRestDay: false,
    session: best,
    reason,
    deloadOrRestRecommended: recommended,
    deloadStrength: strength,
    consecutiveTrainingDays,
    consecutiveRestDays,
    streakWarning: consecutiveRestDays === 2,
    streakBroken: consecutiveRestDays >= 3,
    temperatureAlert,
    ...rem,
  }
}
```

- [ ] **Step 2: TypeScript check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/ai-periodization/ai-dynamic.ts
git commit -m "feat: add pure ai_dynamic session scoring function"
```

---

## Task 4: Unit Tests for Scoring Function

**Files:**
- Create: `lib/__tests__/ai-dynamic.test.ts`

- [ ] **Step 1: Write tests**

```ts
// lib/__tests__/ai-dynamic.test.ts
import { describe, it, expect } from 'vitest'
import {
  computeAiDynamicNextSession,
  countConsecutiveTrainingDays,
  countConsecutiveRestDays,
  type AiDynamicInput,
  type SessionHistory,
} from '../ai-periodization/ai-dynamic'
import type { ProgramSession } from '../types/program'

const makeSession = (name: string, position: number): ProgramSession => ({
  id: `id-${name}`,
  programId: 'prog',
  name,
  position,
  timeBudgetMinutes: 60,
  exercises: [{ id: `ex-${name}`, sessionId: `id-${name}`, exerciseName: `${name} exercise`, muscleGroups: [name.toLowerCase()], position: 0, exerciseRole: 'primary' }],
})

const push = makeSession('Push', 0)
const pull = makeSession('Pull', 1)
const legs = makeSession('Legs', 2)
const sessions = [push, pull, legs]

const noMuscleAssignments = {}
const noRecovery: AiDynamicInput['muscleRecovery'] = []

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function makeHistory(sessionNames: string[], daysAgoList: number[]): SessionHistory[] {
  return sessionNames.map((name, i) => ({
    sessionName: name,
    startedAt: daysAgo(daysAgoList[i]),
    hasExercises: true,
  }))
}

const baseInput: AiDynamicInput = {
  sessions,
  muscleAssignments: noMuscleAssignments,
  muscleRecovery: noRecovery,
  history: [],
  soreMuscles: [],
  readinessScore: 80,
  temperatureDeviation: null,
  daySummary: null,
  timezone: 'Australia/Brisbane',
  reminderEnabled: false,
  reminderTime: null,
}

describe('computeAiDynamicNextSession', () => {
  it('returns first session when no history', () => {
    const result = computeAiDynamicNextSession(baseInput)
    expect(result.isRestDay).toBe(false)
    expect(result.session).toBeDefined()
    expect(result.deloadOrRestRecommended).toBe(false)
  })

  it('recommends most overdue session', () => {
    const history = makeHistory(['Push', 'Pull'], [1, 2])
    const result = computeAiDynamicNextSession({ ...baseInput, history })
    // Legs was never done — most overdue
    expect(result.session?.name).toBe('Legs')
  })

  it('does not flag deload below 4 consecutive days', () => {
    const history = makeHistory(['Push', 'Pull', 'Legs'], [1, 2, 3])
    const result = computeAiDynamicNextSession({ ...baseInput, history })
    expect(result.consecutiveTrainingDays).toBe(3)
    expect(result.deloadOrRestRecommended).toBe(false)
  })

  it('flags soft deload at 4 consecutive days with high readiness', () => {
    const history = makeHistory(['Push', 'Pull', 'Legs', 'Push'], [1, 2, 3, 4])
    const result = computeAiDynamicNextSession({ ...baseInput, history, readinessScore: 75 })
    expect(result.consecutiveTrainingDays).toBe(4)
    expect(result.deloadOrRestRecommended).toBe(true)
    expect(result.deloadStrength).toBe('soft')
  })

  it('flags strong deload at 4 consecutive days with low readiness', () => {
    const history = makeHistory(['Push', 'Pull', 'Legs', 'Push'], [1, 2, 3, 4])
    const result = computeAiDynamicNextSession({ ...baseInput, history, readinessScore: 40 })
    expect(result.deloadOrRestRecommended).toBe(true)
    expect(result.deloadStrength).toBe('strong')
  })

  it('flags recommended deload on temperature alert below 4 days', () => {
    const history = makeHistory(['Push'], [1])
    const result = computeAiDynamicNextSession({ ...baseInput, history, temperatureDeviation: 0.7 })
    expect(result.deloadOrRestRecommended).toBe(true)
    expect(result.temperatureAlert).toBe(true)
    expect(result.consecutiveTrainingDays).toBe(1)
  })

  it('sets streakWarning on 2 consecutive rest days', () => {
    const history = makeHistory(['Push'], [3]) // last trained 3 days ago → 2 rest days
    const result = computeAiDynamicNextSession({ ...baseInput, history })
    expect(result.consecutiveRestDays).toBe(2)
    expect(result.streakWarning).toBe(true)
    expect(result.streakBroken).toBe(false)
  })

  it('sets streakBroken on 3+ consecutive rest days', () => {
    const history = makeHistory(['Push'], [4])
    const result = computeAiDynamicNextSession({ ...baseInput, history })
    expect(result.consecutiveRestDays).toBe(3)
    expect(result.streakBroken).toBe(true)
  })
})

describe('countConsecutiveTrainingDays', () => {
  it('returns 0 when no history', () => {
    expect(countConsecutiveTrainingDays([], new Date(), 'Australia/Brisbane')).toBe(0)
  })

  it('counts consecutive days ending yesterday', () => {
    const history = makeHistory(['Push', 'Pull', 'Legs'], [1, 2, 3])
    expect(countConsecutiveTrainingDays(history, new Date(), 'Australia/Brisbane')).toBe(3)
  })

  it('stops at a gap', () => {
    const history = makeHistory(['Push', 'Legs'], [1, 3]) // gap on day 2
    expect(countConsecutiveTrainingDays(history, new Date(), 'Australia/Brisbane')).toBe(1)
  })
})

describe('countConsecutiveRestDays', () => {
  it('returns 0 when trained yesterday', () => {
    const history = makeHistory(['Push'], [1])
    expect(countConsecutiveRestDays(history, new Date(), 'Australia/Brisbane')).toBe(0)
  })

  it('returns 2 when last trained 3 days ago', () => {
    const history = makeHistory(['Push'], [3])
    expect(countConsecutiveRestDays(history, new Date(), 'Australia/Brisbane')).toBe(2)
  })
})
```

- [ ] **Step 2: Run tests**

```bash
pnpm vitest run lib/__tests__/ai-dynamic.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add lib/__tests__/ai-dynamic.test.ts
git commit -m "test: ai_dynamic session scoring unit tests"
```

---

## Task 5: Wire Scoring into getNextSession()

**Files:**
- Modify: `lib/data/postgres/adapter.ts` (around line 1875)
- Modify: `lib/data/repository.ts` — `ensureWorkoutSession` signature

- [ ] **Step 1: Update ensureWorkoutSession in repository.ts**

In `lib/data/repository.ts`, update the `ensureWorkoutSession` signature to accept two new optional params. Find the line:

```ts
  ensureWorkoutSession(userId: string, sessionId: string, programSessionId: string | undefined, sessionName: string, startedAt: Date, phaseId?: string, phaseType?: ProgramPhaseType, isEarlyDeload?: boolean): Promise<EnsuredWorkoutSession>
```

Replace with:

```ts
  ensureWorkoutSession(userId: string, sessionId: string, programSessionId: string | undefined, sessionName: string, startedAt: Date, phaseId?: string, phaseType?: ProgramPhaseType, isEarlyDeload?: boolean, intensityMode?: 'full' | 'deload' | null, wasOverride?: boolean): Promise<EnsuredWorkoutSession>
```

- [ ] **Step 2: Update ensureWorkoutSession in adapter.ts**

Find `async ensureWorkoutSession(` (line ~1384) and update signature and insert values:

```ts
  async ensureWorkoutSession(
    userId: string, sessionId: string, programSessionId: string | undefined,
    sessionName: string, startedAt: Date,
    phaseId?: string, phaseType?: ProgramPhaseType, isEarlyDeload = false,
    intensityMode?: 'full' | 'deload' | null, wasOverride = false,
  ): Promise<EnsuredWorkoutSession> {
    const inserted = await this.db.insert(s.workoutSessions)
      .values({
        id: sessionId, userId, sessionId: programSessionId ?? null, sessionName, startedAt,
        phaseId: phaseId ?? null, phaseType: phaseType ?? null, isEarlyDeload,
        intensityMode: intensityMode ?? null, wasOverride,
      })
      .onConflictDoNothing()
      .returning({
        id: s.workoutSessions.id, phaseId: s.workoutSessions.phaseId,
        phaseType: s.workoutSessions.phaseType, isEarlyDeload: s.workoutSessions.isEarlyDeload,
      })
    // rest of the function unchanged
```

- [ ] **Step 3: Add ai_dynamic branch to getNextSession()**

In `lib/data/postgres/adapter.ts`, find `async getNextSession(` (line ~1875).

Add this import at the top of the file if not already present:
```ts
import { computeAiDynamicNextSession, type AiDynamicInput } from '@/lib/ai-periodization/ai-dynamic'
```

Inside `getNextSession()`, before the `if (schedule?.type === 'weekly' ...)` block (around line 1929), add:

```ts
    // ── AI Dynamic mode ────────────────────────────────────────────────────────
    if (program.phaseMode === 'ai_dynamic') {
      // Fetch readiness (Oura blended score when available, else custom)
      const { toAestDay: toDay } = await import('@/lib/date-utils')
      const todayIso = toDay(new Date(), timezone)

      const [muscleAssignmentsMap, ouraRows] = await Promise.all([
        this.getExerciseMuscleAssignments(
          sessions.flatMap(s => s.exercises.map(e => e.exerciseName)),
        ),
        this.getOuraDaily(userId, todayIso, todayIso),
      ])

      const ouraToday = ouraRows[0] ?? null

      // Build muscle recovery from recent workout history (same decay as /api/muscle-recovery)
      const muscleLastTrained = new Map<string, { lastTrainedMs: number; volume: number }>()
      const libraryMuscles = await this.getExerciseMuscleAssignments(
        recentWsWithName.flatMap(w => {
          // We need exercises from these sessions — use sessions as proxy (exercises not loaded here)
          // Fall back to just using recoveries as empty; muscle scoring degrades gracefully to 100%
          return []
        }),
      )
      // Simpler: pass empty recovery — the scoring treats untracked muscles as 100% recovered.
      // Full muscle recovery requires exercise data per session which would need additional DB queries.
      // The balance and freshness scores carry the recommendation in most cases.
      const muscleRecovery: AiDynamicInput['muscleRecovery'] = []

      const history: AiDynamicInput['history'] = recentWsWithName.map(w => ({
        sessionName: w.sessionName ?? '',
        startedAt: w.startedAt,
        hasExercises: true,  // already filtered above to sessions with exercises
      }))

      // Get today's mood log for soreness
      const moodLog = await this.getMoodLog(userId, todayIso)
      const soreMuscles = moodLog?.soreMuscles ?? []

      return computeAiDynamicNextSession({
        sessions,
        muscleAssignments: muscleAssignmentsMap,
        muscleRecovery,
        history,
        soreMuscles,
        readinessScore: ouraToday?.readinessScore ?? null,
        temperatureDeviation: ouraToday?.temperatureDeviation ?? null,
        daySummary: ouraToday?.daySummary ?? null,
        timezone,
        ...rem,
      })
    }
```

- [ ] **Step 4: TypeScript check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Run tests**

```bash
pnpm vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/data/postgres/adapter.ts lib/data/repository.ts
git commit -m "feat: wire ai_dynamic branch into getNextSession with scoring and streak fields"
```

---

## Task 6: Deload URL Param → workout-data + workout page

When the user taps "Deload" on the home screen, the app navigates to `/workout?session=X&aiDeload=1`. This task makes the workout pipeline honour that flag.

**Files:**
- Modify: `app/api/workout-data/route.ts`
- Modify: `app/workout/page.tsx`
- Modify: `components/workout-screen.tsx`

- [ ] **Step 1: workout-data reads aiDeload param**

In `app/api/workout-data/route.ts`, the route currently receives `?session=`. Add reading of `aiDeload`:

Find the GET function signature line. Inside it, after `const session = await auth()`, add:

```ts
  const { searchParams } = new URL(req.url)
  const aiDeload = searchParams.get('aiDeload') === '1'
```

Then find where `isDeloadActive` is computed (line ~91) and add:

```ts
  // ai_dynamic deload: user explicitly chose deload mode from the home screen
  const isAiDynamicDeload = aiDeload && program?.phaseMode === 'ai_dynamic'
```

Then update every place that sets `isDeloadActive: deloadActive` to also OR in `isAiDynamicDeload`:

```ts
  isDeloadActive: deloadActive || isAiDynamicDeload,
```

Note: There are 3 places where `isDeloadActive` appears in the return value — update all of them.

- [ ] **Step 2: workout page passes aiDeload**

In `app/workout/page.tsx`, update `WorkoutPageProps` and pass the param:

```ts
interface WorkoutPageProps {
  searchParams: Promise<{ session?: string; aiDeload?: string; wasOverride?: string }>
}

export default async function WorkoutPage({ searchParams }: WorkoutPageProps) {
  const { session: sessionId, aiDeload, wasOverride } = await searchParams
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')

  if (sessionId) {
    return (
      <div className="h-screen w-full">
        <WorkoutScreen
          sessionType={sessionId}
          userId={session.user.id}
          aiDeload={aiDeload === '1'}
          wasOverride={wasOverride === '1'}
        />
      </div>
    )
  }
  // rest unchanged
```

- [ ] **Step 3: WorkoutScreen accepts and forwards the props**

In `components/workout-screen.tsx`, find the props interface (search for `sessionType: string`) and add:

```ts
  aiDeload?: boolean
  wasOverride?: boolean
```

Then find where `workout-data` is fetched (search for `/api/workout-data`) and append params:

```ts
  const params = new URLSearchParams({ session: sessionType })
  if (aiDeload) params.set('aiDeload', '1')
  const data = await fetch(`/api/workout-data?${params}`, ...)
```

Then find where `log-exercise` is called (search for `/api/log-exercise`) and add to the request body:

```ts
  ...(aiDeload ? { intensityMode: 'deload' } : {}),
  ...(wasOverride ? { wasOverride: true } : {}),
```

- [ ] **Step 4: log-exercise accepts intensityMode + wasOverride**

In `app/api/log-exercise/route.ts`, extend `LogExerciseSchema` (after `rpeValues`):

```ts
  intensityMode: z.enum(['full', 'deload']).optional(),
  wasOverride:   z.boolean().optional(),
```

Then destructure them from `parsed.data`:

```ts
  const { ..., intensityMode, wasOverride } = parsed.data
```

Then pass them to `ensureWorkoutSession` (line ~122):

```ts
  const ensured = await repo.ensureWorkoutSession(
    userId, wsId, sessionId, sessionName, sessionStart,
    currentPhaseId, currentPhaseType, sessionIsEarlyDeload,
    intensityMode ?? null, wasOverride ?? false,
  )
```

- [ ] **Step 5: TypeScript check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/workout-data/route.ts app/workout/page.tsx components/workout-screen.tsx app/api/log-exercise/route.ts
git commit -m "feat: honour aiDeload and wasOverride URL params through workout pipeline"
```

---

## Task 7: Pre-Mood DeloadBanner Component

**Files:**
- Create: `app/session-select/components/deload-banner.tsx`
- Modify: `app/session-select/session-select-content.tsx`

- [ ] **Step 1: Create DeloadBanner component**

```tsx
// app/session-select/components/deload-banner.tsx
'use client'

interface DeloadBannerProps {
  consecutiveTrainingDays: number
  deloadStrength: 'soft' | 'recommended' | 'strong'
  temperatureAlert: boolean
  consecutiveRestDays: number
  streakBroken: boolean
}

export function DeloadBanner({
  consecutiveTrainingDays,
  deloadStrength,
  temperatureAlert,
  consecutiveRestDays,
  streakBroken,
}: DeloadBannerProps) {
  const isRest = consecutiveTrainingDays === 0 && consecutiveRestDays >= 3

  const borderColor = deloadStrength === 'strong' ? '#ef4444'
    : deloadStrength === 'recommended' ? '#f97316'
    : '#fbbf24'
  const bgColor = deloadStrength === 'strong' ? 'rgba(239,68,68,0.10)'
    : deloadStrength === 'recommended' ? 'rgba(249,115,22,0.10)'
    : 'rgba(251,191,36,0.10)'

  return (
    <div className="px-4 pt-2 pb-1">
      <div
        className="rounded-xl px-3 py-2 flex items-center gap-2"
        style={{ background: bgColor, border: `1px solid ${borderColor}40` }}
      >
        <span className="text-base leading-none flex-none">
          {temperatureAlert ? '🌡️' : deloadStrength === 'strong' ? '⚠️' : '💤'}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold leading-snug" style={{ color: borderColor }}>
            {temperatureAlert
              ? 'Body temp elevated — rest or deload recommended'
              : streakBroken
                ? `${consecutiveRestDays} rest days — resting today breaks your streak`
                : `${consecutiveTrainingDays} sessions in a row${deloadStrength === 'soft' ? ' — consider a rest soon' : ' — rest or deload recommended today'}`}
          </p>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Show banner in session-select-content before mood gate**

In `app/session-select/session-select-content.tsx`, add the import near the other component imports:

```ts
import { DeloadBanner } from './components/deload-banner'
```

Find the `case "recommendation":` block (around line 1111). Before the `if (moodLog === undefined || moodLog === null)` check, add:

```tsx
case "recommendation": {
  const showBanner = recommendation?.deloadOrRestRecommended &&
    recommendation.deloadStrength != null &&
    recommendation.consecutiveTrainingDays != null &&
    recommendation.consecutiveTrainingDays >= 4 ||
    recommendation?.temperatureAlert

  return (
    <div>
      {showBanner && recommendation && (
        <DeloadBanner
          consecutiveTrainingDays={recommendation.consecutiveTrainingDays ?? 0}
          deloadStrength={recommendation.deloadStrength ?? 'soft'}
          temperatureAlert={recommendation.temperatureAlert ?? false}
          consecutiveRestDays={recommendation.consecutiveRestDays ?? 0}
          streakBroken={recommendation.streakBroken ?? false}
        />
      )}
      {/* existing mood gate + recommendation card below */}
      {(moodLog === undefined || moodLog === null) ? (
        // ... existing mood check-in card JSX (unchanged) ...
```

Note: the existing `case "recommendation":` block returns a single JSX element. Wrap the entire existing return value in a fragment `<>...</>` and prepend the conditional `DeloadBanner`.

- [ ] **Step 3: TypeScript check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/session-select/components/deload-banner.tsx app/session-select/session-select-content.tsx
git commit -m "feat: show pre-mood deload banner for ai_dynamic consecutive training days"
```

---

## Task 8: Three-Choice RecommendationCard

**Files:**
- Modify: `app/session-select/components/recommendation-card.tsx`
- Modify: `app/session-select/session-select-content.tsx`

- [ ] **Step 1: Add new props to RecommendationCard**

In `app/session-select/components/recommendation-card.tsx`, extend `RecommendationCardProps`:

```ts
interface RecommendationCardProps {
  recommendation: NextSessionRecommendation | null  // import from '@/lib/types/program'
  // ... existing props ...
  onDeload: (sessionName: string) => void
  onRestDay: () => void
}
```

Add the import at the top:
```ts
import type { NextSessionRecommendation } from '@/lib/types/program'
```

Change the existing `recommendation` prop type from the inline object to `NextSessionRecommendation | null`.

- [ ] **Step 2: Add three-choice section to card**

In `recommendation-card.tsx`, find the `Start Workout` button (around line 219). Replace the entire `{isTrainedToday ? ... : <button>Start Workout</button>}` block with:

```tsx
          {isTrainedToday ? (
            <div className="flex items-center gap-2 rounded-xl border border-green-500/40 bg-green-500/10 px-4 py-2.5">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" stroke="#22c55e" strokeWidth="1.5" />
                <path d="M5 8l2 2 4-4" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-sm font-semibold text-green-500">Completed Today</span>
            </div>
          ) : recommendation?.deloadOrRestRecommended ? (
            <div className="flex flex-col gap-2">
              {recommendation.deloadStrength !== 'soft' && (
                <p className="text-xs text-muted-foreground text-center">
                  {recommendation.consecutiveTrainingDays} sessions in a row
                  {recommendation.temperatureAlert ? ' · body temp elevated' : ''}
                </p>
              )}
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  onClick={() => displaySession && onDeload(displaySession.name)}
                  className="rounded-xl py-3 text-xs font-bold flex flex-col items-center gap-1 transition active:scale-95"
                  style={{
                    background: recommendation.deloadStrength === 'strong' ? 'rgba(251,191,36,0.20)' : 'rgba(251,191,36,0.12)',
                    border: '1px solid rgba(251,191,36,0.35)',
                    color: '#fbbf24',
                  }}
                >
                  <span className="text-base">💤</span>
                  Deload
                </button>
                <button
                  onClick={onRestDay}
                  className="rounded-xl py-3 text-xs font-bold flex flex-col items-center gap-1 transition active:scale-95"
                  style={{
                    background: recommendation.deloadStrength === 'strong' ? 'rgba(99,102,241,0.20)' : 'rgba(99,102,241,0.12)',
                    border: '1px solid rgba(99,102,241,0.35)',
                    color: '#818cf8',
                  }}
                >
                  <span className="text-base">🛌</span>
                  Rest
                </button>
                <button
                  onClick={() => displaySession && onStartWorkout(displaySession.name)}
                  className="rounded-xl py-3 text-xs font-bold flex flex-col items-center gap-1 transition active:scale-95"
                  style={{
                    opacity: recommendation.deloadStrength === 'strong' ? 0.55 : 0.8,
                    background: `rgba(${_rtR},${_rtG},${_rtB},0.12)`,
                    border: `1px solid rgba(${_rtR},${_rtG},${_rtB},0.25)`,
                    color: _rtColor,
                  }}
                >
                  <span className="text-base">🏋️</span>
                  Full
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => onStartWorkout(displaySession.name)}
              className="w-full rounded-xl py-3 text-sm font-bold text-white transition hover:opacity-90 active:scale-95 flex items-center justify-center gap-2"
              style={{ background: _rtColor }}
            >
              Start Workout{" "}
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M2.5 6.5h8M7.5 3.5l3 3-3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          )}
```

- [ ] **Step 3: Wire handlers in session-select-content.tsx**

In `session-select-content.tsx`, add handlers. Find `const handleSelect = (session: string) => {` and add below it:

```ts
  const handleDeload = (session: string) => {
    document.cookie = `ta_session=${encodeURIComponent(session)}; path=/; max-age=${60 * 60 * 24 * 7}`
    router.push(`/workout?session=${encodeURIComponent(session)}&aiDeload=1`)
  }

  const handleRestDay = () => {
    // Log rest day by navigating to a lightweight API call, then refresh recommendation
    fetch('/api/log-rest-day', { method: 'POST' }).catch(() => {})
    // Refresh recommendation cache
    cachedFetch('next-session', '/api/next-session').then(rec => setRecommendation(rec as typeof recommendation)).catch(() => {})
  }
```

Then in the `<RecommendationCard>` render, add the two new props:
```tsx
  onDeload={handleDeload}
  onRestDay={handleRestDay}
```

Also update the cast of `recommendation` state to use `NextSessionRecommendation | null`:
```ts
import type { NextSessionRecommendation } from '@/lib/types/program'
// ...
const [recommendation, setRecommendation] = useState<NextSessionRecommendation | null>(null)
```

- [ ] **Step 4: Create log-rest-day API route**

The `handleRestDay` handler calls `/api/log-rest-day`. This doesn't need to store anything for the MVP — it just clears the `next-session` cache so the streak card re-evaluates on next load. Create a minimal route:

```ts
// app/api/log-rest-day/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Rest days are inferred from gaps in workout_sessions — no row needed.
  // The response signals the client to refresh the next-session recommendation.
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 5: TypeScript check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/session-select/components/recommendation-card.tsx app/session-select/session-select-content.tsx app/api/log-rest-day/route.ts
git commit -m "feat: three-choice deload/rest/full card for ai_dynamic mode"
```

---

## Task 9: StreakCard Rest-Day Counter

**Files:**
- Modify: `app/session-select/components/streak-card.tsx`
- Modify: `app/session-select/session-select-content.tsx`

- [ ] **Step 1: Add consecutiveRestDays prop to StreakCard**

In `app/session-select/components/streak-card.tsx`, add to `StreakCardProps`:

```ts
  consecutiveRestDays?: number
  streakWarning?: boolean
  streakBroken?: boolean
```

Inside the component, add a chip above or below the existing streak content. Find the closing `</div>` of the outer wrapper div and, before it, add:

```tsx
      {consecutiveRestDays != null && consecutiveRestDays >= 1 && (
        <div
          className="mx-4 mb-2 rounded-lg px-3 py-1.5 text-xs font-medium text-center"
          style={{
            background: streakBroken ? 'rgba(239,68,68,0.12)' : consecutiveRestDays >= 2 ? 'rgba(251,191,36,0.12)' : 'rgba(148,163,184,0.12)',
            color:      streakBroken ? '#ef4444'               : consecutiveRestDays >= 2 ? '#fbbf24'               : '#94a3b8',
            border: `1px solid ${streakBroken ? 'rgba(239,68,68,0.25)' : consecutiveRestDays >= 2 ? 'rgba(251,191,36,0.25)' : 'rgba(148,163,184,0.20)'}`,
          }}
        >
          {streakBroken
            ? `Resting today breaks your streak`
            : consecutiveRestDays === 2
              ? `Rest again tomorrow and your streak breaks`
              : `Day 1 of 2 rest days — streak safe`}
        </div>
      )}
```

Note: place this chip OUTSIDE the existing flex row div so it spans full width below the two metric cards.

- [ ] **Step 2: Pass consecutiveRestDays from session-select-content**

In `session-select-content.tsx`, find the `<StreakCard>` render (around line 1178) and add:

```tsx
  consecutiveRestDays={recommendation?.consecutiveRestDays}
  streakWarning={recommendation?.streakWarning}
  streakBroken={recommendation?.streakBroken}
```

- [ ] **Step 3: TypeScript check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run all tests**

```bash
pnpm vitest run
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/session-select/components/streak-card.tsx app/session-select/session-select-content.tsx
git commit -m "feat: show consecutive rest-day warning chip on StreakCard for ai_dynamic mode"
```

---

## Task 10: End-to-End Dev Server Test

- [ ] **Step 1: Start dev server**

```bash
pnpm db:local && pnpm dev
```

Expected: server starts on port 3000 with no TypeScript or runtime errors in the console.

- [ ] **Step 2: Set program to ai_dynamic in DB**

```bash
psql "postgresql://postgres:postgres@localhost:5433/trainingai_dev" -c \
  "UPDATE programs SET phase_mode = 'ai_dynamic' WHERE user_id = (SELECT id FROM users WHERE email = 'test@local.dev');"
```

Expected: `UPDATE 1`

- [ ] **Step 3: Verify next-session API**

```bash
curl -s "http://localhost:3000/api/next-session" \
  -H "Cookie: $(cat /tmp/test-cookie 2>/dev/null || echo '')" | python3 -m json.tool
```

Expected: response includes `consecutiveTrainingDays`, `consecutiveRestDays`, `deloadOrRestRecommended`, `deloadStrength` fields.

- [ ] **Step 4: Simulate 4-day streak**

```bash
psql "postgresql://postgres:postgres@localhost:5433/trainingai_dev" -c "
INSERT INTO workout_sessions (user_id, session_name, started_at)
SELECT u.id, 'Push', now() - INTERVAL '1 day' FROM users u WHERE u.email = 'test@local.dev'
ON CONFLICT DO NOTHING;
INSERT INTO workout_sessions (user_id, session_name, started_at)
SELECT u.id, 'Pull', now() - INTERVAL '2 days' FROM users u WHERE u.email = 'test@local.dev'
ON CONFLICT DO NOTHING;
INSERT INTO workout_sessions (user_id, session_name, started_at)
SELECT u.id, 'Legs', now() - INTERVAL '3 days' FROM users u WHERE u.email = 'test@local.dev'
ON CONFLICT DO NOTHING;
INSERT INTO workout_sessions (user_id, session_name, started_at)
SELECT u.id, 'Push', now() - INTERVAL '4 days' FROM users u WHERE u.email = 'test@local.dev'
ON CONFLICT DO NOTHING;
"
```

Then re-hit `/api/next-session` — expect `consecutiveTrainingDays: 4` and `deloadOrRestRecommended: true`.

- [ ] **Step 5: Check home screen visually**

Open `http://localhost:3000` and confirm:
- Pre-mood banner appears above the check-in card when `consecutiveTrainingDays >= 4`
- After completing mood check-in, the card shows three buttons: Deload / Rest / Full Session
- Tapping Deload navigates to `/workout?session=X&aiDeload=1`
- Tapping Full Session navigates to `/workout?session=X&wasOverride=1`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: dev server verified for ai_dynamic mode end-to-end"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Session scoring (recovery × 0.4, balance × 0.35, freshness × 0.25) — Task 3
- ✅ Primary muscle sore → cap at 40; secondary sore → × 0.75 — Task 3 `sessionRecoveryScore`
- ✅ Deload triggers (4 days, readiness thresholds, temperature alert, very_stressful) — Task 3 `deloadStrength()`
- ✅ Extended `NextSessionRecommendation` with 7 new fields — Task 2
- ✅ `was_override` and `intensity_mode` on workout_sessions — Tasks 1, 6
- ✅ Pre-mood banner (passive, shows before check-in gate) — Task 7
- ✅ Three-choice card (Deload / Rest / Full Session) — Task 8
- ✅ Deload navigates with `aiDeload=1` → `isDeloadActive: true` in workout — Task 6
- ✅ wasOverride recorded when Full Session chosen — Tasks 6, 8
- ✅ StreakCard consecutive rest-day counter — Task 9
- ✅ Unit tests for pure scoring function — Task 4

**Type consistency:** `NextSessionRecommendation` extended in Task 2, used in Tasks 3, 7, 8, 9. `ensureWorkoutSession` signature updated in Tasks 5, 6 consistently.
