import { describe, it, expect } from 'vitest'
import {
  bandFor, readPacer, resolveCadenceTargets, speedTargetsFromHistory, kmhFromPace,
  BAND_TOLERANCE, STOPPED_SPM, STOPPED_KMH, MIN_SEGMENTS_FOR_SPEED_TARGET, DEFAULT_CADENCE_TARGETS,
  type TargetPair,
} from '../walk-pacer'
import type { KindAggregate } from '../segment-stats'

const CADENCE: TargetPair = { fast: 120, slow: 95 }
const HR: TargetPair = { fast: 140, slow: 99 }

function agg(over: Partial<KindAggregate>): KindAggregate {
  return {
    avgHr: null, avgPaceSecPerKm: null, avgCadenceSpm: null,
    totalDistanceKm: null, avgDistanceKm: null, count: 0, ...over,
  }
}

describe('bandFor — the band is signed, so overshooting the right way stays green', () => {
  it('keeps a fast block green however far above the floor', () => {
    expect(bandFor(120, 'fast', CADENCE)).toBe('green')
    expect(bandFor(240, 'fast', CADENCE)).toBe('green')
  })

  it('keeps a slow block green however far below the ceiling', () => {
    expect(bandFor(95, 'slow', CADENCE)).toBe('green')
    expect(bandFor(60, 'slow', CADENCE)).toBe('green')
  })

  it('ambers the fast block inside the tolerance and reds it beyond', () => {
    // 10% under 120 is 108: the last amber value, and one below it is red.
    expect(bandFor(108, 'fast', CADENCE)).toBe('amber')
    expect(bandFor(119, 'fast', CADENCE)).toBe('amber')
    expect(bandFor(107, 'fast', CADENCE)).toBe('red')
  })

  it('ambers the slow block inside the tolerance and reds it beyond', () => {
    // 10% over 95 is 104.5.
    expect(bandFor(96, 'slow', CADENCE)).toBe('amber')
    expect(bandFor(104, 'slow', CADENCE)).toBe('amber')
    expect(bandFor(105, 'slow', CADENCE)).toBe('red')
  })

  it('takes the tolerance as an argument so a wider band widens the amber ring', () => {
    expect(bandFor(107, 'fast', CADENCE)).toBe('red')
    expect(bandFor(107, 'fast', CADENCE, 0.5)).toBe('amber')
  })

  it('states the band width as a constant rather than inlining it', () => {
    expect(BAND_TOLERANCE).toBeGreaterThan(0)
    expect(BAND_TOLERANCE).toBeLessThan(1)
  })
})

describe('readPacer — the ladder is cadence, then speed, then heart rate', () => {
  const base = { kind: 'fast' as const, cadenceTargets: CADENCE, hrTargets: HR, speedTargets: { fast: 6, slow: 4 } }

  it('paces by cadence whenever a cadence source is live, ignoring the rungs below', () => {
    const r = readPacer({ ...base, cadenceSpm: 130, speedKmh: 2, bpm: 90 })!
    expect(r.signal).toBe('cadence')
    expect(r.band).toBe('green')
    expect(r.fallbackNote).toBeNull()
  })

  it('falls to speed when cadence is absent, and says so', () => {
    const r = readPacer({ ...base, cadenceSpm: null, speedKmh: 6.5, bpm: 90 })!
    expect(r.signal).toBe('speed')
    expect(r.message).toContain('km/h')
    expect(r.fallbackNote).toMatch(/pacing by speed/)
  })

  it('skips the speed rung when there is no history to derive a target from', () => {
    const r = readPacer({ ...base, speedTargets: null, cadenceSpm: null, speedKmh: 6.5, bpm: 90 })!
    expect(r.signal).toBe('hr')
    expect(r.message).toContain('bpm')
    expect(r.fallbackNote).toMatch(/pacing by heart rate/)
  })

  it('returns null only when no rung has a value at all', () => {
    expect(readPacer({ ...base, cadenceSpm: null, speedKmh: null, bpm: null })).toBeNull()
  })

  it('never leaves a colour to travel alone — every reading carries a mark and a sentence', () => {
    const readings = [
      readPacer({ ...base, cadenceSpm: 130, speedKmh: null, bpm: null })!,
      readPacer({ ...base, cadenceSpm: 110, speedKmh: null, bpm: null })!,
      readPacer({ ...base, cadenceSpm: 60, speedKmh: null, bpm: null })!,
      readPacer({ ...base, cadenceSpm: 10, speedKmh: null, bpm: null })!,
    ]
    for (const r of readings) {
      expect(r.mark.length).toBeGreaterThan(0)
      expect(r.message.length).toBeGreaterThan(0)
    }
  })

  it('names the direction to move in, not just that something is wrong', () => {
    expect(readPacer({ ...base, cadenceSpm: 110, speedKmh: null, bpm: null })!.message).toMatch(/faster/i)
    expect(readPacer({ ...base, kind: 'slow', cadenceSpm: 100, speedKmh: null, bpm: null })!.message).toMatch(/ease off/i)
  })
})

