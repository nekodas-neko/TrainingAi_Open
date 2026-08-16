# Per-Muscle Volume Landmarks & MAV-Aware Time-Budget Trimming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Status: already implemented and pushed.** Branch `claude/muscle-group-set-volumes-9dbeme`, PR #227 (not yet merged to `main` — awaiting the user's merge confirmation per the deploy gate). This plan documents the change as shipped, with real code from the final commits, so it can be audited task-by-task against the actual diff rather than re-implemented from scratch. If this branch is ever lost or reverted, the same steps reproduce it.

**Context:** The AI Dynamic Periodization engine already tracked weekly per-muscle
volume targets (`lib/ai-periodization/volume-targets.ts`) and read them into the
prescription prompt, but two gaps meant the targets weren't actually enforced:

1. Targets came from a **large/small muscle binary** (`LARGE_MUSCLES` set), so
   biceps and quads — which tolerate very different weekly set ranges — got
   identical treatment. There was no real per-muscle MEV/MAV/MRV data.
2. The deterministic time-budget trimmer (`lib/ai-periodization/time-budget.ts`,
   `fitToBudget`) only knew about exercise **role** (`accessory` → `secondary` →
   `primary`) — a session running over time always cut accessories first,
   regardless of whether that accessory's muscle was already under its weekly
   target, or whether a primary/secondary exercise's muscle was way over target.
   The AI prompt *mentioned* the weekly budget, but nothing enforced it once the
   model's output needed trimming to fit the time budget.

**Fix:** (a) Replace the large/small binary with an explicit, evidence-informed
MEV/MAV/MRV landmark table per muscle (chest, back, glutes, biceps, etc. each get
their own numbers), scaled by training goal. (b) Make `fitToBudget` optionally
volume-aware: rank candidates for trimming by a blended score — how far over its
weekly MAV a candidate's muscle sits (as a fraction of MAV, so muscles with very
different target sizes compare fairly) offset by a role bias — so a genuine
cross-tier outlier (e.g. a primary lift whose muscle is already well past MAV,
while the only accessory left belongs to a badly undertrained muscle) can pull the
cut out of a higher-priority role, while a merely mild imbalance still respects the
normal accessory-first order. (c) A live-testing pass surfaced and fixed an
unrelated but blocking bug: Gemini occasionally returns `pct` as a 0–1 fraction
(`0.74`) instead of a percentage (`74`), which hard-failed schema validation and
502'd the entire prescription with no fallback.

**Tech Stack:** TypeScript, vitest. No schema/migration change — this is pure
application logic plus one Zod schema relaxation.

**Not exercised (see Task 5):** the `Pull` and `Legs` sessions (only `Push` was
used for live verification, since it was already loaded with real exercises/roles);
the mobile "Get AI Recommendation" UI flow itself (only the API route was called
directly); native/on-device behavior (this is a server-side change with no
device-specific surface, so no device smoke test applies).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/ai-periodization/volume-targets.ts` | Modify | Per-muscle MEV/MAV/MRV table + goal multiplier, replacing the large/small binary |
| `lib/ai-periodization/time-budget.ts` | Modify | Volume-aware trim priority (`muscleOverageRatio`, `trimPriority`) in `fitToBudget`/`pickTrimTarget` |
| `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts` | Modify | Build the muscle-volume state and wire it into `fitToBudget`; normalize the Gemini `pct`-fraction bug |
| `lib/__tests__/volume-targets.test.ts` | Modify | Cover the new per-muscle table |
| `lib/__tests__/time-budget.test.ts` | Modify | Cover within-tier and cross-tier MAV-aware trim priority |

---

### Task 1: Per-muscle MEV/MAV/MRV landmark table

**Files:**
- Modify: `lib/ai-periodization/volume-targets.ts`
- Modify: `lib/__tests__/volume-targets.test.ts`

- [x] **Step 1: Replace the large/small binary with a per-muscle table**

Full replacement of `lib/ai-periodization/volume-targets.ts`:

```ts
import { normalizeMuscle } from '@/lib/muscles'

