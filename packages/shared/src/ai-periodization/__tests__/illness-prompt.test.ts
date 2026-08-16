import { describe, it, expect } from 'vitest'
import type { SessionPeriodization } from '@trainingai/shared/types/ai-periodization'
import type { PrescriptionSignals } from '../signals'
import { buildSystemPrompt, buildUserPrompt } from '../prompt'

// Minimal but complete signals object — every required field, neutral values.
const baseSignals: PrescriptionSignals = {
  trainingGoal: 'strength',
  autoApplyPrescriptions: false,
  effectiveTimeBudgetMin: 60,
  exercises: [],
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
}
// buildUserPrompt never dereferences state (verified) — a cast keeps the test honest about that.
const state = {} as SessionPeriodization

describe('illness in the periodization prompt', () => {
  it('renders the illness line when a flag is present', () => {
    const p = buildUserPrompt({ ...baseSignals, illness: { flag: 'elevated', score: 70 } }, state, '2026-07-16')
    expect(p).toContain('Illness radar (vs personal baseline): elevated (score 70/100)')
  })

  it('renders "no data" when null so the model omits it from reasoning', () => {
    expect(buildUserPrompt(baseSignals, state, '2026-07-16')).toContain('Illness radar: no data')
  })

  it('system prompt gates rest_day_recommended on elevated/fever and keeps watch advisory-only', () => {
    const s = buildSystemPrompt('strength')
    expect(s).toContain('illness radar is elevated or fever')
    expect(s).toContain('"watch" is context only')
  })
})
