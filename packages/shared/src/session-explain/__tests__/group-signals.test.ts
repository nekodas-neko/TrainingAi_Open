import { describe, it, expect } from 'vitest'
import { groupSignals } from '../group-signals'
import type { SessionExplainData } from '../build-explain-data'

const base: SessionExplainData = {
  session: { id: 'a', name: 'Pull' },
  overallScore: 78,
  weightedComponents: {
    recovery:  { score: 80, weight: 0.5 },
    balance:   { score: 60, weight: 0.3 },
    freshness: { score: 90, weight: 0.2 },
  },
  signals: {
    muscleRecovery: [], ouraReadiness: 72, sleepTrend: 1.05, hrvTrend: 0.9,
    energyLevel: 'good', soreMuscles: ['chest'],
  },
  consecutiveTrainingDays: 2,
  deloadOrRestRecommended: false, deloadStrength: null, hrvWarning: false,
  alternatives: [],
}

describe('groupSignals', () => {
  it('emits Readiness, Recovery and Body sections in a stable order', () => {
    const groups = groupSignals(base)
    expect(groups.map(g => g.heading)).toEqual(['Readiness', 'Recovery', 'Body'])
  })

  it('renders trends as plain language, not "% of baseline" jargon', () => {
    const rows = groupSignals(base).flatMap(g => g.rows)
    const sleep = rows.find(r => r.label === 'Sleep')!
    expect(sleep.value).toBe('Slightly above your usual')
    const hrv = rows.find(r => r.label === 'HRV')!
    expect(hrv.value).toBe('A little below your usual')
  })

  it('surfaces warning chips for a low HRV trend and a long training streak', () => {
    const rows = groupSignals({ ...base, hrvWarning: true, consecutiveTrainingDays: 5 }).flatMap(g => g.rows)
    expect(rows.find(r => r.label === 'HRV')!.chip).toEqual({ text: 'Below baseline', tone: 'warn' })
    expect(rows.find(r => r.label === 'Training streak')!.chip).toEqual({ text: 'Consider a rest day', tone: 'warn' })
  })

  it('shows "No data" for null signals and "None"/"Not logged" fallbacks', () => {
    const rows = groupSignals({
      ...base,
      signals: { ...base.signals, ouraReadiness: null, sleepTrend: null, hrvTrend: null, energyLevel: null, soreMuscles: [] },
    }).flatMap(g => g.rows)
    expect(rows.find(r => r.label === 'Oura readiness')!.value).toBe('No data')
    expect(rows.find(r => r.label === 'Sleep')!.value).toBe('No data')
    expect(rows.find(r => r.label === 'Energy')!.value).toBe('Not logged today')
    expect(rows.find(r => r.label === 'Sore muscles')!.value).toBe('None')
  })

  it('omits the deload row when no deload/rest is recommended', () => {
    const rows = groupSignals(base).flatMap(g => g.rows)
    expect(rows.find(r => r.label === 'Deload')).toBeUndefined()
  })

  it('surfaces a Deload row with a warn chip when deloadOrRestRecommended is true', () => {
    const rows = groupSignals({ ...base, deloadOrRestRecommended: true, deloadStrength: 'strong' }).flatMap(g => g.rows)
    const deload = rows.find(r => r.label === 'Deload')!
    expect(deload.value).toBe('Strong deload advised')
    expect(deload.chip).toEqual({ text: 'strong', tone: 'warn' })
  })

  it('labels a "recommended" deload strength distinctly from "strong"', () => {
    const rows = groupSignals({ ...base, deloadOrRestRecommended: true, deloadStrength: 'recommended' }).flatMap(g => g.rows)
    expect(rows.find(r => r.label === 'Deload')!.value).toBe('Deload recommended')
  })
})
