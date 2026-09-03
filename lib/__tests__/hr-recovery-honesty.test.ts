import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { informativeShareNote, MINORITY_MAX_PCT } from '@/components/health/hr-recovery-honesty'
import { aggregateHrRecoveryProfile } from '@trainingai/shared/health/hr-recovery-profile'
import type { RecoveryEpisode } from '@trainingai/shared/health/hr-recovery-profile'

/**
 * Q-516's honesty half — `informativeShare` was computed and rendered nowhere.
 *
 * The entry's own warning is the thing under test: *four populated buckets look like a working
 * feature whether or not they are.* The share is driven through the real aggregate as well as
 * directly, so a change to the low-signal threshold moves this test rather than slipping past it.
 */

const ROOT = path.resolve(__dirname, '..', '..')
const card = () => readFileSync(path.join(ROOT, 'components/health/hr-recovery-profile-card.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

describe('when the caveat is worth showing', () => {
  it('says nothing when every rest carries signal', () => {
    // A "100% informative" line on a table that is entirely fine is noise, and noise is what trains
    // a reader to skip the line that matters.
    expect(informativeShareNote(1)).toBeNull()
  })

  it('says nothing when there is no share to report', () => {
    expect(informativeShareNote(null)).toBeNull()
    expect(informativeShareNote(undefined)).toBeNull()
  })

  it('speaks up as soon as anything is dimmed, not only in the bad case', () => {
    expect(informativeShareNote(0.99)).toEqual({ pct: 99, minority: false })
  })
})

describe('when it is emphasised', () => {
  it('treats a minority as the headline, not a footnote', () => {
    // The owner's own profile sat at 39% when Q-516 was written.
    expect(informativeShareNote(0.39)).toEqual({ pct: 39, minority: true })
  })

  it('puts the boundary at half, exclusive — exactly half is not a minority', () => {
    expect(informativeShareNote(0.5)).toEqual({ pct: 50, minority: false })
    expect(informativeShareNote(0.49)).toEqual({ pct: 49, minority: true })
    expect(MINORITY_MAX_PCT).toBe(50)
  })

  it('reports zero rather than going quiet, which is the worst case and the most worth saying', () => {
    expect(informativeShareNote(0)).toEqual({ pct: 0, minority: true })
  })

  it('rounds rather than truncates, because the share arrives as a float', () => {
    // `informativeShare` is stored to 2dp, and 0.29 * 100 is 28.999999999999996 in binary floating
    // point. Truncating renders 28% for a share of 29% — off by one, silently, on some values only.
    expect(informativeShareNote(0.29)?.pct).toBe(29)
    expect(informativeShareNote(0.58)?.pct).toBe(58)
  })
})

describe('driven through the real aggregate', () => {
  // Peaks chosen against the shipped bands: <90 and 90-104 are low-signal, 105+ carries signal.
  const episode = (peakBpm: number): RecoveryEpisode => ({
    peakBpm,
    loggedAt: new Date('2026-09-01T00:00:00Z'),
    source: 'set_rest',
    drop30s: null, drop60s: 12, drop90s: null, drop120s: null,
    secToResting: 90,
    recoveredResting: true,
  })

  it('reports the minority case a real profile produces', () => {
    // Six rests, two of them hard enough to read: the shape the entry describes.
    const profile = aggregateHrRecoveryProfile([
      episode(80), episode(85), episode(95), episode(100), episode(110), episode(130),
    ])
    expect(profile.informativeShare).toBe(0.33)
    expect(informativeShareNote(profile.informativeShare)).toEqual({ pct: 33, minority: true })
  })

  it('stays silent on a profile with nothing dimmed', () => {
    const profile = aggregateHrRecoveryProfile([episode(110), episode(130), episode(160)])
    expect(profile.informativeShare).toBe(1)
    expect(informativeShareNote(profile.informativeShare)).toBeNull()
  })
})

describe('the card renders it', () => {
  it('drives the note from the payload field rather than recomputing it', () => {
    expect(card()).toMatch(/informativeShareNote\(profile\.informativeShare\)/)
  })

  it('pins the minority branch to its own copy, condition and consequent together', () => {
    // Split assertions pass against a disabled branch — the string survives the condition going away.
    expect(card()).toMatch(/note\.minority\s*\?\s*`Only \$\{note\.pct\}% of your recorded rests/)
  })

  it('renders nothing at all when there is no note', () => {
    expect(card()).toMatch(/if \(!note\) return null/)
  })
})