// Weekly per-muscle set landmarks for AI-dynamic programs — MEV (minimum effective volume),
// MAV (maximum adaptive volume, the sweet spot most programs target), MRV (maximum recoverable
// volume) — approximating published RP/Schoenfeld-style guidance, expressed in weekly direct
// working sets (secondary-muscle sets count at 0.5, matching getWeeklySetsByMuscleGroup).
//
// This is the single source of truth for volume targets: computeDefaultVolumeTargets (seeds a
// program's targets at creation) and volumeLandmarks (the live MEV/MAV/MRV band used to steer
// and trim sessions) both derive from the same table, so they can't drift apart.
//
// Landmarks are per-muscle rather than a large/small binary — muscle size alone doesn't predict
// volume tolerance. Biceps/calves are small but recover fast and tolerate a wide MEV-MRV band;
// glutes/hamstrings sit lower than their mass implies because most of their stimulus comes
// indirectly from squats/hinges; back tolerates the most volume of any group (large AND
// resilient).
const MUSCLE_LANDMARKS: Record<string, VolumeLandmarks> = {
  chest: { mev: 8, mav: 16, mrv: 22 },
  back: { mev: 10, mav: 18, mrv: 25 },
  lats: { mev: 10, mav: 16, mrv: 22 },
  'upper back': { mev: 8, mav: 14, mrv: 20 },
  'lower back': { mev: 4, mav: 8, mrv: 12 },
  quads: { mev: 8, mav: 14, mrv: 20 },
  hamstrings: { mev: 6, mav: 12, mrv: 18 },
  glutes: { mev: 4, mav: 10, mrv: 18 },
  shoulders: { mev: 8, mav: 16, mrv: 22 },
  biceps: { mev: 6, mav: 14, mrv: 22 },
  triceps: { mev: 6, mav: 12, mrv: 20 },
  calves: { mev: 8, mav: 14, mrv: 20 },
  traps: { mev: 4, mav: 10, mrv: 18 },
  forearms: { mev: 4, mav: 8, mrv: 16 },
  abs: { mev: 0, mav: 16, mrv: 24 },
  obliques: { mev: 0, mav: 12, mrv: 20 },
  'hip flexors': { mev: 2, mav: 6, mrv: 12 },
  adductors: { mev: 2, mav: 6, mrv: 12 },
  abductors: { mev: 2, mav: 6, mrv: 12 },
}

// Fallback for any muscle name not in the table above (e.g. a custom user exercise tagging an
// unlisted muscle) — a conservative small-muscle-shaped default rather than a crash.
const DEFAULT_LANDMARKS: VolumeLandmarks = { mev: 6, mav: 10, mrv: 16 }

// Scales the hypertrophy-baseline table for other goals. Strength/power sessions spend their
// recovery budget on intensity rather than volume, so they run fewer weekly sets per muscle;
// powerbuilding and strength+hypertrophy blends sit between the two poles.
const GOAL_MULTIPLIER: Record<string, number> = {
  strength: 0.65,
  power: 0.55,
  powerbuilding: 0.8,
  'strength+hypertrophy': 0.9,
  hypertrophy: 1.0,
  endurance: 0.85,
}

export interface VolumeLandmarks { mev: number; mav: number; mrv: number }

export function volumeLandmarks(trainingGoal: string, muscle: string): VolumeLandmarks {
  const base = MUSCLE_LANDMARKS[normalizeMuscle(muscle)] ?? DEFAULT_LANDMARKS
  const mult = GOAL_MULTIPLIER[trainingGoal] ?? GOAL_MULTIPLIER.strength
  return {
    mev: Math.round(base.mev * mult),
    mav: Math.round(base.mav * mult),
    mrv: Math.round(base.mrv * mult),
  }
}

