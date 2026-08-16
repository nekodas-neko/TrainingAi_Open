# AI Prescription Response Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Bug:** `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts` does no
validation that the model's structured response actually *covers* the session's
exercises before feeding it into autoregulation, `fitToBudget`, and persistence.
Several schema-valid-but-insane responses reach the workout bar untouched. This is
the "AI response issue" flagged in `docs/reviews/2026-07-05-workout-backlog-review.md`
§4, re-verified against current `main` for this plan.

**Confirmed current state** (`app/api/ai-periodization/session/[sessionId]/prescribe/route.ts`):

```ts
// line 29-46 — schema allows an EMPTY exercises array
const PrescriptionSchema = z.object({
  phase: z.enum(['accumulation', 'intensification', 'realisation', 'deload']),
  phase_action: z.enum([...]),
  exercises: z.array(z.object({ session_exercise_id: z.string(), ... })),  // no .min(1)
  ...
})

// line 219-241 — parse + pct-fraction normalize. NOTHING checks exercises against
// signals.exercises here — no drop, no dedupe, no backfill.
parsed = result.object
for (const ex of parsed.exercises) {
  if (ex.pct > 0 && ex.pct <= 1) ex.pct *= 100   // pct===1 (ambiguous) is promoted to 100%
  ex.pct = Math.min(100, Math.max(30, ex.pct))    // floor+ceiling are a flat 30-100, not zone-aware
}

// line 245-255 — deload override iterates the MODEL'S OWN ECHO, not the deterministic
// deloadedIds set. A dropped sore exercise silently skips its deload entirely.
const preDeloadById = new Map(...)
for (const ex of parsed.exercises) {
  if (!deloadedIds.has(ex.session_exercise_id)) continue
  ...
}

// line 260-289 — autoregulation + the per-exercise clamp. clampPrescribedPct
// (lib/ai-periodization/autoregulation.ts:149-152) is floor-only:
export function clampPrescribedPct(pct: number, zone: { pctMin: number }): number {
  const floor = Math.round(zone.pctMin * (1 - BACKOFF_MAX_PCT / 100) * 2) / 2
  return Math.max(pct, floor)   // no ceiling — a schema-valid 98% rides straight through
}

// line 306-328 — fitToBudget. Any surviving hallucinated id enters here as a
// protected role:'primary' ghost:
return {
  sessionExerciseId: ex.session_exercise_id,
  role: sig?.role ?? 'primary',   // sig is undefined for a hallucinated id → 'primary' fallback
  ...
  transitionSec: sig?.transitionSec ?? 240,
}

// line 353 — the model's own phase is persisted verbatim, even for phase_action==='stay':
phase: parsed.phase as PeriodizationPhase,
```

**Consequences, all verified by direct code trace:**

1. **Hallucinated ids** (`session_exercise_id` not in `signals.exercises`) survive
   into `fitToBudget` as protected `role: 'primary'` ghosts (steals budget from real
   exercises) and render as phantom rows in
   `components/workout/ai-prescription-card.tsx:141-173`, which maps
   `prescription.exercises` directly with `key={ex.sessionExerciseId}`.
2. **Duplicate ids** double-count in `fitToBudget`'s sums, are last-writer-wins in
   the `fittedSets` (route.ts:306-328) and `autoregById` maps, while
   `app/api/workout-data/route.ts:315` (`aiPrescription!.exercises.find(...)`) takes
   the *first* match — the two paths can end up looking at different duplicate
   entries. The card (`ai-prescription-card.tsx:146,199`) also gets a duplicate
   React key.
3. **Omitted exercises (the known live incident)** — excluded from autoregulation
   (route.ts:260-268 filters/maps only `parsed.exercises`), from `fitToBudget` (so
   *other* exercises get over-trimmed against a budget that ignores a lift still
   performed), and from the stored duration/volume estimates. `workout-data`
   (`app/api/workout-data/route.ts:314-353`) then finds no prescription entry for
   that exercise and falls back to the static style — or, for an AI-dynamic session
   with no `styleId`, an unguided `progressionStyle: null` at `defaultSets = 3`.
   **Worst case:** the deload-override loop (route.ts:245-255) only ever iterates
   `parsed.exercises` — a dropped sore-muscle exercise the deterministic
   `computePerExerciseDeload` marked for deload gets full-load static-style
   treatment instead, with nothing in the pipeline aware the deload never applied.
4. **`pct: 1`** is genuinely ambiguous (a "1%" typo vs. an already-percentage
   `100`), and the current normalize step resolves the ambiguity the *most*
   dangerously — promoting it to 100%, an all-out top set. For bodyweight
   exercises, `pct` maps straight to `repMax` reps every set
   (`app/api/workout-data/route.ts:344-353`).
