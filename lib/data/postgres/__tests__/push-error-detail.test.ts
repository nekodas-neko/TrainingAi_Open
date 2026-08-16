import { describe, it, expect } from 'vitest'
import { describeZodFailure } from '../push-error-detail'
import { ActivityLogBody } from '@trainingai/shared/validation/activity-log'

describe('describeZodFailure', () => {
  it('names the field path and the reason', () => {
    const res = ActivityLogBody.safeParse({
      date: '2026-08-01', activityType: 'walk', title: 'Interval walk', distanceKm: 0,
    })
    expect(res.success).toBe(false)
    if (res.success) return
    expect(describeZodFailure(res.error)).toContain('distanceKm')
  })

  it('joins at most three issues and stays short enough for a toast', () => {
    const res = ActivityLogBody.safeParse({ date: 'nope' })
    expect(res.success).toBe(false)
    if (res.success) return
    const msg = describeZodFailure(res.error)
    expect(msg.length).toBeLessThanOrEqual(200)
  })
})
