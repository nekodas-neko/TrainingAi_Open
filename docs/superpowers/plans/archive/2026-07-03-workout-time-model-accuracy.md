# Workout Time-Model Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every session-duration estimate (program generation, builder chat, AI periodization time budget) equipment-aware and sourced from one shared model, start capturing the one missing timing datapoint (warmup end), and ship an admin time-audit that decomposes real session history so the constants can later be replaced by measured per-exercise data.

**Architecture:** One new pure module `lib/workout/duration-model.ts` becomes the single source of truth for the duration formula and its constants ("One Formula, One Place" — today the formula exists in three diverged copies: `time-budget.ts` uses 120s/exercise overhead, `generate-program` uses 90s, `builder-chat` hardcodes derived magic numbers). Transition overhead becomes equipment-driven from `exercise_library.equipment` (barbell 240s, machine/dumbbell/cable/kettlebell 120s, bodyweight 60s, unknown = worst case 240s) — deliberately generous until measured data replaces it. A new `warmup_ended_at` column on `workout_sessions` (migration 108) splits actual warmup from first-exercise setup; the field rides the existing `log-exercise` payload, so the web route and the outbox `pushMutations` path (which both call the shared `logExerciseFromPayload`) stay mirrored with zero extra sync code. A pure `lib/workout/time-audit.ts` computes robust (median/outlier-filtered) per-exercise, per-equipment, and per-session-decomposition stats, exposed via an admin-gated route + admin card. **Out of scope (follow-up plan, after the audit is reviewed against prod data):** feeding measured averages/rest-adherence back into estimates and prescriptions.

**Tech Stack:** Next.js 15 API routes, Drizzle ORM, Zustand store, vitest.

**Key decisions locked during design:**
- Transition constants: barbell **240s**, machine/dumbbell/cable/kettlebell **120s**, bodyweight-only **60s**, empty/unknown equipment **240s** (generous worst case). An equipment array is a list of *options*, so worst case wins: any array containing `'barbell'` → 240.
- `SESSION_WARMUP_MIN = 10` stays a constant for now (measured warmup feeds in later via the audit).
- Set-work formula stays `10 + reps × 4` seconds as the cold-start default (Phase 2 replaces it with measured sec/rep).
- Outlier rule for measured stats: a value outside `[median × 0.25, median × 4]` is excluded and counted (catches the "timer left running → 6-min set" case without hiding it).
- Plate-count-aware transitions: deliberately **not** modelled — measured per-exercise data absorbs it.
- Audit stats are derived at read time, never stored (Stored Counters rule).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/workout/duration-model.ts` | Create | All duration constants + formula (single source) |
| `lib/__tests__/duration-model.test.ts` | Create | Unit tests for the model |
| `lib/workout/known-styles.ts` | Create | `KNOWN_STYLES` + `GOAL_STYLE_RULES` moved out of the two routes that duplicate them |
| `lib/ai-periodization/time-budget.ts` | Modify | Re-export shared model; `TimedExercise` gains `transitionSec`; trimming logic unchanged |
| `lib/__tests__/time-budget.test.ts` | Modify | Update for `transitionSec` |
| `lib/data/repository.ts` | Modify | Add `getExerciseEquipment`, `setWorkoutSessionWarmupEnd`, `getTimingAuditData` |
| `lib/data/postgres/adapter.ts` | Modify | Implement the three new repo methods |
| `lib/ai-periodization/signals.ts` | Modify | Per-exercise `equipment` + `transitionSec` signal |
| `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts` | Modify | Thread `transitionSec` into both `fitToBudget`/estimate paths |
| `lib/ai-periodization/prompt.ts` | Modify | Formula text rendered from constants; per-exercise `transition_sec` in prompt |
| `app/api/generate-program/route.ts` | Modify | Equipment-aware overhead in style menu + exercise-count calc |
| `app/api/builder-chat/route.ts` | Modify | Magic per-goal seconds replaced with computed values |
| `lib/data/postgres/migrations/108_warmup_ended_at.sql` | Create | `warmup_ended_at` column |
| `lib/data/postgres/schema.ts` | Modify | Mirror the column |
| `lib/stores/workout-store.ts` | Modify | `warmupEndedMs` transient-per-workout field |
| `components/workout-screen.tsx` | Modify | Stamp warmup end; include in log payload |
| `lib/workout/log-exercise.ts` | Modify | Accept + persist `warmupEndedAtMs` |
| `lib/workout/time-audit.ts` | Create | Pure robust-stats + session decomposition |
| `lib/__tests__/time-audit.test.ts` | Create | Unit tests incl. outlier scenario |
| `app/api/admin/time-audit/route.ts` | Create | Admin-gated JSON audit |
| `components/admin/time-audit-card.tsx` | Create | Admin UI tables |
| `app/admin/admin-content.tsx` | Modify | Mount the card |
| `package.json` + `lib/changelog.ts` | Modify | Version bump + entry |

Migration number **108** claimed: directory ends at `104`; plan docs reserve 105 (batch E, unused), 106 (batch F), 107 (batch I supersets). If 108 is taken by the time this executes, renumber to the next free and update every reference here.

---

### Task 1: Shared duration model

**Files:**
- Create: `lib/workout/duration-model.ts`
- Test: `lib/__tests__/duration-model.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/duration-model.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  SECONDS_PER_REP, SET_SETUP_SEC, SESSION_WARMUP_MIN,
  TRANSITION_SEC_BARBELL, TRANSITION_SEC_STANDARD, TRANSITION_SEC_BODYWEIGHT, TRANSITION_SEC_DEFAULT,
  transitionSecForEquipment, setWorkSec, styleWorkSec,
  estimateExerciseDurationSec, estimateSessionDurationSec, estimateSessionDurationMin,
} from '@/lib/workout/duration-model'

describe('transitionSecForEquipment', () => {
  it('barbell anywhere in the options list wins (worst case)', () => {
    expect(transitionSecForEquipment(['barbell'])).toBe(TRANSITION_SEC_BARBELL)
    expect(transitionSecForEquipment(['dumbbell', 'barbell'])).toBe(TRANSITION_SEC_BARBELL)
    expect(transitionSecForEquipment(['machine', 'barbell', 'dumbbell', 'kettlebell'])).toBe(TRANSITION_SEC_BARBELL)
  })

  it('machine/dumbbell/cable/kettlebell class is standard', () => {
    expect(transitionSecForEquipment(['machine'])).toBe(TRANSITION_SEC_STANDARD)
    expect(transitionSecForEquipment(['dumbbell', 'cable'])).toBe(TRANSITION_SEC_STANDARD)
    expect(transitionSecForEquipment(['kettlebell'])).toBe(TRANSITION_SEC_STANDARD)
  })

  it('pure bodyweight is cheapest', () => {
    expect(transitionSecForEquipment(['bodyweight'])).toBe(TRANSITION_SEC_BODYWEIGHT)
  })

  it('bodyweight mixed with equipment uses the equipment class', () => {
    expect(transitionSecForEquipment(['bodyweight', 'machine'])).toBe(TRANSITION_SEC_STANDARD)
  })

  it('unknown/empty equipment assumes the worst case', () => {
    expect(transitionSecForEquipment([])).toBe(TRANSITION_SEC_DEFAULT)
    expect(transitionSecForEquipment(undefined)).toBe(TRANSITION_SEC_DEFAULT)
    expect(TRANSITION_SEC_DEFAULT).toBe(TRANSITION_SEC_BARBELL)
  })
})

