import { describe, it, expect } from 'vitest'
import { buildIntervalPlan, type WalkConfig } from '@/lib/walk/interval-plan'
import { computeWalkSegmentStats, aggregateSegmentsByKind, walkEffortDisplay, type WalkSegmentStat } from '@/lib/walk/segment-stats'
import { computeTotalDistanceKm, computeAvgPaceSecPerKm } from '@/lib/activity/activity-metrics'
import type { RoutePoint } from '@/lib/activity/route-encoding'
import { ActivityLogBody } from '@trainingai/shared/validation/activity-log'

// 2 sets, no warmup/cooldown → [slow 0-180, fast 180-360, slow 360-540, fast 540-720].
const config: WalkConfig = { sets: 2, fastSec: 180, slowSec: 180, warmupSec: 0, cooldownSec: 0 }
const plan = buildIntervalPlan(config)
const startedAtMs = 1_000_000

describe('computeWalkSegmentStats', () => {
  it('computes HR/pace/distance/cadence for a segment with real data, from the correctly windowed slice', () => {
    // All inside segment 0 (slow, 0-180s → [1_000_000, 1_180_000) ms).
    const hrSamples = [
      { at: startedAtMs + 10_000, bpm: 100 },
      { at: startedAtMs + 90_000, bpm: 110 },
      { at: startedAtMs + 170_000, bpm: 120 },
      { at: startedAtMs + 190_000, bpm: 999 }, // outside the window — must not be counted
    ]
    const pointsInWindow: RoutePoint[] = [
      { lat: -27.4698, lng: 153.0251, t: startedAtMs + 10_000 },
      { lat: -27.4710, lng: 153.0255, t: startedAtMs + 90_000 },
      { lat: -27.4725, lng: 153.0260, t: startedAtMs + 170_000 },
    ]
    const rawPoints: RoutePoint[] = [
      ...pointsInWindow,
      { lat: -27.5000, lng: 153.1000, t: startedAtMs + 300_000 }, // segment 1 (fast) — excluded
    ]
    const cadenceSeries = [
      { tSec: 5, spm: 110 },
      { tSec: 100, spm: 120 },
      { tSec: 250, spm: 999 }, // outside segment 0's [0,180)s window
    ]

    const stats = computeWalkSegmentStats({ plan, startedAtMs, hrSamples, rawPoints, cadenceSeries })
    const seg0 = stats[0]

    expect(seg0.kind).toBe('slow')
    expect(seg0.avgHr).toBe(110) // (100+110+120)/3
    expect(seg0.maxHr).toBe(120)
    expect(seg0.hrAtStart).toBe(100) // earliest in-window reading, not the average
    expect(seg0.avgCadenceSpm).toBe(115) // (110+120)/2

    const expectedDistanceKm = computeTotalDistanceKm(pointsInWindow)
    expect(seg0.distanceKm).toBeCloseTo(expectedDistanceKm, 10)
    expect(seg0.avgPaceSecPerKm).toBeCloseTo(computeAvgPaceSecPerKm(expectedDistanceKm, 180)!, 10)
  })

  it('returns null stats for a segment with no HR/GPS/cadence data in its window', () => {
    const stats = computeWalkSegmentStats({
      plan, startedAtMs,
      hrSamples: [{ at: startedAtMs + 10_000, bpm: 100 }], // only in segment 0
      rawPoints: [],
      cadenceSeries: null,
    })
    const seg1 = stats[1] // fast, 180-360s — no samples land here
    expect(seg1.kind).toBe('fast')
    expect(seg1.avgHr).toBeNull()
    expect(seg1.maxHr).toBeNull()
    expect(seg1.hrAtStart).toBeNull()
    expect(seg1.distanceKm).toBeNull()
    expect(seg1.avgPaceSecPerKm).toBeNull()
    expect(seg1.avgCadenceSpm).toBeNull()
  })

  it('returns one stat entry per plan segment, in order', () => {
    const stats = computeWalkSegmentStats({ plan, startedAtMs, hrSamples: [], rawPoints: [], cadenceSeries: null })
    expect(stats.map(s => s.kind)).toEqual(['slow', 'fast', 'slow', 'fast'])
    expect(stats.map(s => s.startSec)).toEqual([0, 180, 360, 540])
  })
})

