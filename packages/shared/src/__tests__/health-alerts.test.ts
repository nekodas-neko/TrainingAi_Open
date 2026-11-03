import { describe, it, expect } from 'vitest'
import {
  computeHealthAlertActions,
  firedToday,
  healthAlertInput,
  recordFired,
  type HealthAlertInput,
  type HealthAlertType,
} from '../health/health-alerts'
import { STRESS_HIGH_LEVEL } from '../health/daytime-stress-thresholds'

const calm: HealthAlertInput = {
  illnessFlag: 'normal',
  illnessAdvisory: null,
  readinessLabel: 'High',
  readinessHasData: true,
  stressHighMinutes: 0,
  stressCurrent: 0,
}
const fires = (input: Partial<HealthAlertInput>, done: HealthAlertType[] = []) =>
  computeHealthAlertActions({ ...calm, ...input }, new Set(done))
    .filter(a => a.type === 'fire')
    .map(a => a.alertType)

describe('shared health alerts: each type fires and does not fire', () => {
  it('illness: fires on elevated and fever, not on watch, normal, learning or null', () => {
    expect(fires({ illnessFlag: 'elevated' })).toEqual(['illness'])
    expect(fires({ illnessFlag: 'fever' })).toEqual(['illness'])
    for (const flag of ['watch', 'normal', 'learning', null] as const) {
      expect(fires({ illnessFlag: flag })).toEqual([])
    }
  })

  it('stress: fires at the threshold, not above it, and ignores the daily minutes', () => {
    expect(fires({ stressCurrent: STRESS_HIGH_LEVEL })).toEqual(['stress'])
    expect(fires({ stressCurrent: STRESS_HIGH_LEVEL + 0.01 })).toEqual([])
    expect(fires({ stressCurrent: null })).toEqual([])
    expect(fires({ stressCurrent: 0, stressHighMinutes: 600 })).toEqual([])
  })

  it('readiness: fires on Low with data, not on Moderate, High, no data or no label', () => {
    expect(fires({ readinessLabel: 'Low' })).toEqual(['readiness'])
    expect(fires({ readinessLabel: 'Moderate' })).toEqual([])
    expect(fires({ readinessLabel: 'Low', readinessHasData: false })).toEqual([])
    expect(fires({ readinessLabel: null })).toEqual([])
  })

  it('readiness-low gives way to a more specific illness or stress alert', () => {
    expect(fires({ readinessLabel: 'Low', illnessFlag: 'fever' })).toEqual(['illness'])
    expect(fires({ readinessLabel: 'Low', stressCurrent: -1 })).toEqual(['stress'])
  })

  it('readiness-low stays quiet on a later open, after the illness or stress alert already fired (#3536)', () => {
    const fever = { readinessLabel: 'Low' as const, illnessFlag: 'fever' as const }
    expect(fires(fever, ['illness'])).toEqual([])
    expect(fires({ readinessLabel: 'Low', stressCurrent: -1 }, ['stress'])).toEqual([])
  })

  it('uses the radar advisory as the body when there is one', () => {
    const [illness] = computeHealthAlertActions({ ...calm, illnessFlag: 'elevated', illnessAdvisory: 'Rest.' })
    expect(illness).toMatchObject({ type: 'fire', body: 'Rest.' })
  })
})

describe('shared health alerts: once per type per day', () => {
  const today = '2026-11-02'
  it('a type fired today is skipped; other types still fire', () => {
    const input = { illnessFlag: 'fever', stressCurrent: -1 } as const
    expect(fires(input, ['illness'])).toEqual(['stress'])
    expect(fires(input, ['illness', 'stress'])).toEqual([])
  })

  it('only today counts: an entry from another day does not suppress', () => {
    const map = { illness: '2026-11-01', stress: today, junk: today }
    expect([...firedToday(map, today)]).toEqual(['stress'])
    expect(firedToday(null, today).size).toBe(0)
  })

  it('across a day boundary the same anomaly fires again', () => {
    const input = { illnessFlag: 'elevated' } as const
    const day1 = recordFired({}, computeHealthAlertActions({ ...calm, ...input }), today)
    expect(fires(input, [...firedToday(day1, today)])).toEqual([])
    expect(fires(input, [...firedToday(day1, '2026-11-03')])).toEqual(['illness'])
  })

  it('recordFired keeps other entries, records only fires, and does not mutate', () => {
    const before = { readiness: '2026-10-30' }
    const acts = computeHealthAlertActions({ ...calm, illnessFlag: 'fever' })
    expect(recordFired(before, acts, today)).toEqual({ readiness: '2026-10-30', illness: today })
    expect(before).toEqual({ readiness: '2026-10-30' })
  })
})

describe('healthAlertInput', () => {
  it('maps the two responses, and reads missing ones as no signal', () => {
    expect(
      healthAlertInput({
        readiness: { illnessFlag: 'fever', illnessAdvisory: 'x', label: 'Low', hasSufficientData: true },
        battery: { stress: { highMinutes: 90, current: -0.5 } },
      }),
    ).toEqual({
      illnessFlag: 'fever', illnessAdvisory: 'x', readinessLabel: 'Low', readinessHasData: true,
      stressHighMinutes: 90, stressCurrent: -0.5,
    })
    expect(healthAlertInput({})).toEqual({
      illnessFlag: null, illnessAdvisory: null, readinessLabel: null, readinessHasData: false,
      stressHighMinutes: null, stressCurrent: null,
    })
  })

  it('treats an unknown flag or label as absent rather than alerting on it', () => {
    const input = healthAlertInput({ readiness: { illnessFlag: 'bogus', label: 'Awful', hasSufficientData: true } })
    expect(input.illnessFlag).toBeNull()
    expect(input.readinessLabel).toBeNull()
  })
})
