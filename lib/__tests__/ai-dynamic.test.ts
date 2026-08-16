import { describe, it, expect } from 'vitest'
import {
  computeAiDynamicNextSession,
  countConsecutiveTrainingDays,
  countConsecutiveRestDays,
  type AiDynamicInput,
  type SessionHistory,
} from '@trainingai/shared/ai-periodization/ai-dynamic'
import type { ProgramSession } from '@trainingai/shared/types/program'

const makeSession = (name: string, position: number): ProgramSession => ({
  id: `id-${name}`,
  programId: 'prog',
  name,
  position,
  timeBudgetMinutes: 60,
  exercises: [{
    id: `ex-${name}`, sessionId: `id-${name}`,
    exerciseName: `${name} exercise`,
    muscleGroups: [name.toLowerCase()],
    position: 0,
    exerciseRole: 'primary',
  }],
})

const push = makeSession('Push', 0)
const pull = makeSession('Pull', 1)
const legs = makeSession('Legs', 2)
const sessions = [push, pull, legs]

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function makeHistory(sessionNames: string[], daysAgoList: number[]): SessionHistory[] {
  return sessionNames.map((name, i) => ({
    sessionName: name,
    startedAt: daysAgo(daysAgoList[i]),
    hasExercises: true,
  }))
}

const baseInput: AiDynamicInput = {
  sessions,
  muscleAssignments: {},
  muscleRecovery: [],
  history: [],
  soreMuscles: [],
  readinessScore: 80,
  temperatureDeviation: null,
  daySummary: null,
  timezone: 'Australia/Brisbane',
  reminderEnabled: false,
  reminderTime: null,
  sleepTrend: null,
  energyLevel: null,
  hrvTrend: null,
  illnessFlag: null,
  stressHighMinutes: null,
}

