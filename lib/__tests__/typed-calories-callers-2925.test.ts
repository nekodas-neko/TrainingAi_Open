/**
 * #2925. #2876 made `sanitiseFoodItemNutrition(fields, source)` keep what a person typed, but two
 * callers still reported a source that sends the number back through the model-hallucination repair:
 * the logger sheet (a scan the user then corrected kept the scan's origin) and the two search paths
 * (a database hit with calories and no macros went in as 'text' with 0 g macros).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { stripComments } from '../../scripts/lib/strip-comments.js'
import { sanitiseFoodItemNutrition } from '@trainingai/shared/nutrition/scan-totals'
import { lookupHitSource, sourceAfterEdit } from '@trainingai/shared/nutrition/log-food'

const SCAN = { calories: 300, proteinG: 20, carbsG: 30, fatG: 10, servingSizeG: 100 }
const stored = (source: string, f: typeof SCAN) => sanitiseFoodItemNutrition(f, source).calories

describe('a scan the user corrected', () => {
  it('keeps the figure they typed', () => {
    // The scan said 300 kcal with 20/30/10 (290 from macros). They know the label says 500.
    const typed = { ...SCAN, calories: 500 }
    expect(sourceAfterEdit('ai', SCAN, typed)).toBe('manual')
    expect(stored(sourceAfterEdit('ai', SCAN, typed), typed)).toBe(500)
    // Under the old source the repair rewrote it from the macros.
    expect(stored('ai', typed)).not.toBe(500)
  })
  it('also covers a macro the user changed, since the repair reads calories against the macros', () => {
    expect(sourceAfterEdit('barcode', SCAN, { ...SCAN, proteinG: 25 })).toBe('manual')
  })
  it('leaves an untouched scan with its origin, and so with its repair', () => {
    expect(sourceAfterEdit('ai', SCAN, { ...SCAN })).toBe('ai')
    expect(sourceAfterEdit('barcode', SCAN, { ...SCAN })).toBe('barcode')
  })
  it('a hand-typed entry, or no scan, stays manual', () => {
    expect(sourceAfterEdit('manual', null, SCAN)).toBe('manual')
  })
})

describe('a lookup hit with calories and no macros', () => {
  const hit = { calories: 250, proteinG: undefined, carbsG: null, fatG: undefined }
  const asStored = { calories: 250, proteinG: 0, carbsG: 0, fatG: 0, servingSizeG: 100 }
  it('keeps its calories', () => {
    expect(lookupHitSource(hit)).toBe('manual')
    expect(stored(lookupHitSource(hit), asStored)).toBe(250)
    // The old fixed 'text' zeroed it.
    expect(stored('text', asStored)).toBe(0)
  })
  it('a hit with macros is still a lookup and still repaired', () => {
    expect(lookupHitSource({ calories: 250, proteinG: 10, carbsG: 30, fatG: 5 })).toBe('text')
  })
  it('a hit with no calories is not rescued', () => {
    expect(lookupHitSource({ calories: 0 })).toBe('text')
  })
})

describe('each caller goes through the helper', () => {
  const read = (rel: string) => stripComments(readFileSync(path.resolve(__dirname, '../..', rel), 'utf8'))
  it('the logger sheet', () => {
    const src = read('components/nutrition/food-logger-sheet.tsx')
    expect(src).toMatch(/source:\s*sourceAfterEdit\(/)
    expect(src).not.toMatch(/source:\s*scanOriginToSource\(/)
  })
  it.each(['components/nutrition/food-list.tsx', 'components/nutrition/ingredient-picker.tsx'])('%s', rel => {
    const src = read(rel)
    expect(src).toMatch(/source:\s*lookupHitSource\(food\)/)
    expect(src).not.toMatch(/source:\s*'text'/)
  })
})
