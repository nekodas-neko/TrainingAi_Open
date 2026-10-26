import { describe, expect, it } from 'vitest'
import { withLiveTodayActivity } from '../live-today-activity-trend'

const trends = [
  { date: '2026-10-24', activityScore: 70 },
  { date: '2026-10-25', activityScore: null },
  { date: '2026-10-26', activityScore: null },
]

describe('withLiveTodayActivity', () => {
  it("puts the live score on today's empty point and leaves other gaps alone", () => {
    expect(withLiveTodayActivity(trends, '2026-10-26', 55)).toEqual([
      { date: '2026-10-24', activityScore: 70 },
      { date: '2026-10-25', activityScore: null },
      { date: '2026-10-26', activityScore: 55 },
    ])
  })

  it('keeps a stored value for today', () => {
    const stored = [{ date: '2026-10-26', activityScore: 60 }]
    expect(withLiveTodayActivity(stored, '2026-10-26', 55)).toEqual(stored)
  })

  it('leaves the trend as it is when there is no live score', () => {
    expect(withLiveTodayActivity(trends, '2026-10-26', null)).toEqual(trends)
  })
})