export function computeDefaultVolumeTargets(
  trainingGoal: string,
  sessions: Array<{ exercises?: Array<{ muscleGroups?: string[] | null }> }>,
): Array<{ muscleGroup: string; targetSetsPerWeek: number }> {
  const muscles = new Set<string>()
  for (const session of sessions) {
    for (const ex of session.exercises ?? []) {
      for (const mg of ex.muscleGroups ?? []) {
        const m = normalizeMuscle(mg)
        if (m) muscles.add(m)
      }
    }
  }

  return [...muscles].map(muscle => ({
    muscleGroup: muscle,
    targetSetsPerWeek: volumeLandmarks(trainingGoal, muscle).mav,
  }))
}
```

This unifies what used to be two independent derivations (`computeDefaultVolumeTargets`
looked up `GOAL_VOLUME` directly; `volumeLandmarks` separately re-derived from the same
table) into one — `computeDefaultVolumeTargets` now just calls `volumeLandmarks(...).mav`.
Matches the repo's "One Formula, One Place" rule.

- [x] **Step 2: Update the tests for the new table**

`lib/__tests__/volume-targets.test.ts` — replace the exact-value assertions that depended
on the old large/small formula:

```ts
describe('volumeLandmarks', () => {
  it('gives each muscle its own hypertrophy-baseline landmarks (not a large/small binary)', () => {
    // chest baseline MEV 8 / MAV 16 / MRV 22, goal multiplier 1.0 at hypertrophy
    expect(volumeLandmarks('hypertrophy', 'chest')).toEqual({ mev: 8, mav: 16, mrv: 22 })
    // strength multiplier 0.65 applied to biceps baseline (MEV 6 / MAV 14 / MRV 22)
    expect(volumeLandmarks('strength', 'biceps')).toEqual({ mev: 4, mav: 9, mrv: 14 })
  })
  it('gives biceps a wider MEV-MRV band than chest despite being smaller', () => {
    const chest = volumeLandmarks('hypertrophy', 'chest')
    const biceps = volumeLandmarks('hypertrophy', 'biceps')
    expect(biceps.mrv - biceps.mev).toBeGreaterThan(chest.mrv - chest.mev)
  })
  it('normalizes synonyms and falls back to strength for unknown goals', () => {
    expect(volumeLandmarks('hypertrophy', 'Quadriceps')).toEqual(volumeLandmarks('hypertrophy', 'quads'))
    expect(volumeLandmarks('nonsense', 'chest').mav).toBe(10)
  })
})
```

(The `computeDefaultVolumeTargets` describe block above it is unchanged — its assertions
are relative, e.g. "chest > biceps", "hypertrophy > strength", so they still hold.)

- [x] **Step 3: Run tests**

Run: `pnpm vitest run lib/__tests__/volume-targets.test.ts`
Expected: PASS (all 9 tests)

---

### Task 2: Volume-aware, cross-tier-capable time-budget trimming

**Files:**
- Modify: `lib/ai-periodization/time-budget.ts`
- Modify: `lib/__tests__/time-budget.test.ts`

- [x] **Step 1: Extend `TimedExercise` and add the muscle-volume types**

```ts
export interface MuscleContribution { muscle: string; weight: number }

export interface TimedExercise {
  sessionExerciseId: string
  role: string
  sets: number
  reps: number
  restSec: number
  transitionSec: number
  // Optional: this exercise's muscle assignments (main=1.0, secondary=0.5), used to weigh
  // trim priority against weekly volume targets. Omitted callers (e.g. deload) get the
  // legacy role/time-cost-only ordering below.
  muscleGroups?: MuscleContribution[]
}

export interface MuscleVolumeState {
  // Sets already logged this week for this muscle, before this session.
  loggedBeforeSession: number
  // This muscle's weekly target (MAV) for the user's current goal/program.
  mav: number
}
```

- [x] **Step 2: Add the role-bias constant, overage-ratio and trim-priority functions**

```ts
// How much of a role's built-in protection an outlier muscle imbalance must overcome to get
// trimmed ahead of a lower-priority role — see trimPriority. Accessory has none (it's already
// first); secondary and primary need progressively larger imbalances to jump the queue.
const ROLE_TRIM_BIAS: Record<string, number> = { accessory: 0, secondary: 0.3, primary: 0.5 }

// How far over its weekly MAV an exercise's most-affected muscle would sit if it kept its
// current sets, as a fraction of that muscle's MAV — projected from sets already logged this
// week plus every other exercise's current (not-yet-trimmed) contribution in this session.
// Expressing it as a fraction (rather than raw sets) lets a small muscle (MAV 8) and a large
// one (MAV 18) compare on the same scale. Positive = over MAV; negative = still under MAV.
// 0 when there's no muscle data.
function muscleOverageRatio<T extends TimedExercise>(
  exercise: T,
  all: T[],
  muscleVolume: Map<string, MuscleVolumeState>,
): number {
  if (!exercise.muscleGroups?.length) return 0
  let worst: number | null = null
  for (const { muscle, weight } of exercise.muscleGroups) {
    const state = muscleVolume.get(muscle)
    if (!state || state.mav <= 0) continue
    const projected = state.loggedBeforeSession + all.reduce((sum, e) => {
      const w = e.muscleGroups?.find(m => m.muscle === muscle)?.weight ?? 0
      return sum + e.sets * w
    }, 0)
    const ratio = ((projected - state.mav) / state.mav) * weight
    if (worst === null || ratio > worst) worst = ratio
  }
  return worst ?? 0
}

