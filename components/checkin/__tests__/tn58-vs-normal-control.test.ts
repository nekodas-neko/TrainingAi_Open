import { describe, expect, it } from 'vitest'
import { DayCheckinExtrasSchema, dayCheckinHasAnswers } from '@trainingai/shared/validation/day-checkin'

/** #2411: the comparative check-in row is no longer asked in either app. The column stays and
 *  older clients may still send it, so the server schema keeps accepting it. */
describe('vs_normal after the row was dropped', () => {
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
