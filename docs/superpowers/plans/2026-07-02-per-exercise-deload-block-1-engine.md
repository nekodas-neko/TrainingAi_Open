# Per-Exercise Deload — Block 1: Engine Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure decision engine for per-exercise deloads — shared deload constants plus `computePerExerciseDeload()` with full unit coverage. No route or UI changes in this block.

**Architecture:** Extract the per-goal deload constants out of the prescribe route into a shared module (used later by both the emergency path and the new engine). Add `lib/ai-periodization/per-exercise-deload.ts`, a pure function sibling to `autoregulation.ts`, implementing the deterministic soreness rule from the spec (`docs/superpowers/specs/2026-07-02-per-exercise-deload-design.md`).

**Tech Stack:** TypeScript, vitest (`pnpm test`), existing helpers `moodMuscleMatches` from `lib/muscles.ts`.

**Blocks:** This is Block 1 of 4. Block 2 = prescribe route integration; Block 3 = PR gating / log payload; Block 4 = UI. Each later block has its own plan doc.

---

### Task 1: Shared deload constants module

**Files:**
- Create: `lib/ai-periodization/deload-constants.ts`
- Modify: `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts` (lines 40–59 define the constants today; usages at lines ~111–112, ~119–121)

- [ ] **Step 1: Create the constants module**

Move the four constants verbatim from the route (currently `route.ts:40-59`) into a new file:

```ts
// lib/ai-periodization/deload-constants.ts

// Per-goal deload prescription values. Used by the emergency whole-session
// deload and the per-exercise deload — "deloaded" means the same numbers at
// both scales.
export const DELOAD_LOWER_PCT: Record<string, number> = {
  strength: 50,
  hypertrophy: 50,
  power: 55,
  endurance: 40,
  powerbuilding: 52,
  'strength+hypertrophy': 50,
}

export const DELOAD_REPS: Record<string, number> = {
  strength: 6,
  hypertrophy: 10,
  power: 4,
  endurance: 15,
  powerbuilding: 8,
  'strength+hypertrophy': 10,
}

export const DELOAD_SETS = 2
export const DELOAD_REST = 120

export interface DeloadOverride {
  sets: number
  reps: number
  pct: number
  restSec: number
}

export function deloadOverrideForGoal(trainingGoal: string): DeloadOverride {
  return {
    sets: DELOAD_SETS,
    reps: DELOAD_REPS[trainingGoal] ?? 8,
    pct: DELOAD_LOWER_PCT[trainingGoal] ?? 50,
    restSec: DELOAD_REST,
  }
}
```

- [ ] **Step 2: Point the prescribe route at the module**

In `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts`:

1. Delete the local `DELOAD_LOWER_PCT`, `DELOAD_REPS`, `DELOAD_SETS`, `DELOAD_REST` definitions (lines 40–59).
2. Add the import:

```ts
import { DELOAD_LOWER_PCT, DELOAD_REPS, DELOAD_SETS, DELOAD_REST } from '@/lib/ai-periodization/deload-constants'
```

The emergency-deload body (`const pct = DELOAD_LOWER_PCT[goal] ?? 50` etc.) is unchanged — it now reads the imported names.

- [ ] **Step 3: Verify typecheck and existing tests**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no type errors; all existing tests PASS (this is a pure move — no behaviour change).

- [ ] **Step 4: Commit**

```bash
git add lib/ai-periodization/deload-constants.ts app/api/ai-periodization/session/\[sessionId\]/prescribe/route.ts
git commit -m "Extract deload prescription constants into a shared module

The per-exercise deload engine needs the same per-goal deload values the
emergency whole-session deload uses; one formula, one place."
```

---

### Task 2: `computePerExerciseDeload` — failing tests first

**Files:**
- Test: `lib/__tests__/per-exercise-deload.test.ts` (create)

- [ ] **Step 1: Write the failing test file**

