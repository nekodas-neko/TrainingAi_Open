import { describe, expect, it } from 'vitest'
import type { NextSessionRecommendation } from '@trainingai/shared/types/program'
import { buildSignals } from '../deload-explanation'

/**
 * #3804. The "Why this recommendation?" panel under the daily rest/deload nudge listed
 * "Still sore: …" for every saved tick. Nothing behind that nudge reads soreness
 * (`computeDeloadStrength`, the sick and energy checks in ai-dynamic.ts), and the check-in pre-ticks
 * recently trained muscles, so the line mostly named the app's own guess as a cause. The reasons
 * that do drive the nudge must stay.
 *
 * #3837. The same was true of the HRV and sleep-trend lines: `hrvWarning` is computed after the
 * deload decision and only returned, and `sleepTrend` only shifts the session-scoring weights. A
 * low HRV or sleep trend must not appear as a reason.
 */
const rec = (suggestedSoreMuscles: string[] | null): NextSessionRecommendation => ({
  isRestDay: false,
  reason: 'Legs · recovery 60% · 4 training days',
  deloadOrRestRecommended: true,
  deloadStrength: 'strong',
  consecutiveTrainingDays: 4,
  hrvWarning: true,
  signals: {
    muscleRecovery: [],
    ouraReadiness: 55,
    sleepTrend: 0.8,
    hrvTrend: 0.8,
    energyLevel: 'low',
    soreMuscles: ['Quads', 'Glutes'],
    suggestedSoreMuscles,
    temperatureDeviation: null,
    temperatureBaselineDays: null,
  },
} as unknown as NextSessionRecommendation)

describe('deload explanation reasons', () => {
  it.each([
    ['app-suggested ticks', ['Quads', 'Glutes']],
    ['lifter-reported ticks', []],
    ['ticks with no provenance', null],
  ])('lists no soreness line for %s', (_label, suggested) => {
    const text = buildSignals(rec(suggested)).map(s => s.text).join('\n')
    expect(text).not.toMatch(/sore/i)
    expect(text).not.toContain('Quads')
    expect(text).not.toContain('Glutes')
  })

  it('keeps every reason that drives the nudge', () => {
    const text = buildSignals(rec(null)).map(s => s.text)
    expect(text).toHaveLength(3)
    expect(text.some(t => t.startsWith('Readiness 55'))).toBe(true)
    expect(text.some(t => t.startsWith('4 training days in a row'))).toBe(true)
    expect(text.some(t => t.includes('feeling low on energy'))).toBe(true)
  })

  it.each([
    ['an HRV warning with low HRV and sleep trends', { hrvWarning: true, hrvTrend: 0.8, sleepTrend: 0.8 }],
    ['low trends without the warning flag', { hrvWarning: false, hrvTrend: 0.5, sleepTrend: 0.5 }],
  ])('lists no HRV or sleep line for %s', (_label, v) => {
    const base = rec(null)
    const r = { ...base, hrvWarning: v.hrvWarning, signals: { ...base.signals!, hrvTrend: v.hrvTrend, sleepTrend: v.sleepTrend } }
    const text = buildSignals(r as NextSessionRecommendation).map(s => s.text).join('\n')
    expect(text).not.toMatch(/HRV/)
    expect(text).not.toMatch(/sleep/i)
  })
})
