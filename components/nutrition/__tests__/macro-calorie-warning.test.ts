import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { macroCalorieDisagreement, MACRO_MISMATCH_VISIBLE_LIMIT } from '@trainingai/shared/nutrition/scan-totals'

/**
 * BF-109 — the barcode Review sheet was the one food surface with no macro/calorie cross-check.
 *
 * The owner scanned `9350167000490` and got **173 kcal** beside 45.7 P / 52.1 C / 13.6 F — macros
 * that come to **514** by Atwater. The screen was right and the row was wrong: OFF is filled in
 * field by field, and that product's energy is wrong at source. The check already existed
 * (`macroCalorieDisagreement`, used by the OFF text-search list since it was written); the barcode
 * path was simply the surface without it.
 */

const OWNERS_SCAN = { calories: 173, proteinG: 45.7, carbsG: 52.1, fatG: 13.6 }

describe('the row that started this', () => {
  it('is far past the visible limit, which is why it should have been flagged on sight', () => {
    const off = macroCalorieDisagreement(OWNERS_SCAN)!
    expect(off).toBeGreaterThan(MACRO_MISMATCH_VISIBLE_LIMIT)
    // The entry's own figure: 197% disagreement, 13x the 15% limit. Asserted rather than described,
    // so a change to either the check or the limit shows up here as a number.
    expect(off).toBeCloseTo(1.97, 1)
  })

  it('the Atwater figure the warning offers is 514', () => {
    const fromMacros = Math.round(OWNERS_SCAN.proteinG * 4 + OWNERS_SCAN.carbsG * 4 + OWNERS_SCAN.fatG * 9)
    expect(fromMacros).toBe(514)
  })
})

describe('what must NOT be flagged', () => {
  it('a food whose numbers agree', () => {
    const off = macroCalorieDisagreement({ calories: 500, proteinG: 40, carbsG: 45, fatG: 18 })!
    expect(off).toBeLessThanOrEqual(MACRO_MISMATCH_VISIBLE_LIMIT)
  })

  it('a high-fibre food a little out — the legitimate case the entry protects', () => {
    // Fibre and alcohol put real foods 10-20% out. Silently rewriting these is what the entry says
    // not to do, and the 15% limit is what keeps a note from becoming an alarm.
    const off = macroCalorieDisagreement({ calories: 100, proteinG: 5, carbsG: 20, fatG: 1 })!
    expect(off).toBeLessThanOrEqual(MACRO_MISMATCH_VISIBLE_LIMIT)
  })

  it('a genuinely calorie-free item, rather than dividing by zero', () => {
    expect(macroCalorieDisagreement({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 })).toBeNull()
  })
})

const ROOT = path.resolve(__dirname, '../../..')
const source = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

describe('the Review sheet is wired to it', () => {
  it('renders the warning, ungated, directly under the Calories field', () => {
    const src = source('components/nutrition/review-step.tsx')
    // **Adjacency, not mere presence.** `expect(src).toContain('<MacroCalorieWarning')` was the first
    // version and it survived wrapping the whole thing in `{false && …}` — the text is still there
    // while the warning never renders, which is the shape of guard that reads as coverage and is
    // not. Pinning it to the line after Calories kills both that and moving it away from the field
    // it is about.
    // `[\s{}]*` between them, not `\s*`: `source()` strips `/* … */` and a JSX comment
    // `{/* … */}` leaves its braces behind, so the two are separated by `{}` rather than by
    // whitespace alone. Braces and space are still not `false &&`, which is what this has to catch.
    expect(src).toMatch(/\{numField\('Calories', 'calories', 'kcal', 1\)\}[\s{}]*<MacroCalorieWarning/)
    for (const field of ['calories={value.calories}', 'proteinG={value.proteinG}', 'carbsG={value.carbsG}', 'fatG={value.fatG}']) {
      expect(src, `${field} must be passed`).toContain(field)
    }
  })

  it('the correction is a tap, never automatic', () => {
    // The entry is explicit that silent rewriting is the wrong call here: Review exists for the user
    // to decide, and a screen showing one number while the store keeps another is the worse bug.
    const src = source('components/nutrition/review-step.tsx')
    expect(src).toMatch(/onUseMacroCalories=\{kcal => set\('calories', kcal\)\}/)

    const warn = source('components/nutrition/macro-calorie-warning.tsx')
    expect(warn, 'the warning must not write on mount').not.toMatch(/useEffect/)
    expect(warn).toMatch(/onClick=\{\(\) => onUseMacroCalories\(fromMacros\)\}/)
  })

  it('reuses the shared check and its limit rather than a local threshold', () => {
    // No new formula: the entry says so, and a second copy of the 15% is how the search list and
    // this sheet would come to disagree about the same row.
    const warn = source('components/nutrition/macro-calorie-warning.tsx')
    expect(warn).toContain("from '@trainingai/shared/nutrition/scan-totals'")
    expect(warn).toContain('MACRO_MISMATCH_VISIBLE_LIMIT')
    expect(warn).not.toMatch(/0\.15|> 0\.4/)
  })

  it('says it in words and an icon, not colour alone', () => {
    const warn = source('components/nutrition/macro-calorie-warning.tsx')
    expect(warn).toContain('TriangleAlert')
    expect(warn).toMatch(/come to \{fromMacros/)
  })
})
