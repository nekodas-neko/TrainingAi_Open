import { describe, it, expect } from 'vitest'
import { buildSessionExplainData } from '../build-explain-data'
import type { NextSessionRecommendation } from '@trainingai/shared/types/program'
import type { ProgramSession } from '@trainingai/shared/types/program'

function sess(id: string, name: string): ProgramSession {
  return { id, name, position: 0, icon: null, exercises: [] } as unknown as ProgramSession
}

function rec(): NextSessionRecommendation {
  return {
    isRestDay: false,
    reason: 'x',
    session: sess('a', 'Pull'),
    consecutiveTrainingDays: 2,
    deloadOrRestRecommended: false,
    deloadStrength: undefined,
    hrvWarning: false,
    weightedComponents: {
      recovery:  { score: 80, weight: 0.5 },
      balance:   { score: 60, weight: 0.3 },
      freshness: { score: 90, weight: 0.2 },
    },
    scoredSessions: [
      { session: sess('a', 'Pull'), overallScore: 78, recoveryScore: 80, balanceScore: 60, freshnessScore: 90 },
      { session: sess('b', 'Push'), overallScore: 64, recoveryScore: 50, balanceScore: 55, freshnessScore: 88 },
      { session: sess('c', 'Legs'), overallScore: 61, recoveryScore: 70, balanceScore: 40, freshnessScore: 70 },
    ],
    signals: {
      muscleRecovery: [{ muscle: 'lats', pct: 0.8, hoursAgo: 40 }],
      ouraReadiness: 72, sleepTrend: 1.05, hrvTrend: 0.9,
      energyLevel: 'good', soreMuscles: ['chest'],
    },
  }
}

describe('buildSessionExplainData', () => {
  it('returns null when the recommendation lacks ai_dynamic scoring fields', () => {
    expect(buildSessionExplainData({ isRestDay: false, reason: 'x' }, undefined)).toBeNull()
    expect(buildSessionExplainData(null, undefined)).toBeNull()
  })

  it('uses the scored session matching the passed sessionId as the subject', () => {
    const d = buildSessionExplainData(rec(), 'b')!
    expect(d.session).toEqual({ id: 'b', name: 'Push' })
    expect(d.overallScore).toBe(64)
    // alternatives are every OTHER scored session
    expect(d.alternatives.map(a => a.session.id).sort()).toEqual(['a', 'c'])
  })

  it('falls back to the top-scored session when sessionId is missing or unknown', () => {
    expect(buildSessionExplainData(rec(), undefined)!.session.id).toBe('a')
    expect(buildSessionExplainData(rec(), 'zzz')!.session.id).toBe('a')
  })

  it('derives each alternative primaryReason from the largest deficit vs the subject', () => {
    const d = buildSessionExplainData(rec(), 'a')!
    const push = d.alternatives.find(a => a.session.id === 'b')!
    // vs a: recovery deficit 30, balance 5, freshness 2 → recovery is largest
    expect(push.primaryReason).toBe('muscles not fully recovered')
    const legs = d.alternatives.find(a => a.session.id === 'c')!
    // vs a: recovery 10, balance 20, freshness 20 → tie broken by first (balance)
    expect(legs.primaryReason).toBe('not yet overdue')
  })

  it('passes weighted components, signals and flags straight through', () => {
    const d = buildSessionExplainData(rec(), 'a')!
    expect(d.weightedComponents.recovery.score).toBe(80)
    expect(d.signals.ouraReadiness).toBe(72)
    expect(d.consecutiveTrainingDays).toBe(2)
    expect(d.hrvWarning).toBe(false)
  })
})
