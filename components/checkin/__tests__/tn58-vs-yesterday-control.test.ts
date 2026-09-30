import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DayCheckinExtrasSchema, dayCheckinHasAnswers } from '@trainingai/shared/validation/day-checkin'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

/** TN-58. The absolute 1–5 produced **two distinct values across 96 check-ins**, sd 0.29, none of
 *  them touched. This is the comparative control that asks the question we actually want answered,
 *  writing the `vs_normal` column LB-124 shipped.
 *
 *  **LB-191 inverted the first case: the neutral IS seeded now**, by the owner's explicit call after
 *  the cost was put to him. So the question these guard has changed from *"is nothing selected"* to
 *  *"is the seeded value the neutral, and is NULL still reachable"* — because with a value seeded,
 *  the only remaining signal of "not answered" is a dismissal storing nothing, and a `??` anywhere
 *  on the write path would turn the seed into an answer the owner never gave.
 *
 *  **2 of these 5 discriminate, and it is stated rather than implied.** Seeding `null` again, or
 *  seeding a value the control does not offer, turns the first red; a `??` on the payload turns the
 *  second red. The third characterises the picker, and the last two are Lane A's schema and
 *  `dayCheckinHasAnswers` — they pass either way and are here because the whole design depends on
 *  them: a 201-that-stores-nothing, or a three-tap check-in rejected as empty, would each make this
 *  question unable to produce the variance it exists to produce. */

const ROOT = path.resolve(__dirname, '../../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
const code = (src: string) =>
  stripComments(src)

describe('TN-58/LB-191 — the comparative control seeds the neutral, and NULL stays reachable', () => {
  it('the control seeds the neutral, and seeds it from the picker\'s own constant', () => {
    const sheet = code(read('components/morning-checkin-sheet.tsx'))
    expect(sheet, 'the seed is back to null, or is a literal that can drift from the option list')
      .toMatch(/useState<VsNormal \| null>\(VS_NORMAL_DEFAULT\)/)
    // Closing the sheet resets the state, so a seed applied only at mount would leave the SECOND
    // open of the day with nothing selected.
    expect(sheet, 'the close-reset still clears to null, so the seed lasts one open only')
      .toMatch(/setVsNormal\(VS_NORMAL_DEFAULT\)/)
    const picker = code(read('components/checkin/vs-normal-picker.tsx'))
    expect(picker, 'the seeded value is not the neutral — it must be the one labelled "About the same"')
      .toMatch(/VS_NORMAL_DEFAULT: VsNormal = 'same'/)
    expect(sheet, 'vsNormal was added to the absolute scales\' neutral seed')
      .not.toMatch(/NEUTRAL_SCALES[^\n]*vsNormal/)
  })

  it('a restored row is read back exactly as stored, so a cleared answer stays cleared', () => {
    // The one place the seed must NOT apply. A stored NULL is either an answer he cleared or a row
    // from before LB-191; re-seeding the neutral over it is the TN-57 shape under a new name.
    const sheet = code(read('components/morning-checkin-sheet.tsx'))
    expect(sheet, 'the restore re-seeds the neutral over a stored NULL')
      .toMatch(/setVsNormal\(saved\.vsNormal \?\? null\)/)
  })

  it('and the sheet posts it straight through, with no ?? fallback on the way', () => {
    const sheet = code(read('components/morning-checkin-sheet.tsx'))
    expect(sheet).toMatch(/^\s*vsNormal,\s*$/m)
    expect(sheet, 'a ?? on the payload would turn "not answered" into an answer')
      .not.toMatch(/vsNormal:\s*vsNormal\s*\?\?/)
    // The local write hard-coded `vsNormal: null` before the payload spread. Key order would
    // decide silently which won; the placeholder is gone rather than left to that.
    expect(sheet, 'the placeholder null is still in the local write, beside the real value')
      .not.toMatch(/vsNormal:\s*null/)
  })

  it('the picker offers exactly the three values the column accepts, and can be cleared', () => {
    const picker = code(read('components/checkin/vs-normal-picker.tsx'))
    for (const v of ['better', 'same', 'worse']) expect(picker).toContain(`'${v}'`)
    expect(picker, 'tapping the selected option no longer clears it — a mis-tap would be stuck')
      .toMatch(/onChange\(selected \? null : opt\.value\)/)
  })

  it('the schema rejects anything else, rather than storing nothing and returning 201', () => {
    const parse = (vsNormal: unknown) => DayCheckinExtrasSchema.safeParse({ vsNormal }).success
    expect(parse('better')).toBe(true)
    expect(parse(null), 'null must parse — it is how a skipped answer reaches the column').toBe(true)
    expect(parse(undefined), 'omitted must parse too — the sheet may not send the key at all').toBe(true)
    expect(parse('neutral'), 'a neutral is exactly the value this question exists to refuse').toBe(false)
    expect(parse(3), 'the absolute scale\'s shape must not be accepted here').toBe(false)
  })

  it('a check-in whose only answer is this one still counts as an answer', () => {
    // Otherwise the cheapest possible honest check-in — three taps and nothing else — is rejected
    // as empty, and the question can never produce the variance it exists to produce.
    expect(dayCheckinHasAnswers({ vsNormal: 'worse' })).toBe(true)
    expect(dayCheckinHasAnswers({ vsNormal: null })).toBe(false)
    expect(dayCheckinHasAnswers({})).toBe(false)
  })
})
