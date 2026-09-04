import { describe, it, expect } from 'vitest'
import { metricAvailability } from '@/lib/health/score-availability'
import { computeReadinessComposite } from '@trainingai/shared/health/readiness-composite'

// Q-278. The entry's risk was a taxonomy nothing can populate — a "why" field that always says the
// same thing. These pin the opposite: every reason here is one a producer actually computes, and the
// two are told apart.
describe('metricAvailability', () => {
  it('a value that exists is present, whatever its metric is called', () => {
    // Keyed on the metric, so no ruling on whether daytime stress is a "pillar" is needed.
    expect(metricAvailability('daytimeStress', 42)).toEqual({
      metric: 'daytimeStress', state: 'present', gap: null, degradedInputs: [],
    })
  })

  it('a missing value with no contributors reads no_input', () => {
    const a = metricAvailability('sleep', null)
    expect(a.state).toBe('absent')
    expect(a.gap).toBe('no_input')
  })

  it('treats 0 as a value, not as missing', () => {
    // The bug this shape invites: `!value` would call a real zero score absent.
    expect(metricAvailability('activity', 0).state).toBe('present')
  })

  // The distinction the whole entry turns on. Both cases score 50 and both are `provisional`; only
  // the reason differs, and only the reason tells the user whether waiting fixes it.
  it('says awaiting_baseline when every fallback was waiting on history', () => {
    const a = metricAvailability('readiness', null, {
      hrvBalance: { gap: 'awaiting_baseline' },
      restingHeartRate: { gap: 'awaiting_baseline' },
    })
    expect(a.gap).toBe('awaiting_baseline')
  })

  it('says no_input when any fallback was genuinely missing data', () => {
    // Mixed causes resolve to no_input: waiting cannot fix the half that has no data at all, so the
    // more optimistic answer would be the misleading one.
    const a = metricAvailability('readiness', null, {
      hrvBalance: { gap: 'awaiting_baseline' },
      temperature: { gap: 'no_input' },
    })
    expect(a.gap).toBe('no_input')
  })

  it('reports degraded inputs on a value that WAS produced', () => {
    // This is what lets a surface say "computed without HRV" instead of only "limited".
    const a = metricAvailability('readiness', 71, {
      hrvBalance: { gap: 'awaiting_baseline' },
      temperature: { gap: null },
    })
    expect(a.state).toBe('present')
    expect(a.gap).toBeNull()
    expect(a.degradedInputs).toEqual([{ key: 'hrvBalance', gap: 'awaiting_baseline' }])
  })
})

// The gap between "the helper works" and "the producers populate it". Every test above builds
// contributors by hand, which would still pass if `computeReadinessComposite` never set a gap at
// all — the exact shape of a taxonomy nothing populates.
describe('metricAvailability against the real producer', () => {
  // Every contributor supplied, deliberately. A first draft omitted `checkinScore` and the cold
  // case then reported `no_input` — correctly, because a missing check-in IS missing data. The
  // failure was the fixture's, not the code's, and it is worth keeping as the reason this fixture
  // is exhaustive: an incomplete one silently tests a different question.
  const FULL = {
    rhrZ: -0.5, hrvZ: 0.8, tempZ: 0.1, sleepBalanceZ: 0.4,
    previousNightScore: 80, prevDayActivityScore: 70, activityBalanceScore: 60,
    recoveryIndexHours: 4, checkinScore: 72,
  }

  it('a cold baseline reports awaiting_baseline, from a real composite', () => {
    const c = computeReadinessComposite({ ...FULL, nHistory: 3 }).contributors
    const a = metricAvailability('readiness', null, c)
    expect(a.gap).toBe('awaiting_baseline')
    expect(a.degradedInputs.map(d => d.key).sort())
      .toEqual(['hrvBalance', 'restingHeartRate', 'sleepBalance', 'temperature'])
  })

  it('a mature baseline with every input present reports nothing degraded', () => {
    const c = computeReadinessComposite({ ...FULL, nHistory: 30 }).contributors
    const a = metricAvailability('readiness', 71, c)
    expect(a.state).toBe('present')
    expect(a.degradedInputs).toEqual([])
  })

  it('a genuinely absent input reads no_input, not awaiting_baseline', () => {
    // hrvZ null with a mature baseline: waiting will not fix this one, and saying it would is the
    // misleading half.
    const c = computeReadinessComposite({ ...FULL, hrvZ: null, nHistory: 30 }).contributors
    expect(c.hrvBalance.gap).toBe('no_input')
    expect(metricAvailability('readiness', null, c).gap).toBe('no_input')
  })
})
