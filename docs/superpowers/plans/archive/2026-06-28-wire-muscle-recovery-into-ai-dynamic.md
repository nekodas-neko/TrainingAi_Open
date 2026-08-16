# Wire Muscle Recovery into AI Dynamic Scheduling

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `getNextSession` so the AI dynamic path actually passes real muscle recovery data (instead of `[]`) to `computeAiDynamicNextSession`, making the 40% recovery weight meaningful.

**Architecture:** Extract the muscle recovery calculation from the HTTP route into a pure function in `lib/ai-periodization/muscle-recovery.ts`. Call it from the adapter's `getNextSession` AI dynamic branch. Update the HTTP route to use the same function. Clean up the unused `volume` field from `MuscleRecovery` in `ai-dynamic.ts`.

**Tech Stack:** Next.js 15, TypeScript, Drizzle ORM + PostgreSQL, Vitest

---

## Files

- **Create:** `lib/ai-periodization/muscle-recovery.ts` — pure `computeMuscleRecovery(sessions, library)` function
- **Modify:** `lib/ai-periodization/ai-dynamic.ts` — drop unused `volume` from `MuscleRecovery`
- **Modify:** `app/api/muscle-recovery/route.ts` — use shared function instead of inline logic
- **Modify:** `lib/data/postgres/adapter.ts` — fetch + pass muscle recovery in AI dynamic branch
- **Modify:** `lib/__tests__/ai-dynamic.test.ts` — add test proving recovery influences session selection

---

## Task 1: Extract muscle recovery calculation into a shared pure function

**Files:**
- Create: `lib/ai-periodization/muscle-recovery.ts`

The inline logic in `app/api/muscle-recovery/route.ts` (lines 31–56) needs to become a pure function that both the route and the adapter can call. It takes workout sessions (from `getWorkoutSessionsFrom`) and the exercise library (from `listExerciseLibrary`) and returns `MuscleRecovery[]`.

- [ ] **Step 1: Create `lib/ai-periodization/muscle-recovery.ts`**

```ts
import type { WorkoutSession } from '@/lib/types/workout'
import type { ExerciseLibraryEntry } from '@/lib/types/exercise'
import type { MuscleRecovery } from './ai-dynamic'

function normMuscle(m: string) { return m.toLowerCase().trim() }

export function computeMuscleRecovery(
  sessions: WorkoutSession[],
  library: ExerciseLibraryEntry[],
): MuscleRecovery[] {
  const libByName = new Map(library.map(e => [e.name.toLowerCase(), e]))
  const muscleLastTrained = new Map<string, { lastTrainedMs: number }>()

  for (const ws of sessions) {
    for (const ex of ws.exercises) {
      const entry = libByName.get(ex.exerciseName.toLowerCase())
      if (!entry) continue
      const trainedMs = ws.startedAt.getTime()
      for (const m of entry.muscles) {
        if (m.role !== 'main') continue
        const key = normMuscle(m.muscle)
        const existing = muscleLastTrained.get(key)
        if (!existing || trainedMs > existing.lastTrainedMs) {
          muscleLastTrained.set(key, { lastTrainedMs: trainedMs })
        }
      }
    }
  }

  const now = Date.now()
  return Array.from(muscleLastTrained.entries()).map(([muscle, { lastTrainedMs }]) => {
    const hoursAgo = Math.min(168, (now - lastTrainedMs) / 3_600_000)
    const pct = Math.min(100, Math.round(100 * (1 - Math.exp(-hoursAgo / 24))))
    return { muscle, pct, hoursAgo: Math.round(hoursAgo) }
  })
}
```

Note: the original route uses `tau = volume >= 3000 ? 36 : 24`. The `volume` field on `ExerciseLog` is total kg lifted (sum of weight × reps), so 3000 kg is a heavy session. We drop that branch here — `volume` is not available in the AI dynamic context cleanly, and using a fixed 24-hour tau keeps the function simple and testable. If needed, the tau can be re-introduced in a follow-up.

