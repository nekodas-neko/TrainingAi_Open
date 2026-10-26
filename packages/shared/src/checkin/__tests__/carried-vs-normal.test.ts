import { describe, expect, it } from 'vitest'
import { carriedVsNormal } from '../carried-vs-normal'

describe('carriedVsNormal', () => {
  it('keeps the answer, its question and whether it was touched', () => {
    expect(carriedVsNormal({ vsNormal: 'worse', vsQuestion: 1, vsNormalTouched: true })).toEqual({
      vsNormal: 'worse',
      vsQuestion: 1,
      vsNormalTouched: true,
    })
  })

  it('invents nothing when there is no saved row', () => {
    expect(carriedVsNormal(null)).toEqual({ vsNormal: null, vsNormalTouched: false })
    expect(carriedVsNormal({ vsNormal: 'same' })).toEqual({ vsNormal: 'same', vsNormalTouched: false })
  })

  it('drops a value the schema would reject', () => {
    expect(carriedVsNormal({ vsNormal: 'much worse', vsQuestion: 3 })).toEqual({
      vsNormal: null,
      vsNormalTouched: false,
    })
  })
})
