import { describe, it, expect } from 'vitest'
import {
  bandForPeak, recoveryRateBpmPerMin, aggregateHrRecoveryProfile, episodeFromSetHrStats,
  type RecoveryEpisode,
} from '../hr-recovery-profile'

function ep(over: Partial<RecoveryEpisode>): RecoveryEpisode {
  return {
    peakBpm: 150, loggedAt: new Date('2026-07-10T00:00:00Z'), source: 'set_rest',
    drop30s: null, drop60s: null, drop90s: null, drop120s: 40,
    secToResting: 100, recoveredResting: true,
    ...over,
  }
}

describe('bandForPeak', () => {
  it('buckets into the right band, boundaries inclusive-low/exclusive-high', () => {
    expect(bandForPeak(99)?.label).toBe('<110')
    expect(bandForPeak(110)?.label).toBe('110–129')
    expect(bandForPeak(129)?.label).toBe('110–129')
    expect(bandForPeak(130)?.label).toBe('130–149')
    expect(bandForPeak(170)?.label).toBe('170+')
    expect(bandForPeak(220)?.label).toBe('170+')
  })
})

describe('recoveryRateBpmPerMin', () => {
  it('prefers the largest available drop point', () => {
    expect(recoveryRateBpmPerMin(ep({ drop30s: 10, drop60s: 18, drop90s: 25, drop120s: 40 }))).toBe(20) // 40/120*60
  })
  it('falls back to a smaller point when later ones are null (rest ended early)', () => {
    expect(recoveryRateBpmPerMin(ep({ drop30s: 10, drop60s: 18, drop90s: null, drop120s: null }))).toBe(18) // 18/60*60
  })
  it('null when no drop point at all', () => {
    expect(recoveryRateBpmPerMin(ep({ drop30s: null, drop60s: null, drop90s: null, drop120s: null }))).toBeNull()
  })
})

describe('aggregateHrRecoveryProfile', () => {
  it('groups by band and computes median rate/seconds, omitting empty bands', () => {
    const episodes = [
      ep({ peakBpm: 155, drop120s: 30 }),  // rate 15
      ep({ peakBpm: 160, drop120s: 50 }),  // rate 25
      ep({ peakBpm: 105, drop120s: 5 }),   // low-signal band, rate 2.5
    ]
    const profile = aggregateHrRecoveryProfile(episodes)
    expect(profile.totalEpisodes).toBe(3)
    const b150 = profile.bands.find(b => b.label === '150–169')!
    expect(b150.n).toBe(2)
    expect(b150.medianRateBpmMin).toBe(20) // median(15,25)
    expect(b150.lowSignal).toBe(false)
    expect(b150.bySource).toEqual({ set_rest: 2 })

    const bLow = profile.bands.find(b => b.label === '<110')!
    expect(bLow.lowSignal).toBe(true)

    // 130-149 / 170+ had zero episodes -> omitted entirely
    expect(profile.bands.find(b => b.label === '130–149')).toBeUndefined()
    expect(profile.bands.find(b => b.label === '170+')).toBeUndefined()
  })

  it('recoveredPct reflects the censoring flag, and a single anomaly does not skew the median', () => {
    const episodes = [
      ep({ peakBpm: 150, drop120s: 20, recoveredResting: true }),
      ep({ peakBpm: 150, drop120s: 22, recoveredResting: true }),
      ep({ peakBpm: 150, drop120s: 21, recoveredResting: false }), // never reached resting HR
      ep({ peakBpm: 150, drop120s: 500, recoveredResting: true }), // anomalous rate — median resists it
    ]
    const profile = aggregateHrRecoveryProfile(episodes)
    const b = profile.bands.find(x => x.label === '150–169')!
    expect(b.n).toBe(4)
    expect(b.recoveredPct).toBe(75) // 3/4
    // median of [10, 10.5, 11, 250] (bpm/min) = (10.5+11)/2 = 10.75 -> not skewed toward 250
    expect(b.medianRateBpmMin).toBeLessThan(50)
  })

  it('a band with episodes but no usable drop points reports null rate, not zero', () => {
    const episodes = [ep({ peakBpm: 150, drop30s: null, drop60s: null, drop90s: null, drop120s: null })]
    const profile = aggregateHrRecoveryProfile(episodes)
    const b = profile.bands.find(x => x.label === '150–169')!
    expect(b.medianRateBpmMin).toBeNull()
  })

  it('empty input -> empty profile, no throw', () => {
    expect(aggregateHrRecoveryProfile([])).toEqual({ bands: [], totalEpisodes: 0 })
  })

  it('bySource makes a mixed band (lifting + run) visible rather than silently averaged', () => {
    const episodes = [
      ep({ peakBpm: 155, source: 'set_rest' }),
      ep({ peakBpm: 158, source: 'set_rest' }),
      ep({ peakBpm: 160, source: 'run_cooldown' }),
    ]
    const b = aggregateHrRecoveryProfile(episodes).bands.find(x => x.label === '150–169')!
    expect(b.bySource).toEqual({ set_rest: 2, run_cooldown: 1 })
  })
})

describe('episodeFromSetHrStats', () => {
  it('normalises a set_hr_stats row into a set_rest episode', () => {
    const row = {
      peakBpm: 168, loggedAt: new Date('2026-07-10T00:00:00Z'),
      drop30s: 10, drop60s: 20, drop90s: 28, drop120s: 34,
      secToResting: 95, recoveredResting: true,
    }
    expect(episodeFromSetHrStats(row)).toEqual({
      peakBpm: 168, loggedAt: row.loggedAt, source: 'set_rest',
      drop30s: 10, drop60s: 20, drop90s: 28, drop120s: 34,
      secToResting: 95, recoveredResting: true,
    })
  })

  it('null peak -> no episode (a set with no trustworthy peak contributes nothing)', () => {
    expect(episodeFromSetHrStats({
      peakBpm: null, loggedAt: null, drop30s: null, drop60s: null, drop90s: null, drop120s: null,
      secToResting: null, recoveredResting: null,
    })).toBeNull()
  })
})
