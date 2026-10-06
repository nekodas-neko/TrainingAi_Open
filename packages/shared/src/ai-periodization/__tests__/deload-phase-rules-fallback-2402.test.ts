// #2402 — in a deload PHASE (a deload already accepted, `state.phase === 'deload'`) the bar deloads
// every exercise, and every set is logged as a deload. The no-AI fallback built the program as
// written (3×8 @ 75%) with `deload: false`, so the card's numbers and its Intensity toggle
// ("Full · As prescribed") described a session that never runs.
//
// RV-202's trap still stands and is guarded in rv202-rules-prescription.test.ts: an OUTAGE must not
// turn a normal phase into a deload. This is the other direction: the phase is already a deload,
// and the fallback must say so.
import { describe, it, expect } from 'vitest'
import { buildRulesPrescription, buildWholeSessionDeloadPrescription } from '../generate-prescription'
import { DELOAD_LOWER_PCT, DELOAD_REPS, DELOAD_SETS, DELOAD_REST } from '../deload-constants'
import type { PrescriptionSignals } from '../signals'

type Ex = PrescriptionSignals['exercises'][number]

const exercise = (over: Partial<Ex> = {}): Ex => ({
  sessionExerciseId: 'se-1', name: 'Bench Press', role: 'primary', muscleGroups: ['chest'],
  muscleAssignments: [{ muscle: 'chest', role: 'main' }],
  baseline1rm: 100, current1rm: 100, exerciseType: null, rm1Trend: 'flat', rm1ChangeKg: 0,
  avgSetDurationSec: 45, timeProfile: null, equipment: [], transitionSec: 240, plateau: false,
  rpeDelta: null, repCompletionRate: null,
  baseSets: [{ pct: 75, reps: 8, restSec: 90 }, { pct: 75, reps: 8, restSec: 90 }, { pct: 75, reps: 8, restSec: 90 }],
  ...over,
})

const signals = (over: Partial<PrescriptionSignals> = {}): PrescriptionSignals => ({
  trainingGoal: 'strength', autoApplyPrescriptions: false, effectiveTimeBudgetMin: 90,
  exercises: [exercise()], phase: 'deload', sessionsInPhase: 1, hoursSinceLastSession: 48,
  consecutiveSessionDaysOfThisType: 0, soreMusclesInSession: [], soreMusclesOutOfSession: [],
  sorenessLogDate: 'none', activeInjuredMusclesInSession: [], morningCheckin: null, rpeTrend: null,
  repCompletionRate: null, weeklyTargets: {}, weeklyLogged: {}, volumeBudgetPerMuscleGroup: {},
  acwr: null, sleepTrend: null, hrvTrend: null, spo2Trend: null, illness: null,
  externalReadiness: null, confidenceTier: 1, confidence: 0.5, confidenceReasons: [],
  selfReportedSick: false, sleepScoreTrend: null, tempZ: null, trainingLoadOts: null,
  trainingLoadHigh: null, resilienceLevel: null,
  ...over,
})

const build = (over: Partial<PrescriptionSignals> = {}) => buildRulesPrescription(signals(over), 'coach unreachable')!

describe('the fallback in a deload phase prescribes the deload the phase runs (#2402)', () => {
  it('carries the deload numbers, not the program as written', () => {
    const p = build()
    expect(p.exercises[0]).toMatchObject({
      sets: DELOAD_SETS, reps: DELOAD_REPS.strength, pct: DELOAD_LOWER_PCT.strength, restSec: DELOAD_REST,
    })
    expect(p.exercises[0].sets).not.toBe(3)
    expect(p.exercises[0].pct).not.toBe(75)
  })

  it('marks the plan and every exercise as a deload, so the card and the toggle say so', () => {
    const p = build({ exercises: [exercise(), exercise({ sessionExerciseId: 'se-2', name: 'Row' })] })
    expect(p.deload).toBe(true)
    expect(p.exercises.every(e => e.deloaded === true)).toBe(true)
  })

  it('matches the whole-session deload numbers, one definition of "deloaded"', () => {
    const s = signals()
    const whole = buildWholeSessionDeloadPrescription(s, 'x')
    const rules = buildRulesPrescription(s, 'x')!
    expect(rules.exercises.map(({ sessionExerciseId, sets, reps, pct, restSec }) => ({ sessionExerciseId, sets, reps, pct, restSec })))
      .toEqual(whole.exercises.map(({ sessionExerciseId, sets, reps, pct, restSec }) => ({ sessionExerciseId, sets, reps, pct, restSec })))
  })

  it('records the program as written as what Full reverts to', () => {
    // `preDeload` is what the Intensity toggle restores. The program as written is its own plan,
    // not the deload's, so it must come from the as-written builder, not from itself.
    expect(build().exercises[0].preDeload).toEqual({ sets: 3, reps: 8, pct: 75, restSec: 90 })
  })

  it('stays in the deload phase and does not re-offer a deload', () => {
    const p = build()
    expect(p.phase).toBe('deload')
    // `deload_recommended` on a stored prescription is what the accept route flips the phase on.
    // The phase is already a deload; there is nothing to offer.
    expect(p.phaseAction).toBe('stay')
  })

  it('is still honest about being rules-built and uninformed', () => {
    const p = build()
    expect(p.source).toBe('rules')
    expect(p.confidence).toBeLessThan(0.5)
    expect(p.confidenceReasons?.join(' ')).toMatch(/could not be reached/i)
  })

  it('still returns null when no exercise has a style, so the caller keeps its error path', () => {
    expect(buildRulesPrescription(signals({ exercises: [exercise({ baseSets: [] })] }), 'x')).toBeNull()
  })

  it('leaves every other phase as the program as written (RV-202 holds)', () => {
    for (const phase of ['accumulation', 'intensification', 'realisation']) {
      const p = build({ phase })
      expect(p.deload, phase).toBe(false)
      expect(p.exercises[0], phase).toMatchObject({ sets: 3, reps: 8, pct: 75 })
      expect(p.exercises.every(e => e.deloaded !== true), phase).toBe(true)
    }
  })
})

describe('the call site names the plan for what it is', () => {
  it('says "deload week" in a deload phase and "program as written" otherwise', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(__dirname, '..', 'generate-prescription.ts'), 'utf8')
    expect(src).toMatch(/state\.phase === 'deload'\s*\?\s*'Your AI coach could not be reached, so this is your deload week/)
    expect(src).toContain("so this is your program as written.'")
  })
})
