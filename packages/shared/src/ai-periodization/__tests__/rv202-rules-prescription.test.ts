// RV-202 — what to prescribe when the model call fails.
//
// The 502 was not a quiet failure: `PRESCRIPTION_POLL_MAX = 10` polls at 3 s, so the lifter
// watched "Preparing your AI workout…" for about thirty seconds and then got the base program
// anyway. The rules plan is those same numbers, immediately.
//
// **The trap this file mostly exists to guard** is that the only deterministic builder already
// present was `buildWholeSessionDeloadPrescription`, and reaching for it here would have
// prescribed a DELOAD to everyone whose Gemini call timed out — a training decision made by an
// outage. So the first assertions are that the plan is not a deload and does not move the phase.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildRulesPrescription } from '../generate-prescription'
import type { PrescriptionSignals } from '../signals'

type Ex = PrescriptionSignals['exercises'][number]

const exercise = (over: Partial<Ex> = {}): Ex => ({
  sessionExerciseId: 'se-1',
  name: 'Bench Press',
  role: 'primary',
  muscleGroups: ['chest'],
  muscleAssignments: [{ muscle: 'chest', role: 'main' }],
  baseline1rm: 100,
  current1rm: 100,
  exerciseType: null,
  rm1Trend: 'flat',
  rm1ChangeKg: 0,
  avgSetDurationSec: 45,
  timeProfile: null,
  equipment: [],
  transitionSec: 240,
  plateau: false,
  rpeDelta: null,
  repCompletionRate: null,
  baseSets: [
    { pct: 80, reps: 5, restSec: 120 },
    { pct: 80, reps: 5, restSec: 120 },
    { pct: 80, reps: 5, restSec: 120 },
  ],
  ...over,
})

const signals = (over: Partial<PrescriptionSignals> = {}): PrescriptionSignals => ({
  trainingGoal: 'strength',
  autoApplyPrescriptions: false,
  effectiveTimeBudgetMin: 90,
  exercises: [exercise()],
  phase: 'accumulation',
  sessionsInPhase: 2,
  hoursSinceLastSession: 48,
  consecutiveSessionDaysOfThisType: 0,
  soreMusclesInSession: [],
  soreMusclesOutOfSession: [],
  sorenessLogDate: 'none',
  activeInjuredMusclesInSession: [],
  morningCheckin: null,
  rpeTrend: null,
  repCompletionRate: null,
  weeklyTargets: {},
  weeklyLogged: {},
  volumeBudgetPerMuscleGroup: {},
  acwr: null,
  sleepTrend: null,
  hrvTrend: null,
  spo2Trend: null,
  illness: null,
  externalReadiness: null,
  confidenceTier: 1,
  confidence: 0.5,
  confidenceReasons: [],
  selfReportedSick: false,
  sleepScoreTrend: null,
  tempZ: null,
  trainingLoadOts: null,
  trainingLoadHigh: null,
  resilienceLevel: null,
  ...over,
})

const build = (over: Partial<PrescriptionSignals> = {}) =>
  buildRulesPrescription(signals(over), 'because the coach was unreachable')

describe('the fallback is the program, not a deload', () => {
  it('does not deload, and does not say a deload was recommended', () => {
    const p = build()!
    expect(p.deload).toBe(false)
    expect(p.phaseAction).toBe('stay')
    expect(p.exercises.every(e => e.deloaded !== true)).toBe(true)
  })

  it('leaves the lifter in the phase they were already in', () => {
    // A plan built without the model must not move anyone through periodization.
    expect(build({ phase: 'intensification' })!.phase).toBe('intensification')
    expect(build({ phase: 'accumulation' })!.phase).toBe('accumulation')
  })

  it('prescribes the program\'s own numbers, set for set', () => {
    const p = build()!
    expect(p.exercises[0]).toMatchObject({ sets: 3, reps: 5, pct: 80, restSec: 120 })
  })

  it('marks itself as rules-built, so a later surface can say so', () => {
    expect(build()!.source).toBe('rules')
  })
})

describe('it is honest about being uninformed', () => {
  it('reports low confidence, not the deload builder\'s 1.0', () => {
    // Everything the model contributes — transitions, RPE autoregulation, per-exercise deloads —
    // is missing here. The numbers are sound and the judgement behind them is absent.
    const p = build()!
    expect(p.confidence).toBeLessThan(0.5)
    expect(p.confidenceReasons?.join(' ')).toMatch(/could not be reached/i)
  })
})

