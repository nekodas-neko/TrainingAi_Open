import { describe, it, expect } from 'vitest'
import {
  bandForPeak, recoveryRateBpmPerMin, aggregateHrRecoveryProfile, episodeFromSetHrStats,
  isLowSignalBand, LOW_SIGNAL_MAX_BPM, PEAK_BANDS,
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
    expect(bandForPeak(89)?.label).toBe('<90')
    expect(bandForPeak(90)?.label).toBe('90–104')
    expect(bandForPeak(104)?.label).toBe('90–104')
    expect(bandForPeak(105)?.label).toBe('105–119')
    expect(bandForPeak(119)?.label).toBe('105–119')
    expect(bandForPeak(120)?.label).toBe('120–149')
    expect(bandForPeak(149)?.label).toBe('120–149')
    expect(bandForPeak(150)?.label).toBe('150+')
    expect(bandForPeak(220)?.label).toBe('150+')
  })

  // Q-516: `170+` held zero episodes across BOTH sources and is gone. The bound is the observed
  // maximum over lifting rests (132) AND cardio cool-downs (168) — measuring it over strength
  // alone is what made the entry propose collapsing the top bands, which would have put a 168 bpm
  // cool-down in the same bucket as a 120 bpm lifting rest.
  it('has no band that neither source can reach', () => {
    const OBSERVED_MAX_ANY_SOURCE = 168
    for (const b of PEAK_BANDS) expect(b.min).toBeLessThan(OBSERVED_MAX_ANY_SOURCE)
  })

  it('still separates a cardio cool-down from a lifting rest', () => {
    expect(bandForPeak(168)?.label).not.toBe(bandForPeak(120)?.label)
  })
})

describe('isLowSignalBand', () => {
  it('marks every band that ends at or below the threshold, and no others', () => {
    for (const b of PEAK_BANDS) expect(isLowSignalBand(b)).toBe(b.max <= LOW_SIGNAL_MAX_BPM)
  })

  // The invariant the old version broke: a threshold that does not land on a band edge dims part
  // of a band's range and not the rest, which is unobservable from the rendered bands.
  it('sits exactly on a band boundary, so it can never half-dim a band', () => {
    expect(PEAK_BANDS.some(b => b.max === LOW_SIGNAL_MAX_BPM)).toBe(true)
  })

  // The defect Q-516 found: the old `<110` boundary cut through the middle of the informative
  // range, so 42 covered episodes peaking 105-109 — dropping 11.5 bpm in their first minute —
  // were dimmed as noise alongside episodes that genuinely do not move.
  it('no longer dims the 105-109 episodes the old boundary swallowed', () => {
    expect(isLowSignalBand(bandForPeak(107)!)).toBe(false)
    expect(isLowSignalBand(bandForPeak(95)!)).toBe(true)
    expect(isLowSignalBand(bandForPeak(80)!)).toBe(true)
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
      ep({ peakBpm: 125, drop120s: 30 }),  // rate 15
      ep({ peakBpm: 128, drop120s: 50 }),  // rate 25
      ep({ peakBpm: 95, drop120s: 5 }),    // low-signal band, rate 2.5
    ]
    const profile = aggregateHrRecoveryProfile(episodes)
    expect(profile.totalEpisodes).toBe(3)
    const bTop = profile.bands.find(b => b.label === '120–149')!
    expect(bTop.n).toBe(2)
    expect(bTop.medianRateBpmMin).toBe(20) // median(15,25)
    expect(bTop.lowSignal).toBe(false)
    expect(bTop.bySource).toEqual({ set_rest: 2 })

    const bLow = profile.bands.find(b => b.label === '90–104')!
    expect(bLow.lowSignal).toBe(true)

    // <90, 105-119 and 150+ had zero episodes -> omitted entirely
    expect(profile.bands.find(b => b.label === '<90')).toBeUndefined()
    expect(profile.bands.find(b => b.label === '105–119')).toBeUndefined()
    expect(profile.bands.find(b => b.label === '150+')).toBeUndefined()
  })

  it('recoveredPct reflects the censoring flag, and a single anomaly does not skew the median', () => {
    const episodes = [
      ep({ peakBpm: 125, drop120s: 20, recoveredResting: true }),
      ep({ peakBpm: 125, drop120s: 22, recoveredResting: true }),
      ep({ peakBpm: 125, drop120s: 21, recoveredResting: false }), // never reached resting HR
      ep({ peakBpm: 125, drop120s: 500, recoveredResting: true }), // anomalous rate — median resists it
    ]
    const profile = aggregateHrRecoveryProfile(episodes)
    const b = profile.bands.find(x => x.label === '120–149')!
    expect(b.n).toBe(4)
    expect(b.recoveredPct).toBe(75) // 3/4
    // median of [10, 10.5, 11, 250] (bpm/min) = (10.5+11)/2 = 10.75 -> not skewed toward 250
    expect(b.medianRateBpmMin).toBeLessThan(50)
  })

  it('a band with episodes but no usable drop points reports null rate, not zero', () => {
    const episodes = [ep({ peakBpm: 125, drop30s: null, drop60s: null, drop90s: null, drop120s: null })]
    const profile = aggregateHrRecoveryProfile(episodes)
    const b = profile.bands.find(x => x.label === '120–149')!
    expect(b.medianRateBpmMin).toBeNull()
  })

  it('empty input -> empty profile, no throw', () => {
    expect(aggregateHrRecoveryProfile([])).toEqual({ bands: [], totalEpisodes: 0, informativeShare: null })
  })

  it('reports the share of episodes that carry signal at all', () => {
    // Two informative against three noise — the number the feature has to say out loud, because
    // four populated buckets look like a working feature whether or not they are.
    const profile = aggregateHrRecoveryProfile([
      ep({ peakBpm: 125 }), ep({ peakBpm: 110 }),
      ep({ peakBpm: 100 }), ep({ peakBpm: 95 }), ep({ peakBpm: 80 }),
    ])
    expect(profile.informativeShare).toBe(0.4)
  })

  it('bySource makes a mixed band (lifting + run) visible rather than silently averaged', () => {
    const episodes = [
      ep({ peakBpm: 125, source: 'set_rest' }),
      ep({ peakBpm: 128, source: 'set_rest' }),
      ep({ peakBpm: 130, source: 'run_cooldown' }),
    ]
    const b = aggregateHrRecoveryProfile(episodes).bands.find(x => x.label === '120–149')!
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