describe('aggregateSegmentsByKind', () => {
  const seg = (overrides: Partial<WalkSegmentStat>): WalkSegmentStat => ({
    index: 0, setNumber: 1, kind: 'fast', startSec: 0, endSec: 180,
    avgHr: null, maxHr: null, hrAtStart: null, avgPaceSecPerKm: null, distanceKm: null, avgCadenceSpm: null,
    ...overrides,
  })

  it('averages avgHr/avgPace and sums distance across all segments of one kind', () => {
    const segments: WalkSegmentStat[] = [
      seg({ kind: 'fast', avgHr: 120, avgPaceSecPerKm: 300, distanceKm: 0.5 }),
      seg({ kind: 'fast', avgHr: 130, avgPaceSecPerKm: 320, distanceKm: 0.6 }),
      seg({ kind: 'slow', avgHr: 90, avgPaceSecPerKm: 600, distanceKm: 0.3 }),
    ]
    const result = aggregateSegmentsByKind(segments)
    expect(result.fast).toEqual({ avgHr: 125, avgPaceSecPerKm: 310, avgCadenceSpm: null, totalDistanceKm: 1.1, avgDistanceKm: 0.6, count: 2 })
    expect(result.slow).toEqual({ avgHr: 90, avgPaceSecPerKm: 600, avgCadenceSpm: null, totalDistanceKm: 0.3, avgDistanceKm: 0.3, count: 1 })
  })

  it('skips null-stat segments in the average instead of treating them as zero', () => {
    const segments: WalkSegmentStat[] = [
      seg({ kind: 'fast', avgHr: 120, avgPaceSecPerKm: null, distanceKm: null }),
      seg({ kind: 'fast', avgHr: null, avgPaceSecPerKm: 300, distanceKm: 0.4 }),
    ]
    const result = aggregateSegmentsByKind(segments)
    // Only the non-null avgHr contributes — a missing reading must not drag the average toward 0.
    expect(result.fast.avgHr).toBe(120)
    expect(result.fast.avgPaceSecPerKm).toBe(300)
    expect(result.fast.totalDistanceKm).toBe(0.4)
    expect(result.fast.avgDistanceKm).toBe(0.4)
    expect(result.fast.count).toBe(2) // count is segment count, not "segments with data"
  })

  // Q-84: cadence was computed per segment and then dropped here, so the summary screen could only
  // ever show pace. On an interval walk the owner's read is that step rate beats a 1–3 minute GPS
  // pace sample, and it had no route to the screen at all.
  it('averages cadence across a kind, skipping segments that had no cadence source', () => {
    const segments: WalkSegmentStat[] = [
      seg({ kind: 'fast', avgCadenceSpm: 120 }),
      seg({ kind: 'fast', avgCadenceSpm: 130 }),
      seg({ kind: 'fast', avgCadenceSpm: null }), // strap dropped for this block
      seg({ kind: 'slow', avgCadenceSpm: 96 }),
    ]
    const result = aggregateSegmentsByKind(segments)
    expect(result.fast.avgCadenceSpm).toBe(125) // not 83.3 — the null must not average in as zero
    expect(result.slow.avgCadenceSpm).toBe(96)
  })

  it('leaves cadence null for a walk with no cadence source at all', () => {
    // The GPS-only case: no strap, no validated ring cadence. Pace still aggregates, cadence does
    // not, and the screens fall back to pace rather than rendering a dash where a number was.
    const result = aggregateSegmentsByKind([
      seg({ kind: 'fast', avgPaceSecPerKm: 300, distanceKm: 0.5 }),
      seg({ kind: 'fast', avgPaceSecPerKm: 320, distanceKm: 0.6 }),
    ])
    expect(result.fast.avgCadenceSpm).toBeNull()
    expect(result.fast.avgPaceSecPerKm).toBe(310)
  })

  it('returns null/0 for a kind with no segments at all', () => {
    const result = aggregateSegmentsByKind([seg({ kind: 'slow' })])
    expect(result.fast).toEqual({ avgHr: null, avgPaceSecPerKm: null, avgCadenceSpm: null, totalDistanceKm: null, avgDistanceKm: null, count: 0 })
  })
})

// Q-84: three surfaces render the pace/cadence pair — the summary's fast/slow cards, its
// per-interval rows, and the walk-config history card. Which of the two headlines is one decision,
// so it lives in one function; a per-site copy is how two of them end up disagreeing.
describe('walkEffortDisplay', () => {
  it('leads with cadence and keeps pace beside it', () => {
    expect(walkEffortDisplay({ avgCadenceSpm: 118.4, avgPaceSecPerKm: 420 }))
      .toEqual({ lead: '118 spm', secondary: '7:00/km' })
  })

  it('falls back to pace rather than a dash when there is no cadence source', () => {
    // The GPS-only walk. Leading with "—" would make the strapless case read worse than before
    // this change, which is the opposite of the point.
    expect(walkEffortDisplay({ avgCadenceSpm: null, avgPaceSecPerKm: 420 }))
      .toEqual({ lead: '7:00/km', secondary: null })
  })

  it('still leads with cadence when the GPS never got a fix', () => {
    // Treadmill intervals with a strap: no distance, so no pace, but cadence is the better number
    // anyway. The secondary slot says the pace is missing rather than silently dropping.
    expect(walkEffortDisplay({ avgCadenceSpm: 121, avgPaceSecPerKm: null }))
      .toEqual({ lead: '121 spm', secondary: '—/km' })
  })

  it('has something to render when neither exists', () => {
    expect(walkEffortDisplay({ avgCadenceSpm: null, avgPaceSecPerKm: null }))
      .toEqual({ lead: '—', secondary: null })
  })
})

// 2026-08-02 owner report: a guided walk could never sync. `avg()` rounds to 1dp, so a segment
// mean HR of 130.5 was emitted; `WalkSegmentStatSchema.avgHr` was `z.number().int()`, which
// rejected the WHOLE activity_logs payload on both write paths. The walk dead-lettered in the
// outbox and never reached the server or the training calendar. Guarded from both ends: whole
// beats at source, and a schema that accepts what this function actually produces.
describe('computeWalkSegmentStats — segment mean HR is wire-safe', () => {
  // 130 + 131 → mean 130.5, the exact value that broke production.
  const hrSamples = [
    { at: startedAtMs + 10_000, bpm: 130 },
    { at: startedAtMs + 20_000, bpm: 131 },
  ]

  it('emits whole-beat segment mean HR', () => {
    const stats = computeWalkSegmentStats({
      plan, startedAtMs, hrSamples, rawPoints: [], cadenceSeries: null,
    })
    expect(stats[0].avgHr).toBe(131) // 130.5 rounds up, not 130.5
    expect(Number.isInteger(stats[0].avgHr!)).toBe(true)
  })

  it('produces segments the wire schema accepts', () => {
    const segments = computeWalkSegmentStats({
      plan, startedAtMs, hrSamples, rawPoints: [], cadenceSeries: null,
    })
    const res = ActivityLogBody.safeParse({
      date: '2026-08-01', activityType: 'walk', title: 'Interval walk',
      startTime: '08:15', durationMin: 12, segments,
    })
    expect(res.success).toBe(true)
  })
})
