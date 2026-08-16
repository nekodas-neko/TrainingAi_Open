import { describe, it, expect } from 'vitest'
import { bucketStepInputsByDay, type StepDayInputs } from '@/lib/oura-ble/step-day-buckets'
import { measuredAtMs } from '@/lib/oura-ble/decode'
import type { ClockAnchor } from '@/lib/oura-ble/clock'
import { toAestDay } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Brisbane' // UTC+10, no DST
const DS_PER_DAY = 864_000
// 2026-08-04 12:00 Brisbane.
const T0 = Date.UTC(2026, 7, 4, 2, 0, 0)
const D0 = 25_000_000

const anchorAt = (anchorDs: number, anchorUtcMs: number, epoch = 0): ClockAnchor => ({
  epoch,
  anchorDs,
  anchorUtcMs,
})

const frame = (ds: number) => ({ ds, tag: 0x7e, bodyHex: 'aabb' })

function inputs(over: Partial<StepDayInputs> = {}): StepDayInputs {
  return {
    stepFrames: [],
    motionFrames: [],
    liveWindows: [],
    anchors: [anchorAt(D0, T0)],
    timezone: TZ,
    nowMs: T0,
    ...over,
  }
}

describe('bucketStepInputsByDay — day assignment', () => {
  it('buckets a frame on the local day of its own ds', () => {
    const b = bucketStepInputsByDay(inputs({ stepFrames: [frame(D0)] }))
    expect([...b.days]).toEqual(['2026-08-04'])
  })

  it('puts a frame from 20 hours earlier on the previous local day', () => {
    // 12:00 Brisbane minus 20 h = 16:00 the day before.
    const b = bucketStepInputsByDay(inputs({ stepFrames: [frame(D0 - 720_000)] }))
    expect([...b.days]).toEqual(['2026-08-03'])
  })
})

describe('bucketStepInputsByDay — the Q-56 future-dated frame', () => {
  // The production shape: an aggregation reads the pre-drain anchor while a concurrent drain has
  // already stored frames carrying days of ring history. Those frames sit far ABOVE the anchor's
  // ds, and bare linear extrapolation maps them into the future. Five such rows were written on
  // 2026-07-30 with real step counts dated up to five days ahead.
  const fiveDaysAhead = D0 + 5 * DS_PER_DAY

  it('the old single-anchor maths does date such a frame five days into the future', () => {
    // Pins the defect itself, so the fix below cannot be mistaken for a test that never failed.
    const ms = measuredAtMs(fiveDaysAhead, D0, T0)
    expect(toAestDay(new Date(ms), TZ)).toBe('2026-08-09')
    expect(ms).toBeGreaterThan(T0)
  })

  it('drops the frame rather than storing a future-dated day', () => {
    const b = bucketStepInputsByDay(inputs({ stepFrames: [frame(D0), frame(fiveDaysAhead)] }))
    expect([...b.days]).toEqual(['2026-08-04'])
    expect(b.droppedFrames).toBe(1)
  })

  it('drops a future-dated live window too — same path, same failure', () => {
    const b = bucketStepInputsByDay(
      inputs({ liveWindows: [{ startDs: fiveDaysAhead, endDs: fiveDaysAhead + 600, steps: 400 }] }),
    )
    expect(b.days.size).toBe(0)
    expect(b.droppedFrames).toBe(1)
  })

  it('still accepts a frame a few seconds past the anchor — ordinary drain skew, not a broken clock', () => {
    const b = bucketStepInputsByDay(inputs({ stepFrames: [frame(D0 + 300)] })) // +30 s
    expect([...b.days]).toEqual(['2026-08-04'])
    expect(b.droppedFrames).toBe(0)
  })

  it('recovers the dropped frame once the drain has published its own anchor', () => {
    // The frame is not lost: body_hex is archival and the rollup re-runs. With the post-drain
    // anchor present it resolves to real time and lands on its true day.
    const drainAnchorUtc = T0 + 60_000
    const b = bucketStepInputsByDay(
      inputs({
        stepFrames: [frame(fiveDaysAhead)],
        anchors: [anchorAt(D0, T0), anchorAt(fiveDaysAhead, drainAnchorUtc)],
        nowMs: drainAnchorUtc,
      }),
    )
    expect([...b.days]).toEqual(['2026-08-04'])
    expect(b.droppedFrames).toBe(0)
  })
})

describe('bucketStepInputsByDay — anchor resolution', () => {
  it('resolves a frame against the anchors bracketing it, not whichever is newest', () => {
    // Production anchors re-stamp mid-drain with large ds jumps: ~39 minutes of ring time in 11
    // real seconds. Extrapolating from the newest one throws a frame well off; interpolating
    // between the pair that brackets it does not.
    const anchors = [anchorAt(D0, T0), anchorAt(D0 + 23_520, T0 + 11_000)]
    const mid = D0 + 11_760
    const b = bucketStepInputsByDay(inputs({ stepFrames: [frame(mid)], anchors, nowMs: T0 + 11_000 }))
    expect([...b.days]).toEqual(['2026-08-04'])

    const newestOnly = measuredAtMs(mid, D0 + 23_520, T0 + 11_000)
    expect(newestOnly).toBeLessThan(T0) // 39 minutes adrift, in the past
    expect(T0 - newestOnly).toBeGreaterThan(19 * 60_000)
  })

  it('drops every frame when no anchor exists for the epoch rather than guessing a day', () => {
    const b = bucketStepInputsByDay(inputs({ stepFrames: [frame(D0)], anchors: [] }))
    expect(b.days.size).toBe(0)
    expect(b.droppedFrames).toBe(1)
  })
})

describe('bucketStepInputsByDay — live windows crossing midnight', () => {
  it('splits a window across the two days it covers, pro-rata by duration', () => {
    // 23:00 -> 01:00 Brisbane, i.e. 13:00 -> 15:00 UTC on 2026-08-04.
    const startUtc = Date.UTC(2026, 7, 4, 13, 0, 0)
    const startDs = D0 + (startUtc - T0) / 100
    const endDs = startDs + 72_000 // +2 h
    const b = bucketStepInputsByDay(
      inputs({
        liveWindows: [{ startDs, endDs, steps: 100 }],
        nowMs: startUtc + 3 * 3_600_000,
      }),
    )
    const day1 = b.liveByDay.get('2026-08-04') ?? []
    const day2 = b.liveByDay.get('2026-08-05') ?? []
    expect(day1).toHaveLength(1)
    expect(day2).toHaveLength(1)
    expect(day1[0].steps + day2[0].steps).toBeCloseTo(100, 6)
    expect(day1[0].steps).toBeCloseTo(50, 6)
  })
})
