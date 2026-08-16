import { describe, it, expect } from 'vitest'
import { computeHealthAlertActions, type HealthAlertInput, type HealthAlertType } from '@/lib/health-alerts'

// Neutral baseline — no anomaly on any axis.
const base: HealthAlertInput = {
  illnessFlag: 'normal',
  illnessAdvisory: null,
  readinessLabel: 'High',
  readinessHasData: true,
  stressHighMinutes: 0,
  stressCurrent: 0,
}
// Helper: pull the action for one type out of the returned array.
const forType = (input: Partial<HealthAlertInput>, notified = new Set<HealthAlertType>()) => {
  const acts = computeHealthAlertActions({ ...base, ...input }, notified)
  return (t: string) => acts.find(a => a.alertType === t)!
}

describe('computeHealthAlertActions', () => {
  it('fires an illness alert on fever, with fever-specific copy', () => {
    const a = forType({ illnessFlag: 'fever', illnessAdvisory: 'Skin temperature is well above your baseline — possible fever. Readiness lowered; rest and hydrate.' })('illness')
    expect(a.type).toBe('fire')
    if (a.type === 'fire') {
      expect(a.title).toMatch(/fever/i)
      expect(a.body).toContain('baseline')
    }
  })

  it('fires an illness alert on elevated', () => {
    expect(forType({ illnessFlag: 'elevated', illnessAdvisory: 'x' })('illness').type).toBe('fire')
  })

  it('never fires illness on watch / normal / learning (advisory-only or no signal)', () => {
    for (const flag of ['watch', 'normal', 'learning'] as const) {
      expect(forType({ illnessFlag: flag })('illness').type).toBe('skip')
    }
  })

  it('skips an anomaly type already notified today (dedup)', () => {
    const a = forType({ illnessFlag: 'fever', illnessAdvisory: 'x' }, new Set<HealthAlertType>(['illness']))('illness')
    expect(a.type).toBe('skip')
  })

  it('fires a stress alert when highMinutes crosses the shared deload threshold', () => {
    expect(forType({ stressHighMinutes: 150 })('stress').type).toBe('fire')
    expect(forType({ stressHighMinutes: 60 })('stress').type).toBe('skip')
  })

  it('falls back to stressCurrent when highMinutes is null (pre-daytime-stress-wiring response)', () => {
    expect(forType({ stressHighMinutes: null, stressCurrent: -0.8 })('stress').type).toBe('fire')
    expect(forType({ stressHighMinutes: null, stressCurrent: -0.1 })('stress').type).toBe('skip')
    // null/null → no stress signal at all → skip
    expect(forType({ stressHighMinutes: null, stressCurrent: null })('stress').type).toBe('skip')
  })

  it('fires a standalone readiness-low alert when Low and nothing more specific fired', () => {
    expect(forType({ readinessLabel: 'Low' })('readiness').type).toBe('fire')
  })

  it('suppresses readiness-low when an illness alert fires the same reconcile (precedence)', () => {
    const get = forType({ readinessLabel: 'Low', illnessFlag: 'fever', illnessAdvisory: 'x' })
    expect(get('illness').type).toBe('fire')
    expect(get('readiness').type).toBe('skip')
  })

  it('suppresses readiness-low when a stress alert fires the same reconcile (precedence)', () => {
    const get = forType({ readinessLabel: 'Low', stressHighMinutes: 150 })
    expect(get('stress').type).toBe('fire')
    expect(get('readiness').type).toBe('skip')
  })

  it('never fires readiness-low without sufficient data (chip would be hidden)', () => {
    expect(forType({ readinessLabel: 'Low', readinessHasData: false })('readiness').type).toBe('skip')
  })

  it('an all-clear day returns skip for every type', () => {
    const acts = computeHealthAlertActions(base, new Set())
    expect(acts.every(a => a.type === 'skip')).toBe(true)
  })
})
