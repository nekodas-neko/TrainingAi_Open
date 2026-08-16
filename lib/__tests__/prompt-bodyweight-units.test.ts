import { describe, it, expect } from 'vitest'
import { buildUserPrompt } from '@trainingai/shared/ai-periodization/prompt'
import { buildReviewUserPrompt } from '@trainingai/shared/workout/review/prompt'
import type { PrescriptionSignals } from '@trainingai/shared/ai-periodization/signals'
import type { SessionPeriodization } from '@trainingai/shared/types/ai-periodization'

const signals = (over: Partial<PrescriptionSignals> = {}): PrescriptionSignals => ({
  trainingGoal: 'powerbuilding',
  autoApplyPrescriptions: false,
  effectiveTimeBudgetMin: 60,
  exercises: [
    {
      sessionExerciseId: 'ex-1', name: 'Hip Thrust', role: 'primary',
      muscleGroups: ['glutes'], muscleAssignments: [{ muscle: 'glutes', role: 'main' }],
      baseline1rm: 100, current1rm: 120, rm1Trend: 'flat', rm1ChangeKg: 0,
      avgSetDurationSec: 40, timeProfile: null, equipment: ['barbell'], transitionSec: 240,
      plateau: false, rpeDelta: null, repCompletionRate: null,
    },
  ],
  phase: 'accumulation', sessionsInPhase: 2,
  hoursSinceLastSession: 72, consecutiveSessionDaysOfThisType: 1,
  soreMusclesInSession: [], soreMusclesOutOfSession: [], sorenessLogDate: 'none',
  activeInjuredMusclesInSession: [],
  morningCheckin: null,
  rpeTrend: null, repCompletionRate: null,
  weeklyTargets: {}, weeklyLogged: {}, volumeBudgetPerMuscleGroup: {},
  acwr: null, sleepTrend: null, sleepScoreTrend: null, hrvTrend: null, spo2Trend: null,
  tempZ: null, illness: null, externalReadiness: null,
  confidenceTier: 2, confidence: 0.7, confidenceReasons: [],
  ...over,
})


const state = { phase: 'accumulation', sessionsInPhase: 2 } as unknown as SessionPeriodization

// Q-19b: these prompts feed the model, not the user, but a bodyweight 1RM is an internal
// kg-domain number — quoting "118 kg" for a Pull-Up invites the model to prescribe a load
// that does not exist for that movement.
const bodyweight = signals({
  exercises: [{
    sessionExerciseId: 'ex-1', name: 'Pull-Up', role: 'primary',
    muscleGroups: ['lats'], muscleAssignments: [{ muscle: 'lats', role: 'main' }],
    baseline1rm: 110, current1rm: 118, exerciseType: 'bodyweight',
    rm1Trend: 'up', rm1ChangeKg: 8,
    avgSetDurationSec: 40, timeProfile: null, equipment: [], transitionSec: 240,
    plateau: false, rpeDelta: null, repCompletionRate: null,
  }],
})
const weighted = signals({
  exercises: [{
    ...bodyweight.exercises[0], name: 'Barbell Bench Press', exerciseType: 'weighted',
  }],
})

describe('prompt 1RM units (Q-19b)', () => {
  it('gives a bodyweight 1RM as reps, never kilograms', () => {
    const p = buildUserPrompt(bodyweight, state, '2026-07-28')
    expect(p).toContain('RM')
    expect(p).not.toMatch(/current_1rm: 118 kg/)
    expect(p).not.toMatch(/baseline_1rm: 110 kg/)
  })

  it('still uses kilograms for a weighted exercise', () => {
    const p = buildUserPrompt(weighted, state, '2026-07-28')
    expect(p).toContain('current_1rm: 118 kg')
  })

  it('reports the trend change in reps for bodyweight, not kg', () => {
    expect(buildUserPrompt(bodyweight, state, '2026-07-28')).not.toMatch(/rm1_trend: up \+8\.0 kg/)
  })

  it('the review prompt renders the same way', () => {
    const p = buildReviewUserPrompt(bodyweight, new Map(), '2026-07-28')
    expect(p).toContain('RM')
    expect(p).not.toMatch(/current_1rm: 118 kg/)
  })
})