describe('readPacer — standing still is not a perfect slow block', () => {
  const slow = { kind: 'slow' as const, cadenceTargets: CADENCE, hrTargets: HR, speedTargets: { fast: 6, slow: 4 }, speedKmh: null, bpm: null }

  it('scores a stopped walker neutral rather than green on a slow block', () => {
    // The whole hazard: "under the ceiling" would make 0 spm the best possible slow block.
    const r = readPacer({ ...slow, cadenceSpm: STOPPED_SPM - 1 })!
    expect(r.band).toBe('stopped')
    expect(r.message).toMatch(/stopped/i)
    expect(r.progress).toBe(0)
  })

  it('scores a slow walker who is still walking green', () => {
    expect(readPacer({ ...slow, cadenceSpm: STOPPED_SPM })!.band).toBe('green')
  })

  it('applies the same floor to the speed rung', () => {
    const r = readPacer({ ...slow, cadenceSpm: null, speedKmh: STOPPED_KMH - 0.1 })!
    expect(r.band).toBe('stopped')
    expect(readPacer({ ...slow, cadenceSpm: null, speedKmh: STOPPED_KMH })!.band).toBe('green')
  })

  it('has no stopped state on heart rate, where a resting pulse is a real reading', () => {
    const r = readPacer({ ...slow, cadenceSpm: null, speedKmh: null, bpm: 55 })!
    expect(r.band).toBe('green')
  })

  it('keeps the fallback note on a stopped reading, so the ladder stays visible', () => {
    const r = readPacer({ ...slow, cadenceSpm: null, speedKmh: 0.2 })!
    expect(r.fallbackNote).toMatch(/pacing by speed/)
  })
})

describe('readPacer — the bar fills against the target', () => {
  const base = { kind: 'fast' as const, cadenceTargets: CADENCE, hrTargets: HR, speedTargets: null, speedKmh: null, bpm: null }

  it('fills proportionally below the target', () => {
    expect(readPacer({ ...base, cadenceSpm: 60 })!.progress).toBeCloseTo(0.5, 5)
  })

  it('clamps at full rather than overflowing above it', () => {
    expect(readPacer({ ...base, cadenceSpm: 300 })!.progress).toBe(1)
  })
})

describe('resolveCadenceTargets — a config saved before these fields existed', () => {
  it('falls back to the defaults for a config with neither field', () => {
    expect(resolveCadenceTargets({})).toEqual(DEFAULT_CADENCE_TARGETS)
    expect(resolveCadenceTargets(null)).toEqual(DEFAULT_CADENCE_TARGETS)
  })

  it('keeps a set value and defaults only the missing half', () => {
    expect(resolveCadenceTargets({ fastCadenceSpm: 135 })).toEqual({ fast: 135, slow: DEFAULT_CADENCE_TARGETS.slow })
  })

  it('rejects a zero, which would make every reading green and divide the bar by nothing', () => {
    expect(resolveCadenceTargets({ fastCadenceSpm: 0, slowCadenceSpm: -5 })).toEqual(DEFAULT_CADENCE_TARGETS)
  })
})

describe('speedTargetsFromHistory — derived from the walker, or not offered', () => {
  const enough = MIN_SEGMENTS_FOR_SPEED_TARGET
  const usable = {
    fast: agg({ avgPaceSecPerKm: 600, count: enough }),   // 6 km/h
    slow: agg({ avgPaceSecPerKm: 900, count: enough }),   // 4 km/h
  }

  it('converts each kind\'s average pace into a speed', () => {
    const t = speedTargetsFromHistory(usable)!
    expect(t.fast).toBeCloseTo(6, 5)
    expect(t.slow).toBeCloseTo(4, 5)
  })

  it('refuses a history too thin to set a target from', () => {
    expect(speedTargetsFromHistory({ ...usable, fast: agg({ avgPaceSecPerKm: 600, count: enough - 1 }) })).toBeNull()
    expect(speedTargetsFromHistory({ ...usable, slow: agg({ avgPaceSecPerKm: 900, count: enough - 1 }) })).toBeNull()
  })

  it('refuses a history with no GPS-derived pace — the treadmill-only case', () => {
    expect(speedTargetsFromHistory({ ...usable, fast: agg({ avgPaceSecPerKm: null, count: enough }) })).toBeNull()
  })

  it('refuses a degenerate pair where the fast blocks were not faster', () => {
    expect(speedTargetsFromHistory({
      fast: agg({ avgPaceSecPerKm: 900, count: enough }),
      slow: agg({ avgPaceSecPerKm: 900, count: enough }),
    })).toBeNull()
  })

  it('refuses a missing history rather than inventing one', () => {
    expect(speedTargetsFromHistory(null)).toBeNull()
  })
})

describe('kmhFromPace', () => {
  it('converts seconds per kilometre to kilometres per hour', () => {
    expect(kmhFromPace(720)).toBeCloseTo(5, 5)
  })

  it('treats a zero or negative pace as no speed rather than dividing by it', () => {
    expect(kmhFromPace(0)).toBeNull()
    expect(kmhFromPace(-1)).toBeNull()
    expect(kmhFromPace(null)).toBeNull()
  })
})
