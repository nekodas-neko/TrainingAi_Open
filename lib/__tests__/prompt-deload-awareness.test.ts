import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, buildUserPrompt } from '@trainingai/shared/ai-periodization/prompt'
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
  soreMusclesInSession: ['glutes'], soreMusclesOutOfSession: [], sorenessLogDate: 'today',
  activeInjuredMusclesInSession: [],
  morningCheckin: null,
  rpeTrend: null, repCompletionRate: null,
  weeklyTargets: {}, weeklyLogged: {}, volumeBudgetPerMuscleGroup: {},
  acwr: null, sleepTrend: null, sleepScoreTrend: null, hrvTrend: null, spo2Trend: null,
  tempZ: null, externalReadiness: null,
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
