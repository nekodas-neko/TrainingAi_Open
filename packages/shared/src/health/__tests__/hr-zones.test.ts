import { describe, it, expect } from 'vitest'
import { hrMaxFromAge, hrReserve, computeHrZones, zoneForBpm, hrReserveTarget, classifyZone, walkFastBandBpm } from '../hr-zones'

describe('hrMaxFromAge', () => {
  it('applies 220 − age', () => {
    expect(hrMaxFromAge(30)).toBe(190)
  })
  it('falls back to 190 when age is unknown', () => {
    expect(hrMaxFromAge(null)).toBe(190)
    expect(hrMaxFromAge(undefined)).toBe(190)
  })
})

describe('hrReserve', () => {
  it('is max − rest', () => {
    expect(hrReserve(190, 60)).toBe(130)
  })
  it('floors at 30 so a bad low reserve cannot read every beat as max effort', () => {
    expect(hrReserve(100, 90)).toBe(30)
  })
})

describe('computeHrZones', () => {
  const zones = computeHrZones({ maxHr: 190, restingHr: 60 }) // reserve 130

  it('produces five contiguous zones anchored at rest and max', () => {
    expect(zones.map(z => z.id)).toEqual([1, 2, 3, 4, 5])
    expect(zones[0].minBpm).toBe(60)                 // rest
    expect(zones[4].maxBpm).toBe(Infinity)           // open-topped peak zone
    // each zone's max equals the next zone's min (no gaps)
    for (let i = 0; i < zones.length - 1; i++) {
      expect(zones[i].maxBpm).toBe(zones[i + 1].minBpm)
    }
  })

  it('places the 60%-reserve boundary at 138 bpm', () => {
    expect(zones[1].minBpm).toBe(Math.round(60 + 0.6 * 130)) // 138
  })
})

describe('zoneForBpm', () => {
  const zones = computeHrZones({ maxHr: 190, restingHr: 60 })

  it('classifies a working HR into the right zone', () => {
    // boundaries for rest 60 / reserve 130: Z2≥138, Z3≥151, Z4≥164, Z5≥177
    expect(zoneForBpm(145, zones).id).toBe(2)
    expect(zoneForBpm(160, zones).id).toBe(3)
    expect(zoneForBpm(170, zones).id).toBe(4)
    expect(zoneForBpm(185, zones).id).toBe(5)
  })

  it('clamps below rest into zone 1 and above max into zone 5', () => {
    expect(zoneForBpm(40, zones).id).toBe(1)
    expect(zoneForBpm(250, zones).id).toBe(5)
  })
})

describe('interval-walk effort targets', () => {
  it('hrReserveTarget computes a Karvonen reserve-fraction bpm target', () => {
    // resting 60, max 190 → reserve 130. 70% → 60 + 91 = 151. 40% → 60 + 52 = 112.
    expect(hrReserveTarget(0.70, 60, 190)).toBe(151)
    expect(hrReserveTarget(0.40, 60, 190)).toBe(112)
  })

  it('classifyZone — fast block is in-zone at/above the fast target, else push', () => {
    expect(classifyZone(155, 'fast', { fast: 151, slow: 112 })).toBe('in')
    expect(classifyZone(151, 'fast', { fast: 151, slow: 112 })).toBe('in')
    expect(classifyZone(140, 'fast', { fast: 151, slow: 112 })).toBe('push')
  })

  it('classifyZone — slow block is in-zone at/below the slow target, else ease', () => {
    expect(classifyZone(108, 'slow', { fast: 151, slow: 112 })).toBe('in')
    expect(classifyZone(112, 'slow', { fast: 151, slow: 112 })).toBe('in')
    expect(classifyZone(130, 'slow', { fast: 151, slow: 112 })).toBe('ease')
  })
})

// TN-25 — the fast block became a BAND. `0.70 × reserve` was 133 bpm for this owner and was met on
// 0 of 44 blocks against a measured fast mean of 98.5, so `classifyZone` returned 'push' on 100% of
// fast intervals across ten sessions. A cue that can only ever say one thing carries no information.
describe('the walk fast band (TN-25)', () => {
  const HR_MAX = 168   // this owner's, the anchor every figure in TN-25 is quoted against

  it('lands where 60-70% of max does, not where 70% of reserve did', () => {
    const [lo, hi] = walkFastBandBpm(HR_MAX)
    expect([lo, hi]).toEqual([101, 118])
    // The old target, for contrast — unreachable by walking for this person.
    expect(hrReserveTarget(0.70, 53, HR_MAX)).toBeGreaterThan(hi)
  })

  it('is reachable by the blocks that were measured — 98.5 mean, 115 best', () => {
    const [lo] = walkFastBandBpm(HR_MAX)
    expect(115).toBeGreaterThan(lo)          // the best single block now clears it
    expect(classifyZone(115, 'fast', { fast: lo, fastMax: 118, slow: 98 })).toBe('in')
  })

  it('still says push below the band', () => {
    const [lo, hi] = walkFastBandBpm(HR_MAX)
    expect(classifyZone(lo - 1, 'fast', { fast: lo, fastMax: hi, slow: 98 })).toBe('push')
  })

  it('now says EASE above the band — the half a floor could never say', () => {
    const [lo, hi] = walkFastBandBpm(HR_MAX)
    expect(classifyZone(hi + 1, 'fast', { fast: lo, fastMax: hi, slow: 98 })).toBe('ease')
  })

  it('without a fastMax it behaves exactly as before — a floor with no ceiling', () => {
    // The control. `fastMax` is optional so no existing caller changes meaning; a bpm far above the
    // target must still read 'in' when no ceiling was supplied.
    expect(classifyZone(200, 'fast', { fast: 133, slow: 98 })).toBe('in')
    expect(classifyZone(132, 'fast', { fast: 133, slow: 98 })).toBe('push')
  })

  it('leaves the slow ceiling alone — it was met on 78% of blocks, so nothing says it is wrong', () => {
    expect(classifyZone(98, 'slow', { fast: 101, fastMax: 118, slow: 98 })).toBe('in')
    expect(classifyZone(99, 'slow', { fast: 101, fastMax: 118, slow: 98 })).toBe('ease')
  })
})