5. **No zone ceiling on `pct`** — `clampPrescribedPct` only floors. A schema-valid
   98% for an accumulation-phase exercise (zone ceiling ~77.5%) rides unclamped to
   the bar.
6. **`phase_action: 'stay'` doesn't force `phase`** — the model can hallucinate
   `phase: 'realisation'` on a `stay` response; that phase then drives the intensity
   zone and the card's phase label even though nothing about the session actually
   transitioned.

**Fix:** a single post-parse reconciliation pass, run once right after
`parsed = result.object` and before autoregulation/`fitToBudget`/persistence, that:
resolves `phase` deterministically when `phase_action === 'stay'`; normalizes the
ambiguous `pct === 1` case to the *safe* end of the range instead of the dangerous
end; de-dupes by `session_exercise_id` (first occurrence wins, matching
`workout-data`'s own `.find`); drops ids that aren't in `signals.exercises` (logged);
backfills any of `signals.exercises`' ids the model omitted with deterministic
zone-midpoint defaults from `intensityZone(goal, phase)`; and applies the
per-exercise deload override by iterating the deterministic `deloadedIds` set (not
the model's echo), synthesizing the override for anything still missing. `pct` also
gets a phase-zone ceiling clamp (extending the existing floor-only
`clampPrescribedPct`), and the schema gets `.min(1)` on `exercises` so an empty
response can never validate.

This codebase tests logic by extracting it into small pure functions in `lib/` (see
`lib/ai-periodization/per-exercise-deload.ts` + `lib/__tests__/per-exercise-deload.test.ts`,
`lib/ai-periodization/autoregulation.ts` + `lib/__tests__/autoregulation.test.ts`) —
route files (`app/api/**/route.ts`) are never unit-tested directly in this repo (no
`app/api/**/*.test.ts` exists anywhere), and Next's app router only allows a fixed
export set from `route.ts` (`GET`/`POST`/etc.), which is exactly why
`CompleteWorkoutPayloadSchema` already lives in `lib/workout/complete-workout.ts`
rather than inline in `app/api/complete-workout/route.ts`. This plan follows the
same shape: extract the Zod schema and all reconciliation logic into `lib/`, test it
there, and reduce the route to thin wiring.

**`fitToBudget`/`pickTrimTarget` are out of scope and unchanged** — verified solid
(cannot produce `sets=0`, cannot drop an exercise, cannot loop; MAV-aware trimming
shipped v1.104.6). This plan only fixes what feeds it.

⚠️ **Already fixed, no task needed:** the review's "a Gemini failure after workout
completion silently re-serves the previous prescription" should-fix is **already
resolved on `main`** — `lib/workout/complete-workout.ts:32`
(`repo.updatePrescriptionStatus(userId, programSessionId, 'consumed')`, landed in
PR #221, predates this review) marks the prescription `'consumed'` synchronously at
completion, before the fire-and-forget regeneration call. `prescriptionDrivesLoad`
(`lib/ai-periodization/apply-prescription.ts:11-18`) only returns `true` for
`'accepted'`/`'auto_applied'`/`'pending'+stay` — `'consumed'` degrades to the static
style exactly as the review wanted. `prescriptionStatus` is a plain `text` column
(`lib/data/postgres/schema.ts:558`, not a Postgres enum) and `'consumed'` is already
a valid `PrescriptionStatus` union member (`lib/types/ai-periodization.ts:8-14`) —
**no migration needed** for this plan; next free migration number remains 112,
untouched by this work.

**Tech Stack:** Next.js 15 API route, TypeScript, Zod, vitest. No schema/migration
change (the `prescription_status` column is already free-text and already supports
every status this plan touches).

⚠️ **Confidence note:** every file:line reference above was re-verified against
current `main` while writing this plan (not carried over unchecked from the source
review). What is *not* independently verified is a live Gemini hallucination of each
exact shape (omitted id, duplicate id, invented id, `pct: 1`) — Gemini's actual
failure modes are inferred from the "model drops an exercise" incident already on
record in `projectOverview.md`'s Known Issues and from the pct-fraction bug already
patched in v1.104.6, not from a fresh reproduction. The unit tests below construct
each malformed-response shape directly (bypassing Gemini) since that's the only way
to deterministically exercise them.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/ai-periodization/prescription-schema.ts` | Add | Extracted, exported `PrescriptionSchema` (Zod) with `.min(1)` on `exercises` |
| `lib/__tests__/prescription-schema.test.ts` | Add | Unit tests: empty array rejected, non-empty accepted |
| `lib/ai-periodization/autoregulation.ts` | Modify | `clampPrescribedPct` gains an optional zone ceiling |
| `lib/__tests__/autoregulation.test.ts` | Modify | Ceiling-clamp tests alongside the existing floor tests |
| `lib/ai-periodization/reconcile-prescription.ts` | Add | `normalizePctFraction`, `resolvePhase`, `reconcilePrescriptionExercises`, `reconcilePrescription` (the composed pass) |
| `lib/__tests__/reconcile-prescription.test.ts` | Add | Unit tests: drop hallucinated id, dedupe duplicate id, backfill omitted id, omitted+deloaded id gets the deterministic deload (not the zone-midpoint default), `pct===1` handling, `stay` phase override |
| `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts` | Modify | Import extracted schema; call `reconcilePrescription` once, right after parse; remove the now-redundant inline pct-normalize loop and echo-iterating deload-override loop |

---

### Task 1: Schema — reject an empty `exercises` array so it can never auto-apply

**Files:**
- Add: `lib/ai-periodization/prescription-schema.ts`
- Add: `lib/__tests__/prescription-schema.test.ts`
- Modify: `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/prescription-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PrescriptionSchema } from '@/lib/ai-periodization/prescription-schema'

function validPrescription(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    phase: 'accumulation',
    phase_action: 'stay',
    exercises: [
      { session_exercise_id: 'ex-1', name: 'Barbell Bench Press', sets: 4, reps: 6, pct: 75, rest_sec: 120 },
    ],
    deload: false,
    reasoning: 'Test reasoning.',
    confidence: 0.8,
    ...overrides,
  }
}

describe('PrescriptionSchema', () => {
  it('rejects an empty exercises array — a schema-valid empty response must never auto-apply', () => {
    const result = PrescriptionSchema.safeParse(validPrescription({ exercises: [] }))
    expect(result.success).toBe(false)
  })

  it('accepts a well-formed, non-empty response', () => {
    const result = PrescriptionSchema.safeParse(validPrescription())
    expect(result.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/__tests__/prescription-schema.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ai-periodization/prescription-schema'`

- [ ] **Step 3: Extract the schema and add `.min(1)`**

Create `lib/ai-periodization/prescription-schema.ts` with exactly the schema
currently inline at `route.ts:29-46`, plus `.min(1)`:

```ts
import { z } from 'zod'

export const PrescriptionSchema = z.object({
  phase: z.enum(['accumulation', 'intensification', 'realisation', 'deload']),
  phase_action: z.enum(['stay', 'transition_recommended', 'deload_recommended', 'session_swap_recommended', 'rest_day_recommended']),
  exercises: z.array(z.object({
    session_exercise_id: z.string(),
    name: z.string(),
    sets: z.number().int().min(1).max(10),
    reps: z.number().int().min(1).max(30),
    // 0-100 here (not 30-100): the model occasionally returns pct as a 0-1 fraction (e.g. 0.74
    // for 74%) instead of a percentage — normalized back to 30-100 right after parsing, in
    // reconcile-prescription.ts. A hard 30-100 bound here would reject that response outright
    // and 502 the whole prescription.
    pct: z.number().min(0).max(100),
    rest_sec: z.number().int().min(30).max(600),
    // An empty response is schema-valid without this — and can auto-apply (see
    // docs/superpowers/plans/2026-07-05-ai-prescription-response-reconciliation.md).
  })).min(1),
  deload: z.boolean(),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/__tests__/prescription-schema.test.ts`
Expected: PASS

- [ ] **Step 5: Wire the route to the extracted schema**

In `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts`:
1. Remove the inline `const PrescriptionSchema = z.object({...})` block (lines 29-46).
2. Add `import { PrescriptionSchema } from '@/lib/ai-periodization/prescription-schema'`.
3. The `z` import stays (still used for `z.infer<typeof PrescriptionSchema>` at line 219).

- [ ] **Step 6: Typecheck + run the full suite**

Run: `npx tsc --noEmit && pnpm test`
Expected: all green — this step only moved code, no behavior change beyond `.min(1)`.

- [ ] **Step 7: Commit**

```bash
git add lib/ai-periodization/prescription-schema.ts lib/__tests__/prescription-schema.test.ts app/api/ai-periodization/session/\[sessionId\]/prescribe/route.ts
git commit -m "fix: reject empty AI prescription responses at the schema"
```

---

### Task 2: Give `clampPrescribedPct` a phase-zone ceiling, not just a floor

**Files:**
- Modify: `lib/ai-periodization/autoregulation.ts`
- Modify: `lib/__tests__/autoregulation.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the existing `describe('clampPrescribedPct — combined-deviation clamp (C7)', ...)`
block in `lib/__tests__/autoregulation.test.ts`:

```ts
it('ceilings the combined LLM+autoreg pct at the zone ceiling when pctMax is supplied', () => {
  // strength accumulation: pctMin 70, pctMax 77.5 (lib/ai-periodization/prompt.ts)
  expect(clampPrescribedPct(98, { pctMin: 70, pctMax: 77.5 })).toBe(77.5)
  expect(clampPrescribedPct(75, { pctMin: 70, pctMax: 77.5 })).toBe(75) // in-range, untouched
})

it('stays floor-only when pctMax is omitted (back-compat for callers with no zone ceiling)', () => {
  expect(clampPrescribedPct(500, { pctMin: 70 })).toBe(500)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/__tests__/autoregulation.test.ts`
Expected: FAIL on the first new test (`98` currently passes through unclamped — no ceiling exists).

- [ ] **Step 3: Implement the ceiling**

In `lib/ai-periodization/autoregulation.ts`, replace the `clampPrescribedPct`
function (currently lines 149-152):

```ts
// Combined-deviation clamp: whatever the model chose plus whatever autoregulation cut,
// the final working pct never lands more than one full back-off (10%) below the phase
// zone's floor, and never rides above the phase zone's ceiling (a schema-valid but
// out-of-band pct, e.g. 98% in an accumulation block, must not reach the bar). pctMax is
// optional so existing floor-only callers/tests are unaffected. Rounded to 0.5 like all
// autoreg pcts.
export function clampPrescribedPct(pct: number, zone: { pctMin: number; pctMax?: number }): number {
  const floor = Math.round(zone.pctMin * (1 - BACKOFF_MAX_PCT / 100) * 2) / 2
  const ceiling = zone.pctMax ?? Infinity
  return Math.min(ceiling, Math.max(pct, floor))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/__tests__/autoregulation.test.ts`
Expected: PASS (all tests, including the pre-existing floor-only ones).

- [ ] **Step 5: Confirm the route call site already benefits with zero route changes**

`app/api/ai-periodization/session/[sessionId]/prescribe/route.ts:282,286` already does:
```ts
const zone = intensityZone(signals.trainingGoal, parsed.phase)
...
ex.pct = clampPrescribedPct(a.pct, zone)
```
`zone` here is the full `IntensityZone` (`pctMin`, `pctMax`, ...) from
`lib/ai-periodization/prompt.ts:57` — so this call site is already passing `pctMax`
and gets the ceiling for free. No route.ts edit needed for this task. (Task 4 below
touches this same file for unrelated reasons — don't re-verify this twice.)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (the optional `pctMax` is backward-compatible with every existing call site).

- [ ] **Step 7: Commit**

```bash
git add lib/ai-periodization/autoregulation.ts lib/__tests__/autoregulation.test.ts
git commit -m "fix: clamp autoregulated pct at the phase zone ceiling, not just the floor"
```

---

### Task 3: Build the reconciliation pass — drop / dedupe / backfill / deterministic deload / safe pct / phase-stay override

This is the core fix. Everything is a pure function, fully testable without Gemini,
a DB, or the route.

**Files:**
- Add: `lib/ai-periodization/reconcile-prescription.ts`
- Add: `lib/__tests__/reconcile-prescription.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/__tests__/reconcile-prescription.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  normalizePctFraction,
  resolvePhase,
  reconcilePrescriptionExercises,
  reconcilePrescription,
  type ReconcileExercise,
  type ReconcileSignalExercise,
} from '@/lib/ai-periodization/reconcile-prescription'

const ex = (id: string, over: Partial<ReconcileExercise> = {}): ReconcileExercise => ({
  sessionExerciseId: id, name: id, sets: 4, reps: 6, pct: 75, restSec: 120, ...over,
})
const sig = (id: string, role = 'primary', name = id): ReconcileSignalExercise => ({
  sessionExerciseId: id, name, role,
})

describe('normalizePctFraction', () => {
  it('promotes a 0-1 fraction to a percentage', () => {
    expect(normalizePctFraction(0.74)).toBe(74)
  })
  it('leaves an already-percentage value alone', () => {
    expect(normalizePctFraction(75)).toBe(75)
  })
  it('does NOT promote exactly 1 — genuinely ambiguous, must not become the dangerous 100%', () => {
    expect(normalizePctFraction(1)).toBe(1)
  })
})

describe('resolvePhase', () => {
  it('forces the current phase when phase_action is "stay", ignoring a hallucinated model phase', () => {
    expect(resolvePhase('realisation', 'stay', 'accumulation')).toBe('accumulation')
  })
  it('trusts the model phase for any non-"stay" action', () => {
    expect(resolvePhase('intensification', 'transition_recommended', 'accumulation')).toBe('intensification')
  })
})

describe('reconcilePrescriptionExercises — drop / dedupe / backfill', () => {
  const signals = [sig('bench'), sig('row'), sig('curl', 'accessory')]

  it('drops a hallucinated session_exercise_id not present in signals', () => {
    const out = reconcilePrescriptionExercises(
      [ex('bench'), ex('row'), ex('curl'), ex('ghost-id')],
      signals, 'hypertrophy', 'accumulation',
    )
    expect(out.exercises.map(e => e.sessionExerciseId).sort()).toEqual(['bench', 'curl', 'row'])
    expect(out.droppedIds).toEqual(['ghost-id'])
  })

  it('de-dupes a repeated id, keeping the first occurrence (matches workout-data\'s own .find)', () => {
    const out = reconcilePrescriptionExercises(
      [ex('bench', { sets: 4 }), ex('bench', { sets: 8 }), ex('row'), ex('curl')],
      signals, 'hypertrophy', 'accumulation',
    )
    const bench = out.exercises.filter(e => e.sessionExerciseId === 'bench')
    expect(bench).toHaveLength(1)
    expect(bench[0].sets).toBe(4)
  })

  it('backfills an omitted exercise with deterministic zone-midpoint defaults, not a zero/null entry', () => {
    const out = reconcilePrescriptionExercises(
      [ex('bench'), ex('row')], // 'curl' omitted
      signals, 'hypertrophy', 'accumulation',
    )
    expect(out.backfilledIds).toEqual(['curl'])
    const curl = out.exercises.find(e => e.sessionExerciseId === 'curl')
    expect(curl).toBeDefined()
    expect(curl!.sets).toBeGreaterThan(0)
    expect(curl!.reps).toBeGreaterThan(0)
    expect(curl!.pct).toBeGreaterThan(0)
    expect(curl!.restSec).toBeGreaterThan(0)
  })

  it('never returns fewer exercises than signals has, and never more unique ids than signals has', () => {
    const out = reconcilePrescriptionExercises(
      [ex('bench'), ex('bench'), ex('ghost')], // dupe + hallucination + 'row'/'curl' omitted
      signals, 'hypertrophy', 'accumulation',
    )
    expect(out.exercises).toHaveLength(signals.length)
    expect(new Set(out.exercises.map(e => e.sessionExerciseId)).size).toBe(signals.length)
  })
})

describe('reconcilePrescription — the composed pass (the known live incident)', () => {
  const signals = [sig('bench'), sig('row')]
  const deloadOverride = { sets: 2, reps: 10, pct: 50, restSec: 120 }

  it('a model-omitted, deterministically-deloaded exercise gets the DELOAD override, not the zone-midpoint default', () => {
    const out = reconcilePrescription({
      modelPhase: 'accumulation',
      phaseAction: 'stay',
      currentPhase: 'accumulation',
      modelExercises: [ex('bench')], // 'row' omitted by the model, AND it's sore/deloaded
      signalExercises: signals,
      trainingGoal: 'hypertrophy',
      deloadedIds: new Set(['row']),
      deloadOverride,
    })
    const row = out.exercises.find(e => e.sessionExerciseId === 'row')
    expect(row).toMatchObject(deloadOverride)
    expect(out.backfilledIds).toContain('row')
  })

  it('a deloaded exercise the model DID echo still gets overridden by the deterministic values, and its pre-deload numbers are preserved', () => {
    const out = reconcilePrescription({
      modelPhase: 'accumulation',
      phaseAction: 'stay',
      currentPhase: 'accumulation',
      modelExercises: [ex('bench'), ex('row', { sets: 5, reps: 8, pct: 82, restSec: 90 })],
      signalExercises: signals,
      trainingGoal: 'hypertrophy',
      deloadedIds: new Set(['row']),
      deloadOverride,
    })
    const row = out.exercises.find(e => e.sessionExerciseId === 'row')
    expect(row).toMatchObject(deloadOverride)
    expect(out.preDeloadById.get('row')).toMatchObject({ sets: 5, reps: 8, pct: 82, restSec: 90 })
  })

  it('forces the current phase on a "stay" response even if the model hallucinated a different phase', () => {
    const out = reconcilePrescription({
      modelPhase: 'realisation',
      phaseAction: 'stay',
      currentPhase: 'accumulation',
      modelExercises: [ex('bench'), ex('row')],
      signalExercises: signals,
      trainingGoal: 'hypertrophy',
      deloadedIds: new Set(),
      deloadOverride,
    })
    expect(out.phase).toBe('accumulation')
  })

  it('normalizes an ambiguous pct===1 to the safe (floor) end via the 30-100 clamp, not 100%', () => {
    const out = reconcilePrescription({
      modelPhase: 'accumulation',
      phaseAction: 'stay',
      currentPhase: 'accumulation',
      modelExercises: [ex('bench', { pct: 1 }), ex('row')],
      signalExercises: signals,
      trainingGoal: 'hypertrophy',
      deloadedIds: new Set(),
      deloadOverride,
    })
    expect(out.exercises.find(e => e.sessionExerciseId === 'bench')!.pct).toBe(30)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run lib/__tests__/reconcile-prescription.test.ts`
Expected: FAIL — `lib/ai-periodization/reconcile-prescription.ts` does not exist yet.

- [ ] **Step 3: Implement `lib/ai-periodization/reconcile-prescription.ts`**

```ts
import { intensityZone } from '@/lib/ai-periodization/prompt'
import type { PeriodizationPhase } from '@/lib/types/ai-periodization'

export interface ReconcileExercise {
  sessionExerciseId: string
  name: string
  sets: number
  reps: number
  pct: number
  restSec: number
}

export interface ReconcileSignalExercise {
  sessionExerciseId: string
  name: string
  role: string
}

export interface ReconcileExercisesResult {
  exercises: ReconcileExercise[]
  droppedIds: string[]
  backfilledIds: string[]
}

// The model occasionally returns pct as a 0-1 fraction (e.g. 0.74 for 74%) instead of a
// percentage. Exactly 1 is genuinely ambiguous — "1%" (a fraction typo) vs. an
// already-percentage 100. Promoting it to 100% is the single most dangerous misread (an
// all-out top set, or for bodyweight exercises an all-out repMax every set — see
// app/api/workout-data/route.ts:344-353). Leave it at 1 and let the caller's 30-100 clamp
// resolve it to the SAFE end of the range instead.
export function normalizePctFraction(pctRaw: number): number {
  if (pctRaw > 0 && pctRaw < 1) return pctRaw * 100
  return pctRaw
}

// phase_action === 'stay' means nothing about periodization changed — the model's own
// `phase` field is not a decision in that case and must not be trusted. Any other
// phase_action means the model IS asserting a transition, so its phase stands.
export function resolvePhase(
  modelPhase: PeriodizationPhase,
  phaseAction: string,
  currentPhase: PeriodizationPhase,
): PeriodizationPhase {
  return phaseAction === 'stay' ? currentPhase : modelPhase
}

const BACKFILL_REST_SEC_ACCESSORY = 90
const BACKFILL_REST_SEC_COMPOUND = 120

function pctMidpoint(min: number, max: number): number {
  return Math.round(((min + max) / 2) * 2) / 2
}

// Reconciles the model's exercise list against the session's actual exercises
// (signals.exercises is the source of truth — it comes from the program, not the model).
// De-dupes BEFORE dropping, so a hallucinated id repeated twice is logged as dropped once,
// not twice. First occurrence wins on dedupe, matching app/api/workout-data/route.ts's own
// `aiPrescription.exercises.find(...)` (also first-match) — the two code paths can now
// never disagree about which duplicate "wins".
export function reconcilePrescriptionExercises(
  modelExercises: ReconcileExercise[],
  signalExercises: ReconcileSignalExercise[],
  trainingGoal: string,
  phase: string,
): ReconcileExercisesResult {
  const validIds = new Set(signalExercises.map(e => e.sessionExerciseId))

  const seen = new Set<string>()
  const deduped: ReconcileExercise[] = []
  for (const ex of modelExercises) {
    if (seen.has(ex.sessionExerciseId)) continue
    seen.add(ex.sessionExerciseId)
    deduped.push(ex)
  }

  const droppedIds: string[] = []
  const kept = deduped.filter(ex => {
    if (validIds.has(ex.sessionExerciseId)) return true
    droppedIds.push(ex.sessionExerciseId)
    return false
  })

  const keptIds = new Set(kept.map(ex => ex.sessionExerciseId))
  const backfilledIds: string[] = []
  const zone = intensityZone(trainingGoal, phase)
  for (const sig of signalExercises) {
    if (keptIds.has(sig.sessionExerciseId)) continue
    backfilledIds.push(sig.sessionExerciseId)
    kept.push({
      sessionExerciseId: sig.sessionExerciseId,
      name: sig.name,
      sets: Math.round((zone.setsMin + zone.setsMax) / 2),
      reps: Math.round((zone.repMin + zone.repMax) / 2),
      pct: pctMidpoint(zone.pctMin, zone.pctMax),
      restSec: sig.role === 'accessory' ? BACKFILL_REST_SEC_ACCESSORY : BACKFILL_REST_SEC_COMPOUND,
    })
  }

  return { exercises: kept, droppedIds, backfilledIds }
}

export interface ReconcileParams {
  modelPhase: PeriodizationPhase
  phaseAction: string
  currentPhase: PeriodizationPhase
  modelExercises: ReconcileExercise[]
  signalExercises: ReconcileSignalExercise[]
  trainingGoal: string
  deloadedIds: Set<string>
  deloadOverride: { sets: number; reps: number; pct: number; restSec: number }
}

export interface ReconcileResult {
  phase: PeriodizationPhase
  exercises: ReconcileExercise[]
  preDeloadById: Map<string, { sets: number; reps: number; pct: number; restSec: number }>
  droppedIds: string[]
  backfilledIds: string[]
}

// The single post-parse reconciliation pass — call once, right after
// `parsed = result.object`, before autoregulation/fitToBudget/persistence.
export function reconcilePrescription(params: ReconcileParams): ReconcileResult {
  const phase = resolvePhase(params.modelPhase, params.phaseAction, params.currentPhase)

  const normalizedExercises = params.modelExercises.map(ex => ({
    ...ex,
    pct: Math.min(100, Math.max(30, normalizePctFraction(ex.pct))),
  }))

  const { exercises, droppedIds, backfilledIds } = reconcilePrescriptionExercises(
    normalizedExercises, params.signalExercises, params.trainingGoal, phase,
  )

  // Per-exercise deload override — iterate the DETERMINISTIC deloadedIds set, not the
  // model's echo. reconcilePrescriptionExercises already guarantees every signals.exercises
  // id is present above, so every deloaded id is guaranteed found here; the fallback branch
  // only guards a future change to that guarantee, not today's expected path.
  const byId = new Map(exercises.map(ex => [ex.sessionExerciseId, ex]))
  const preDeloadById = new Map<string, { sets: number; reps: number; pct: number; restSec: number }>()
  for (const id of params.deloadedIds) {
    let target = byId.get(id)
    if (!target) {
      const sig = params.signalExercises.find(e => e.sessionExerciseId === id)
      target = { sessionExerciseId: id, name: sig?.name ?? id, sets: 0, reps: 0, pct: 0, restSec: 0 }
      exercises.push(target)
      byId.set(id, target)
    }
    preDeloadById.set(id, { sets: target.sets, reps: target.reps, pct: target.pct, restSec: target.restSec })
    target.sets = params.deloadOverride.sets
    target.reps = params.deloadOverride.reps
    target.pct = params.deloadOverride.pct
    target.restSec = params.deloadOverride.restSec
  }

  return { phase, exercises, preDeloadById, droppedIds, backfilledIds }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run lib/__tests__/reconcile-prescription.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/ai-periodization/reconcile-prescription.ts lib/__tests__/reconcile-prescription.test.ts
git commit -m "feat: add AI prescription reconciliation (drop/dedupe/backfill/deterministic deload)"
```

---

### Task 4: Wire the reconciliation pass into the prescribe route

**Files:**
- Modify: `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts`

No new pure logic is introduced in this task — Task 3's tests are the coverage for
the behavior. This task only rewires the route to call it. There is nothing safe to
unit-test in isolation here (route.ts can't be unit tested per this repo's
convention — see the plan header); verification is the full suite + typecheck +
manual dev-server check in Step 4.

- [ ] **Step 1: Replace the pct-normalize loop and the deload-override block**

Leave the `try { ... parsed = result.object ... } catch (err) { ... }` wrapper
(lines 220-241) exactly as it is — only two things inside/after it change:

1. Delete the pct-normalize `for` loop currently at lines 234-237 (immediately after
   `parsed = result.object`):
   ```ts
   for (const ex of parsed.exercises) {
     if (ex.pct > 0 && ex.pct <= 1) ex.pct *= 100
     ex.pct = Math.min(100, Math.max(30, ex.pct))
   }
   ```
   (its job — pct-fraction normalization — moves into `reconcilePrescription` below).

2. Delete the deload-override block currently at lines 243-255 (the comment,
   `preDeloadById` declaration, and the `for (const ex of parsed.exercises)` loop that
   iterates the model's own echo).

3. In their place (i.e. right after the `catch` block closes at line 241, where the
   deload-override block used to start), insert:

```ts
  // Single post-parse reconciliation pass — resolves the phase for a "stay" response,
  // normalizes ambiguous pct fractions, drops hallucinated ids, de-dupes, backfills any
  // model-omitted exercise, and applies the deterministic per-exercise deload override by
  // id (not by iterating the model's echo). See
  // docs/superpowers/plans/2026-07-05-ai-prescription-response-reconciliation.md.
  const reconciled = reconcilePrescription({
    modelPhase: parsed.phase as PeriodizationPhase,
    phaseAction: parsed.phase_action,
    currentPhase: state.phase,
    modelExercises: parsed.exercises.map(ex => ({
      sessionExerciseId: ex.session_exercise_id,
      name: ex.name,
      sets: ex.sets,
      reps: ex.reps,
      pct: ex.pct,
      restSec: ex.rest_sec,
    })),
    signalExercises: signals.exercises.map(e => ({
      sessionExerciseId: e.sessionExerciseId,
      name: e.name,
      role: e.role,
    })),
    trainingGoal: signals.trainingGoal,
    deloadedIds,
    deloadOverride: perExDeload.override,
  })
  if (reconciled.droppedIds.length > 0) {
    console.warn('[prescribe] dropped hallucinated session_exercise_id(s):', reconciled.droppedIds)
  }
  if (reconciled.backfilledIds.length > 0) {
    console.warn('[prescribe] backfilled model-omitted session_exercise_id(s):', reconciled.backfilledIds)
  }
  parsed.phase = reconciled.phase
  parsed.exercises = reconciled.exercises.map(ex => ({
    session_exercise_id: ex.sessionExerciseId,
    name: ex.name,
    sets: ex.sets,
    reps: ex.reps,
    pct: ex.pct,
    rest_sec: ex.restSec,
  }))
  const preDeloadById = reconciled.preDeloadById
```

Notes on this replacement:
- The `try { const result = await withAiRetry(...) ... parsed = result.object }` wrapper
  stays exactly as-is above this block — only the pct-normalize loop and the
  `preDeloadById`/echo-iterating deload-override loop that used to follow it are removed
  and replaced by the call above.
- `deloadedIds` and `perExDeload` are already in scope above this point (computed at
  lines 182-210, before the Gemini call) — unchanged.
- Everything from the old `// RPE-based autoregulation` comment onward (today's line 257)
  is **unchanged** — `autoreg`, `zone = intensityZone(...)`, `fitToBudget`, the duration
  estimate, `weeklyVolumeContribution`, and the final `aiPrescription` object all keep
  reading `parsed.exercises`/`parsed.phase`/`preDeloadById` exactly as they do today, now
  fed reconciled data instead of the raw model echo.

- [ ] **Step 2: Add the import**

Add to the top of the file:
```ts
import { reconcilePrescription } from '@/lib/ai-periodization/reconcile-prescription'
```

- [ ] **Step 3: Typecheck + run the full suite**

Run: `npx tsc --noEmit && pnpm test && pnpm lint`
Expected: all green.

- [ ] **Step 4: Manual verification on the local dev server**

The local seed data (`scripts/local-db/seed.sql`) does not include an AI Dynamic
Periodization program (no `is_ai_dynamic`/equivalent flag set on the seeded
program), and this sandbox cannot reproduce a real Gemini hallucination
deterministically — so a full live round-trip through `/api/ai-periodization/session/
[sessionId]/prescribe` exercising an actual dropped/duplicate/invented id is **not**
achievable end-to-end here. At minimum:
1. Run `pnpm dev`, confirm the route still returns 200 for a normal (non-malformed)
   prescription call if an AI-dynamic program + completed baseline can be set up
   locally (create one via the program builder with periodization enabled, log
   enough sessions to clear baseline).
2. Confirm no regression in the ordinary path: `prescription.exercises.length`
   equals the session's exercise count, no `dropped`/`backfilled` warnings appear in
   the server log for a well-formed response.
3. If the user has a production account showing the "dropped exercise" Known Issue,
   ask them to trigger a fresh prescription (or wait for the next auto-regeneration
   after a workout) and confirm in the server logs that a `[prescribe] backfilled
   model-omitted session_exercise_id(s)` warning now appears instead of the
   exercise silently vanishing from the card.

- [ ] **Step 5: Commit**

```bash
git add app/api/ai-periodization/session/\[sessionId\]/prescribe/route.ts
git commit -m "fix: reconcile the AI prescription response before it drives the workout"
```

- [ ] **Step 6: Bump version + changelog if this ships**

Per CLAUDE.md, once this PR is merged to `main` (with user confirmation — this is a
code/deploy change, not docs-only), bump the patch version in `package.json` and add
an entry to `lib/changelog.ts` describing the user-visible effect ("AI prescriptions
no longer drop or duplicate exercises silently").

---

## Not exercised

- **A real Gemini hallucination of any of these exact shapes** (omitted id,
  duplicate id, invented id, `pct: 1`) — not reproduced live; the fix is verified
  against hand-constructed malformed responses in the Task 3 unit tests, which is
  the only deterministic way to exercise them. If the user later observes a
  malformed response of a shape not covered by these tests (e.g. a negative `sets`,
  which the schema already rejects, or an id belonging to a *different* session),
  that's a new gap, not a regression of this fix.
- **The local dev sandbox has no seeded AI Dynamic Periodization program** — Task 4
  Step 4's manual verification is best-effort; the primary correctness evidence for
  this bug class is the Task 3 unit suite, not a local end-to-end run.
- **Native/on-device behavior** — this is a server-side route + pure-function
  change with no device-specific surface (no safe-area, no Capacitor/SQLite, no
  offline outbox path — the prescribe route has no local-store or sync
  counterpart).
- **Production data** — whether any *currently stored* prescriptions in prod already
  contain a dropped/duplicate/hallucinated exercise from before this fix; this plan
  only prevents new occurrences going forward, it does not repair already-persisted
  rows. If that turns out to matter, it needs a follow-up data check, not a code
  change.