// Combined trim priority: the muscle-overage ratio above, offset by a role bias. This is what
// lets a genuine volume outlier jump the accessory-first queue — e.g. a primary lift whose
// muscle is 17 sets into a 16-set MAV is a poor trim candidate on role alone, but if the only
// alternative is an accessory whose muscle sits at 4 of a 14-set MAV, the primary's overage
// ratio (~0.06) minus its bias (0.5) still beats the accessory's (~-0.71), so the primary gets
// cut instead — while a merely mild imbalance never clears the bias and role order holds.
function trimPriority<T extends TimedExercise>(
  exercise: T,
  all: T[],
  muscleVolume: Map<string, MuscleVolumeState>,
): number {
  return muscleOverageRatio(exercise, all, muscleVolume) - (ROLE_TRIM_BIAS[exercise.role] ?? ROLE_TRIM_BIAS.primary)
}
```

- [x] **Step 3: Rewrite `pickTrimTarget` and thread `muscleVolume` through `fitToBudget`**

```ts
function pickTrimTarget<T extends TimedExercise>(
  exercises: T[],
  protectedIds: Set<string>,
  muscleVolume?: Map<string, MuscleVolumeState>,
): T | null {
  const byTimeCost = <U extends TimedExercise>(best: U, e: U): U =>
    (setWorkSec(e.reps) + e.restSec) > (setWorkSec(best.reps) + best.restSec) ? e : best

  for (const pass of [false, true] as const) {
    if (!muscleVolume) {
      for (const role of TRIM_ORDER) {
        const eligible = exercises.filter(
          e => e.role === role && e.sets > roleFloor(role) && (pass || !protectedIds.has(e.sessionExerciseId)),
        )
        if (eligible.length === 0) continue
        return eligible.reduce(byTimeCost)
      }
      continue
    }
    const eligible = exercises.filter(
      e => e.sets > roleFloor(e.role) && (pass || !protectedIds.has(e.sessionExerciseId)),
    )
    if (eligible.length === 0) continue
    return eligible.reduce((best, e) => {
      const eP = trimPriority(e, exercises, muscleVolume)
      const bestP = trimPriority(best, exercises, muscleVolume)
      if (eP !== bestP) return eP > bestP ? e : best
      return byTimeCost(best, e)
    })
  }
  return null
}

export function fitToBudget<T extends TimedExercise>(
  exercises: T[],
  budgetMin: number,
  protectedIds: Set<string> = new Set(),
  muscleVolume?: Map<string, MuscleVolumeState>,
): T[] {
  const budgetSec = Math.max(0, budgetMin) * 60
  const out = exercises.map(e => ({ ...e }))
  const maxIters = out.reduce((n, e) => n + e.sets, 0) + 1
  for (let i = 0; i < maxIters; i++) {
    if (estimateSessionDurationSec(out) <= budgetSec) break
    const target = pickTrimTarget(out, protectedIds, muscleVolume)
    if (!target) break
    target.sets -= 1
  }
  return out
}
```

Without `muscleVolume` (e.g. the deload path in the prescribe route, which never passes
it), behavior is **byte-identical** to before — pure role-tier order, then time-cost. This
is a hard backward-compatibility requirement, not incidental: deload always trims uniformly
low sets/reps across every exercise, so volume-aware prioritization doesn't apply there and
must not change its output.

- [x] **Step 4: Add tests for the within-tier and cross-tier behavior**

Append to `lib/__tests__/time-budget.test.ts` (import `type MuscleVolumeState` alongside
the existing imports):

```ts
it('within a role tier, trims the accessory whose muscle is furthest over its weekly MAV first', () => {
  const exs: TimedExercise[] = [
    { ...mk('overTarget', 'accessory', 4, 10, 90), muscleGroups: [{ muscle: 'biceps', weight: 1.0 }] },
    { ...mk('underTarget', 'accessory', 4, 10, 90), muscleGroups: [{ muscle: 'calves', weight: 1.0 }] },
  ]
  const muscleVolume = new Map<string, MuscleVolumeState>([
    ['biceps', { loggedBeforeSession: 20, mav: 14 }], // already well over MAV
    ['calves', { loggedBeforeSession: 2, mav: 14 }], // well under MAV
  ])
  const out = fitToBudget(exs, 10, new Set(), muscleVolume)
  const overTarget = out.find(e => e.sessionExerciseId === 'overTarget')!
  const underTarget = out.find(e => e.sessionExerciseId === 'underTarget')!
  expect(overTarget.sets).toBeLessThan(underTarget.sets)
})

