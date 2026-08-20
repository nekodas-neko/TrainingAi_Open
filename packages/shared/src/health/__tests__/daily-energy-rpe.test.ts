import { describe, it, expect } from 'vitest'
import { computeActiveEnergy } from '../daily-energy'
import { estWorkoutKcal, intensityFromRpe } from '../workout-energy'
import { hasRealConstants } from '@/lib/oura-models/__fixtures__/real-constants'

/**
 * Q-419 — the done screen and the day's energy budget disagreed about the same workout.
 *
 * `GET /api/workout-sessions/[id]/energy` estimates with `intensityFromRpe(rpe)`; `computeActiveEnergy`
 * hardcoded `'moderate'`. So tapping an RPE on the done screen changed the number there and changed
 * nothing in the day's ENERGY row, Nutrition's earned calories or the Home budget — the tap looked
 * load-bearing and was not.
 *
 * ⚠️ Magnitudes are unassertable here: the committed fixture scrubs the MET table (strength reads
 * `met_easy 1, met_moderate 0.6, met_hard 3`), and `estWorkoutKcal` floors at `met − 1.5`, so most
 * tiers yield 0 under fixtures. Everything below asserts *agreement between the two paths*, which
 * holds at any MET, rather than a kcal value.
 */
const profile = { ageYears: 33, weightKg: 80, sex: 'male' as const }
const base = { activities: [], pedometerSteps: null, loggedOutdoorSteps: 0 }

/** What the done screen computes for one session. */
const doneScreenKcal = (durationMin: number, rpe: number | null) =>
  estWorkoutKcal({
    durationMin, ageYears: profile.ageYears, weightKg: profile.weightKg, sex: profile.sex,
    activityId: 8, intensity: intensityFromRpe(rpe),
  }) ?? 0

describe('the day total honours session RPE (Q-419)', () => {
  // The entry's own "what would count as done": the kcal the done screen shows for a session is the
  // kcal that session contributes to the day — for EVERY rpe value, not just the rated ones.
  it.each([null, 1, 4, 5, 7, 8, 9, 10])('agrees with the done screen at rpe=%s', rpe => {
    const r = computeActiveEnergy({
      profile, strengthSessions: [{ id: 'ws-1', durationMin: 49, rpe }], ...base,
    })
    expect(r.workoutKcalBySession[0].kcal).toBeCloseTo(doneScreenKcal(49, rpe), 9)
    expect(r.workoutKcal).toBe(Math.round(doneScreenKcal(49, rpe)))
  })

  it('leaves an unrated session exactly where it was — no history without a rating moves', () => {
    const unrated = computeActiveEnergy({
      profile, strengthSessions: [{ id: 'a', durationMin: 49 }], ...base,
    })
    const explicitNull = computeActiveEnergy({
      profile, strengthSessions: [{ id: 'a', durationMin: 49, rpe: null }], ...base,
    })
    expect(unrated.workoutKcal).toBe(explicitNull.workoutKcal)
    // and that is the moderate figure, which is what the old hardcoded literal produced
    expect(unrated.workoutKcal).toBe(Math.round(doneScreenKcal(49, null)))
  })

  it('still sums: the per-session addends reproduce the day total across mixed ratings', () => {
    const r = computeActiveEnergy({
      profile,
      strengthSessions: [
        { id: 'hard', durationMin: 40, rpe: 9 },
        { id: 'easy', durationMin: 40, rpe: 2 },
        { id: 'none', durationMin: 40 },
      ],
      ...base,
    })
    const sum = r.workoutKcalBySession.reduce((a, s) => a + s.kcal, 0)
    expect(Math.round(sum)).toBe(r.workoutKcal)
  })

  // Direction, not magnitude — and only where the real table makes the tiers distinguishable.
  it.skipIf(!hasRealConstants())('rates a hard session above a moderate one of equal length', () => {
    const r = computeActiveEnergy({
      profile,
      strengthSessions: [{ id: 'h', durationMin: 45, rpe: 9 }, { id: 'm', durationMin: 45, rpe: 5 }],
      ...base,
    })
    const h = r.workoutKcalBySession.find(s => s.id === 'h')!.kcal
    const m = r.workoutKcalBySession.find(s => s.id === 'm')!.kcal
    expect(h).toBeGreaterThan(m)
  })
})
