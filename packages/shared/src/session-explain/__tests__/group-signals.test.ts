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
    expect(rows.find(r => r.label === 'Readiness')!.value).toBe('No data')
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

// #3718 F3: a rest day from one of the AI rule's signals names it on the "Why this?" page, with the
// same line Home shows (`deloadReasons`).
describe('groupSignals — rest signals (#3718)', () => {
  it('on a day only blood oxygen fired, the page explains the deload', async () => {
    const { buildSessionExplainData } = await import('../build-explain-data')
    const rec = {
      isRestDay: false, reason: '', reminderEnabled: false, reminderTime: null,
      deloadOrRestRecommended: true, deloadStrength: 'recommended' as const, consecutiveTrainingDays: 0,
      restSignals: ['spo2Low' as const],
      scoredSessions: [{ session: { id: 'a', name: 'Pull' }, overallScore: 70, recoveryScore: 70, balanceScore: 70, freshnessScore: 70 }],
      weightedComponents: base.weightedComponents,
      signals: { ...base.signals, ouraReadiness: 72 },
    } as unknown as Parameters<typeof buildSessionExplainData>[0]
    const data = buildSessionExplainData(rec, 'a')!
    const rows = groupSignals(data).flatMap(g => g.rows)
    expect(rows.find(r => r.label === 'Deload')?.value).toBe('Deload recommended')
    expect(rows.find(r => r.label === 'Blood oxygen low')?.value)
      .toBe('Blood oxygen has been below your usual over the last 3 nights — often an early sign of illness or incomplete recovery.')
  })

  it('each of the three signals shows its reason', () => {
    const reasons = [
      { kind: 'readiness' as const, text: 'Readiness 38 — under 45, low enough that a rest day is the better call.', signal: 'readinessVeryLow' as const },
      { kind: 'sleepAndHrv' as const, text: 'Sleep and HRV have both run well below your usual over the last 3 nights.', signal: 'sleepAndHrvLow' as const },
      { kind: 'spo2' as const, text: 'Blood oxygen has been below your usual over the last 3 nights — often an early sign of illness or incomplete recovery.', signal: 'spo2Low' as const },
    ]
    const rows = groupSignals({ ...base, restSignalReasons: reasons }).flatMap(g => g.rows)
    expect(rows.filter(r => ['Readiness very low', 'Sleep and HRV both low', 'Blood oxygen low'].includes(r.label)).map(r => r.value))
      .toEqual(reasons.map(r => r.text))
  })

  it('no rest signal, no extra rows', () => {
    expect(groupSignals({ ...base, restSignalReasons: [] })).toEqual(groupSignals(base))
  })
})
