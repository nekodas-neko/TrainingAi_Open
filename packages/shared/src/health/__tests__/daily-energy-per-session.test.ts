import { describe, it, expect } from 'vitest'
import { computeActiveEnergy } from '../daily-energy'
import { hasRealConstants } from '@/lib/oura-models/__fixtures__/real-constants'

/**
 * Q-391 — the day screen's Training card wants a per-session calories-burnt figure.
 *
 * It comes from here rather than from a second estimate in `/api/day-log`, and the reason is on file
 * in `energy-summary.ts`: the day screen's Energy section already reads its `workoutKcal` from this
 * same computation *"because the day screen disagreeing with Nutrition about how much was burned is
 * worse than either being slightly off"*. Returning the addends keeps the card and the total
 * consistent **by construction** rather than by two call sites happening to agree.
 *
 * ⚠️ **A magnitude assertion is impossible in this repo, and that is worth knowing before adding
 * one.** The synthetic constants CI runs against give activity 8 ("strength training") a
 * `met_moderate` of **0.6**, and `estWorkoutKcal` is `max(0, duration × (met − 1.5) × bmrPerMinute)`
 * — so every strength estimate is **0** under fixtures. An assertion like `expect(kcal).toBeGreaterThan(0)`
 * therefore fails on fixtures and passes only on a machine holding the vendor's real numbers; worse,
 * assertions *about* those zeros pass vacuously. Everything below is written to be meaningful at any
 * MET value, and the one proportionality check guards on `hasRealConstants()`.
 */
const profile = { ageYears: 33, weightKg: 80, sex: 'male' as const }
const base = { activities: [], pedometerSteps: null, loggedOutdoorSteps: 0 }

describe('computeActiveEnergy per-session workout breakdown (Q-391)', () => {
  it('returns one addend per identified session, in order', () => {
    const r = computeActiveEnergy({
      profile,
      strengthSessions: [{ id: 'ws-1', durationMin: 49 }, { id: 'ws-2', durationMin: 31 }],
      ...base,
    })
    expect(r.workoutKcalBySession.map(s => s.id)).toEqual(['ws-1', 'ws-2'])
  })

  // The invariant the feature exists for, and it holds at any MET: the parts are the exact terms
  // that were summed, so rounding their sum reproduces the published total. Not that the ROUNDED
  // parts do — a card showing 120 + 130 under a total of 251 is precisely what this avoids.
  it('the addends sum to the published total', () => {
    const r = computeActiveEnergy({
      profile,
      strengthSessions: [{ id: 'ws-1', durationMin: 49 }, { id: 'ws-2', durationMin: 31 }],
      ...base,
    })
    const sum = r.workoutKcalBySession.reduce((a, s) => a + s.kcal, 0)
    expect(Math.round(sum)).toBe(r.workoutKcal)
  })

  // A session the plausibility guard drops contributed nothing to the total, so it is absent rather
  // than zero — zero would read as "measured, and it was nothing".
  it('omits an implausibly long session rather than reporting it as zero', () => {
    const r = computeActiveEnergy({
      profile,
      strengthSessions: [{ id: 'real', durationMin: 45 }, { id: 'absurd', durationMin: 10_000 }],
      ...base,
    })
    expect(r.workoutKcalBySession.map(s => s.id)).toEqual(['real'])
  })

  it('leaves callers that pass no id unchanged — the breakdown is simply empty', () => {
    const r = computeActiveEnergy({ profile, strengthSessions: [{ durationMin: 49 }], ...base })
    expect(r.workoutKcalBySession).toEqual([])
  })

  it('is empty, not undefined, when the profile is incomplete', () => {
    const r = computeActiveEnergy({
      profile: { ageYears: null, weightKg: 80, sex: 'male' },
      strengthSessions: [{ id: 'ws-1', durationMin: 49 }],
      ...base,
    })
    expect(r.workoutKcalBySession).toEqual([])
    expect(r.workoutKcal).toBe(0)
  })

  // Duration is the ONLY input the estimator has for a strength session — not load, not volume, not
  // reps — so double the clock is double the number. Skipped on synthetic constants, where every
  // strength estimate is 0 and the ratio would be 0/0.
  it.skipIf(!hasRealConstants())('scales linearly with duration, the estimator\'s only input', () => {
    const r = computeActiveEnergy({
      profile,
      strengthSessions: [{ id: 'short', durationMin: 20 }, { id: 'long', durationMin: 40 }],
      ...base,
    })
    const short = r.workoutKcalBySession.find(s => s.id === 'short')!.kcal
    const long = r.workoutKcalBySession.find(s => s.id === 'long')!.kcal
    expect(short).toBeGreaterThan(0)
    expect(long).toBeCloseTo(short * 2, 6)
  })
})
