import { describe, it, expect } from 'vitest'
import { formatDistanceToNow } from 'date-fns'
import { timeAgo } from '@trainingai/shared/format/time-ago'

const NOW = new Date('2026-10-18T02:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const MIN = 60_000
const DAY = 86_400_000

describe('timeAgo', () => {
  it('reads the way the web friend feed does', () => {
    expect(timeAgo(ago(20_000), NOW)).toBe('less than a minute ago')
    expect(timeAgo(ago(10 * MIN), NOW)).toBe('10 minutes ago')
    expect(timeAgo(ago(60 * MIN), NOW)).toBe('about 1 hour ago')
    expect(timeAgo(ago(3 * DAY), NOW)).toBe('3 days ago')
    expect(timeAgo(ago(41 * DAY), NOW)).toBe('about 1 month ago')
  })

  it('matches date-fns for the same instant', () => {
    for (const ms of [5 * MIN, 50 * MIN, 5 * 60 * MIN, 2 * DAY, 29 * DAY, 41 * DAY, 100 * DAY, 400 * DAY]) {
      const at = new Date(Date.now() - ms)
      expect(timeAgo(at, new Date())).toBe(formatDistanceToNow(at, { addSuffix: true }))
    }
  })

  it('returns null for a value that is not a date', () => {
    expect(timeAgo('not a date', NOW)).toBeNull()
  })
})
