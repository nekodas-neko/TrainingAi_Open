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

/**
 * TN-57 — the prompt states the morning check-in as the lifter's own report.
 *
 * `aggregateSignals` now resolves `perceivedRecovery`/`sleepQualityFeel` through
 * `answeredMorningScales`, so a scale that was never moved arrives here as null. What this file
 * pins is the consequence: a null must render as the em dash, not as a number and not as the word
 * "null". Telling a model *"recovery 3"* when the lifter chose nothing is the same class of defect
 * the prose guards exist for — 78 of the owner's 97 rows carried exactly that 3.
 */
describe('the morning check-in line states only what was answered (TN-57)', () => {
  const withCheckin = (over: Partial<NonNullable<PrescriptionSignals['morningCheckin']>>) =>
    buildUserPrompt(
      { ...baseSignals, morningCheckin: {
        wakeMood: null, perceivedRecovery: null, sleepQualityFeel: null,
        restingSoreness: null, illnessContext: null, ...over,
      } },
      state, '2026-07-16',
    )

  it('renders an unanswered scale as the em dash, never as a number', () => {
    const p = withCheckin({})
    expect(p).toContain('Morning check-in (1=best, 5=worst): recovery —, sleep feel —, soreness —')
    expect(p).not.toContain('recovery null')
    expect(p).not.toContain('recovery 3')
  })

  it('renders a scale that was answered', () => {
    expect(withCheckin({ perceivedRecovery: 5 })).toContain('recovery 5, sleep feel —')
  })

  /** A genuinely answered 3 is indistinguishable from the seed by value alone — only the flag tells them apart, upstream. */
  it('renders an answered 3, which is the value the sheet also seeds', () => {
    expect(withCheckin({ perceivedRecovery: 3 })).toContain('recovery 3')
  })

  it('still says nothing was logged when there is no check-in at all', () => {
    expect(buildUserPrompt(baseSignals, state, '2026-07-16')).toContain('Morning check-in: not logged today')
  })
})