Follow the factory-helper style of `lib/__tests__/autoregulation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  computePerExerciseDeload,
  type PerExerciseDeloadInput,
} from '@/lib/ai-periodization/per-exercise-deload'

const ex = (
  id: string,
  main: string[],
  secondary: string[] = [],
): PerExerciseDeloadInput => ({
  sessionExerciseId: id,
  name: id,
  muscleAssignments: [
    ...main.map(m => ({ muscle: m, role: 'main' as const })),
    ...secondary.map(m => ({ muscle: m, role: 'secondary' as const })),
  ],
})

// 6-exercise leg day: two glute-main exercises, one glute-secondary.
const legDay = [
  ex('squat', ['quads'], ['glutes']),
  ex('hip-thrust', ['glutes']),
  ex('rdl', ['hamstrings'], ['glutes']),
  ex('glute-kickback', ['glutes']),
  ex('leg-extension', ['quads']),
  ex('calf-raise', ['calves']),
]

describe('computePerExerciseDeload — no-op cases', () => {
  it('returns none with no sore muscles', () => {
    const r = computePerExerciseDeload(legDay, [], 'powerbuilding', 'accumulation')
    expect(r.outcome).toBe('none')
    expect(r.deloadedIds.size).toBe(0)
  })

  it('returns none during a deload phase — the whole session is already deloaded', () => {
    const r = computePerExerciseDeload(legDay, ['glutes'], 'powerbuilding', 'deload')
    expect(r.outcome).toBe('none')
  })

  it('returns none when soreness matches no main-role muscle', () => {
    const r = computePerExerciseDeload(legDay, ['biceps'], 'powerbuilding', 'accumulation')
    expect(r.outcome).toBe('none')
  })
})

describe('computePerExerciseDeload — main-role matching only', () => {
  it('deloads main-role matches and ignores secondary involvement', () => {
    // glutes: main on hip-thrust + glute-kickback; secondary on squat + rdl.
    const r = computePerExerciseDeload(legDay, ['glutes'], 'powerbuilding', 'accumulation')
    expect(r.outcome).toBe('per_exercise')
    expect([...r.deloadedIds].sort()).toEqual(['glute-kickback', 'hip-thrust'])
  })

  it('matches broad mood labels through moodMuscleMatches (Back covers lats)', () => {
    const pullDay = [ex('row', ['lats']), ex('curl', ['biceps']), ex('facepull', ['rear delts'])]
    const r = computePerExerciseDeload(pullDay, ['Back'], 'powerbuilding', 'accumulation')
    expect(r.outcome).toBe('per_exercise')
    expect([...r.deloadedIds]).toEqual(['row'])
  })
})

describe('computePerExerciseDeload — escalation thresholds', () => {
  it('3 of 6 affected → per_exercise (half is the boundary, inclusive)', () => {
    const r = computePerExerciseDeload(
      legDay, ['glutes', 'calves'], 'powerbuilding', 'accumulation',
    ) // hip-thrust, glute-kickback, calf-raise = 3 of 6
    expect(r.outcome).toBe('per_exercise')
    expect(r.deloadedIds.size).toBe(3)
  })

  it('4 of 6 affected → whole_session', () => {
    const r = computePerExerciseDeload(
      legDay, ['glutes', 'calves', 'hamstrings'], 'powerbuilding', 'accumulation',
    ) // hip-thrust, glute-kickback, calf-raise, rdl = 4 of 6
    expect(r.outcome).toBe('whole_session')
    expect(r.deloadedIds.size).toBe(0)
  })

  it('1-exercise session with that exercise sore → whole_session (degenerate case)', () => {
    const r = computePerExerciseDeload([ex('squat', ['quads'])], ['quads'], 'powerbuilding', 'accumulation')
    expect(r.outcome).toBe('whole_session')
  })

  it('whole_session reports which sore muscles matched', () => {
    const r = computePerExerciseDeload(
      legDay, ['glutes', 'calves', 'hamstrings'], 'powerbuilding', 'accumulation',
    )
    expect(r.matchedMuscles.sort()).toEqual(['calves', 'glutes', 'hamstrings'])
  })
})

describe('computePerExerciseDeload — override values and notes', () => {
  it('uses the per-goal deload constants (powerbuilding: 52% × 8 × 2 sets, 120s rest)', () => {
    const r = computePerExerciseDeload(legDay, ['glutes'], 'powerbuilding', 'accumulation')
    expect(r.override).toEqual({ sets: 2, reps: 8, pct: 52, restSec: 120 })
  })

  it('falls back to 50% × 8 for an unknown goal', () => {
    const r = computePerExerciseDeload(legDay, ['glutes'], 'mystery-goal', 'accumulation')
    expect(r.override).toEqual({ sets: 2, reps: 8, pct: 50, restSec: 120 })
  })

  it('writes a note naming the sore muscle for each deloaded exercise', () => {
    const r = computePerExerciseDeload(legDay, ['glutes'], 'powerbuilding', 'accumulation')
    expect(r.notes['hip-thrust']).toBe('Deload — glutes still sore')
    expect(r.notes['glute-kickback']).toBe('Deload — glutes still sore')
    expect(r.notes['squat']).toBeUndefined()
  })

  it('joins multiple matched muscles in one note', () => {
    const combo = [ex('thruster', ['glutes', 'quads']), ex('curl', ['biceps']), ex('row', ['lats'])]
    const r = computePerExerciseDeload(combo, ['glutes', 'quads'], 'powerbuilding', 'accumulation')
    expect(r.notes['thruster']).toBe('Deload — glutes & quads still sore')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run lib/__tests__/per-exercise-deload.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai-periodization/per-exercise-deload`.

