// LA-124 — the clock formatter is hoisted out of `toSegments`' per-bucket map, and must stay
// per-CALL.
//
// `toSegments` called `minutesIntoDay` once per bucket, and each call constructed a fresh
// `Intl.DateTimeFormat`. Same defect RV-80 fixed in `computeMovedHours`, and the only other raw
// `Intl.DateTimeFormat` construction anywhere in `lib/`, `packages/`, `app/` or `components/`.
//
// `stress-day.test.ts` already covers the BEHAVIOUR — the timezone, midnight-as-0, gap splitting,
// coverage — and passes unchanged, which is what makes the hoist behaviour-preserving. What it does
// not cover is the hazard the hoist introduces: lifting the formatter one more level, to module
// scope, would bind the FIRST caller's zone for the lifetime of the process. No existing test calls
// `toSegments` in two zones, so nothing there would notice.
import { describe, it, expect } from 'vitest'
import { toSegments, minutesIntoDay } from '../stress-day'

/** One bucket every 30 minutes across a UTC day — the shape a full day of coverage has. */
const fullDay = () =>
  Array.from({ length: 48 }, (_, i) => ({
    t: Date.UTC(2026, 8, 20, 0, 0) + i * 30 * 60_000,
    level: -0.4,
  }))

describe('the hoisted clock formatter is per call, not per module (LA-124)', () => {
  // THE control. Two calls, two zones, in one process — exactly what a module-level formatter
  // would get wrong and what every existing test would miss.
  it('a second toSegments call in a different timezone is not answered in the first one', () => {
    const buckets = [{ t: Date.UTC(2026, 8, 20, 3, 15), level: -0.5 }]

    const brisbane = toSegments(buckets, 'Australia/Brisbane')[0][0].x
    const gmtMinus5 = toSegments(buckets, 'Etc/GMT+5')[0][0].x

    // 03:15 UTC is 13:15 in Brisbane and 22:15 in Etc/GMT+5. Equality means the zone was ignored.
    expect(brisbane).toBe(13 * 60 + 15)
    expect(gmtMinus5).toBe(22 * 60 + 15)
    expect(brisbane).not.toBe(gmtMinus5)

    // ...and the order must not matter either: re-asking the first zone still answers in it.
    expect(toSegments(buckets, 'Australia/Brisbane')[0][0].x).toBe(brisbane)
  })

  // `minutesIntoDay` stays exported and per-call. It is the one entry point that may keep building
  // its own formatter — it is not in a loop — and sharing one across calls here would be the same
  // mutation by another route.
  it('minutesIntoDay still answers per call, in the zone it was given', () => {
    expect(minutesIntoDay(Date.UTC(2026, 8, 20, 3, 15), 'Australia/Brisbane')).toBe(13 * 60 + 15)
    expect(minutesIntoDay(Date.UTC(2026, 8, 20, 3, 15), 'Etc/GMT+5')).toBe(22 * 60 + 15)
    expect(minutesIntoDay(Date.UTC(2026, 8, 20, 3, 15), 'Australia/Brisbane')).toBe(13 * 60 + 15)
  })

  // The hoist is worth having only if the answer is unchanged at the real volume, which is small
  // here — 48 buckets, not RV-80's 5,606 rows. This pins that a full day still places every bucket
  // on the axis in order rather than the sort or the gap test drifting with the shared formatter.
  it('a full day of buckets still places in order, as one segment', () => {
    const segments = toSegments(fullDay(), 'Australia/Brisbane')
    const xs = segments.flat().map(p => p.x)
    expect(xs).toHaveLength(48)
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
    expect(xs.every(x => x >= 0 && x < 1440)).toBe(true)
  })
})
