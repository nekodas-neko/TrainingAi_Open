import { describe, expect, it } from 'vitest'
import { rpeLoadSuggestion } from '../rpe-load-suggestion'
import { BACKOFF_MAX_PCT } from '@trainingai/shared/ai-periodization/autoregulation'
import { expectedRpe, expectedRpePrefill } from '@trainingai/shared/ai-periodization/expected-rpe'

/**
 * BF-220 — he logged a set at RPE 10 that fell short of its prescribed reps, and the next set card
 * on the same screen did not move. `computeRpeAdjustment` had already decided the load was too
 * heavy; its only two call sites run at prescription time, a week later.
 *
 * The owner's actual set, from the intake: `13.75 kg × 6` at **RPE 10** against a prescribed **7
 * reps** in a ~70% block. He tapped the 10, so it is a rating (#2253).
 */
const OWNER_SET = { loggedRpe: 10, rated: true, repsDone: 6, prescribedReps: 7, pct: 70 }
const DUMBBELL = { equipment: ['dumbbell'] }

describe('BF-220 — the set he just logged can move the next one', () => {
  it('⭐ the reported set produces a lower weight and the engine’s own sentence', () => {
    const s = rpeLoadSuggestion(OWNER_SET, 13.75, DUMBBELL)
    expect(s).not.toBeNull()
    expect(s!.weightKg).toBeLessThan(13.75)
    // Not re-worded here: the card shows what next week would have said.
    expect(s!.note).toMatch(/RPE ran high and you fell short of the prescribed reps/)
  })

  it('⭐ and the number is the one the entry predicted: 13.75 → 12.5 kg', () => {
    // 6 of 7 reps ⇒ completion 0.857, which sits 37% of the way from the 0.95 ceiling to the 0.7
    // floor ⇒ a 6.86% cut ⇒ 12.81 kg, landing on 12.5 at the 1.25 step. Pinned because "matches
    // what `computeRpeAdjustment` would apply next week" is this entry's own done-when, and an
    // arithmetic slip here would still have produced *a* lower number and looked right.
    expect(rpeLoadSuggestion(OWNER_SET, 13.75, DUMBBELL)!.weightKg).toBe(12.5)
  })

  it('the cut never exceeds the engine’s own ceiling', () => {
    const s = rpeLoadSuggestion(OWNER_SET, 100, DUMBBELL)!
    expect(s.weightKg).toBeGreaterThanOrEqual(100 * (1 - BACKOFF_MAX_PCT / 100) - 2.5)
  })

  it('⛔ an untouched RPE picker suggests nothing — the app must not act on a number it invented', () => {
    // The picker opens on `expectedRpePrefill`, and untouched means "went as planned" (#2253). Even
    // with the reps short, a value he never chose is not a rating — the `rated` flag says so.
    for (const pct of [60, 70, 80, 90]) {
      const seeded = expectedRpePrefill(pct, 7)
      expect(rpeLoadSuggestion({ loggedRpe: seeded, rated: false, repsDone: 5, prescribedReps: 7, pct }, 50, DUMBBELL)).toBeNull()
    }
    // The owner's own set, had he not touched the picker.
    expect(rpeLoadSuggestion({ ...OWNER_SET, rated: false }, 13.75, DUMBBELL)).toBeNull()
  })

  it('#2253 — the expectation is the shared expectedRpe(pct, reps done), not floor(pct/10)', () => {
    // At 80% × 5 reps done the shared formula expects 7.1 (floor(pct/10) said 8). Against the 1.5
    // dead band a tapped 8 is on plan and a tapped 9 is not; under the old 8 the 9 sat inside it.
    const at = { prescribedReps: 6, repsDone: 5, pct: 80 }
    expect(expectedRpe(80, 5)).toBeCloseTo(7.11, 2)
    expect(rpeLoadSuggestion({ ...at, loggedRpe: 8, rated: true }, 100, DUMBBELL)).toBeNull()
    expect(rpeLoadSuggestion({ ...at, loggedRpe: 9, rated: true }, 100, DUMBBELL)).not.toBeNull()
  })

  it('a hard set that still made its reps suggests nothing, because the trend is unknown in-session', () => {
    // `rm1Trend` is passed as 'flat', so only the missed-reps branch can fire. Withholding is the
    // intended failure direction.
    expect(rpeLoadSuggestion({ ...OWNER_SET, repsDone: 7 }, 13.75, DUMBBELL)).toBeNull()
  })

  it('an easy set suggests nothing — this offers a cut, never a push', () => {
    expect(rpeLoadSuggestion({ loggedRpe: 5, rated: true, repsDone: 7, prescribedReps: 7, pct: 70 }, 50, DUMBBELL)).toBeNull()
  })

  it('a deload or baseline session is left alone, inheriting the engine’s decision', () => {
    expect(rpeLoadSuggestion(OWNER_SET, 13.75, { ...DUMBBELL, isDeload: true })).toBeNull()
    expect(rpeLoadSuggestion(OWNER_SET, 13.75, { ...DUMBBELL, isBaseline: true })).toBeNull()
  })

  it('bodyweight work suggests nothing — there is no load to cut', () => {
    expect(rpeLoadSuggestion(OWNER_SET, 0, { ...DUMBBELL, exerciseType: 'bodyweight' })).toBeNull()
  })

  it('a missing rating, rep count or prescription suggests nothing rather than guessing', () => {
    expect(rpeLoadSuggestion({ ...OWNER_SET, loggedRpe: undefined }, 13.75, DUMBBELL)).toBeNull()
    expect(rpeLoadSuggestion({ ...OWNER_SET, repsDone: undefined }, 13.75, DUMBBELL)).toBeNull()
    expect(rpeLoadSuggestion({ ...OWNER_SET, prescribedReps: undefined }, 13.75, DUMBBELL)).toBeNull()
    expect(rpeLoadSuggestion({ ...OWNER_SET, prescribedReps: 0 }, 13.75, DUMBBELL)).toBeNull()
  })

  it('a cut that rounds back to the weight on the card is not offered', () => {
    // The floor in `mroundStep` is 5 kg, so at the lightest loads a 5–10% cut rounds to itself.
    expect(rpeLoadSuggestion(OWNER_SET, 5, DUMBBELL)).toBeNull()
  })

  it('the suggested weight lands on the equipment’s own step', () => {
    const bar = rpeLoadSuggestion(OWNER_SET, 100, { equipment: ['barbell'] })!
    const db = rpeLoadSuggestion(OWNER_SET, 100, DUMBBELL)!
    for (const s of [bar, db]) expect(s.weightKg).toBeLessThan(100)
    // Whatever each step is, a suggestion a dial cannot land on is useless.
    expect(bar.weightKg % 1.25).toBeCloseTo(0, 5)
    expect(db.weightKg % 1.25).toBeCloseTo(0, 5)
  })
})
