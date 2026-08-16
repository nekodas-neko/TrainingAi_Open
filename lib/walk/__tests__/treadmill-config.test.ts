import { describe, it, expect } from 'vitest'
import { DEFAULT_WALK_CONFIG, buildIntervalPlan, type WalkConfig } from '../interval-plan'
import { aggregateSegmentsByKind, type WalkSegmentStat } from '../segment-stats'

describe('treadmill mode config (Q-66)', () => {
  it('defaults to off — outdoor stays the default walk', () => {
    expect(DEFAULT_WALK_CONFIG.treadmill).toBe(false)
  })

  it('does not change the interval plan — treadmill is about GPS, not structure', () => {
    const outdoor: WalkConfig = { ...DEFAULT_WALK_CONFIG, treadmill: false }
    const indoor: WalkConfig = { ...DEFAULT_WALK_CONFIG, treadmill: true }
    expect(buildIntervalPlan(indoor)).toEqual(buildIntervalPlan(outdoor))
  })

  it('reads as off when absent — a config persisted before the field existed', () => {
    // Zustand's persist replaces the whole `config` object from storage, so an older stored config
    // rehydrates with no `treadmill` key at all. Every read site uses `=== true` so undefined means
    // outdoors, i.e. today's behaviour, rather than silently switching GPS off for existing users.
    const stored = { ...DEFAULT_WALK_CONFIG } as Partial<WalkConfig>
    delete stored.treadmill
    expect(stored.treadmill === true).toBe(false)
  })
})

describe('segment aggregation with treadmill segments mixed in', () => {
  const seg = (kind: 'fast' | 'slow', avgHr: number, pace: number | null, dist: number | null): WalkSegmentStat => ({
    index: 0, setNumber: 1, kind,
    avgHr, maxHr: avgHr + 10, hrAtStart: avgHr - 5,
    avgPaceSecPerKm: pace, distanceKm: dist, avgCadenceSpm: null,
  } as WalkSegmentStat)

  it('takes heart rate from a treadmill segment but not pace or distance', () => {
    // This is what makes including treadmill walks in the stats card safe: the aggregate filters
    // nulls per field, so an indoor segment adds its real HR and cannot dilute pace or distance.
    const outdoor = seg('fast', 140, 400, 0.75)
    const treadmill = seg('fast', 150, null, null)

    const outdoorOnly = aggregateSegmentsByKind([outdoor])
    const mixed = aggregateSegmentsByKind([outdoor, treadmill])

    expect(mixed.fast.avgHr).toBe(145)                                   // both counted
    expect(mixed.fast.avgPaceSecPerKm).toBe(outdoorOnly.fast.avgPaceSecPerKm)   // unchanged
    expect(mixed.fast.totalDistanceKm).toBe(outdoorOnly.fast.totalDistanceKm)   // unchanged
  })

  it('reports no pace at all when every segment is indoors', () => {
    const agg = aggregateSegmentsByKind([seg('fast', 150, null, null), seg('slow', 110, null, null)])
    expect(agg.fast.avgHr).toBe(150)
    expect(agg.fast.avgPaceSecPerKm).toBeNull()
    expect(agg.fast.totalDistanceKm).toBeNull()
  })
})
