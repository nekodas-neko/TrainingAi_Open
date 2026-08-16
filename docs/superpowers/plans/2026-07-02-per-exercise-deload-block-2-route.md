# Per-Exercise Deload — Block 2: Prescribe Route Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `computePerExerciseDeload()` (Block 1) into the prescribe route: whole-session offers for >50% soreness, deterministic per-exercise overrides after the LLM, autoregulation/clamp exclusion, and the new prescription fields.

**Architecture:** The route computes the deload decision before the LLM call. `whole_session` short-circuits into a pending deload offer (reusing the emergency-deload construction, extracted into a local helper). `per_exercise` informs the prompt, then overwrites the affected exercises after parsing — capturing the LLM's originals into `preDeload` for the Block 4 undo. Deloaded exercises are excluded from autoregulation and from `clampPrescribedPct` (the zone floor would otherwise clamp the ~52% deload away).

**Tech Stack:** TypeScript, vitest, existing route `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts`.

**Depends on:** Block 1 (`lib/ai-periodization/per-exercise-deload.ts`, `lib/ai-periodization/deload-constants.ts`) must be merged/committed first.

---

### Task 1: Prescription type extensions

**Files:**
- Modify: `lib/types/ai-periodization.ts:23-33` (`AiPrescriptionExercise`)

- [ ] **Step 1: Add the three optional fields**

```ts
export interface AiPrescriptionExercise {
  sessionExerciseId: string
  name: string
  sets: number
  reps: number
  pct: number
  restSec: number
  // Plain-English note when RPE autoregulation adjusted this exercise's load/reps/sets
  // (e.g. "−7.5% load — RPE ran high while your 1RM slipped"). Absent when unchanged.
  autoregNote?: string
  // Per-exercise deload (mood-log soreness on this exercise's main muscles while the
  // rest of the session trains normally). preDeload keeps the model's original
  // prescription so the user can revert to full weights on the pre-workout screen.
  deloaded?: boolean
  deloadNote?: string
  preDeload?: { sets: number; reps: number; pct: number; restSec: number }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean (optional fields — no consumers break).

- [ ] **Step 3: Commit**

```bash
git add lib/types/ai-periodization.ts
git commit -m "Add per-exercise deload fields to AiPrescriptionExercise"
```

---

### Task 2: Prompt awareness

**Files:**
- Modify: `lib/ai-periodization/prompt.ts` (`buildSystemPrompt` session_swap rule ~line 103; `buildUserPrompt` signature line 134 and recovery block ~line 176)
- Test: `lib/__tests__/prompt-deload-awareness.test.ts` (create)

- [ ] **Step 1: Write the failing test**

`buildUserPrompt` requires full fixtures — build them with factories:

```ts
import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, buildUserPrompt } from '@/lib/ai-periodization/prompt'
import type { PrescriptionSignals } from '@/lib/ai-periodization/signals'
import type { SessionPeriodization } from '@/lib/types/ai-periodization'

const signals = (over: Partial<PrescriptionSignals> = {}): PrescriptionSignals => ({
  trainingGoal: 'powerbuilding',
  autoApplyPrescriptions: false,
  effectiveTimeBudgetMin: 60,
  exercises: [
    {
      sessionExerciseId: 'ex-1', name: 'Hip Thrust', role: 'primary',
      muscleGroups: ['glutes'], muscleAssignments: [{ muscle: 'glutes', role: 'main' }],
      baseline1rm: 100, current1rm: 120, rm1Trend: 'flat', rm1ChangeKg: 0,
      avgSetDurationSec: 40, rpeDelta: null, repCompletionRate: null,
    },
  ],
  phase: 'accumulation', sessionsInPhase: 2,
  hoursSinceLastSession: 72, consecutiveSessionDaysOfThisType: 1,
  soreMusclesInSession: ['glutes'], soreMusclesOutOfSession: [], sorenessLogDate: 'today',
  rpeTrend: null, repCompletionRate: null,
  weeklyTargets: {}, weeklyLogged: {}, volumeBudgetPerMuscleGroup: {},
  acwr: null, sleepTrend: null, hrvTrend: null, externalReadiness: null,
  confidenceTier: 2, confidence: 0.7, confidenceReasons: [],
  ...over,
})

const state = {
  phase: 'accumulation', sessionsInPhase: 2,
} as unknown as SessionPeriodization

describe('buildUserPrompt — per-exercise deload awareness', () => {
  it('appends the handled-soreness line when deloaded exercise names are passed', () => {
    const p = buildUserPrompt(signals(), state, '2026-07-02', ['Hip Thrust', 'Glute Kickback'])
    expect(p).toContain('Per-exercise deloads already applied to: Hip Thrust, Glute Kickback')
    expect(p).toContain('do NOT recommend a rest day or session swap for this soreness')
  })

  it('omits the line when no names are passed (back-compat)', () => {
    const p = buildUserPrompt(signals(), state, '2026-07-02')
    expect(p).not.toContain('Per-exercise deloads already applied')
  })
})

