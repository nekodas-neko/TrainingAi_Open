import { describe, it, expect } from 'vitest'
import {
  recommendWalkPattern, WALK_PATTERNS, ZONE2_GAP_MET_MIN, ZONE2_GAP_LARGE_MIN,
} from '../recommend-walk-pattern'
import type { ZoneQuota } from '../../health/zone-quota'

/** A quota carrying whatever Zone-2 gap the case needs; the other zones are present and irrelevant,
 *  which is itself part of what these tests pin — a walk must not be graded against Zone 3+. */
const quota = (zone2OpenMin: number | null, others: Partial<Record<2 | 3 | 4 | 5, number>> = {}): ZoneQuota => {
  const row = (zoneId: 1 | 2 | 3 | 4 | 5, remainingMin: number) => ({
    zoneId, targetMin: 60, doneMin: Math.max(0, 60 - remainingMin), remainingMin,
    pctComplete: Math.min(100, Math.round(((60 - remainingMin) / 60) * 100)),
    status: (remainingMin > 0 ? 'open' : 'met') as 'open' | 'met',
  })
  const zones = [row(1, 0)]
  if (zone2OpenMin != null) zones.push(row(2, zone2OpenMin))
  for (const [z, m] of Object.entries(others)) zones.push(row(Number(z) as 3 | 4 | 5, m))
  return {
    zones: zones as ZoneQuota['zones'],
    trainingTargetMin: 60, trainingDoneMin: 0, trainingRemainingMin: zone2OpenMin ?? 0,
  }
}

describe('recommendWalkPattern (TN-25)', () => {
  it('prescribes the long blocks when the Zone 2 gap is large', () => {
    const r = recommendWalkPattern(quota(ZONE2_GAP_LARGE_MIN))
    expect(r.pattern).toBe(WALK_PATTERNS.long_intervals)
    expect(r.reason).toContain('Zone 2')
  })

  it('steps down to the short blocks after a hard day', () => {
    const r = recommendWalkPattern(quota(ZONE2_GAP_LARGE_MIN), { hadHardDayYesterday: true })
    expect(r.pattern).toBe(WALK_PATTERNS.short_intervals)
    expect(r.reason).toContain('after yesterday')
  })

  it('uses one continuous block when the gap is large but time is short', () => {
    const r = recommendWalkPattern(quota(ZONE2_GAP_LARGE_MIN), { shortOnTime: true })
    expect(r.pattern).toBe(WALK_PATTERNS.steady_brisk)
  })

  it('prescribes the short blocks for a moderate gap', () => {
    const r = recommendWalkPattern(quota(ZONE2_GAP_LARGE_MIN - 1))
    expect(r.pattern).toBe(WALK_PATTERNS.short_intervals)
  })

  it('walks for steps once Zone 2 is effectively done', () => {
    const r = recommendWalkPattern(quota(ZONE2_GAP_MET_MIN - 1))
    expect(r.pattern).toBe(WALK_PATTERNS.easy_steps)
    expect(r.reason).toContain('done for the week')
  })

  it('walks for steps when there is no Zone 2 target at all, rather than inventing a gap', () => {
    const r = recommendWalkPattern(quota(null))
    expect(r.pattern).toBe(WALK_PATTERNS.easy_steps)
    expect(r.reason).toContain('No Zone 2 target')
  })

  it('a met Zone 2 outranks a hard day — the answer is the easy walk either way', () => {
    const r = recommendWalkPattern(quota(0), { hadHardDayYesterday: true })
    expect(r.pattern).toBe(WALK_PATTERNS.easy_steps)
  })

  it('IGNORES zones 3+ — a walk cannot deliver them, so they must not drive it', () => {
    // The reason Zone 2 alone decides: 0 of 44 fast blocks ever reached the old Zone-3 target, so a
    // selector counting open Zone 4/5 minutes would prescribe work this mode cannot produce.
    //
    // **The cases that matter are the ones where Zone 2 is NOT open**, because only those separate
    // "reads Zone 2" from "reads the first open training zone". A fixture with Zone 2 still open
    // passes either way — which is how the weaker version of this test let that mutant through.
    const zone2Met = recommendWalkPattern(quota(0, { 4: 90, 5: 90 }))
    expect(zone2Met.pattern).toBe(WALK_PATTERNS.easy_steps)
    expect(zone2Met.reason).toContain('done for the week')

    const noZone2Target = recommendWalkPattern(quota(null, { 4: 90, 5: 90 }))
    expect(noZone2Target.pattern).toBe(WALK_PATTERNS.easy_steps)
    expect(noZone2Target.reason).toContain('No Zone 2 target')

    // And a huge Zone 4/5 gap must not change a Zone-2-driven answer either.
    expect(recommendWalkPattern(quota(ZONE2_GAP_LARGE_MIN, { 4: 90, 5: 90 })).pattern)
      .toBe(recommendWalkPattern(quota(ZONE2_GAP_LARGE_MIN)).pattern)
  })

  it('never prescribes an HR band — the pacer owns that (TN-25: the band, not the fraction)', () => {
    const r = recommendWalkPattern(quota(ZONE2_GAP_LARGE_MIN)) as unknown as Record<string, unknown>
    expect(Object.keys(r).sort()).toEqual(['pattern', 'reason'])
    expect(Object.keys(WALK_PATTERNS.long_intervals).sort()).toEqual(['fastMin', 'id', 'label', 'slowMin'])
  })

  it('is deterministic — the same quota gives the same answer', () => {
    const q = quota(30)
    expect(recommendWalkPattern(q)).toEqual(recommendWalkPattern(q))
  })
})
