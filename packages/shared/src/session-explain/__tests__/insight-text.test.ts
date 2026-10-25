import { describe, it, expect } from 'vitest'
import { buildSessionInsightText, type SessionInsightParts } from '../insight-text'

const parts = (over: Partial<SessionInsightParts> = {}, signals: Partial<SessionInsightParts['signals']> = {}): SessionInsightParts => ({
  sessionName: 'Upper',
  weightedComponents: {
    recovery: { score: 70, weight: 0.5 }, balance: { score: 60, weight: 0.3 }, freshness: { score: 80, weight: 0.2 },
  },
  signals: { ouraReadiness: 80, sleepTrend: 1.1, hrvTrend: 0.95, energyLevel: 'good', soreMuscles: [], ...signals },
  consecutiveTrainingDays: 2,
  ...over,
})

describe('buildSessionInsightText (#3286)', () => {
  it('names the session, each component with its weight, and the heaviest contributor', () => {
    const text = buildSessionInsightText(parts())
    expect(text).toContain('Upper was chosen for today from muscle recovery at 70% (weighted 50%)')
    expect(text).toContain('freshness at 80% (weighted 20%)')
    expect(text).toContain('muscle recovery counted most.')
  })

  it('reads the measured signals and trends in plain words', () => {
    const text = buildSessionInsightText(parts())
    expect(text).toContain('Your readiness is 80, your sleep is 10% above your usual, your HRV is 5% below your usual and you logged your energy as good.')
  })

  it('names what had no reading instead of treating it as zero', () => {
    const text = buildSessionInsightText(parts({}, { sleepTrend: null, hrvTrend: null, energyLevel: null }))
    expect(text).toContain('Your readiness is 80; sleep and HRV had no reading.')
    expect(text).not.toMatch(/\b0%/)
  })

  it('says so when nothing was measured', () => {
    const text = buildSessionInsightText(parts({}, { ouraReadiness: null, sleepTrend: null, hrvTrend: null, energyLevel: null }))
    expect(text).toContain('No readiness, sleep or HRV reading was available')
  })

  it('handles one sore muscle, many, and none', () => {
    expect(buildSessionInsightText(parts({ consecutiveTrainingDays: 0 }, { soreMuscles: ['quads'] }))).toContain('Quads is marked sore.')
    expect(buildSessionInsightText(parts({ consecutiveTrainingDays: 0 }, { soreMuscles: ['quads', 'calves', 'back'] }))).toContain('Quads, calves and back are marked sore.')
    expect(buildSessionInsightText(parts({ consecutiveTrainingDays: 0 }))).not.toContain('sore')
  })

  it('counts consecutive days singular and plural, and flags a deload with its strength', () => {
    expect(buildSessionInsightText(parts({ consecutiveTrainingDays: 1 }))).toContain('You have trained 1 day in a row')
    const text = buildSessionInsightText(parts({ consecutiveTrainingDays: 5, deloadOrRestRecommended: true, deloadStrength: 'strong' }))
    expect(text).toContain('You have trained 5 days in a row and a deload or rest is recommended (strong).')
  })

  it('is deterministic and never mentions Oura', () => {
    expect(buildSessionInsightText(parts())).toBe(buildSessionInsightText(parts()))
    expect(buildSessionInsightText(parts())).not.toContain('Oura')
  })
})
