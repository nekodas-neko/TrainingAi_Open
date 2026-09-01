/**
 * BF-1 — the blood-panel shapes, asserted against the real 2026-04 report rather than invented ones.
 *
 * The entry's own rule is that this schema be written from a real panel, and these are the four
 * shapes that drove it: a result that is **not a number** (`<0.2`), reference ranges that arrive
 * two-sided, one-sided in **both** directions and absent, and flags that are commentary rather than
 * verdicts. Each is a row in `docs/clinical-baseline-2026-08-27.md`.
 *
 * **The load-bearing assertion is that the verdict is COMPUTED.** The report flags a creatinine of
 * 109 against a 60–130 range as *"Normal (athletic)"* and a urea of 9.2 against 2.5–8.0 as
 * *"High (likely protein intake)"*. Those are a clinician's words; CLAUDE.md forbids showing a
 * self-reported judgement as fact, so the bounds decide and the words are displayed as the words.
 */
import { describe, it, expect } from 'vitest'
import { rangeVerdict, parseResult, parseReference, analyteKey, slugAnalyte, ANALYTE_KEYS } from '../analyte-keys'

/** Straight from the report: label, unit, reference as printed, result as printed. */
const PANEL: [label: string, ref: string, result: string, expected: string][] = [
  ['Urea', '2.5–8.0', '9.2', 'high'],
  ['Creatinine', '60–130', '109', 'in'],
  ['ALT', '0–45', '46', 'high'],
  ['Cholesterol (total)', '<4.0', '5.1', 'high'],
  ['LDL (calculated)', '<2.5', '3.57', 'high'],
  ['Non-HDL', '<3.3', '3.93', 'high'],
  ['Total/HDL ratio', '<4.0', '4.4', 'high'],
  ['HDL', '>1.0', '1.17', 'in'],
  ['eGFR', '>59', '76', 'in'],
  ['MCH', '27–35', '26', 'low'],
  ['Triglycerides', '<2.0', '0.8', 'in'],
  ['Insulin (fasting)', '<25', '4', 'in'],
  ['Glucose (fasting)', '3.0–6.0', '4.8', 'in'],
  // The one that is not a number. `<0.2` against `<19`: below the ceiling however it resolves.
  ['Growth hormone', '<19', '<0.2', 'in'],
  ['Basophils', '<0.21', '0.06', 'in'],
]

describe('the real panel, row by row', () => {
  for (const [label, ref, result, expected] of PANEL) {
    it(`${label} ${result} against ${ref} reads ${expected}`, () => {
      const { refLow, refHigh } = parseReference(ref)
      const { valueNum, valueOperator } = parseResult(result)
      expect(rangeVerdict({ valueNum, valueOperator, refLow, refHigh }), label).toBe(expected)
    })
  }

  it('and the verdict disagrees with the report\'s own wording where the bounds say so', () => {
    // "Normal (athletic)" on a creatinine inside its range — the flag is commentary and the bounds
    // are the fact. Both are kept; only one of them is a boolean.
    expect(rangeVerdict({ valueNum: 109, valueOperator: null, refLow: 60, refHigh: 130 })).toBe('in')
    // "Borderline high" on an ALT one unit over. The word is a hedge; 46 > 45 is not.
    expect(rangeVerdict({ valueNum: 46, valueOperator: null, refLow: 0, refHigh: 45 })).toBe('high')
  })
})

describe('unknown is a real answer', () => {
  /**
   * A bounded result against a bound on the same side genuinely does not decide. `>59` with a
   * ceiling of 100 could be 60 or 600, and returning `in` there is a guess wearing a measurement's
   * clothes — the failure this whole entry is about, one layer down.
   */
  it('a bounded result that straddles its range is not resolved either way', () => {
    expect(rangeVerdict({ valueNum: 59, valueOperator: '>', refLow: 10, refHigh: 100 })).toBe('unknown')
    expect(rangeVerdict({ valueNum: 5, valueOperator: '<', refLow: 1, refHigh: 10 })).toBe('unknown')
  })

  it('a result with no bounds, or no number, is not resolved', () => {
    expect(rangeVerdict({ valueNum: 4.4, valueOperator: null, refLow: null, refHigh: null })).toBe('unknown')
    expect(rangeVerdict({ valueNum: null, valueOperator: null, refLow: 1, refHigh: 10 })).toBe('unknown')
  })

  it('but a bounded result clear of the range IS resolved', () => {
    // `<0.2` against a floor of 1 is below the floor whatever the true value is.
    expect(rangeVerdict({ valueNum: 0.2, valueOperator: '<', refLow: 1, refHigh: 10 })).toBe('low')
    // `>200` against a ceiling of 100 is above it whatever the true value is.
    expect(rangeVerdict({ valueNum: 200, valueOperator: '>', refLow: 1, refHigh: 100 })).toBe('high')
  })
})

describe('parsing the printed forms', () => {
  it('keeps the operator rather than flattening it to a number', () => {
    expect(parseResult('<0.2')).toEqual({ valueNum: 0.2, valueOperator: '<' })
    expect(parseResult('9.2')).toEqual({ valueNum: 9.2, valueOperator: null })
    expect(parseResult(' > 59 ')).toEqual({ valueNum: 59, valueOperator: '>' })
  })

  it('a result that is not a number stores as null rather than throwing', () => {
    // The row still stores, carrying its label and the provider's own text — a partial panel is
    // useful, a rejected one is not.
    expect(parseResult('not detected')).toEqual({ valueNum: null, valueOperator: null })
  })

  it('reads all four reference shapes, including the en-dash the report actually prints', () => {
    expect(parseReference('2.5–8.0')).toEqual({ refLow: 2.5, refHigh: 8.0 })
    expect(parseReference('60-130')).toEqual({ refLow: 60, refHigh: 130 })
    expect(parseReference('<25')).toEqual({ refLow: null, refHigh: 25 })
    expect(parseReference('>59')).toEqual({ refLow: 59, refHigh: null })
    expect(parseReference('—')).toEqual({ refLow: null, refHigh: null })
  })

  it('a negative bound is a bound, not a separator', () => {
    expect(parseReference('-2.5–1.0')).toEqual({ refLow: -2.5, refHigh: 1.0 })
  })
})

describe('analyte keys', () => {
  it('normalise the labels the report prints', () => {
    expect(analyteKey('LDL (calculated)')).toBe('ldl_calculated')
    expect(analyteKey('Insulin (fasting)')).toBe('insulin_fasting')
    expect(analyteKey('Total/HDL ratio')).toBe('cholesterol_hdl_ratio')
  })

  it('and an unknown label slugs rather than being dropped', () => {
    // A new marker must store. Losing a result because the table has not heard of it is the one
    // outcome worse than an ugly key.
    expect(analyteKey('Vitamin D (25-OH)')).toBe('vitamin_d_25_oh')
    expect(slugAnalyte('  Free T3  ')).toBe('free_t3')
  })

  it('every key in the table is unique, so two labels cannot collide onto one analyte', () => {
    const keys = Object.values(ANALYTE_KEYS)
    expect(new Set(keys).size, `duplicate analyte key: ${keys.filter((k, i) => keys.indexOf(k) !== i)}`)
      .toBe(keys.length)
  })
})
