import { describe, it, expect } from 'vitest'
import { aggregateHrRecoveryTrend } from '../hr-recovery-trend'
import type { RecoveryEpisode } from '../hr-recovery-profile'

const TZ = 'Australia/Brisbane'

function ep(over: Partial<RecoveryEpisode>): RecoveryEpisode {
  return {
    peakBpm: 125, loggedAt: new Date('2026-05-10T00:00:00Z'), source: 'set_rest',
    drop30s: null, drop60s: null, drop90s: null, drop120s: 40,
    secToResting: null, recoveredResting: null,
    ...over,
  }
}

describe('aggregateHrRecoveryTrend', () => {
  it('groups by band and local month, one median point per (band, month), oldest first', () => {
    const episodes = [
      ep({ loggedAt: new Date('2026-05-05T00:00:00Z'), drop120s: 20 }), // rate 10
      ep({ loggedAt: new Date('2026-05-20T00:00:00Z'), drop120s: 30 }), // rate 15 -> May median 12.5
      ep({ loggedAt: new Date('2026-06-15T00:00:00Z'), drop120s: 50 }), // rate 25 -> June median 25
    ]
    const trends = aggregateHrRecoveryTrend(episodes, TZ)
    const b = trends.find(t => t.label === '120–149')!
    expect(b.points.map(p => p.period)).toEqual(['2026-05', '2026-06'])
    expect(b.points[0]).toMatchObject({ period: '2026-05', medianRateBpmMin: 12.5, n: 2 })
    expect(b.points[1]).toMatchObject({ period: '2026-06', medianRateBpmMin: 25, n: 1 })
  })

  it('a late-night episode lands in the correct LOCAL month, not the UTC month', () => {
    // 2026-05-31 23:00 in Brisbane (UTC+10) is 2026-05-31 13:00 UTC -- still May in both. Use a
    // date where UTC and AEST genuinely disagree: 2026-05-31 15:30 UTC = 2026-06-01 01:30 AEST.
    const episodes = [ep({ loggedAt: new Date('2026-05-31T15:30:00Z') })]
    const trends = aggregateHrRecoveryTrend(episodes, TZ)
    const b = trends.find(t => t.label === '120–149')!
    expect(b.points[0].period).toBe('2026-06') // local month, not the UTC month (still 05)
  })

  it('a low-signal band is always omitted from the trend', () => {
    const episodes = [ep({ peakBpm: 100, drop120s: 5 })]
    const trends = aggregateHrRecoveryTrend(episodes, TZ)
    expect(trends.find(t => t.label === '90–104')).toBeUndefined()
  })

  // Q-516: 105-109 used to fall inside the dimmed `<110` band and was dropped from the trend
  // entirely, despite a mean 60-second drop of 11.5 bpm.
  it('keeps the 105-119 episodes the old low-signal boundary excluded', () => {
    const trends = aggregateHrRecoveryTrend([ep({ peakBpm: 107, drop120s: 20 })], TZ)
    expect(trends.find(t => t.label === '105–119')).toBeDefined()
  })

  it('episodes with no usable rate or no loggedAt are skipped, not crashed on', () => {
    const episodes = [
      ep({ drop30s: null, drop60s: null, drop90s: null, drop120s: null }), // no rate
      ep({ loggedAt: null }), // can't place on a timeline
    ]
    expect(aggregateHrRecoveryTrend(episodes, TZ)).toEqual([])
  })

  it('empty input -> empty trend, no throw', () => {
    expect(aggregateHrRecoveryTrend([], TZ)).toEqual([])
  })
})
