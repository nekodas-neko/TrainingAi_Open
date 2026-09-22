import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DayCheckinExtrasSchema, dayCheckinHasAnswers } from '@trainingai/shared/validation/day-checkin'

/** TN-58. The absolute 1–5 produced **two distinct values across 96 check-ins**, sd 0.29, none of
 *  them touched. This is the comparative control that asks the question we actually want answered,
 *  writing the `vs_yesterday` column LB-124 shipped.
 *
 *  **The defect this guards is a default, not a bug in the happy path.** A neutral stored as though
 *  it were an answer is exactly what TN-57 fixed, and shipping one here would recreate it under a
 *  new name — so the assertions are about what happens when the owner says NOTHING.
 *
 *  **2 of these 5 discriminate, and it is stated rather than implied.** Reverting the sheet turns
 *  the first two red. The third characterises a component that did not exist before, and the last
 *  two are Lane A's schema and `dayCheckinHasAnswers` — they pass either way and are here because
 *  the whole design depends on them: a 201-that-stores-nothing, or a three-tap check-in rejected
 *  as empty, would each make this question unable to produce the variance it exists to produce. */

const ROOT = path.resolve(__dirname, '../../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

describe('TN-58 — a skipped comparative answer stores nothing', () => {
  it('the control has no default and no pre-selection', () => {
    const sheet = code(read('components/morning-checkin-sheet.tsx'))
    expect(sheet, 'the state is seeded with a value — the TN-57 defect under a new name')
      .toMatch(/useState<VsYesterday \| null>\(null\)/)
    expect(sheet, 'vsYesterday was added to the absolute scales\' neutral seed')
      .not.toMatch(/NEUTRAL_SCALES[^\n]*vsYesterday/)
  })

  it('and the sheet posts it straight through, with no ?? fallback on the way', () => {
    const sheet = code(read('components/morning-checkin-sheet.tsx'))
    expect(sheet).toMatch(/^\s*vsYesterday,\s*$/m)
    expect(sheet, 'a ?? on the payload would turn "not answered" into an answer')
      .not.toMatch(/vsYesterday:\s*vsYesterday\s*\?\?/)
    // The local write hard-coded `vsYesterday: null` before the payload spread. Key order would
    // decide silently which won; the placeholder is gone rather than left to that.
    expect(sheet, 'the placeholder null is still in the local write, beside the real value')
      .not.toMatch(/vsYesterday:\s*null/)
  })

  it('the picker offers exactly the three values the column accepts, and can be cleared', () => {
    const picker = code(read('components/checkin/vs-yesterday-picker.tsx'))
    for (const v of ['better', 'same', 'worse']) expect(picker).toContain(`'${v}'`)
    expect(picker, 'tapping the selected option no longer clears it — a mis-tap would be stuck')
      .toMatch(/onChange\(selected \? null : opt\.value\)/)
  })

  it('the schema rejects anything else, rather than storing nothing and returning 201', () => {
    const parse = (vsYesterday: unknown) => DayCheckinExtrasSchema.safeParse({ vsYesterday }).success
    expect(parse('better')).toBe(true)
    expect(parse(null), 'null must parse — it is how a skipped answer reaches the column').toBe(true)
    expect(parse(undefined), 'omitted must parse too — the sheet may not send the key at all').toBe(true)
    expect(parse('neutral'), 'a neutral is exactly the value this question exists to refuse').toBe(false)
    expect(parse(3), 'the absolute scale\'s shape must not be accepted here').toBe(false)
  })

  it('a check-in whose only answer is this one still counts as an answer', () => {
    // Otherwise the cheapest possible honest check-in — three taps and nothing else — is rejected
    // as empty, and the question can never produce the variance it exists to produce.
    expect(dayCheckinHasAnswers({ vsYesterday: 'worse' })).toBe(true)
    expect(dayCheckinHasAnswers({ vsYesterday: null })).toBe(false)
    expect(dayCheckinHasAnswers({})).toBe(false)
  })
})
