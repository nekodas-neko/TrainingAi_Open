import { describe, expect, it } from 'vitest'
import { weekOverWeekChange } from '../trend-delta'

describe('weekOverWeekChange', () => {
  const week = (v: number) => Array<number>(7).fill(v)
  it('is null without today or a first week', () => {
    expect(weekOverWeekChange([])).toBeNull()
    expect(weekOverWeekChange([...week(10), ...week(10), null])).toBeNull()
    expect(weekOverWeekChange([...Array(7).fill(null), 5])).toBeNull()
  })
  it('reports a rise against the first-week average', () => {
    expect(weekOverWeekChange([...week(100), ...week(100), 104])).toEqual({
      direction: 'up', amount: 4, text: '▲ 4 vs last week',
    })
  })
  it('reports a fall', () => {
    expect(weekOverWeekChange([...week(100), 97])).toMatchObject({ direction: 'down', amount: 3, text: '▼ 3 vs last week' })
  })
  it('reports no change when it rounds to zero', () => {
    expect(weekOverWeekChange([...week(100), 100.4])).toEqual({
      direction: 'same', amount: 0, text: '— same as last week',
    })
  })
})