describe('duration formula', () => {
  it('setWorkSec = setup + reps × tempo', () => {
    expect(setWorkSec(5)).toBe(SET_SETUP_SEC + 5 * SECONDS_PER_REP)
  })

  it('exercise duration = sets×setWork + (sets−1)×rest + transition', () => {
    const ex = { sets: 3, reps: 5, restSec: 120, transitionSec: 240 }
    expect(estimateExerciseDurationSec(ex)).toBe(3 * setWorkSec(5) + 2 * 120 + 240)
  })

  it('a single set has no rest interval', () => {
    expect(estimateExerciseDurationSec({ sets: 1, reps: 5, restSec: 180, transitionSec: 120 }))
      .toBe(setWorkSec(5) + 120)
  })

  it('a barbell exercise costs 2 minutes more than the same machine exercise', () => {
    const shape = { sets: 4, reps: 8, restSec: 90 }
    const barbell = estimateExerciseDurationSec({ ...shape, transitionSec: TRANSITION_SEC_BARBELL })
    const machine = estimateExerciseDurationSec({ ...shape, transitionSec: TRANSITION_SEC_STANDARD })
    expect(barbell - machine).toBe(120)
  })

  it('session duration sums exercises and rounds to minutes', () => {
    const exs = [
      { sets: 2, reps: 6, restSec: 90, transitionSec: 240 },
      { sets: 3, reps: 8, restSec: 60, transitionSec: 120 },
    ]
    expect(estimateSessionDurationSec(exs))
      .toBe(estimateExerciseDurationSec(exs[0]) + estimateExerciseDurationSec(exs[1]))
    expect(estimateSessionDurationMin(exs)).toBe(Math.round(estimateSessionDurationSec(exs) / 60))
  })

  it('styleWorkSec sums per-set work + rest with no transition', () => {
    const sets = [{ reps: 5, restSec: 120 }, { reps: 5, restSec: 120 }]
    expect(styleWorkSec(sets)).toBe(2 * setWorkSec(5) + 2 * 120)
  })

  it('warmup constant is exported for budget callers', () => {
    expect(SESSION_WARMUP_MIN).toBe(10)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/__tests__/duration-model.test.ts`
Expected: FAIL — cannot resolve `@/lib/workout/duration-model`

- [ ] **Step 3: Write the implementation**

Create `lib/workout/duration-model.ts`:

```ts
// Single source of truth for session-duration estimation ("One Formula, One Place").
// Consumers: lib/ai-periodization/time-budget.ts (budget enforcement),
// lib/ai-periodization/prompt.ts (formula text shown to the AI),
// app/api/generate-program + app/api/builder-chat (program planning).
//
// Constants are deliberately generous (worst case): overestimating duration
// under-fills a session rather than overrunning the user's time budget.
// A follow-up plan replaces them with measured per-exercise medians once the
// time-audit (lib/workout/time-audit.ts) has validated the real distributions.

export const SECONDS_PER_REP = 4
export const SET_SETUP_SEC = 10
export const SESSION_WARMUP_MIN = 10

// Per-exercise transition overhead: walking over, adjusting the station, loading the bar.
export const TRANSITION_SEC_BARBELL = 240
export const TRANSITION_SEC_STANDARD = 120 // machine, dumbbell, cable, kettlebell
export const TRANSITION_SEC_BODYWEIGHT = 60
export const TRANSITION_SEC_DEFAULT = TRANSITION_SEC_BARBELL // unknown equipment: assume worst case

// equipment lists the *options* an exercise can be performed with, so the
// slowest option governs the estimate.
export function transitionSecForEquipment(equipment: string[] | undefined): number {
  if (!equipment || equipment.length === 0) return TRANSITION_SEC_DEFAULT
  if (equipment.includes('barbell')) return TRANSITION_SEC_BARBELL
  if (equipment.every(e => e === 'bodyweight')) return TRANSITION_SEC_BODYWEIGHT
  return TRANSITION_SEC_STANDARD
}

export function setWorkSec(reps: number): number {
  return SET_SETUP_SEC + reps * SECONDS_PER_REP
}

export interface DurationExercise {
  sets: number
  reps: number
  restSec: number
  transitionSec: number
}

export function estimateExerciseDurationSec(ex: DurationExercise): number {
  return ex.sets * setWorkSec(ex.reps) + Math.max(0, ex.sets - 1) * ex.restSec + ex.transitionSec
}

export function estimateSessionDurationSec(exercises: DurationExercise[]): number {
  return exercises.reduce((total, ex) => total + estimateExerciseDurationSec(ex), 0)
}

export function estimateSessionDurationMin(exercises: DurationExercise[]): number {
  return Math.round(estimateSessionDurationSec(exercises) / 60)
}

// Work + rest seconds for a progression-style set shape. No transition overhead —
// callers add transitionSecForEquipment (or a blended planning assumption).
export function styleWorkSec(sets: Array<{ reps: number; restSec: number }>): number {
  return sets.reduce((total, set) => total + setWorkSec(set.reps) + set.restSec, 0)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/__tests__/duration-model.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add lib/workout/duration-model.ts lib/__tests__/duration-model.test.ts
git commit -m "feat: shared equipment-aware duration model for session estimates"
```

---

### Task 2: Periodization time budget uses the shared model

**Files:**
- Modify: `lib/ai-periodization/time-budget.ts`
- Modify: `lib/__tests__/time-budget.test.ts`

- [ ] **Step 1: Update the test for `transitionSec`**

Rewrite `lib/__tests__/time-budget.test.ts` — the `mk` helper and formula assertions change; trimming tests keep their semantics:

```ts
import { describe, it, expect } from 'vitest'
import {
  setWorkSec, estimateExerciseDurationSec, estimateSessionDurationSec,
  estimateSessionDurationMin, fitToBudget, SECONDS_PER_REP, SET_SETUP_SEC,
  type TimedExercise,
} from '@/lib/ai-periodization/time-budget'
import { TRANSITION_SEC_BARBELL, TRANSITION_SEC_STANDARD } from '@/lib/workout/duration-model'

describe('duration model', () => {
  it('per-set work time grows with reps', () => {
    expect(setWorkSec(3)).toBe(SET_SETUP_SEC + 3 * SECONDS_PER_REP)
    expect(setWorkSec(12)).toBeGreaterThan(setWorkSec(3))
  })

  it('exercise duration = sets*setWork + (sets-1)*rest + transition', () => {
    const ex = { sets: 3, reps: 5, restSec: 120, transitionSec: TRANSITION_SEC_BARBELL }
    const expected = 3 * setWorkSec(5) + 2 * 120 + TRANSITION_SEC_BARBELL
    expect(estimateExerciseDurationSec(ex)).toBe(expected)
  })

  it('a single set has no rest interval', () => {
    expect(estimateExerciseDurationSec({ sets: 1, reps: 5, restSec: 180, transitionSec: TRANSITION_SEC_STANDARD }))
      .toBe(setWorkSec(5) + TRANSITION_SEC_STANDARD)
  })

  it('session duration sums exercises', () => {
    const exs = [
      { sets: 2, reps: 6, restSec: 90, transitionSec: TRANSITION_SEC_BARBELL },
      { sets: 3, reps: 8, restSec: 60, transitionSec: TRANSITION_SEC_STANDARD },
    ]
    expect(estimateSessionDurationSec(exs))
      .toBe(estimateExerciseDurationSec(exs[0]) + estimateExerciseDurationSec(exs[1]))
  })
})

describe('fitToBudget', () => {
  const mk = (id: string, role: string, sets: number, reps: number, restSec: number, transitionSec = 120): TimedExercise =>
    ({ sessionExerciseId: id, role, sets, reps, restSec, transitionSec })

  it('leaves an already-fitting session untouched', () => {
    const exs = [mk('a', 'primary', 3, 5, 120)]
    expect(fitToBudget(exs, 60)).toEqual(exs)
  })

  it('does not mutate the input', () => {
    const exs = [mk('a', 'accessory', 5, 12, 90)]
    const before = JSON.parse(JSON.stringify(exs))
    fitToBudget(exs, 10)
    expect(exs).toEqual(before)
  })

  it('trims accessories before compounds', () => {
    const exs = [
      mk('main', 'primary', 5, 5, 180),
      mk('acc', 'accessory', 5, 12, 90),
    ]
    const out = fitToBudget(exs, 25)
    const acc = out.find(e => e.sessionExerciseId === 'acc')!
    const main = out.find(e => e.sessionExerciseId === 'main')!
    expect(acc.sets).toBeLessThan(5)
    expect(main.sets).toBe(5)
  })

  it('a barbell-heavy session trims more sets than a machine session for the same budget', () => {
    const budget = 30
    const machine = fitToBudget([
      mk('a', 'primary', 5, 5, 150, TRANSITION_SEC_STANDARD),
      mk('b', 'accessory', 5, 12, 90, TRANSITION_SEC_STANDARD),
    ], budget)
    const barbell = fitToBudget([
      mk('a', 'primary', 5, 5, 150, TRANSITION_SEC_BARBELL),
      mk('b', 'accessory', 5, 12, 90, TRANSITION_SEC_BARBELL),
    ], budget)
    const totalSets = (out: TimedExercise[]) => out.reduce((n, e) => n + e.sets, 0)
    expect(totalSets(barbell)).toBeLessThan(totalSets(machine))
  })

  it('brings an over-budget session within budget when possible', () => {
    const exs = [
      mk('a', 'primary', 5, 5, 180),
      mk('b', 'secondary', 5, 8, 120),
      mk('c', 'accessory', 5, 12, 90),
    ]
    const budget = 35
    const out = fitToBudget(exs, budget)
    expect(estimateSessionDurationMin(out)).toBeLessThanOrEqual(budget)
  })

  it('never drops an exercise entirely, even on an impossible budget', () => {
    const exs = [
      mk('a', 'primary', 5, 5, 240),
      mk('b', 'accessory', 5, 12, 120),
    ]
    const out = fitToBudget(exs, 5)
    expect(out.find(e => e.sessionExerciseId === 'a')!.sets).toBe(2)
    expect(out.find(e => e.sessionExerciseId === 'b')!.sets).toBe(1)
  })

  it('a protected (earned) set is trimmed last — it steals time from other work', () => {
    const exs = [
      mk('main', 'primary', 4, 5, 150),
      mk('other', 'accessory', 4, 12, 90),
      mk('earned', 'accessory', 4, 12, 90),
    ]
    const budget = 30
    const out = fitToBudget(exs, budget, new Set(['earned']))
    const earned = out.find(e => e.sessionExerciseId === 'earned')!
    const other = out.find(e => e.sessionExerciseId === 'other')!
    expect(estimateSessionDurationMin(out)).toBeLessThanOrEqual(budget)
    expect(earned.sets).toBeGreaterThan(other.sets)
  })

  it('still honours the budget guarantee — a protected set is trimmed if nothing else can give', () => {
    const exs = [
      mk('main', 'primary', 2, 5, 240),
      mk('earned', 'accessory', 4, 12, 180),
    ]
    const out = fitToBudget(exs, 5, new Set(['earned']))
    expect(out.find(e => e.sessionExerciseId === 'earned')!.sets).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/__tests__/time-budget.test.ts`
Expected: FAIL — `TimedExercise` has no `transitionSec`; `estimateExerciseDurationSec` arg mismatch

- [ ] **Step 3: Rewrite `lib/ai-periodization/time-budget.ts`**

Replace the header and estimator section (lines 1–38) — delete `SECONDS_PER_REP`/`SET_SETUP_SEC`/`EXERCISE_TRANSITION_SEC` locals and the local estimator bodies, keep `fitToBudget`/`pickTrimTarget`/floors byte-identical apart from the type:

```ts
// Time-budget enforcement for AI periodization prescriptions.
//
// The AI is asked to fit the session into its time budget, but that's a soft request.
// This module estimates the realistic duration (shared model: lib/workout/duration-model.ts)
// and trims sets (accessories first, never dropping an exercise) until the session fits.

import {
  setWorkSec,
  estimateExerciseDurationSec,
  estimateSessionDurationSec,
  estimateSessionDurationMin,
  SECONDS_PER_REP,
  SET_SETUP_SEC,
} from '@/lib/workout/duration-model'

export {
  setWorkSec,
  estimateExerciseDurationSec,
  estimateSessionDurationSec,
  estimateSessionDurationMin,
  SECONDS_PER_REP,
  SET_SETUP_SEC,
}

export interface TimedExercise {
  sessionExerciseId: string
  role: string
  sets: number
  reps: number
  restSec: number
  // Equipment-dependent per-exercise overhead — callers derive it via
  // transitionSecForEquipment(equipment) from the shared duration model.
  transitionSec: number
}
```

Everything from `const SET_FLOOR` down stays unchanged (the trim comparator `setWorkSec(e.reps) + e.restSec` is per-set time and correctly ignores the per-exercise transition).

- [ ] **Step 4: Run tests + typecheck to find every caller that must thread `transitionSec`**

Run: `pnpm vitest run lib/__tests__/time-budget.test.ts && npx tsc --noEmit`
Expected: test PASSES; `tsc` FAILS in `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts` (missing `transitionSec`) — fixed in Task 3. Do **not** commit yet if tsc reports errors elsewhere; fix Task 3 first and commit the two tasks together **only if** needed — otherwise commit now:

```bash
git add lib/ai-periodization/time-budget.ts lib/__tests__/time-budget.test.ts
git commit -m "refactor: time budget consumes shared duration model with per-exercise transitions"
```

(A temporarily red `tsc` between two adjacent commits on a feature branch is acceptable; CI runs on the PR head.)

---

### Task 3: Thread equipment through signals → prescribe → prompt

**Files:**
- Modify: `lib/data/repository.ts:287` (near `getExerciseMuscleAssignments`)
- Modify: `lib/data/postgres/adapter.ts:1753` (next to `getExerciseMuscleAssignments`)
- Modify: `lib/ai-periodization/signals.ts`
- Modify: `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts`
- Modify: `lib/ai-periodization/prompt.ts`

- [ ] **Step 1: Add the repo method**

In `lib/data/repository.ts`, directly after the `getExerciseMuscleAssignments` line:

```ts
  getExerciseEquipment(names: string[]): Promise<Record<string, string[]>>
```

In `lib/data/postgres/adapter.ts`, directly after the `getExerciseMuscleAssignments` implementation:

```ts
  async getExerciseEquipment(names: string[]): Promise<Record<string, string[]>> {
    if (names.length === 0) return {}
    const rows = await this.db
      .select({ name: s.exerciseLibrary.name, equipment: s.exerciseLibrary.equipment })
      .from(s.exerciseLibrary)
      .where(inArray(s.exerciseLibrary.name, names))
    const result: Record<string, string[]> = {}
    for (const row of rows) {
      result[row.name] = row.equipment ?? []
    }
    return result
  }
```

- [ ] **Step 2: Add equipment + transitionSec to signals**

In `lib/ai-periodization/signals.ts`:

1. Add the import at the top:
```ts
import { transitionSecForEquipment } from '@/lib/workout/duration-model'
```

2. In the `PrescriptionSignals` interface, after `avgSetDurationSec: number` (line 25):
```ts
    equipment: string[]
    transitionSec: number
```

3. In the `Promise.all` (line 85), add a seventh fetch after `getExerciseMuscleAssignments`:
```ts
  const [recentSessions, avgSetDurations, muscleAssignmentsMap, equipmentMap, todayMoodLog, yesterdayMoodLog, allRecentSessions] = await Promise.all([
    repo.getRecentSessionsOfType(userId, programSessionId, 60),
    repo.getAvgSetDurationPerExercise(userId, exerciseNames),
    repo.getExerciseMuscleAssignments(exerciseNames),
    repo.getExerciseEquipment(exerciseNames),
    repo.getMoodLog(userId, today),
    repo.getMoodLog(userId, yesterday),
    // ACWR needs volume-load across ALL session types, not just this one — a lifter who
    // trains Push/Pull/Legs has their real acute:chronic load spread across all three.
    repo.getWorkoutSessionsFrom(userId, new Date(todayMid.getTime() - 28 * 86_400_000)),
  ])
```

4. In the per-exercise `return` object (after `avgSetDurationSec`, line 132):
```ts
      avgSetDurationSec: avgSetDurations[ex.exerciseName] ?? 45,
      equipment: equipmentMap[ex.exerciseName] ?? [],
      transitionSec: transitionSecForEquipment(equipmentMap[ex.exerciseName]),
```

- [ ] **Step 3: Thread transitionSec through the prescribe route**

In `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts`:

1. Emergency-deload path — the `fitToBudget` input map (line ~117) gains the field:
```ts
        signals.exercises.map(ex => ({
          sessionExerciseId: ex.sessionExerciseId,
          role: ex.role,
          sets: DELOAD_SETS,
          reps,
          restSec: DELOAD_REST,
          transitionSec: ex.transitionSec,
        })),
```

2. Emergency-deload `estimateSessionDurationMin` call (line ~137) — build a lookup first, immediately above the call:
```ts
    const transitionById = new Map(signals.exercises.map(e => [e.sessionExerciseId, e.transitionSec]))
    const estimatedSessionDurationMin = estimateSessionDurationMin(
      exercises.map(ex => ({
        sets: ex.sets, reps: ex.reps, restSec: ex.restSec,
        transitionSec: transitionById.get(ex.sessionExerciseId) ?? 240,
      })),
    )
```

3. Normal path — the `fitToBudget` input map (line ~234). The existing code already does a `signals.exercises.find(...)` for `role`; hoist it so it's used for both fields:
```ts
      parsed.exercises.map(ex => {
        const sig = signals.exercises.find(e => e.sessionExerciseId === ex.session_exercise_id)
        return {
          sessionExerciseId: ex.session_exercise_id,
          role: sig?.role ?? 'primary',
          sets: ex.sets,
          reps: ex.reps,
          restSec: ex.rest_sec,
          transitionSec: sig?.transitionSec ?? 240,
        }
      }),
```

4. Normal path `estimateSessionDurationMin` (line ~249):
```ts
  const transitionById = new Map(signals.exercises.map(e => [e.sessionExerciseId, e.transitionSec]))
  const estimatedSessionDurationMin = estimateSessionDurationMin(
    parsed.exercises.map(ex => ({
      sets: ex.sets, reps: ex.reps, restSec: ex.rest_sec,
      transitionSec: transitionById.get(ex.session_exercise_id) ?? 240,
    })),
  )
```

(Note: the two `transitionById` declarations are in separate early-return branches — no redeclaration conflict. Verify with tsc.)

- [ ] **Step 4: Render the formula from constants in the prompt**

In `lib/ai-periodization/prompt.ts`:

1. Add the import:
```ts
import { SECONDS_PER_REP, SET_SETUP_SEC } from '@/lib/workout/duration-model'
```

2. In `buildSystemPrompt`, replace the hardcoded time-constraint lines:
```
Time constraint: total session duration must fit within effective_time_budget_min.
Duration formula: for each exercise, time = sets × (10 + reps × 4) + (sets - 1) × rest_sec + 120 (transition).
```
with:
```ts
Time constraint: total session duration must fit within effective_time_budget_min.
Duration formula: for each exercise, time = sets × (${SET_SETUP_SEC} + reps × ${SECONDS_PER_REP}) + (sets - 1) × rest_sec + transition_sec.
transition_sec is given per exercise in the exercise list (equipment-dependent: barbell setups cost more than machines).
```
(The rest of the paragraph — "Total = sum...", trimming rules — stays unchanged.)

3. In `buildUserPrompt`'s `exerciseLines` (line ~129), extend the line:
```ts
      `avg_set_duration: ${ex.avgSetDurationSec}s, transition_sec: ${ex.transitionSec})`
```

- [ ] **Step 5: Run the full suite + typecheck**

Run: `pnpm test && npx tsc --noEmit`
Expected: PASS / no errors. If any other test constructs `TimedExercise` literals, add `transitionSec: 120` to them.

- [ ] **Step 6: Commit**

```bash
git add lib/data/repository.ts lib/data/postgres/adapter.ts lib/ai-periodization/signals.ts "app/api/ai-periodization/session/[sessionId]/prescribe/route.ts" lib/ai-periodization/prompt.ts
git commit -m "feat: equipment-aware transition overhead in AI periodization time budget"
```

---

### Task 4: Program generation + builder chat use the shared model

**Files:**
- Create: `lib/workout/known-styles.ts`
- Modify: `app/api/generate-program/route.ts`
- Modify: `app/api/builder-chat/route.ts`

- [ ] **Step 1: Extract `KNOWN_STYLES` + `GOAL_STYLE_RULES` to `lib/workout/known-styles.ts`**

Both routes currently keep their own copy of `GOAL_STYLE_RULES` (`generate-program:126`, `builder-chat:46`), and `KNOWN_STYLES` lives only in generate-program (line 50). Create `lib/workout/known-styles.ts` and **move** (cut, don't copy) both constants into it verbatim, adding exports:

```ts
// Default progression styles (set shapes + prompt descriptions) and the
// goal → style-role assignment rules. Shared by program generation and
// builder chat — previously duplicated in both routes.

export const KNOWN_STYLES: { name: string; sets: { reps: number; restSec: number }[]; description: string }[] = [
  // ... exact array moved from app/api/generate-program/route.ts lines 50–125 ...
]

export const GOAL_STYLE_RULES: Record<string, { primary: string; secondary: string; accessory: string }> = {
  // ... exact object moved from app/api/generate-program/route.ts line 126 ...
}
```

Before moving, diff the two `GOAL_STYLE_RULES` copies (`generate-program:126` vs `builder-chat:46`) — if they differ, stop and surface it; if identical, keep one. Update both routes to `import { KNOWN_STYLES, GOAL_STYLE_RULES } from '@/lib/workout/known-styles'` (builder-chat only imports `GOAL_STYLE_RULES` + `KNOWN_STYLES`).

- [ ] **Step 2: Make generate-program equipment-aware**

In `app/api/generate-program/route.ts`:

1. Add the import:
```ts
import {
  styleWorkSec, SESSION_WARMUP_MIN,
  TRANSITION_SEC_BARBELL, TRANSITION_SEC_STANDARD, TRANSITION_SEC_BODYWEIGHT,
} from '@/lib/workout/duration-model'
```

2. Replace `styleTimeMin` (lines 41–46) with:
```ts
// Work+rest minutes per exercise for a style's set shape — transition overhead is
// listed separately in the prompt because it depends on the exercise's equipment.
function styleTimeMin(sets: { reps: number; restSec: number }[]): number {
  return Math.round((styleWorkSec(sets) / 60) * 10) / 10
}
```

3. Update the style menu line (line ~214) to make clear overhead is extra:
```ts
  const styleMenu = availableStyles
    .map(s => `  - "${s.name}": ${s.description} (~${styleTimeMin(s.sets)} min/exercise + setup overhead)`)
    .join('\n')
```

4. In the exercise-count calc (lines ~225–231), replace the two `+ 90` computations — primaries are assumed barbell (worst case), accessories machine/dumbbell class:
```ts
    const primaryTimeSec = styleWorkSec(primaryStyle.sets) + TRANSITION_SEC_BARBELL
    const accessoryTimeSec = styleWorkSec(accessoryStyle.sets) + TRANSITION_SEC_STANDARD
```
Also replace both `inputs.timePerSessionMinutes - 10` occurrences in this block with `inputs.timePerSessionMinutes - SESSION_WARMUP_MIN`.

5. In the user prompt, directly after the `${styleMenu}` line, add the overhead legend (rendered from constants):
```ts
PER-EXERCISE SETUP OVERHEAD — add on top of the style time when fitting the budget:
- barbell exercises: ~${Math.round(TRANSITION_SEC_BARBELL / 60)} min (plate loading, warm-up ramp)
- machine / dumbbell / cable / kettlebell: ~${Math.round(TRANSITION_SEC_STANDARD / 60)} min
- bodyweight: ~${Math.round(TRANSITION_SEC_BODYWEIGHT / 60)} min
```

6. Update Rule 5 (line ~296) to:
```
5. IMPORTANT: The sum of (~style time + setup overhead) × exercise count per session must fit within the working time budget.
```

- [ ] **Step 3: Replace builder-chat's magic numbers**

In `app/api/builder-chat/route.ts`, delete the local `GOAL_STYLE_RULES` (line 46) in favour of the import, add:
```ts
import { KNOWN_STYLES, GOAL_STYLE_RULES } from '@/lib/workout/known-styles'
import { styleWorkSec, SESSION_WARMUP_MIN, TRANSITION_SEC_BARBELL, TRANSITION_SEC_STANDARD } from '@/lib/workout/duration-model'
```
and replace the count block (lines ~108–123) with:
```ts
  // Compute minimum exercise count from the time budget so the AI doesn't strip sessions.
  // Same model as generate-program: weighted 60% primary (barbell worst case) / 40% accessory.
  let exerciseCountNote = ''
  if (timePerSessionMinutes) {
    const workTimeSec = Math.max(30, timePerSessionMinutes - SESSION_WARMUP_MIN) * 60
    const rules = GOAL_STYLE_RULES[goal ?? ''] ?? GOAL_STYLE_RULES.hypertrophy
    const primaryStyle = KNOWN_STYLES.find(s => s.name === rules.primary) ?? KNOWN_STYLES[0]
    const accessoryStyle = KNOWN_STYLES.find(s => s.name === rules.accessory) ?? KNOWN_STYLES[0]
    const primarySec = styleWorkSec(primaryStyle.sets) + TRANSITION_SEC_BARBELL
    const accessorySec = styleWorkSec(accessoryStyle.sets) + TRANSITION_SEC_STANDARD
    const avgSecPerExercise = Math.round(0.6 * primarySec + 0.4 * accessorySec)
    const minExercises = Math.max(3, Math.floor(workTimeSec / avgSecPerExercise))
    exerciseCountNote = `\nSESSION TIME BUDGET: ${timePerSessionMinutes} minutes → minimum ${minExercises} exercises per session. NEVER reduce any session below ${minExercises} exercises when recalculating. Use ${Math.ceil(minExercises * 0.6)} compounds + ${minExercises - Math.ceil(minExercises * 0.6)} accessories as the baseline.`
  }
```
(Check `GOAL_STYLE_RULES.hypertrophy` exists in the moved object — it does in the generate-program copy; if the key set differs adjust the fallback to a key that exists.)

- [ ] **Step 4: Verify**

Run: `pnpm test && npx tsc --noEmit && pnpm lint`
Expected: all green. (These are prompt-string and planning-math changes — behaviour is exercised end-to-end in Task 7's dev-server pass; the AI-generation call itself needs a Gemini key and is named as an untested surface if the sandbox lacks one.)

- [ ] **Step 5: Commit**

```bash
git add lib/workout/known-styles.ts app/api/generate-program/route.ts app/api/builder-chat/route.ts
git commit -m "feat: equipment-aware setup overhead in program generation time planning"
```

---

### Task 5: Capture warmup end (migration 108)

**Files:**
- Create: `lib/data/postgres/migrations/108_warmup_ended_at.sql`
- Modify: `lib/data/postgres/schema.ts` (workoutSessions)
- Modify: `lib/data/repository.ts`, `lib/data/postgres/adapter.ts`
- Modify: `lib/stores/workout-store.ts`
- Modify: `components/workout-screen.tsx`
- Modify: `lib/workout/log-exercise.ts`

Why this shape: the field rides the existing `log-exercise` payload (sent with every exercise of the workout, first write wins), so the web route **and** the outbox `pushMutations` path stay mirrored automatically — both call the shared `logExerciseFromPayload` (`adapter.ts:2777`). No local-SQLite column is needed: the value is analytics-only, never rendered offline, and a queued mutation carries the full payload JSON. (Known, accepted gap: the local-store sync-engine's rebuilt-from-rows push path omits the optional field — harmless.)

- [ ] **Step 1: Migration + schema**

Create `lib/data/postgres/migrations/108_warmup_ended_at.sql`:
```sql
-- When the user tapped "Begin exercises" on the warmup screen. Splits actual
-- warmup time from first-exercise setup in session time decomposition.
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS warmup_ended_at TIMESTAMPTZ;
```

In `lib/data/postgres/schema.ts`, in `workoutSessions` after `hrSyncedAt`:
```ts
  warmupEndedAt:     timestamp('warmup_ended_at', { withTimezone: true }),
```

- [ ] **Step 2: Repo method**

`lib/data/repository.ts` (near the other workout-session methods):
```ts
  setWorkoutSessionWarmupEnd(userId: string, workoutSessionId: string, warmupEndedAt: Date): Promise<void>
```

`lib/data/postgres/adapter.ts`:
```ts
  async setWorkoutSessionWarmupEnd(userId: string, workoutSessionId: string, warmupEndedAt: Date): Promise<void> {
    await this.db.update(s.workoutSessions)
      .set({ warmupEndedAt })
      .where(and(
        eq(s.workoutSessions.id, workoutSessionId),
        eq(s.workoutSessions.userId, userId),
        isNull(s.workoutSessions.warmupEndedAt),
      ))
  }
```
(`isNull` guard: every exercise's payload carries the same timestamp; the first write wins and later ones are no-ops. Check `isNull` is already imported from `drizzle-orm` at the top of adapter.ts — it is used elsewhere; if not, add it.)

- [ ] **Step 3: Store field**

In `lib/stores/workout-store.ts`:
1. In the state interface, after `workoutEndMs` (~line 34): `warmupEndedMs: number | null`
2. In `INITIAL_STATE` (after `workoutEndMs: null`, line 108): `warmupEndedMs: null,`
3. In `startWorkout`'s `set` object (after `workoutEndMs: null`, line 128): `warmupEndedMs: null,`
4. In the `setTimestamps` `Pick` union (line 72–74), add `'warmupEndedMs'`:
```ts
  setTimestamps: (patch: Partial<Pick<WorkoutState,
    'workoutStartMs' | 'workoutEndMs' | 'warmupEndedMs' | 'exerciseStartMs' | 'lapStartMs' | 'restStartMs' | 'lastExerciseEndMs'
  >>) => void
```
Persistence note (Zustand rule): like `workoutStartMs`, this is per-workout state that SHOULD survive a refresh mid-workout; it is reset in `startWorkout` and by `resetSession` (via `INITIAL_STATE`). No `onRehydrateStorage` change needed.

- [ ] **Step 4: Stamp it and send it**

In `components/workout-screen.tsx`:

1. The warmup screen mount (line ~887) currently passes `onBeginExercises={() => launchExercise(0, false)}`. Change to:
```tsx
        onBeginExercises={() => {
          store.setTimestamps({ warmupEndedMs: Date.now() });
          launchExercise(0, false);
        }}
```

2. In `handleCompleteSet`'s `logPayload` (after `workoutStartedAt`, line ~609):
```ts
      warmupEndedAtMs: store.warmupEndedMs ?? undefined,
```
and add `store.warmupEndedMs` to the `useCallback` dependency array (the list ending at line ~685, next to `store.workoutStartMs`).

- [ ] **Step 5: Accept + persist server-side**

In `lib/workout/log-exercise.ts`:

1. Schema field, after `workoutStartedAt` (line 37):
```ts
  warmupEndedAtMs:      z.number().optional(),
```
2. Destructure it alongside `workoutStartedAt` (line 64).
3. After the `if (wsId) { ... } else { ... }` block that resolves `wsId` (after line 132):
```ts
  if (warmupEndedAtMs) {
    await repo.setWorkoutSessionWarmupEnd(userId, wsId, new Date(warmupEndedAtMs))
  }
```

- [ ] **Step 6: Verify migration + suite**

Run: `pnpm db:local` (idempotent; applies 108), then
`psql "postgresql://postgres:postgres@localhost:5433/trainingai_dev" -c "\d workout_sessions" | grep warmup`
Expected: `warmup_ended_at | timestamp with time zone`
Run: `pnpm test && npx tsc --noEmit`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add lib/data/postgres/migrations/108_warmup_ended_at.sql lib/data/postgres/schema.ts lib/data/repository.ts lib/data/postgres/adapter.ts lib/stores/workout-store.ts components/workout-screen.tsx lib/workout/log-exercise.ts
git commit -m "feat: record warmup end time to split warmup from first-exercise setup"
```

---

### Task 6: Time audit — robust stats + admin route + card

**Files:**
- Create: `lib/workout/time-audit.ts`
- Test: `lib/__tests__/time-audit.test.ts`
- Modify: `lib/data/repository.ts`, `lib/data/postgres/adapter.ts` (`getTimingAuditData`)
- Create: `app/api/admin/time-audit/route.ts`
- Create: `components/admin/time-audit-card.tsx`
- Modify: `app/admin/admin-content.tsx`

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/time-audit.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  median, robustStats, computeExerciseStats, computeEquipmentStats, decomposeSessions,
  type TimingSetRow, type TimingExerciseRow, type TimingSessionRow,
} from '@/lib/workout/time-audit'

const set = (over: Partial<TimingSetRow>): TimingSetRow => ({
  workoutSessionId: 'ws1', exerciseName: 'Squat', equipment: ['barbell'],
  setNumber: 1, reps: 5, setTimeSec: 30, restTimeSec: 120, setStartMs: null,
  ...over,
})
const exRow = (over: Partial<TimingExerciseRow>): TimingExerciseRow => ({
  workoutSessionId: 'ws1', exerciseName: 'Squat', equipment: ['barbell'],
  interExerciseRestSec: 200,
  ...over,
})

describe('median / robustStats', () => {
  it('median of odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBeNull()
  })

  it('excludes values outside [0.25×, 4×] median and counts them', () => {
    // The reported real-world case: 4 sets ~60s, 1 tracked-wrong at 360s.
    const r = robustStats([60, 58, 62, 60, 360])
    expect(r.outlierCount).toBe(1)
    expect(r.median).toBeGreaterThanOrEqual(58)
    expect(r.median).toBeLessThanOrEqual(62)
    expect(r.count).toBe(4)
  })

  it('keeps everything when values are consistent', () => {
    const r = robustStats([100, 110, 120])
    expect(r.outlierCount).toBe(0)
    expect(r.count).toBe(3)
    expect(r.p75).toBeGreaterThanOrEqual(r.median!)
  })
})

describe('computeExerciseStats', () => {
  it('aggregates per exercise with sec/rep and rest', () => {
    const sets = [
      set({ setTimeSec: 30, reps: 5 }),
      set({ setTimeSec: 34, reps: 5, setNumber: 2 }),
      set({ exerciseName: 'Leg Press', equipment: ['machine'], setTimeSec: 40, reps: 10 }),
    ]
    const exercises = [
      exRow({ interExerciseRestSec: 250 }),
      exRow({ exerciseName: 'Leg Press', equipment: ['machine'], interExerciseRestSec: 90, workoutSessionId: 'ws2' }),
    ]
    const stats = computeExerciseStats(sets, exercises)
    const squat = stats.find(s => s.exerciseName === 'Squat')!
    expect(squat.setCount).toBe(2)
    expect(squat.medianSetSec).toBe(32)
    expect(squat.medianSecPerRep).toBeCloseTo(32 / 5, 1)
    expect(squat.medianRestSec).toBe(120)
    expect(squat.medianTransitionSec).toBe(250)
    const legPress = stats.find(s => s.exerciseName === 'Leg Press')!
    expect(legPress.medianTransitionSec).toBe(90)
  })

  it('ignores null timings', () => {
    const stats = computeExerciseStats([set({ setTimeSec: null, restTimeSec: null })], [])
    expect(stats[0].setCount).toBe(0)
  })
})

describe('computeEquipmentStats', () => {
  it('rolls transitions up by equipment class and compares to the current model', () => {
    const rows = [
      exRow({ interExerciseRestSec: 260 }),
      exRow({ interExerciseRestSec: 300, workoutSessionId: 'ws2' }),
      exRow({ exerciseName: 'Leg Press', equipment: ['machine'], interExerciseRestSec: 100 }),
      exRow({ exerciseName: 'Plank', equipment: ['bodyweight'], interExerciseRestSec: 45 }),
    ]
    const stats = computeEquipmentStats(rows)
    const barbell = stats.find(s => s.equipmentClass === 'barbell')!
    expect(barbell.transitionCount).toBe(2)
    expect(barbell.medianTransitionSec).toBe(280)
    expect(barbell.currentModelSec).toBe(240)
    expect(stats.find(s => s.equipmentClass === 'standard')!.currentModelSec).toBe(120)
    expect(stats.find(s => s.equipmentClass === 'bodyweight')!.currentModelSec).toBe(60)
  })
})

describe('decomposeSessions', () => {
  it('splits a session into warmup/work/rest/transition/unaccounted', () => {
    const t0 = 1_000_000_000_000
    const sessions: TimingSessionRow[] = [{
      workoutSessionId: 'ws1', startedAt: t0, completedAt: t0 + 3_600_000, warmupEndedAt: t0 + 600_000,
    }]
    const sets = [
      set({ setTimeSec: 60, restTimeSec: 120, setStartMs: t0 + 900_000 }),
      set({ setTimeSec: 60, restTimeSec: 120, setNumber: 2, setStartMs: t0 + 1_080_000 }),
    ]
    const exercises = [exRow({ interExerciseRestSec: 240 })]
    const [d] = decomposeSessions(sessions, sets, exercises)
    expect(d.totalSec).toBe(3600)
    expect(d.warmupSec).toBe(600)
    expect(d.workSec).toBe(120)
    expect(d.restSec).toBe(240)
    expect(d.transitionSec).toBe(240)
    expect(d.unaccountedSec).toBe(3600 - 600 - 120 - 240 - 240)
  })

  it('falls back to first set start when warmup end is missing, and skips incomplete sessions', () => {
    const t0 = 1_000_000_000_000
    const sessions: TimingSessionRow[] = [
      { workoutSessionId: 'ws1', startedAt: t0, completedAt: t0 + 1_800_000, warmupEndedAt: null },
      { workoutSessionId: 'ws2', startedAt: t0, completedAt: null, warmupEndedAt: null },
    ]
    const sets = [set({ setStartMs: t0 + 480_000 })]
    const out = decomposeSessions(sessions, sets, [])
    expect(out).toHaveLength(1)
    expect(out[0].warmupSec).toBe(480)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/__tests__/time-audit.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `lib/workout/time-audit.ts`**

```ts
// Robust timing statistics over logged workout history. Read-time derivation only —
// nothing here is stored (Stored Counters rule). Consumed by /api/admin/time-audit
// to validate the duration-model constants against real data; a follow-up plan
// feeds these numbers back into planning estimates.

import {
  transitionSecForEquipment,
  TRANSITION_SEC_BARBELL, TRANSITION_SEC_STANDARD, TRANSITION_SEC_BODYWEIGHT, TRANSITION_SEC_DEFAULT,
} from '@/lib/workout/duration-model'

export interface TimingSetRow {
  workoutSessionId: string
  exerciseName: string
  equipment: string[]
  setNumber: number
  reps: number
  setTimeSec: number | null
  restTimeSec: number | null
  setStartMs: number | null
}

export interface TimingExerciseRow {
  workoutSessionId: string
  exerciseName: string
  equipment: string[]
  interExerciseRestSec: number | null
}

export interface TimingSessionRow {
  workoutSessionId: string
  startedAt: number            // epoch ms
  completedAt: number | null   // epoch ms
  warmupEndedAt: number | null // epoch ms
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function quantileSorted(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null
  const idx = (sorted.length - 1) * q
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

export interface RobustStats {
  count: number        // values kept
  outlierCount: number // values excluded as tracking errors
  median: number | null
  p25: number | null
  p75: number | null
}

// A value outside [median × 0.25, median × 4] is a tracking error (timer left
// running, app backgrounded), not signal — exclude it but report the count.
export function robustStats(values: number[]): RobustStats {
  const m = median(values)
  if (m === null) return { count: 0, outlierCount: 0, median: null, p25: null, p75: null }
  const kept = values.filter(v => v >= m * 0.25 && v <= m * 4)
  const sorted = [...kept].sort((a, b) => a - b)
  return {
    count: kept.length,
    outlierCount: values.length - kept.length,
    median: median(kept),
    p25: quantileSorted(sorted, 0.25),
    p75: quantileSorted(sorted, 0.75),
  }
}

export interface ExerciseTimingStats {
  exerciseName: string
  equipment: string[]
  setCount: number
  outlierSetCount: number
  medianSetSec: number | null
  medianSecPerRep: number | null
  medianRestSec: number | null
  restP75Sec: number | null
  transitionCount: number
  outlierTransitionCount: number
  medianTransitionSec: number | null
  transitionP75Sec: number | null
  modelTransitionSec: number
}

export function computeExerciseStats(sets: TimingSetRow[], exercises: TimingExerciseRow[]): ExerciseTimingStats[] {
  const names = [...new Set([...sets.map(s => s.exerciseName), ...exercises.map(e => e.exerciseName)])]
  return names.map(name => {
    const exSets = sets.filter(s => s.exerciseName === name)
    const equipment = exSets[0]?.equipment ?? exercises.find(e => e.exerciseName === name)?.equipment ?? []
    const setTimes = exSets.map(s => s.setTimeSec).filter((v): v is number => v != null && v > 0)
    const setStats = robustStats(setTimes)
    const secPerRep = exSets
      .filter(s => s.setTimeSec != null && s.setTimeSec > 0 && s.reps > 0)
      .map(s => s.setTimeSec! / s.reps)
    const restTimes = exSets.map(s => s.restTimeSec).filter((v): v is number => v != null && v > 0)
    const restStats = robustStats(restTimes)
    const transitions = exercises
      .filter(e => e.exerciseName === name && e.interExerciseRestSec != null && e.interExerciseRestSec > 0)
      .map(e => e.interExerciseRestSec!)
    const transStats = robustStats(transitions)
    return {
      exerciseName: name,
      equipment,
      setCount: setStats.count,
      outlierSetCount: setStats.outlierCount,
      medianSetSec: setStats.median,
      medianSecPerRep: robustStats(secPerRep).median,
      medianRestSec: restStats.median,
      restP75Sec: restStats.p75,
      transitionCount: transStats.count,
      outlierTransitionCount: transStats.outlierCount,
      medianTransitionSec: transStats.median,
      transitionP75Sec: transStats.p75,
      modelTransitionSec: transitionSecForEquipment(equipment),
    }
  }).sort((a, b) => b.setCount - a.setCount)
}

export type EquipmentClass = 'barbell' | 'standard' | 'bodyweight' | 'unknown'

export function equipmentClassOf(equipment: string[]): EquipmentClass {
  if (equipment.length === 0) return 'unknown'
  if (equipment.includes('barbell')) return 'barbell'
  if (equipment.every(e => e === 'bodyweight')) return 'bodyweight'
  return 'standard'
}

const MODEL_SEC_BY_CLASS: Record<EquipmentClass, number> = {
  barbell: TRANSITION_SEC_BARBELL,
  standard: TRANSITION_SEC_STANDARD,
  bodyweight: TRANSITION_SEC_BODYWEIGHT,
  unknown: TRANSITION_SEC_DEFAULT,
}

export interface EquipmentTimingStats {
  equipmentClass: EquipmentClass
  transitionCount: number
  outlierTransitionCount: number
  medianTransitionSec: number | null
  transitionP75Sec: number | null
  currentModelSec: number
}

export function computeEquipmentStats(exercises: TimingExerciseRow[]): EquipmentTimingStats[] {
  const classes: EquipmentClass[] = ['barbell', 'standard', 'bodyweight', 'unknown']
  return classes.map(cls => {
    const values = exercises
      .filter(e => equipmentClassOf(e.equipment) === cls && e.interExerciseRestSec != null && e.interExerciseRestSec > 0)
      .map(e => e.interExerciseRestSec!)
    const stats = robustStats(values)
    return {
      equipmentClass: cls,
      transitionCount: stats.count,
      outlierTransitionCount: stats.outlierCount,
      medianTransitionSec: stats.median,
      transitionP75Sec: stats.p75,
      currentModelSec: MODEL_SEC_BY_CLASS[cls],
    }
  }).filter(s => s.transitionCount > 0 || s.equipmentClass !== 'unknown')
}

export interface SessionDecomposition {
  workoutSessionId: string
  startedAt: number
  totalSec: number
  warmupSec: number | null
  workSec: number
  restSec: number
  transitionSec: number
  unaccountedSec: number
}

export function decomposeSessions(
  sessions: TimingSessionRow[],
  sets: TimingSetRow[],
  exercises: TimingExerciseRow[],
): SessionDecomposition[] {
  return sessions
    .filter(ws => ws.completedAt != null)
    .map(ws => {
      const totalSec = Math.round((ws.completedAt! - ws.startedAt) / 1000)
      const wsSets = sets.filter(s => s.workoutSessionId === ws.workoutSessionId)
      const firstSetStart = wsSets
        .map(s => s.setStartMs)
        .filter((v): v is number => v != null)
        .sort((a, b) => a - b)[0] ?? null
      const warmupEnd = ws.warmupEndedAt ?? firstSetStart
      const warmupSec = warmupEnd != null ? Math.max(0, Math.round((warmupEnd - ws.startedAt) / 1000)) : null
      const workSec = wsSets.reduce((t, s) => t + (s.setTimeSec ?? 0), 0)
      const restSec = wsSets.reduce((t, s) => t + (s.restTimeSec ?? 0), 0)
      const transitionSec = exercises
        .filter(e => e.workoutSessionId === ws.workoutSessionId)
        .reduce((t, e) => t + (e.interExerciseRestSec ?? 0), 0)
      return {
        workoutSessionId: ws.workoutSessionId,
        startedAt: ws.startedAt,
        totalSec,
        warmupSec,
        workSec,
        restSec,
        transitionSec,
        unaccountedSec: totalSec - (warmupSec ?? 0) - workSec - restSec - transitionSec,
      }
    })
    .sort((a, b) => b.startedAt - a.startedAt)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/__tests__/time-audit.test.ts`
Expected: PASS

- [ ] **Step 5: Repo fetch**

`lib/data/repository.ts` — import the row types and add:
```ts
  getTimingAuditData(userId: string, sinceDays: number): Promise<{
    sets: import('@/lib/workout/time-audit').TimingSetRow[]
    exercises: import('@/lib/workout/time-audit').TimingExerciseRow[]
    sessions: import('@/lib/workout/time-audit').TimingSessionRow[]
  }>
```

`lib/data/postgres/adapter.ts` — implementation (place near `getAvgSetDurationPerExercise` delegation or as a full method; follow the direct-method style used by `getExerciseMuscleAssignments`):
```ts
  async getTimingAuditData(userId: string, sinceDays: number) {
    const since = new Date(Date.now() - sinceDays * 86_400_000)
    const wsRows = await this.db
      .select({
        id: s.workoutSessions.id,
        startedAt: s.workoutSessions.startedAt,
        completedAt: s.workoutSessions.completedAt,
        warmupEndedAt: s.workoutSessions.warmupEndedAt,
      })
      .from(s.workoutSessions)
      .where(and(eq(s.workoutSessions.userId, userId), gte(s.workoutSessions.startedAt, since)))
    const wsIds = wsRows.map(r => r.id)
    if (wsIds.length === 0) return { sets: [], exercises: [], sessions: [] }

    const elRows = await this.db
      .select({
        id: s.exerciseLogs.id,
        workoutSessionId: s.exerciseLogs.workoutSessionId,
        exerciseName: s.exerciseLogs.exerciseName,
        interExerciseRestSec: s.exerciseLogs.interExerciseRestSec,
        equipment: s.exerciseLibrary.equipment,
      })
      .from(s.exerciseLogs)
      .leftJoin(s.exerciseLibrary, eq(s.exerciseLogs.exerciseName, s.exerciseLibrary.name))
      .where(inArray(s.exerciseLogs.workoutSessionId, wsIds))

    const elIds = elRows.map(r => r.id)
    const setRows = elIds.length
      ? await this.db
          .select({
            exerciseLogId: s.setLogs.exerciseLogId,
            setNumber: s.setLogs.setNumber,
            reps: s.setLogs.reps,
            setTimeSec: s.setLogs.setTimeSec,
            restTimeSec: s.setLogs.restTimeSec,
            setStartMs: s.setLogs.setStartMs,
          })
          .from(s.setLogs)
          .where(inArray(s.setLogs.exerciseLogId, elIds))
      : []

    const elById = new Map(elRows.map(r => [r.id, r]))
    return {
      sessions: wsRows.map(r => ({
        workoutSessionId: r.id,
        startedAt: r.startedAt.getTime(),
        completedAt: r.completedAt?.getTime() ?? null,
        warmupEndedAt: r.warmupEndedAt?.getTime() ?? null,
      })),
      exercises: elRows.map(r => ({
        workoutSessionId: r.workoutSessionId,
        exerciseName: r.exerciseName,
        equipment: r.equipment ?? [],
        interExerciseRestSec: r.interExerciseRestSec ?? null,
      })),
      sets: setRows.map(r => {
        const el = elById.get(r.exerciseLogId)!
        return {
          workoutSessionId: el.workoutSessionId,
          exerciseName: el.exerciseName,
          equipment: el.equipment ?? [],
          setNumber: r.setNumber,
          reps: r.reps,
          setTimeSec: r.setTimeSec ?? null,
          restTimeSec: r.restTimeSec ?? null,
          setStartMs: r.setStartMs ?? null,
        }
      }),
    }
  }
```

- [ ] **Step 6: Admin route**

Create `app/api/admin/time-audit/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, AdminError } from '@/lib/admin'
import { computeExerciseStats, computeEquipmentStats, decomposeSessions } from '@/lib/workout/time-audit'

export async function GET(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await requireAdmin(userId)
  } catch (err) {
    if (err instanceof AdminError) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    throw err
  }

  const daysRaw = Number(req.nextUrl.searchParams.get('days') ?? 90)
  const days = Number.isFinite(daysRaw) ? Math.min(365, Math.max(7, Math.round(daysRaw))) : 90

  const repo = await getRepository()
  const { sets, exercises, sessions } = await repo.getTimingAuditData(userId, days)

  return NextResponse.json({
    days,
    equipment: computeEquipmentStats(exercises),
    exercises: computeExerciseStats(sets, exercises),
    sessions: decomposeSessions(sessions, sets, exercises).slice(0, 30),
  })
}
```
(Match sibling admin routes' auth shape — open one, e.g. `app/api/admin/users/route.ts`, and mirror its `requireAdmin` usage exactly if it differs from the above.)

- [ ] **Step 7: Admin card**

Create `components/admin/time-audit-card.tsx`:
```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2, TimerIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react'

interface EquipmentRow {
  equipmentClass: string
  transitionCount: number
  outlierTransitionCount: number
  medianTransitionSec: number | null
  transitionP75Sec: number | null
  currentModelSec: number
}
interface ExerciseRow {
  exerciseName: string
  setCount: number
  outlierSetCount: number
  medianSetSec: number | null
  medianSecPerRep: number | null
  medianRestSec: number | null
  transitionCount: number
  medianTransitionSec: number | null
  modelTransitionSec: number
}
interface SessionRow {
  workoutSessionId: string
  startedAt: number
  totalSec: number
  warmupSec: number | null
  workSec: number
  restSec: number
  transitionSec: number
  unaccountedSec: number
}

const fmtSec = (v: number | null) => (v == null ? '—' : v >= 90 ? `${(v / 60).toFixed(1)}m` : `${Math.round(v)}s`)

export default function TimeAuditCard() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ equipment: EquipmentRow[]; exercises: ExerciseRow[]; sessions: SessionRow[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/time-audit?days=90')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <button
        className="w-full flex items-center justify-between"
        onClick={() => {
          setOpen(v => !v)
          if (!open && !data && !loading) load()
        }}
      >
        <span className="flex items-center gap-2 font-semibold">
          <TimerIcon className="h-4 w-4" /> Workout time audit (90 days)
        </span>
        {open ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
      </button>

      {open && (
        <div className="space-y-4 text-xs">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {error && <p className="text-destructive">{error} <Button size="sm" variant="ghost" onClick={load}>Retry</Button></p>}
          {data && (
            <>
              <div>
                <p className="font-medium mb-1">Transitions by equipment (measured vs model)</p>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead><tr className="text-left text-muted-foreground"><th>Class</th><th>n</th><th>median</th><th>p75</th><th>model</th><th>outliers</th></tr></thead>
                    <tbody>
                      {data.equipment.map(r => (
                        <tr key={r.equipmentClass}>
                          <td>{r.equipmentClass}</td><td>{r.transitionCount}</td>
                          <td>{fmtSec(r.medianTransitionSec)}</td><td>{fmtSec(r.transitionP75Sec)}</td>
                          <td>{fmtSec(r.currentModelSec)}</td><td>{r.outlierTransitionCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <p className="font-medium mb-1">Per exercise</p>
                <div className="overflow-x-auto max-h-64 overflow-y-auto">
                  <table className="w-full">
                    <thead><tr className="text-left text-muted-foreground"><th>Exercise</th><th>sets</th><th>set med</th><th>s/rep</th><th>rest med</th><th>transition med</th><th>model</th></tr></thead>
                    <tbody>
                      {data.exercises.map(r => (
                        <tr key={r.exerciseName}>
                          <td className="pr-2">{r.exerciseName}{r.outlierSetCount > 0 ? ` (${r.outlierSetCount}⚠)` : ''}</td>
                          <td>{r.setCount}</td><td>{fmtSec(r.medianSetSec)}</td>
                          <td>{r.medianSecPerRep != null ? r.medianSecPerRep.toFixed(1) : '—'}</td>
                          <td>{fmtSec(r.medianRestSec)}</td><td>{fmtSec(r.medianTransitionSec)}</td>
                          <td>{fmtSec(r.modelTransitionSec)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <p className="font-medium mb-1">Recent sessions — where the time went</p>
                <div className="overflow-x-auto max-h-64 overflow-y-auto">
                  <table className="w-full">
                    <thead><tr className="text-left text-muted-foreground"><th>Date</th><th>total</th><th>warmup</th><th>work</th><th>rest</th><th>transitions</th><th>unaccounted</th></tr></thead>
                    <tbody>
                      {data.sessions.map(r => (
                        <tr key={r.workoutSessionId}>
                          <td>{new Date(r.startedAt).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })}</td>
                          <td>{fmtSec(r.totalSec)}</td><td>{fmtSec(r.warmupSec)}</td><td>{fmtSec(r.workSec)}</td>
                          <td>{fmtSec(r.restSec)}</td><td>{fmtSec(r.transitionSec)}</td><td>{fmtSec(r.unaccountedSec)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
```

In `app/admin/admin-content.tsx`, add the import next to the other admin components (line ~14):
```ts
import TimeAuditCard from '@/components/admin/time-audit-card'
```
and mount it directly after `<ExerciseUnitFix />` (line ~244):
```tsx
          <TimeAuditCard />
```
(Match the exact wrapper markup around the sibling components — copy whatever `<div>`/spacing pattern wraps `<ExerciseUnitFix />`.)

- [ ] **Step 8: Verify + commit**

Run: `pnpm test && npx tsc --noEmit && pnpm lint`
Expected: green.

```bash
git add lib/workout/time-audit.ts lib/__tests__/time-audit.test.ts lib/data/repository.ts lib/data/postgres/adapter.ts app/api/admin/time-audit/route.ts components/admin/time-audit-card.tsx app/admin/admin-content.tsx
git commit -m "feat: admin workout time audit with robust per-exercise/equipment timing stats"
```

---

### Task 7: End-to-end verification + version bump

**Files:**
- Modify: `package.json` (version), `lib/changelog.ts`

- [ ] **Step 1: Full static pass**

Run: `pnpm test && npx tsc --noEmit && pnpm lint`
Expected: all green.

- [ ] **Step 2: Dev-server E2E against the local DB**

```bash
pnpm db:local          # idempotent; applies migration 108
pnpm dev &             # remember: session-start hook unsets prod DATABASE_URL/DATABASE_SSL
```
Then, logged in as `test@local.dev` / `testpass123`:
1. Make the test user admin: `psql "postgresql://postgres:postgres@localhost:5433/trainingai_dev" -c "UPDATE users SET is_admin = true WHERE email = 'test@local.dev'"`
2. Start a workout → warmup screen → **Begin exercises** → start/log at least 2 sets of the first exercise, complete it, begin the second exercise, log a set, complete the workout.
3. Verify warmup landed: `psql ... -c "SELECT started_at, warmup_ended_at FROM workout_sessions ORDER BY started_at DESC LIMIT 1"` → `warmup_ended_at` non-null and ≥ `started_at`.
4. `curl` (or open) `/api/admin/time-audit` with the session cookie → JSON with `equipment`, `exercises`, `sessions`; the just-logged session appears in `sessions` with a non-null `warmupSec`.
5. Open `/admin` → the "Workout time audit" card expands and renders the three tables.
6. AI-periodization estimate: `POST /api/ai-periodization/session/{id}/prescribe` needs a Gemini key — if unavailable in the sandbox, verify instead via the unit tests + a one-off node script calling `estimateSessionDurationMin` with barbell vs machine inputs, and name the prescribe route as an untested surface.

**Untested surfaces to declare when presenting this work:** on-device APK behaviour (native SQLite outbox path for the new payload field), real Gemini calls for generate-program/builder-chat/prescribe (prompt-text changes), prod data drift (local seed lacks set-timing values, so audit tables will be sparse locally — the real validation happens against prod after deploy).

- [ ] **Step 3: Version + changelog**

User-visible change (planning estimates change; new admin audit) → **minor** bump in `package.json`, and add a `lib/changelog.ts` entry following the existing entry shape, e.g.:
```
Session time estimates are now equipment-aware (barbell exercises get realistic 4-min setup vs 2-min for machines/dumbbells), warmup end is recorded, and a new admin time-audit shows where each session's time actually went.
```

- [ ] **Step 4: Commit**

```bash
git add package.json lib/changelog.ts
git commit -m "chore: bump version for equipment-aware time model + time audit"
```

---

## Follow-up plan (deliberately out of scope here)

Written as a separate plan **after** the audit has been run against prod data and its distributions reviewed:
1. **Measured estimates:** replace the hardcoded constants with per-exercise robust medians (sec/rep tempo, actual rest, transition) once an exercise has ≥5 sessions of data, blended toward the equipment default below that; wire `avgSetDurationSec`-style measured values into `fitToBudget`/`estimateSessionDurationMin` (today the measured average reaches the AI prompt but the enforcement math ignores it).
2. **Rest adherence signal:** actual-vs-prescribed rest per exercise into `signals.ts` (spec'd in the original periodization design, never built).
3. **Measured warmup:** replace the flat `SESSION_WARMUP_MIN` with the user's median once `warmup_ended_at` has accumulated data.
4. Possibly a user-facing session time-breakdown (done screen / Health) reusing `decomposeSessions`.