it('a mild imbalance stays role-ordered — accessory still trims before primary', () => {
  const exs: TimedExercise[] = [
    { ...mk('chest', 'primary', 4, 6, 150), muscleGroups: [{ muscle: 'chest', weight: 1.0 }] },
    { ...mk('biceps', 'accessory', 4, 12, 90), muscleGroups: [{ muscle: 'biceps', weight: 1.0 }] },
  ]
  // Both close to their own MAV — a small edge either way, not an outlier.
  const muscleVolume = new Map<string, MuscleVolumeState>([
    ['chest', { loggedBeforeSession: 12, mav: 16 }],
    ['biceps', { loggedBeforeSession: 9, mav: 14 }],
  ])
  const out = fitToBudget(exs, 15, new Set(), muscleVolume)
  expect(out.find(e => e.sessionExerciseId === 'biceps')!.sets)
    .toBeLessThan(out.find(e => e.sessionExerciseId === 'chest')!.sets)
})

it('a severe cross-tier outlier lets a primary trim ahead of an accessory', () => {
  // Chest (primary) is already well past its weekly MAV; biceps (accessory) is badly
  // undertrained this week — cutting the accessory further would only widen the gap.
  const exs: TimedExercise[] = [
    { ...mk('chest', 'primary', 4, 6, 150), muscleGroups: [{ muscle: 'chest', weight: 1.0 }] },
    { ...mk('biceps', 'accessory', 4, 12, 90), muscleGroups: [{ muscle: 'biceps', weight: 1.0 }] },
  ]
  const muscleVolume = new Map<string, MuscleVolumeState>([
    ['chest', { loggedBeforeSession: 13, mav: 16 }], // projects to 17 of 16 — over MAV
    ['biceps', { loggedBeforeSession: 0, mav: 14 }], // projects to 4 of 14 — badly under
  ])
  const out = fitToBudget(exs, 15, new Set(), muscleVolume)
  expect(out.find(e => e.sessionExerciseId === 'chest')!.sets)
    .toBeLessThan(out.find(e => e.sessionExerciseId === 'biceps')!.sets)
})
```

- [x] **Step 5: Run tests**

Run: `pnpm vitest run lib/__tests__/time-budget.test.ts`
Expected: PASS (all 15 tests)

---

### Task 3: Wire muscle-volume state into the prescribe route

**Files:**
- Modify: `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts`

- [x] **Step 1: Add the imports**

```ts
import { fitToBudget, estimateSessionDurationMin, type MuscleContribution, type MuscleVolumeState } from '@/lib/ai-periodization/time-budget'
import { normalizeMuscle } from '@/lib/muscles'
```

- [x] **Step 2: Build the muscle-volume map and pass each exercise's muscle assignments into `fitToBudget`**

Replace the existing `fitToBudget` call (the normal, non-deload prescription path — the
deload path's own `fitToBudget` call in `buildWholeSessionDeloadPrescription` is
**intentionally left unchanged**, see Task 2 Step 3):

```ts
  const muscleVolume = new Map<string, MuscleVolumeState>(
    Object.entries(signals.weeklyTargets).map(([muscle, mav]) => [
      muscle,
      { loggedBeforeSession: signals.weeklyLogged[muscle] ?? 0, mav },
    ]),
  )
  const fittedSets = new Map(
    fitToBudget(
      parsed.exercises.map(ex => {
        const sig = signals.exercises.find(e => e.sessionExerciseId === ex.session_exercise_id)
        const muscleGroups: MuscleContribution[] = (sig?.muscleAssignments ?? []).map(ma => ({
          muscle: normalizeMuscle(ma.muscle),
          weight: ma.role === 'main' ? 1.0 : 0.5,
        }))
        return {
          sessionExerciseId: ex.session_exercise_id,
          role: sig?.role ?? 'primary',
          sets: ex.sets,
          reps: ex.reps,
          restSec: ex.rest_sec,
          transitionSec: sig?.transitionSec ?? 240,
          muscleGroups,
        }
      }),
      signals.effectiveTimeBudgetMin,
      autoreg.earnedSetIds,
      muscleVolume,
    ).map(f => [f.sessionExerciseId, f.sets]),
  )