---

### Task 3: `computePerExerciseDeload` — implementation

**Files:**
- Create: `lib/ai-periodization/per-exercise-deload.ts`

- [ ] **Step 1: Implement the module**

```ts
// lib/ai-periodization/per-exercise-deload.ts
import { moodMuscleMatches } from '@/lib/muscles'
import { deloadOverrideForGoal, type DeloadOverride } from '@/lib/ai-periodization/deload-constants'

// Deterministic per-exercise deload — the muscle-soreness quadrant.
//
// Mood-log soreness (soreMusclesInSession) is matched against each exercise's
// MAIN-role muscle assignments only. Half or fewer of the session's exercises
// affected → deload just those in place; more than half → the caller should
// offer a whole-session deload instead. Runs before the LLM call: the
// prescription for a deloaded exercise is overwritten after parsing, so the
// model can never fight it.

export interface PerExerciseDeloadInput {
  sessionExerciseId: string
  name: string
  muscleAssignments: Array<{ muscle: string; role: 'main' | 'secondary' }>
}

export interface PerExerciseDeloadResult {
  outcome: 'none' | 'per_exercise' | 'whole_session'
  deloadedIds: Set<string>
  notes: Record<string, string>
  // Sore mood-log labels that matched at least one main-role assignment,
  // deduped — feeds note text here and the whole-session offer's reasoning.
  matchedMuscles: string[]
  override: DeloadOverride
}

export function computePerExerciseDeload(
  exercises: PerExerciseDeloadInput[],
  soreMusclesInSession: string[],
  trainingGoal: string,
  phase: string,
): PerExerciseDeloadResult {
  const override = deloadOverrideForGoal(trainingGoal)
  const none: PerExerciseDeloadResult = {
    outcome: 'none',
    deloadedIds: new Set(),
    notes: {},
    matchedMuscles: [],
    override,
  }
  if (phase === 'deload') return none
  if (exercises.length === 0 || soreMusclesInSession.length === 0) return none

  const matchedMuscles = new Set<string>()
  const affected: Array<{ id: string; sore: string[] }> = []

  for (const ex of exercises) {
    const sore = soreMusclesInSession.filter(label =>
      ex.muscleAssignments.some(ma => ma.role === 'main' && moodMuscleMatches(ma.muscle, label)),
    )
    if (sore.length === 0) continue
    sore.forEach(s => matchedMuscles.add(s))
    affected.push({ id: ex.sessionExerciseId, sore })
  }

  if (affected.length === 0) return none

  if (affected.length * 2 > exercises.length) {
    return { ...none, outcome: 'whole_session', matchedMuscles: [...matchedMuscles] }
  }

  const notes: Record<string, string> = {}
  for (const a of affected) {
    const labels = a.sore.map(s => s.toLowerCase()).join(' & ')
    notes[a.id] = `Deload — ${labels} still sore`
  }

  return {
    outcome: 'per_exercise',
    deloadedIds: new Set(affected.map(a => a.id)),
    notes,
    matchedMuscles: [...matchedMuscles],
    override,
  }
}
```

- [ ] **Step 2: Run the new tests**

Run: `pnpm exec vitest run lib/__tests__/per-exercise-deload.test.ts`
Expected: PASS (all describes).

- [ ] **Step 3: Run the full suite + typecheck**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: everything green.

- [ ] **Step 4: Commit**

```bash
git add lib/ai-periodization/per-exercise-deload.ts lib/__tests__/per-exercise-deload.test.ts
git commit -m "Add per-exercise deload decision engine

Deterministic soreness rule: mood-log soreness matched against main-role
muscle assignments; half or fewer of the session's exercises affected are
deloaded in place, more than half escalates to a whole-session deload
offer. Pure module — route integration lands separately."
```

---

## Self-Review Notes

- **Spec coverage (Block 1 scope):** trigger signal, main-role-only matching, escalation thresholds incl. degenerate 1-exercise case, shared constants, note text — all covered. Route wiring, `preDeload` capture, autoreg exclusion, clamp exemption are Block 2 by design. PR gate is Block 3; UI is Block 4.
- **Type consistency:** `PerExerciseDeloadResult.override` reuses `DeloadOverride` from Task 1; Block 2 will consume `outcome`/`deloadedIds`/`notes`/`matchedMuscles`/`override` exactly as named here.
- **Note text contract:** `"Deload — {labels} still sore"` — Block 4's chip renders this string verbatim as `deloadNote`.
