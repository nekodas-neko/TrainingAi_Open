import { describe, it, expect } from 'vitest'
import { clipSegmentsAt } from '../clip-segments'
import { averagePaceSecPerKm } from '../../activity/route-summary'

// slow 0-600, fast 600-1200, slow 1200-1800.
const segments = [
  { index: 0, startSec: 0, endSec: 600 },
  { index: 1, startSec: 600, endSec: 1200 },
  { index: 2, startSec: 1200, endSec: 1800 },
]

describe('clipSegmentsAt', () => {
  it('stopping 3 minutes into a 10-minute block ends it there and drops the later blocks', () => {
    const clipped = clipSegmentsAt(segments, 600 + 180)
    expect(clipped.map(s => s.index)).toEqual([0, 1])
    expect(clipped[1]).toEqual({ index: 1, startSec: 600, endSec: 780 })
    // 0.3 km over the 3 minutes walked, not over the planned 10.
    expect(averagePaceSecPerKm(0.3, clipped[1].endSec - clipped[1].startSec)).toBe(600)
    expect(averagePaceSecPerKm(0.3, segments[1].endSec - segments[1].startSec)).toBe(2000)
  })

  it('leaves a walk finished normally unchanged, including a tick past the plan', () => {
    expect(clipSegmentsAt(segments, 1800)).toEqual(segments)
    expect(clipSegmentsAt(segments, 1801)).toEqual(segments)
  })

  it('stopping exactly on a boundary does not save the next block', () => {
    expect(clipSegmentsAt(segments, 600).map(s => s.index)).toEqual([0])
  })

  it('a pause inside the current block does not count: only active seconds clip', () => {
    // 13 min of wall clock, 4 of them paused inside block 1: 9 active minutes, 3 into block 1.
    const wallSec = 780 + 240
    const pausedSec = 240
    const clipped = clipSegmentsAt(segments, wallSec - pausedSec)
    expect(clipped[clipped.length - 1].endSec).toBe(780)
    expect(clipSegmentsAt(segments, wallSec)[1].endSec).toBe(1020)
  })

  it('does not mutate the plan', () => {
    clipSegmentsAt(segments, 100)
    expect(segments[0].endSec).toBe(600)
  })
})