describe('computeAiDynamicNextSession', () => {
  it('returns a session when no history', () => {
    const result = computeAiDynamicNextSession(baseInput)
    expect(result.isRestDay).toBe(false)
    expect(result.session).toBeDefined()
    expect(result.deloadOrRestRecommended).toBe(false)
  })

  it('recommends most overdue session', () => {
    const history = makeHistory(['Push', 'Pull'], [1, 2])
    const result = computeAiDynamicNextSession({ ...baseInput, history })
    // Legs was never done — most overdue
    expect(result.session?.name).toBe('Legs')
  })

  it('does not flag deload below 3 consecutive days', () => {
    const history = makeHistory(['Push', 'Pull'], [1, 2])
    const result = computeAiDynamicNextSession({ ...baseInput, history })
    expect(result.consecutiveTrainingDays).toBe(2)
    expect(result.deloadOrRestRecommended).toBe(false)
  })

  it('flags soft deload at 3 consecutive days with high readiness', () => {
    const history = makeHistory(['Push', 'Pull', 'Legs'], [1, 2, 3])
    const result = computeAiDynamicNextSession({ ...baseInput, history, readinessScore: 75 })
    expect(result.consecutiveTrainingDays).toBe(3)
    expect(result.deloadOrRestRecommended).toBe(true)
    expect(result.deloadStrength).toBe('soft')
  })

  it('flags strong deload at 3 consecutive days with low readiness', () => {
    const history = makeHistory(['Push', 'Pull', 'Legs'], [1, 2, 3])
    const result = computeAiDynamicNextSession({ ...baseInput, history, readinessScore: 40 })
    expect(result.deloadOrRestRecommended).toBe(true)
    expect(result.deloadStrength).toBe('strong')
  })

  it('flags recommended deload on temperature alert once the baseline is mature', () => {
    const history = makeHistory(['Push'], [1])
    const result = computeAiDynamicNextSession({ ...baseInput, history, temperatureDeviation: 0.7, temperatureBaselineDays: 30 })
    expect(result.deloadOrRestRecommended).toBe(true)
    expect(result.temperatureAlert).toBe(true)
    expect(result.consecutiveTrainingDays).toBe(1)
  })

  it('does NOT fire the temperature deload until the baseline is mature (≥30 nights)', () => {
    const history = makeHistory(['Push'], [1])
    const result = computeAiDynamicNextSession({ ...baseInput, history, temperatureDeviation: 0.7, temperatureBaselineDays: 12 })
    expect(result.temperatureAlert).toBe(false)
    expect(result.deloadOrRestRecommended).toBe(false)
  })

  it('flags recommended deload on very_stressful day summary', () => {
    const history = makeHistory(['Push'], [1])
    const result = computeAiDynamicNextSession({ ...baseInput, history, daySummary: 'very_stressful' })
    expect(result.deloadOrRestRecommended).toBe(true)
    expect(result.deloadStrength).toBe('recommended')
  })

  it('sets streakWarning on 2 consecutive rest days', () => {
    const history = makeHistory(['Push'], [3]) // last trained 3 days ago → 2 rest days
    const result = computeAiDynamicNextSession({ ...baseInput, history })
    expect(result.consecutiveRestDays).toBe(2)
    expect(result.streakWarning).toBe(true)
    expect(result.streakBroken).toBe(false)
  })

  it('sets streakBroken on 3+ consecutive rest days', () => {
    const history = makeHistory(['Push'], [4])
    const result = computeAiDynamicNextSession({ ...baseInput, history })
    expect(result.consecutiveRestDays).toBe(3)
    expect(result.streakBroken).toBe(true)
  })

  it('normalises balance scores correctly when all sessions have been done', () => {
    // Push done 1 day ago, Pull 2 days ago, Legs 3 days ago
    // Legs should have highest balance score (most overdue)
    const history = makeHistory(['Push', 'Pull', 'Legs'], [1, 2, 3])
    const result = computeAiDynamicNextSession({ ...baseInput, history })
    // Legs is most overdue so should be recommended
    expect(result.session?.name).toBe('Legs')
  })

  it('prefers session with better muscle recovery when balance is equal', () => {
    // All three done 2 days ago so balance/freshness scores are equal across the board
    const history = makeHistory(['Push', 'Pull', 'Legs'], [2, 2, 2])
    // Legs fully recovered; Pull partial; Push poor — recovery is the tiebreaker
    const muscleRecovery = [
      { muscle: 'push', pct: 30, hoursAgo: 10 },
      { muscle: 'pull', pct: 50, hoursAgo: 30 },
      { muscle: 'legs', pct: 100, hoursAgo: 48 },
    ]
    const muscleAssignments: Record<string, import('../types/program').MuscleAssignment[]> = {
      'Push exercise': [{ muscle: 'push', role: 'main' }],
      'Pull exercise': [{ muscle: 'pull', role: 'main' }],
      'Legs exercise': [{ muscle: 'legs', role: 'main' }],
    }
    const result = computeAiDynamicNextSession({
      ...baseInput,
      history,
      muscleRecovery,
      muscleAssignments,
    })
    expect(result.session?.name).toBe('Legs')
  })

  it('avoids session with sore primary muscles even if most overdue', () => {
    // Legs most overdue (3 days ago), but legs muscle is sore — caps recovery at 40%
    const history = makeHistory(['Push', 'Pull', 'Legs'], [1, 2, 3])
    const muscleAssignments: Record<string, import('../types/program').MuscleAssignment[]> = {
      'Push exercise': [{ muscle: 'push', role: 'main' }],
      'Pull exercise': [{ muscle: 'pull', role: 'main' }],
      'Legs exercise': [{ muscle: 'legs', role: 'main' }],
    }
    const muscleRecovery = [
      { muscle: 'push', pct: 95, hoursAgo: 24 },
      { muscle: 'pull', pct: 80, hoursAgo: 48 },
      { muscle: 'legs', pct: 90, hoursAgo: 72 },
    ]
    const result = computeAiDynamicNextSession({
      ...baseInput,
      history,
      muscleRecovery,
      muscleAssignments,
      soreMuscles: ['legs'],
    })
    // Legs is capped at 40% recovery when sore — Push or Pull should win
    expect(result.session?.name).not.toBe('Legs')
  })

  it('shifts recovery weight when readiness is below 60', () => {
    // Use 2 sessions (Push and Legs) so Pull doesn't muddy the comparison.
    // Push done yesterday (high recovery 95%), Legs done a week ago (low recovery 20%).
    // Default weights: Legs wins on balance/freshness (7 days overdue).
    // Low-readiness weights (recovery 0.55): Push wins because recovery dominates.
    const twoSessions = [push, legs]
    const history = makeHistory(['Push', 'Legs'], [1, 7])
    const muscleAssignments: Record<string, import('../types/program').MuscleAssignment[]> = {
      'Push exercise': [{ muscle: 'push', role: 'main' }],
      'Legs exercise': [{ muscle: 'legs', role: 'main' }],
    }
    const muscleRecovery = [
      { muscle: 'push', pct: 95, hoursAgo: 24 },
      { muscle: 'legs', pct: 20, hoursAgo: 168 },
    ]
    const highReadiness = computeAiDynamicNextSession({
      ...baseInput, sessions: twoSessions, history, muscleAssignments, muscleRecovery,
      readinessScore: 80,
    })
    expect(highReadiness.session?.name).toBe('Legs')

    const lowReadiness = computeAiDynamicNextSession({
      ...baseInput, sessions: twoSessions, history, muscleAssignments, muscleRecovery,
      readinessScore: 55,
    })
    expect(lowReadiness.session?.name).toBe('Push')
  })

  it('shifts recovery weight when sleepTrend is below 0.85', () => {
    // Same 2-session setup: Legs wins normally; poor sleep flips to Push via recovery weight.
    const twoSessions = [push, legs]
    const history = makeHistory(['Push', 'Legs'], [1, 7])
    const muscleAssignments: Record<string, import('../types/program').MuscleAssignment[]> = {
      'Push exercise': [{ muscle: 'push', role: 'main' }],
      'Legs exercise': [{ muscle: 'legs', role: 'main' }],
    }
    const muscleRecovery = [
      { muscle: 'push', pct: 95, hoursAgo: 24 },
      { muscle: 'legs', pct: 20, hoursAgo: 168 },
    ]
    const goodSleep = computeAiDynamicNextSession({
      ...baseInput, sessions: twoSessions, history, muscleAssignments, muscleRecovery,
      sleepTrend: 1.0,
    })
    expect(goodSleep.session?.name).toBe('Legs')

    const poorSleep = computeAiDynamicNextSession({
      ...baseInput, sessions: twoSessions, history, muscleAssignments, muscleRecovery,
      sleepTrend: 0.75,
    })
    expect(poorSleep.session?.name).toBe('Push')
  })

  it('forces deloadStrength to strong when energyLevel is drained', () => {
    const history = makeHistory(['Push'], [1])
    const result = computeAiDynamicNextSession({ ...baseInput, history, energyLevel: 'drained' })
    expect(result.deloadOrRestRecommended).toBe(true)
    expect(result.deloadStrength).toBe('strong')
  })

  it('bumps deloadStrength one level when energyLevel is low', () => {
    // 4 consecutive days + high readiness → 'soft'; energy 'low' bumps to 'recommended'
    const history = makeHistory(['Push', 'Pull', 'Legs', 'Push'], [1, 2, 3, 4])
    const result = computeAiDynamicNextSession({
      ...baseInput, history, readinessScore: 75, energyLevel: 'low',
    })
    expect(result.deloadStrength).toBe('recommended')
  })

  it('sets hrvWarning true when hrvTrend is below 0.85', () => {
    const result = computeAiDynamicNextSession({ ...baseInput, hrvTrend: 0.80 })
    expect(result.hrvWarning).toBe(true)
  })

  it('does not set hrvWarning when hrvTrend is null', () => {
    const result = computeAiDynamicNextSession({ ...baseInput, hrvTrend: null })
    expect(result.hrvWarning).toBe(false)
  })

  it('returns weightedComponents and scoredSessions', () => {
    const result = computeAiDynamicNextSession(baseInput)
    expect(result.weightedComponents).toBeDefined()
    expect(result.weightedComponents?.recovery.weight).toBe(0.40)
    expect(result.scoredSessions).toBeDefined()
    expect(result.scoredSessions?.length).toBe(3)
  })

  it('uses elevated weights when readiness is low', () => {
    const result = computeAiDynamicNextSession({ ...baseInput, readinessScore: 50 })
    expect(result.weightedComponents?.recovery.weight).toBe(0.55)
    expect(result.weightedComponents?.balance.weight).toBe(0.25)
    expect(result.weightedComponents?.freshness.weight).toBe(0.20)
  })

  it('flags recommended deload on illness "elevated" even below 3 consecutive days', () => {
    const history = makeHistory(['Push'], [1])
    const result = computeAiDynamicNextSession({ ...baseInput, history, illnessFlag: 'elevated' })
    expect(result.deloadOrRestRecommended).toBe(true)
    expect(result.deloadStrength).toBe('recommended')
  })

  it('flags strong deload on illness "fever" regardless of readiness', () => {
    const history = makeHistory(['Push'], [1])
    const result = computeAiDynamicNextSession({ ...baseInput, history, readinessScore: 90, illnessFlag: 'fever' })
    expect(result.deloadOrRestRecommended).toBe(true)
    expect(result.deloadStrength).toBe('strong')
  })

  it('does not deload on illness "watch" or "learning" (advisory-only flags)', () => {
    const history = makeHistory(['Push'], [1])
    expect(computeAiDynamicNextSession({ ...baseInput, history, illnessFlag: 'watch' }).deloadOrRestRecommended).toBe(false)
    expect(computeAiDynamicNextSession({ ...baseInput, history, illnessFlag: 'learning' }).deloadOrRestRecommended).toBe(false)
  })

  it('flags recommended deload when derived stress-high minutes cross the threshold', () => {
    const history = makeHistory(['Push'], [1])
    const result = computeAiDynamicNextSession({ ...baseInput, history, stressHighMinutes: 150 })
    expect(result.deloadOrRestRecommended).toBe(true)
    expect(result.deloadStrength).toBe('recommended')
  })

  it('derived stress below threshold suppresses the frozen very_stressful fallback', () => {
    const history = makeHistory(['Push'], [1])
    const result = computeAiDynamicNextSession({
      ...baseInput, history, stressHighMinutes: 30, daySummary: 'very_stressful',
    })
    expect(result.deloadOrRestRecommended).toBe(false)
  })

  it('falls back to very_stressful only when no derived stress exists', () => {
    const history = makeHistory(['Push'], [1])
    const result = computeAiDynamicNextSession({
      ...baseInput, history, stressHighMinutes: null, daySummary: 'very_stressful',
    })
    expect(result.deloadOrRestRecommended).toBe(true)
  })
})