describe('buildSystemPrompt — session_swap rule carve-out', () => {
  it('tells the model soreness handled by per-exercise deloads is not a swap trigger', () => {
    const p = buildSystemPrompt('powerbuilding')
    expect(p).toContain('per-exercise deloads')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run lib/__tests__/prompt-deload-awareness.test.ts`
Expected: FAIL — `buildUserPrompt` takes 3 arguments; assertions on missing text fail.

- [ ] **Step 3: Implement the prompt changes**

In `buildSystemPrompt`, extend the `session_swap_recommended` rule (currently ~lines 103–105) to:

```
- "session_swap_recommended": sore_muscles_in_session is non-empty and hours_since_last_session < 36;
  the user should consider training a different session today that avoids those muscles.
  Still provide a full exercise prescription (used if they choose to train anyway).
  EXCEPTION: if the input states per-exercise deloads were already applied for this
  soreness, it is handled — do not use this action (or rest_day_recommended) for that
  soreness alone.
```

In `buildUserPrompt`, add the optional parameter and the recovery-section line:

```ts
export function buildUserPrompt(
  signals: PrescriptionSignals,
  state: SessionPeriodization,
  today: string,
  perExerciseDeloadedNames?: string[],
): string {
```

After the `recoveryLines` array is built (line ~176), append:

```ts
  if (perExerciseDeloadedNames && perExerciseDeloadedNames.length > 0) {
    recoveryLines.push(
      `  Per-exercise deloads already applied to: ${perExerciseDeloadedNames.join(', ')} — ` +
      `this soreness is handled; prescribe the session normally and do NOT recommend a rest day or session swap for this soreness alone.`,
    )
  }
```

- [ ] **Step 4: Run the new tests + full suite**

Run: `pnpm exec vitest run lib/__tests__/prompt-deload-awareness.test.ts && pnpm test`
Expected: PASS; no other prompt tests broken.

- [ ] **Step 5: Commit**

```bash
git add lib/ai-periodization/prompt.ts lib/__tests__/prompt-deload-awareness.test.ts
git commit -m "Teach prescription prompts about per-exercise deloads

The model must not double-handle soreness the deterministic layer already
deloaded — without the carve-out it recommends a session swap or rest day
on top of the per-exercise cuts."
```

---

### Task 3: Extract the whole-session deload builder

**Files:**
- Modify: `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts:109-172` (emergency-deload block)

- [ ] **Step 1: Extract the construction into a local helper**

Pure refactor — move the emergency block's prescription construction (lines ~110–160) into a function in the same route file, above `POST`:

```ts
import type { PrescriptionSignals } from '@/lib/ai-periodization/signals'

function buildWholeSessionDeloadPrescription(
  signals: PrescriptionSignals,
  reasoning: string,
): AiPrescription {
  const goal = signals.trainingGoal
  const pct = DELOAD_LOWER_PCT[goal] ?? 50
  const reps = DELOAD_REPS[goal] ?? 8

  const fittedDeload = new Map(
    fitToBudget(
      signals.exercises.map(ex => ({
        sessionExerciseId: ex.sessionExerciseId,
        role: ex.role,
        sets: DELOAD_SETS,
        reps,
        restSec: DELOAD_REST,
      })),
      signals.effectiveTimeBudgetMin,
    ).map(f => [f.sessionExerciseId, f.sets]),
  )

  const exercises: AiPrescriptionExercise[] = signals.exercises.map(ex => ({
    sessionExerciseId: ex.sessionExerciseId,
    name: ex.name,
    sets: fittedDeload.get(ex.sessionExerciseId) ?? DELOAD_SETS,
    reps,
    pct,
    restSec: DELOAD_REST,
  }))

  const estimatedSessionDurationMin = estimateSessionDurationMin(
    exercises.map(ex => ({ sets: ex.sets, reps: ex.reps, restSec: ex.restSec })),
  )

  const weeklyVolumeContribution: Record<string, number> = {}
  for (const ex of exercises) {
    const signal = signals.exercises.find(e => e.sessionExerciseId === ex.sessionExerciseId)
    if (!signal) continue
    for (const ma of signal.muscleAssignments) {
      const weight = ma.role === 'main' ? 1.0 : 0.5
      const muscle = ma.muscle.toLowerCase()
      weeklyVolumeContribution[muscle] = (weeklyVolumeContribution[muscle] ?? 0) + ex.sets * weight
    }
  }

  return {
    phase: 'deload',
    phaseAction: 'deload_recommended',
    exercises,
    estimatedSessionDurationMin,
    weeklyVolumeContribution,
    deload: true,
    reasoning,
    confidence: 1.0,
  }
}
```

The emergency block shrinks to:

```ts
  if (isEmergencyDeload) {
    const prescription = buildWholeSessionDeloadPrescription(
      signals,
      'Emergency deload triggered due to overtraining signals.',
    )
    const expiresAt = new Date(Date.now() + 7 * 86_400_000)
    await repo.storePrescription(userId, programSessionId, prescription, expiresAt)
    return NextResponse.json({
      prescription,
      prescriptionStatus: 'pending',
      estimatedSessionDurationMin: prescription.estimatedSessionDurationMin,
    })
  }
```

Note: `AiPrescriptionExercise` is already imported in the route (line 20); `estimatedSessionDurationMin` moves inside the prescription object — the JSON response reads it from there, matching the emergency response shape today.

- [ ] **Step 2: Verify no behaviour change**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: clean. This is a pure move; the emergency path's stored prescription and response are byte-identical.

- [ ] **Step 3: Commit**

```bash
git add app/api/ai-periodization/session/\[sessionId\]/prescribe/route.ts
git commit -m "Extract whole-session deload prescription builder

The soreness-driven whole-session offer (per-exercise deload spec) reuses
the same construction as the emergency deload; extract it before wiring."
```

---

### Task 4: Route wiring

**Files:**
- Modify: `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts`

- [ ] **Step 1: Compute the deload decision after the emergency check**

Add the import:

```ts
import { computePerExerciseDeload } from '@/lib/ai-periodization/per-exercise-deload'
```

Immediately after the `isEmergencyDeload` block (i.e. once we know the emergency path didn't fire), insert:

```ts
  // Per-exercise deload — deterministic soreness handling (see
  // docs/superpowers/specs/2026-07-02-per-exercise-deload-design.md).
  // Runs after the emergency check: a systemic emergency outranks soreness.
  const perExDeload = computePerExerciseDeload(
    signals.exercises.map(e => ({
      sessionExerciseId: e.sessionExerciseId,
      name: e.name,
      muscleAssignments: e.muscleAssignments,
    })),
    signals.soreMusclesInSession,
    signals.trainingGoal,
    state.phase,
  )

  if (perExDeload.outcome === 'whole_session') {
    const muscles = perExDeload.matchedMuscles.join(', ')
    const prescription = buildWholeSessionDeloadPrescription(
      signals,
      `Most of this session's muscles are still sore (${muscles}) — a lighter full-session deload will serve recovery better than training through it.`,
    )
    // Soreness is a per-day signal — expire tomorrow so a clean check-in
    // gets a fresh decision (the emergency offer keeps its 7-day window).
    const expiresAt = new Date(Date.now() + 86_400_000)
    await repo.storePrescription(userId, programSessionId, prescription, expiresAt)
    return NextResponse.json({
      prescription,
      prescriptionStatus: 'pending',
      estimatedSessionDurationMin: prescription.estimatedSessionDurationMin,
    })
  }

  const deloadedIds = perExDeload.outcome === 'per_exercise' ? perExDeload.deloadedIds : new Set<string>()
```

- [ ] **Step 2: Pass the deloaded names to the prompt**

Change the `buildUserPrompt` call to:

```ts
  const deloadedNames = signals.exercises
    .filter(e => deloadedIds.has(e.sessionExerciseId))
    .map(e => e.name)
  const userPrompt = buildUserPrompt(signals, state, today, deloadedNames.length > 0 ? deloadedNames : undefined)
```

- [ ] **Step 3: Override deloaded exercises after parsing, capturing preDeload**

Directly after `parsed = PrescriptionSchema.parse(...)` succeeds:

```ts
  // Deterministic override: the model was told about these deloads, but it can
  // never fight them — its original numbers are kept for the pre-workout undo.
  const preDeloadById = new Map<string, { sets: number; reps: number; pct: number; restSec: number }>()
  for (const ex of parsed.exercises) {
    if (!deloadedIds.has(ex.session_exercise_id)) continue
    preDeloadById.set(ex.session_exercise_id, {
      sets: ex.sets, reps: ex.reps, pct: ex.pct, restSec: ex.rest_sec,
    })
    ex.sets = perExDeload.override.sets
    ex.reps = perExDeload.override.reps
    ex.pct = perExDeload.override.pct
    ex.rest_sec = perExDeload.override.restSec
  }
```

- [ ] **Step 4: Exclude deloaded exercises from autoregulation and the clamp**

Filter **both** input arrays of `applyAutoregulation` (the clamp loop keys off
`autoregById`, so exclusion here also skips `clampPrescribedPct` — which would
otherwise raise the ~52% deload pct back up to the phase-zone floor):

```ts
  const autoreg = applyAutoregulation(
    parsed.exercises
      .filter(ex => !deloadedIds.has(ex.session_exercise_id))
      .map(ex => ({
        sessionExerciseId: ex.session_exercise_id,
        sets: ex.sets,
        reps: ex.reps,
        pct: ex.pct,
      })),
    signals.exercises
      .filter(e => !deloadedIds.has(e.sessionExerciseId))
      .map(e => ({
        sessionExerciseId: e.sessionExerciseId,
        role: e.role,
        rpeDelta: e.rpeDelta,
        rm1Trend: e.rm1Trend,
        repCompletionRate: e.repCompletionRate,
      })),
    signals.trainingGoal,
    parsed.phase,
  )
```

The existing loop (`for (const ex of parsed.exercises) { const a = autoregById.get(...); if (!a) continue; ... }`) already skips exercises without an autoreg entry — no further change needed there. `fitToBudget` and `weeklyVolumeContribution` are untouched: they compute from the final (overridden) sets, which is correct.

- [ ] **Step 5: Carry the new fields onto the stored prescription**

In the `aiPrescription.exercises` map:

```ts
    exercises: parsed.exercises.map(ex => ({
      sessionExerciseId: ex.session_exercise_id,
      name: ex.name,
      sets: ex.sets,
      reps: ex.reps,
      pct: ex.pct,
      restSec: ex.rest_sec,
      autoregNote: autoreg.notes[ex.session_exercise_id],
      ...(deloadedIds.has(ex.session_exercise_id) && {
        deloaded: true,
        deloadNote: perExDeload.notes[ex.session_exercise_id],
        preDeload: preDeloadById.get(ex.session_exercise_id),
      }),
    })),
```

Auto-apply needs no change: a per-exercise-deloaded prescription keeps the LLM's
`phaseAction` (told to `stay`), so it rides the existing auto-apply/pending rules.

- [ ] **Step 6: Typecheck + full suite**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: clean.

- [ ] **Step 7: Runtime verification on the local dev server**

1. `pnpm dev` (local Postgres on 5433 is set up by the session hook).
2. Log in as `test@local.dev` / `testpass123`.
3. Complete a mood check-in reporting sore muscles that match a **minority** of the seeded Legs session's exercises (e.g. glutes only).
4. Open session-select → trigger the prescription for that session. Verify in the network response: the glute exercises carry `deloaded: true`, `deloadNote`, `preDeload`, and deload-zone numbers (2 sets, ~52%); other exercises are normal; `phase_action` is not a rest/swap recommendation.
5. Re-do the check-in with sore muscles covering **most** of the session (e.g. glutes + quads + hamstrings on Legs). Verify the response is a pending whole-session deload (`phaseAction: 'deload_recommended'`, all exercises at deload values, reasoning naming the muscles).
6. Clear the soreness (clean check-in) and verify a normal prescription returns after the 24h offer expires or is declined — at minimum verify declining works via the existing card.

Not exercisable here: real Gemini variance (the override is deterministic regardless), APK behaviour.

- [ ] **Step 8: Commit**

```bash
git add app/api/ai-periodization/session/\[sessionId\]/prescribe/route.ts
git commit -m "Wire per-exercise deload into the prescribe route

Soreness on half or fewer of a session's exercises deloads just those in
place (model overridden post-parse, originals kept for undo, autoreg and
zone clamp skip them). Soreness on most of the session becomes a pending
whole-session deload offer with a 24h expiry so a clean check-in gets a
fresh decision."
```

---

## Self-Review Notes

- **Spec coverage (Block 2 scope):** whole-session offer (>50%, pending, decline-able, emergency-shape), prompt awareness (system + user), post-parse override with `preDeload` capture, autoreg exclusion, clamp exemption, unchanged time budget / volume contribution, auto-apply unaffected — all present. PR gate = Block 3; UI = Block 4.
- **Type consistency:** consumes Block 1's `outcome`/`deloadedIds`/`notes`/`matchedMuscles`/`override` exactly as defined; `preDeload` shape matches the Task 1 type; `buildUserPrompt`'s 4th param matches Task 2's signature.
- **Deviation from spec worth noting:** the soreness-driven whole-session offer expires in **24h** (spec didn't fix a value; the emergency offer keeps 7 days). Rationale: soreness is a per-day signal and the route's pending-offer guard would otherwise replay a stale offer for a week.
- **Order subtlety encoded:** emergency check → per-exercise deload → LLM. `phase === 'deload'` no-op lives inside the Block 1 module.
