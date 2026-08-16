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

describe('buildUserPrompt — temp + sleep-quality signals', () => {
  it('renders temp_z with a sign when present', () => {
    const p = buildUserPrompt(signals({ tempZ: 2.7 }), state, '2026-07-16')
    expect(p).toContain('Skin temp deviation')
    expect(p).toContain('+2.7')
  })

  it('renders temp_z "no data" when null', () => {
    const p = buildUserPrompt(signals(), state, '2026-07-16')
    expect(p).toContain('Skin temp deviation (temp_z): no data')
  })

  it('renders the sleep quality trend when present, alongside the duration trend', () => {
    const p = buildUserPrompt(signals({ sleepTrend: 0.95, sleepScoreTrend: 0.72 }), state, '2026-07-16')
    expect(p).toContain('Sleep trend (recent/baseline ratio): 0.95')
    expect(p).toContain('Sleep quality trend')
    expect(p).toContain('0.72')
  })

  it('renders sleep quality "no data" when null', () => {
    expect(buildUserPrompt(signals(), state, '2026-07-16')).toContain('Sleep quality trend: no data')
  })
})

describe('buildSystemPrompt — rest-day rule covers temperature + sleep quality', () => {
  const p = buildSystemPrompt('powerbuilding')
  it('folds temp_z into rest_day_recommended at the shared fever threshold', () => {
    expect(p).toContain('temp_z >= 2.5')
  })
  it('prefers sleep_score_trend, keeping sleep_trend as the fallback', () => {
    expect(p).toContain('sleep_score_trend')
    expect(p).toContain('sleep_trend')
  })
})