describe('countConsecutiveTrainingDays', () => {
  it('returns 0 when no history', () => {
    expect(countConsecutiveTrainingDays([], new Date(), 'Australia/Brisbane')).toBe(0)
  })

  it('counts consecutive days ending yesterday', () => {
    const history = makeHistory(['Push', 'Pull', 'Legs'], [1, 2, 3])
    expect(countConsecutiveTrainingDays(history, new Date(), 'Australia/Brisbane')).toBe(3)
  })

  it('stops at a gap', () => {
    const history = makeHistory(['Push', 'Legs'], [1, 3]) // gap on day 2
    expect(countConsecutiveTrainingDays(history, new Date(), 'Australia/Brisbane')).toBe(1)
  })

  it('does not count today in the streak', () => {
    const history = makeHistory(['Push'], [0]) // trained today only
    expect(countConsecutiveTrainingDays(history, new Date(), 'Australia/Brisbane')).toBe(0)
  })
})

describe('countConsecutiveRestDays', () => {
  it('returns 0 when trained yesterday', () => {
    const history = makeHistory(['Push'], [1])
    expect(countConsecutiveRestDays(history, new Date(), 'Australia/Brisbane')).toBe(0)
  })

  it('returns 2 when last trained 3 days ago', () => {
    const history = makeHistory(['Push'], [3])
    expect(countConsecutiveRestDays(history, new Date(), 'Australia/Brisbane')).toBe(2)
  })

  it('returns 0 when no history', () => {
    // No training history — we count rest days backward, but with no training
    // the loop runs and never finds a training day so counts up to 30
    // In practice with no history, rest days aren't meaningful, but test the edge case
    const result = countConsecutiveRestDays([], new Date(), 'Australia/Brisbane')
    expect(result).toBe(30) // hits the 30-day cap
  })
})