```

`signals.weeklyTargets`/`signals.weeklyLogged` (`lib/ai-periodization/signals.ts`) were
already computed for the AI prompt — this reuses them rather than re-querying.

- [x] **Step 3: Run typecheck + full unit suite**

Run: `pnpm tsc --noEmit && pnpm vitest run lib/__tests__/`
Expected: no new type errors; 495/495 tests pass.

---

### Task 4: Fix Gemini's occasional 0-1 `pct` fraction (discovered during live verification)

**Files:**
- Modify: `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts`

**Root cause:** live-testing Task 3 against a real session with a real Gemini call
surfaced a pre-existing, reproducible bug unrelated to the volume work — Gemini
occasionally returns `pct: 0.74` (a 0–1 fraction) instead of `pct: 74` (the schema's
30–100 range). The hard `z.number().min(30).max(100)` bound rejected that response
outright, `generateObject` threw `AI_NoObjectGeneratedError`, and the whole prescription
request 502'd with no fallback — reproduced twice, consistently, against the same
prompt/session.

- [x] **Step 1: Widen the schema's `pct` bound and document why**

```ts
    sets: z.number().int().min(1).max(10),
    reps: z.number().int().min(1).max(30),
    // 0-100 here (not 30-100): the model occasionally returns pct as a 0-1 fraction (e.g. 0.74
    // for 74%) instead of a percentage — normalized back to 30-100 right after parsing, below.
    // A hard 30-100 bound here would reject that response outright and 502 the whole prescription.
    pct: z.number().min(0).max(100),
    rest_sec: z.number().int().min(30).max(600),
```

- [x] **Step 2: Normalize and clamp immediately after parsing**

```ts
    parsed = result.object
    // Normalize the occasional 0-1 fraction back to a 30-100 percentage (see schema comment
    // above), then clamp to the same bounds the schema used to enforce directly.
    for (const ex of parsed.exercises) {
      if (ex.pct > 0 && ex.pct <= 1) ex.pct *= 100
      ex.pct = Math.min(100, Math.max(30, ex.pct))
    }
```

Placed right after `parsed = result.object` inside the existing try block, before any
other code reads `ex.pct` (autoregulation, phase guards, etc. all run after this).

- [x] **Step 3: Verify against a live call**

Not unit-testable in isolation (it's a one-line defensive normalization, not new pure
logic) — verified live instead: called the real route with the same session/prompt that
previously 502'd twice in a row; got a clean `200` with `pct: 74` correctly normalized
both times after the fix.

---

### Task 5: Verification

- [x] **Step 1: Full unit suite + typecheck + lint**

Run: `pnpm vitest run lib/__tests__/ && pnpm tsc --noEmit -p tsconfig.json && pnpm eslint <changed files>`
Result: 495/495 tests pass; no new type errors; lint clean.

- [x] **Step 2: Live end-to-end verification against the local dev DB + real Gemini key**

Seeded a realistic scenario in the local dev Postgres (not production): the `Push`
session's `program_volume_targets` set to chest MAV 10, shoulders MAV 10, triceps MAV 8;
10 real `set_logs` rows for `Tricep Pushdown` logged earlier in the current week (so
triceps starts the session already over its MAV); a `session_periodization` row with
`baseline_complete = true` so the prescribe route's baseline gate doesn't block it. Logged
in as the seeded test user (`test@local.dev`) via the real NextAuth credentials flow and
called `POST /api/ai-periodization/session/{id}/prescribe` directly against a running
`pnpm dev` instance.

Result (with temporary debug logging, removed before the final commit): both primary
lifts (Bench Press — chest; Overhead Press — shoulders) share triceps as a secondary
muscle assignment. Because triceps was seeded well over its MAV, both primaries'
`trimPriority` scores were dominated by that shared overage and came out higher than the
one untouched accessory's — so `fitToBudget` cut a set from **Bench Press (primary)**
rather than further from the (already-floored) accessory. This is the cross-tier-outlier
behavior Task 2 implements, observed on the real code path (real DB signals, real Gemini
response, real trim decision) rather than only in the unit tests. All seeded test data
was reverted afterward; the dev DB is back to its original seed state.

- [ ] **Step 3 (not done — optional follow-up):** Repeat Step 2 against the `Pull` and
`Legs` sessions, and exercise the "Get AI Recommendation" flow from the actual mobile UI
rather than calling the API route directly, to confirm the prescription explain-sheet
renders the new reasoning/trim decisions sensibly end-to-end.

---

⚠️ **Not exercised:** the mobile UI flow itself (verified via direct API call only, not
through the app's "Get AI Recommendation" button); the `Pull`/`Legs` session types; any
scenario with more than one accessory competing within the same role tier on a live
Gemini response (the live test above only had one, since the model itself dropped a
second exercise from its response — a separate, pre-existing issue where the model can
omit a `session_exercise_id` from its output entirely, not fixed as part of this plan).
No device/APK-specific behavior applies — this is a server-side-only change.
