import { describe, it, expect } from 'vitest'
import { buildIntervalPlan, segmentAt, type WalkConfig } from '@/lib/walk/interval-plan'

const base: WalkConfig = { sets: 5, fastSec: 180, slowSec: 180, warmupSec: 0, cooldownSec: 0 }

describe('interval-plan', () => {
  it('builds 2 segments per set (default 5×3/3 = 10 segments, 30 min)', () => {
    const plan = buildIntervalPlan(base)
    expect(plan.segments.length).toBe(10)
    expect(plan.totalSec).toBe(1800)
    expect(plan.segments[0]).toMatchObject({ kind: 'slow', index: 0, startSec: 0, endSec: 180 })
    expect(plan.segments[1]).toMatchObject({ kind: 'fast', startSec: 180, endSec: 360 })
  })

  it('adds warmup and cooldown when configured', () => {
    const plan = buildIntervalPlan({ ...base, sets: 1, warmupSec: 120, cooldownSec: 60 })
    expect(plan.segments.map(s => s.kind)).toEqual(['warmup', 'slow', 'fast', 'cooldown'])
    expect(plan.totalSec).toBe(120 + 180 + 180 + 60)
  })

  it('omits zero-length warmup/cooldown segments', () => {
    const plan = buildIntervalPlan({ ...base, sets: 2 })
    expect(plan.segments.map(s => s.kind)).toEqual(['slow', 'fast', 'slow', 'fast'])
    expect(plan.segments[2]).toMatchObject({ setNumber: 2 })
  })

  it('resolves the active segment and time remaining for an elapsed time', () => {
    const plan = buildIntervalPlan(base)
    const at = segmentAt(plan, 200) // 200s → 2nd segment (fast, 180..360)
    expect(at?.segment.kind).toBe('fast')
    expect(at?.remainingSec).toBe(160)
    expect(segmentAt(plan, 1800)).toBeNull() // finished
  })
})