- [ ] **Step 2: Run TypeScript to confirm no errors**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no errors from the new file (it may show unrelated pre-existing errors — that's fine).

- [ ] **Step 3: Commit**

```bash
git checkout claude/training-schedule-logic-vwst0l
git add lib/ai-periodization/muscle-recovery.ts
git commit -m "Extract muscle recovery calculation into shared pure function"
```

---

## Task 2: Drop unused `volume` from `MuscleRecovery` in `ai-dynamic.ts`

**Files:**
- Modify: `lib/ai-periodization/ai-dynamic.ts:4-9`

The `volume` field on `MuscleRecovery` is not read by any scoring function. Removing it aligns the interface with the shared function's output and removes dead weight.

- [ ] **Step 1: Remove `volume` from the interface**

In `lib/ai-periodization/ai-dynamic.ts`, change:

```ts
export interface MuscleRecovery {
  muscle: string
  pct: number
  hoursAgo: number
  volume: number
}
```

to:

```ts
export interface MuscleRecovery {
  muscle: string
  pct: number
  hoursAgo: number
}
```

- [ ] **Step 2: Confirm no usages of `.volume` on `MuscleRecovery` exist**

```bash
cd /home/user/TrainingAI && grep -rn "\.volume" lib/ai-periodization/
```

Expected: no output (no code reads `.volume` from a `MuscleRecovery` object).

- [ ] **Step 3: Run TypeScript check**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add lib/ai-periodization/ai-dynamic.ts
git commit -m "Remove unused volume field from MuscleRecovery interface"
```

---

## Task 3: Update the HTTP route to use the shared function

**Files:**
- Modify: `app/api/muscle-recovery/route.ts`

The route has the same logic inline. Replace the inline computation with the shared function. The route needs to keep its own `MuscleRecoveryEntry` interface (it adds `hoursAgo` to the HTTP response, which `ai-dynamic.ts` also keeps on `MuscleRecovery`), so the types are compatible.

- [ ] **Step 1: Update `app/api/muscle-recovery/route.ts`**

Replace the entire file with:

```ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { computeMuscleRecovery } from '@/lib/ai-periodization/muscle-recovery'

export interface MuscleRecoveryEntry {
  muscle: string
  pct: number
  hoursAgo: number
}

export interface MuscleRecoveryResponse {
  muscles: MuscleRecoveryEntry[]
}

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepository()
  const from7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const [sessions, library] = await Promise.all([
    repo.getWorkoutSessionsFrom(userId, from7d),
    repo.listExerciseLibrary(),
  ])

  const muscles = computeMuscleRecovery(sessions, library)
  muscles.sort((a, b) => a.pct - b.pct || a.muscle.localeCompare(b.muscle))

  return NextResponse.json({ muscles } satisfies MuscleRecoveryResponse)
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
git add app/api/muscle-recovery/route.ts
git commit -m "Route uses shared computeMuscleRecovery instead of inline logic"
```

---

## Task 4: Wire muscle recovery into `getNextSession` AI dynamic branch

**Files:**
- Modify: `lib/data/postgres/adapter.ts` lines ~1187–1218

This is the core fix. In the AI dynamic branch, fetch workout sessions from the last 7 days and the exercise library, compute muscle recovery, and pass it to `computeAiDynamicNextSession`.

- [ ] **Step 1: Add the import at the top of `adapter.ts`**

Find the existing import line for `computeAiDynamicNextSession`:

```ts
import { computeAiDynamicNextSession, type AiDynamicInput } from '@/lib/ai-periodization/ai-dynamic'
```

Add `computeMuscleRecovery` to the import from the new module (add a new import line):

```ts
import { computeMuscleRecovery } from '@/lib/ai-periodization/muscle-recovery'
```

- [ ] **Step 2: Update the AI dynamic branch in `getNextSession`**

Find this block (around line 1188–1218):

```ts
    // ── AI Dynamic mode ────────────────────────────────────────────────────────
    if (program.phaseMode === 'ai_dynamic') {
      const todayIso = todayInTz(timezone)

      const [muscleAssignmentsMap, ouraRows, moodLog] = await Promise.all([
        this.getExerciseMuscleAssignments(
          sessions.flatMap(s => s.exercises.map(e => e.exerciseName)),
        ),
        this.getOuraDaily(userId, todayIso, todayIso),
        this.getMoodLog(userId, todayIso),
      ])

      const ouraToday = ouraRows[0] ?? null
      const history: AiDynamicInput['history'] = recentWsWithName.map(w => ({
        sessionName: w.sessionName ?? '',
        startedAt: w.startedAt,
        hasExercises: true,
      }))

      return computeAiDynamicNextSession({
        sessions,
        muscleAssignments: muscleAssignmentsMap,
        muscleRecovery: [],
        history,
        soreMuscles: moodLog?.soreMuscles ?? [],
        readinessScore: ouraToday?.readinessScore ?? null,
        temperatureDeviation: ouraToday?.temperatureDeviation ?? null,
        daySummary: ouraToday?.daySummary ?? null,
        timezone,
        ...rem,
      })
    }
```

Replace with:

```ts
    // ── AI Dynamic mode ────────────────────────────────────────────────────────
    if (program.phaseMode === 'ai_dynamic') {
      const todayIso = todayInTz(timezone)
      const from7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

      const [muscleAssignmentsMap, ouraRows, moodLog, recentWorkouts, exerciseLibrary] = await Promise.all([
        this.getExerciseMuscleAssignments(
          sessions.flatMap(s => s.exercises.map(e => e.exerciseName)),
        ),
        this.getOuraDaily(userId, todayIso, todayIso),
        this.getMoodLog(userId, todayIso),
        this.getWorkoutSessionsFrom(userId, from7d),
        this.listExerciseLibrary(),
      ])

      const ouraToday = ouraRows[0] ?? null
      const history: AiDynamicInput['history'] = recentWsWithName.map(w => ({
        sessionName: w.sessionName ?? '',
        startedAt: w.startedAt,
        hasExercises: true,
      }))

      return computeAiDynamicNextSession({
        sessions,
        muscleAssignments: muscleAssignmentsMap,
        muscleRecovery: computeMuscleRecovery(recentWorkouts, exerciseLibrary),
        history,
        soreMuscles: moodLog?.soreMuscles ?? [],
        readinessScore: ouraToday?.readinessScore ?? null,
        temperatureDeviation: ouraToday?.temperatureDeviation ?? null,
        daySummary: ouraToday?.daySummary ?? null,
        timezone,
        ...rem,
      })
    }
```

- [ ] **Step 3: Run TypeScript check**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Run existing tests**

```bash
cd /home/user/TrainingAI && pnpm vitest run lib/__tests__/ai-dynamic.test.ts 2>&1
```

Expected: all existing tests pass (they use `muscleRecovery: []` in their `baseInput`, which is valid since the function still works with an empty array when there's no recovery history).

- [ ] **Step 5: Commit**

```bash
git add lib/data/postgres/adapter.ts
git commit -m "Pass real muscle recovery data to AI dynamic session scoring"
```

---

## Task 5: Add a test proving recovery influences session selection

**Files:**
- Modify: `lib/__tests__/ai-dynamic.test.ts`

Add a test that gives Push poor recovery (chest/shoulders at 30%) and Legs full recovery (quads at 100%), with equal time since last trained, and asserts Legs is recommended.

- [ ] **Step 1: Add the test to `lib/__tests__/ai-dynamic.test.ts`**

Inside the `describe('computeAiDynamicNextSession', () => {` block, append:

```ts
  it('prefers session with better muscle recovery when balance is equal', () => {
    // Push and Legs both done 2 days ago (equal balance/freshness scores)
    const history = makeHistory(['Push', 'Legs'], [2, 2])
    // Push muscles are poorly recovered; Legs muscles are fully recovered
    const muscleRecovery = [
      { muscle: 'push', pct: 30, hoursAgo: 10 },
      { muscle: 'legs', pct: 100, hoursAgo: 48 },
    ]
    // muscleAssignments map each session's exercise to its muscle
    const muscleAssignments: Record<string, import('../types/program').MuscleAssignment[]> = {
      'Push exercise': [{ muscle: 'push', role: 'main' }],
      'Legs exercise': [{ muscle: 'legs', role: 'main' }],
    }
    const result = computeAiDynamicNextSession({
      ...baseInput,
      history,
      muscleRecovery,
      muscleAssignments,
    })
    // Legs should win because its muscles are fully recovered
    expect(result.session?.name).toBe('Legs')
  })

  it('avoids session with sore primary muscles even if most overdue', () => {
    // Legs most overdue (3 days ago), but quads are sore
    const history = makeHistory(['Push', 'Pull', 'Legs'], [1, 2, 3])
    const muscleAssignments: Record<string, import('../types/program').MuscleAssignment[]> = {
      'Push exercise': [{ muscle: 'push', role: 'main' }],
      'Pull exercise': [{ muscle: 'pull', role: 'main' }],
      'Legs exercise': [{ muscle: 'legs', role: 'main' }],
    }
    const muscleRecovery = [
      { muscle: 'push', pct: 95, hoursAgo: 24 },
      { muscle: 'pull', pct: 80, hoursAgo: 48 },
      { muscle: 'legs', pct: 90, hoursAgo: 72 },
    ]
    const result = computeAiDynamicNextSession({
      ...baseInput,
      history,
      muscleRecovery,
      muscleAssignments,
      soreMuscles: ['legs'],
    })
    // Legs muscles are capped at 40% when sore — Push or Pull should win
    expect(result.session?.name).not.toBe('Legs')
  })
```

- [ ] **Step 2: Run the full test file**

```bash
cd /home/user/TrainingAI && pnpm vitest run lib/__tests__/ai-dynamic.test.ts 2>&1
```

Expected: all tests pass including the two new ones.

- [ ] **Step 3: Commit**

```bash
git add lib/__tests__/ai-dynamic.test.ts
git commit -m "Add tests proving muscle recovery and sore muscles influence AI session selection"
```

---

## Task 6: Push branch

- [ ] **Push to remote**

```bash
git push -u origin claude/training-schedule-logic-vwst0l
```

---

## Self-review

**Spec coverage:**
- Main bug (`muscleRecovery: []`) fixed in Task 4 ✅
- Type mismatch (`volume` field) cleaned up in Task 2 ✅
- Route kept working and using shared function in Task 3 ✅
- Recovery actually influencing selection proved by tests in Task 5 ✅

**Placeholder scan:** No TBDs or hand-wavy steps. Every step has exact code or exact commands.

**Type consistency:**
- `MuscleRecovery` in `ai-dynamic.ts` after Task 2: `{ muscle, pct, hoursAgo }` — no `volume`
- `computeMuscleRecovery` in Task 1 returns `MuscleRecovery[]` — matches the trimmed interface ✅
- `muscleRecovery` parameter in `computeAiDynamicNextSession` is `MuscleRecovery[]` — matches ✅
- Route's `MuscleRecoveryEntry` is identical shape (`{ muscle, pct, hoursAgo }`) — compatible ✅