describe('an exercise with no style is skipped, never invented', () => {
  it('drops the style-less exercise and keeps the rest', () => {
    const p = build({
      exercises: [
        exercise({ sessionExerciseId: 'has-style' }),
        exercise({ sessionExerciseId: 'no-style', name: 'Cable Fly', baseSets: [] }),
      ],
    })!
    expect(p.exercises.map(e => e.sessionExerciseId)).toEqual(['has-style'])
  })

  it('returns null when NO exercise has one, so the caller keeps its error path', () => {
    // A prescription that fabricates a load is worse than no prescription.
    expect(build({ exercises: [exercise({ baseSets: [] })] })).toBeNull()
    expect(build({ exercises: [] })).toBeNull()
  })
})

describe('it is fitted to today\'s budget like any other plan', () => {
  it('trims sets when the session cannot fit, and does not when it can', () => {
    const roomy = build({ effectiveTimeBudgetMin: 90 })!
    const tight = build({ effectiveTimeBudgetMin: 5 })!
    expect(tight.exercises[0].sets).toBeLessThan(roomy.exercises[0].sets)
  })

  it('counts weekly volume from the FITTED sets, not the style\'s', () => {
    // The contribution has to describe the plan the lifter will actually do. Counting the
    // style's three sets while prescribing one would overstate the week silently.
    const tight = build({ effectiveTimeBudgetMin: 5 })!
    expect(tight.weeklyVolumeContribution.chest).toBe(tight.exercises[0].sets)
  })

  it('weights a secondary muscle at half, the same rule the model path uses', () => {
    const p = build({
      exercises: [exercise({
        muscleAssignments: [
          { muscle: 'chest', role: 'main' },
          { muscle: 'triceps', role: 'secondary' },
        ],
      })],
    })!
    expect(p.weeklyVolumeContribution.triceps).toBe(p.weeklyVolumeContribution.chest / 2)
  })

  it('estimates a duration rather than leaving it at zero', () => {
    expect(build()!.estimatedSessionDurationMin).toBeGreaterThan(0)
  })
})

/**
 * The wiring, at source level.
 *
 * No harness drives the real `generatePrescriptionForSession` with a failing model: it would mean
 * mocking the AI SDK, `aiModel`, `loggedGenerateText` and ~30 repository reads, and the route test
 * one level up mocks the whole generator away. So the behaviour above is tested directly on the
 * builder, and what follows pins only that the catch branch reaches it and does not store what it
 * returns. **That is weaker than a run** — it cannot prove the branch is reachable, only that it
 * says the right thing — and the honest place to prove reachability is a device or production
 * observation of a model outage.
 */
describe('the catch branch uses it, and does not persist what it returns', () => {
  const src = readFileSync(
    join(process.cwd(), 'packages/shared/src/ai-periodization/generate-prescription.ts'), 'utf8')
  const catchBranch = (() => {
    const i = src.indexOf("console.error('Gemini prescription generation failed:'")
    expect(i, 'the model-failure catch not found').toBeGreaterThan(-1)
    return src.slice(i, src.indexOf('\n  }\n', i))
  })()

  it('builds a rules prescription there rather than returning 502 outright', () => {
    expect(catchBranch).toMatch(/buildRulesPrescription/)
    expect(catchBranch).toMatch(/ok: true/)
  })

  /**
   * The load-bearing one. `storePrescription` holds a plan for seven days, so persisting this
   * would give the model no further attempt until it expired — one provider blip becoming a week
   * of uninformed plans. That is the shape RV-69 fixed for the digests, and the reason the
   * degraded recap is never cached there either.
   */
  it('NEVER stores it — the next open must re-run the model', () => {
    // Matched as a CALL, not as the identifier: the branch's own comment explains why it does not
    // persist, and naming the function there made the looser assertion fail on the explanation.
    expect(catchBranch).not.toMatch(/storePrescription\s*\(/)
    expect(catchBranch).not.toMatch(/advancePhase\s*\(/)
  })

  it('keeps the 502 for the case the builder cannot serve', () => {
    expect(catchBranch).toMatch(/status: 502/)
  })
})
