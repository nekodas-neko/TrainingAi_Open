import { describe, expect, it } from 'vitest'
import { settledNights } from '../settled-nights'

describe('settledNights — BF-83', () => {
  it('drops a night that is still filling', () => {
    const nights = [
      { date: 'a', provisional: true },
      { date: 'b', provisional: false },
      { date: 'c' },
    ]
    expect(settledNights(nights).map(n => n.date)).toEqual(['b', 'c'])
  })

  it('treats an absent flag as settled, not as provisional', () => {
    // Every night before the flag existed carries no value, and dropping those would empty the
    // baseline rather than protect it.
    expect(settledNights([{}, {}])).toHaveLength(2)
  })

  it('keeps the order it was given', () => {
    const nights = [{ date: 'a' }, { date: 'b', provisional: true }, { date: 'c' }]
    expect(settledNights(nights).map(n => n.date)).toEqual(['a', 'c'])
  })

  it('can return nothing, which the caller must gate on', () => {
    // One provisional night and no history is a real state on a fresh install; the sheet's own
    // `>= 3` check is what stops an empty baseline rendering as a scale.
    expect(settledNights([{ provisional: true }])).toEqual([])
  })
})
