import { describe, it, expect } from 'vitest'
import { scaleMacrosForEarnedKcal, type MacroTargets } from '../calorie-balance'

/**
 * Q-323 — the calorie budget grows with movement and the macro grams under it did not, so the card
 * told the user to eat 300 more kcal without saying of what.
 *
 * The figures below are a realistic rest-day target: 1,900 kcal at 150 g protein (600), 53 g fat
 * (477) and 206 g carbs (824). The owner's own example day earns ~547 kcal.
 */
const BASE: MacroTargets = { proteinG: 150, carbsG: 206, fatG: 53 }
const kcalOf = (m: MacroTargets) => m.proteinG * 4 + m.carbsG * 4 + m.fatG * 9

describe('scaleMacrosForEarnedKcal', () => {
  it('holds protein no matter how much was earned', () => {
    for (const earned of [1, 100, 547, 2000]) {
      expect(scaleMacrosForEarnedKcal(BASE, earned).proteinG).toBe(150)
    }
  })

  it('adds the earned calories to the day, within rounding', () => {
    const scaled = scaleMacrosForEarnedKcal(BASE, 547)
    // Grams are whole numbers, so the total lands within a few kcal of base + earned rather than on
    // it exactly. Asserting equality here would be asserting that rounding does not happen.
    expect(kcalOf(scaled) - kcalOf(BASE)).toBeGreaterThan(540)
    expect(kcalOf(scaled) - kcalOf(BASE)).toBeLessThan(554)
  })

  it('preserves the carbs:fat energy ratio, which is the property that was chosen', () => {
    // Tolerance is 0.05, not 0.005, and the reason is whole grams rather than sloppiness: a gram of
    // fat is 9 kcal, so rounding the fat figure moves this ratio by up to ~1% on its own. The exact
    // split is pinned by the case below, where the arithmetic divides cleanly.
    const ratio = (m: MacroTargets) => (m.carbsG * 4) / (m.fatG * 9)
    for (const earned of [100, 547, 1200]) {
      expect(ratio(scaleMacrosForEarnedKcal(BASE, earned))).toBeCloseTo(ratio(BASE), 1)
    }
  })

  it('splits the earned calories exactly, when the numbers divide cleanly', () => {
    // 100 g carbs = 400 kcal, 100 g fat = 900 kcal: carbs hold 400/1300 of the splittable energy.
    // 1,300 earned kcal therefore adds 400 kcal of carbs (100 g) and 900 of fat (100 g), doubling
    // both and leaving the ratio identical — no rounding anywhere.
    const clean: MacroTargets = { proteinG: 100, carbsG: 100, fatG: 100 }
    expect(scaleMacrosForEarnedKcal(clean, 1300)).toEqual({ proteinG: 100, carbsG: 200, fatG: 200 })
  })

  it('does NOT hold each macro\'s share of the day — that is impossible while protein is fixed', () => {
    // Worth pinning explicitly, because "keeps both percentages stable" is easy to read as this and
    // then to report the function as broken. Protein's share must fall; carbs' and fat's must rise.
    const scaled = scaleMacrosForEarnedKcal(BASE, 547)
    const share = (g: number, kcalPerG: number, m: MacroTargets) => (g * kcalPerG) / kcalOf(m)
    expect(share(scaled.proteinG, 4, scaled)).toBeLessThan(share(BASE.proteinG, 4, BASE))
    expect(share(scaled.carbsG, 4, scaled)).toBeGreaterThan(share(BASE.carbsG, 4, BASE))
    expect(share(scaled.fatG, 9, scaled)).toBeGreaterThan(share(BASE.fatG, 9, BASE))
  })

  it('does not turn a walk into a protein requirement — the arithmetic behind excluding it', () => {
    // Expressing 150 g as a share of 1,900 kcal (31.6%) and applying it to the bigger day is the
    // implementation that was rejected; it yields ~2.6 g/kg for a 75 kg user who went for a walk.
    const scaled = scaleMacrosForEarnedKcal(BASE, 547)
    const rejected = Math.round((kcalOf(BASE) * 0.316 + 547 * 0.316) / 4)
    expect(rejected).toBeGreaterThan(190)
    expect(scaled.proteinG).toBe(150)
  })

  it('gives carbs the larger share, because they already carry more of the energy', () => {
    const scaled = scaleMacrosForEarnedKcal(BASE, 547)
    expect(scaled.carbsG - BASE.carbsG).toBeGreaterThan(0)
    expect(scaled.fatG - BASE.fatG).toBeGreaterThan(0)
    expect((scaled.carbsG - BASE.carbsG) * 4).toBeGreaterThan((scaled.fatG - BASE.fatG) * 9)
  })

  it('returns the target untouched when nothing was earned', () => {
    expect(scaleMacrosForEarnedKcal(BASE, 0)).toBe(BASE)
    // A budget only grows with movement; a negative is meaningless rather than a shrink to model.
    expect(scaleMacrosForEarnedKcal(BASE, -300)).toBe(BASE)
    expect(scaleMacrosForEarnedKcal(BASE, Number.NaN)).toBe(BASE)
  })

  it('puts everything into carbs when there is no ratio to preserve', () => {
    const noFat: MacroTargets = { proteinG: 150, carbsG: 0, fatG: 0 }
    const scaled = scaleMacrosForEarnedKcal(noFat, 400)
    expect(scaled).toEqual({ proteinG: 150, carbsG: 100, fatG: 0 })
  })
})
