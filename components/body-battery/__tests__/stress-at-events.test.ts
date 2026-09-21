import { describe, expect, it } from 'vitest'
import { levelAt, placeEvents, measuredCount, BUCKET_HALF_MIN } from '../stress-at-events'
import { toSegments } from '../stress-day'

const TZ = 'Australia/Brisbane'

/** Brisbane is UTC+10 with no DST, so a local hour maps to a fixed instant without a library. */
function at(hour: number, minute = 0): number {
  return Date.UTC(2026, 8, 20, hour - 10, minute)
}

function seg(hours: number[]) {
  return toSegments(hours.map(h => ({ t: at(Math.floor(h), (h % 1) * 60), level: -0.5 })), TZ)
}

const ev = (type: string, hour: number, title = type) => ({
  type, title, time: `${hour}:00`, timeMs: at(hour),
})

describe('levelAt', () => {
  it('reads the level of the bucket covering the moment', () => {
    const segments = toSegments([{ t: at(9), level: -0.7 }], TZ)
    expect(levelAt(segments, 9 * 60)).toBe(-0.7)
  })

  it('reaches exactly half a bucket and no further', () => {
    const segments = toSegments([{ t: at(9), level: -0.7 }], TZ)
    expect(levelAt(segments, 9 * 60 + BUCKET_HALF_MIN)).toBe(-0.7)
    expect(levelAt(segments, 9 * 60 + BUCKET_HALF_MIN + 1)).toBeNull()
  })

  it('returns null inside a gap rather than the nearest reading', () => {
    // The measured 06:45 → 13:15 hole. An event at 10:00 has no bucket.
    const segments = seg([6.25, 6.75, 13.25, 13.75])
    expect(levelAt(segments, 10 * 60)).toBeNull()
  })

  it('picks the NEAREST bucket when two are genuinely in reach', () => {
    // Buckets are NOMINALLY 30 minutes apart, which would put at most one inside a +/-15 window and
    // make "nearest" untestable. Nothing enforces that spacing — a back-filled day is assembled
    // from stored rows — so the rule has to hold for irregular ones, and this is the case that
    // separates "nearest" from "first I happened to iterate over".
    const segments = toSegments([
      { t: at(9, 0), level: -0.2 },
      { t: at(9, 10), level: -0.9 },
    ], TZ)
    expect(levelAt(segments, 9 * 60 + 12)).toBe(-0.9)
    expect(levelAt(segments, 9 * 60 + 2)).toBe(-0.2)
  })

  it('returns null on a day with no buckets at all', () => {
    expect(levelAt([], 12 * 60)).toBeNull()
  })

  it('does not confuse a measured zero with an absence', () => {
    const segments = toSegments([{ t: at(11), level: 0 }], TZ)
    expect(levelAt(segments, 11 * 60)).toBe(0)
    expect(levelAt(segments, 11 * 60)).not.toBeNull()
  })
})

describe('placeEvents', () => {
  it('places each event on the minute axis and reads its level', () => {
    const segments = toSegments([{ t: at(7), level: -0.4 }], TZ)
    const out = placeEvents([ev('workout', 7)], segments, TZ)
    expect(out).toHaveLength(1)
    expect(out[0].x).toBe(420)
    expect(out[0].level).toBe(-0.4)
  })

  it('returns events in time order whatever order they arrived in', () => {
    const out = placeEvents([ev('bedtime', 22), ev('wakeup', 6), ev('meal', 12)], [], TZ)
    expect(out.map(e => e.type)).toEqual(['wakeup', 'meal', 'bedtime'])
  })

  it('drops `tag` events — the lane is dead and rendering it would promise a marker', () => {
    const out = placeEvents([ev('tag', 9), ev('walk', 10)], [], TZ)
    expect(out.map(e => e.type)).toEqual(['walk'])
  })

  it('keeps an event with no reading rather than hiding it', () => {
    // Hiding it would make an unmeasured hour look like an uneventful one.
    const segments = seg([6.25])
    const out = placeEvents([ev('meal', 13)], segments, TZ)
    expect(out).toHaveLength(1)
    expect(out[0].level).toBeNull()
  })

  it('places in the user\'s zone, not the device\'s', () => {
    const e = ev('workout', 0)
    expect(placeEvents([e], [], TZ)[0].x).toBe(0)
    // 00:00 Brisbane is 14:00 the previous day in UTC.
    expect(placeEvents([e], [], 'UTC')[0].x).toBe(14 * 60)
  })

  it('handles a day with no events', () => {
    expect(placeEvents([], seg([9]), TZ)).toEqual([])
  })
})

describe('measuredCount', () => {
  it('counts only the events that carry a reading', () => {
    const segments = seg([9])
    const out = placeEvents([ev('workout', 9), ev('meal', 13), ev('walk', 17)], segments, TZ)
    expect(out).toHaveLength(3)
    expect(measuredCount(out)).toBe(1)
  })

  it('counts a measured zero', () => {
    const segments = toSegments([{ t: at(9), level: 0 }], TZ)
    expect(measuredCount(placeEvents([ev('workout', 9)], segments, TZ))).toBe(1)
  })
})
