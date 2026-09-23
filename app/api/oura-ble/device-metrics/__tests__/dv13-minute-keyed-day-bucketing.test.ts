import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { toAestDay } from '@trainingai/shared/date-utils'

const ROUTE = readFileSync(join(__dirname, '..', 'route.ts'), 'utf8')

// DV-13. `device-metrics` used to call `toAestDay` — i.e. `formatInTimeZone` — once per raw row.
// Measured at 11.2 us per call against the 58,856 rows the owner's default `?days=3` window really
// holds, that is 656 ms of synchronous work before any decoding starts, and ~3.1 s at `?days=14`.
// Nothing else runs on the process while it does, which is what makes a route with no such loop
// look like it is hanging.
//
// The route now memoises the lookup by MINUTE. This file exists to pin the one property that makes
// that safe: a zone's UTC offset is never finer than a minute, so every timestamp inside the same
// minute is in the same local day, in every timezone. If that assumption is ever wrong the memo is
// silently wrong too, and a diagnostic panel quietly attributes samples to the wrong day.
const localDayMemo = (tz: string) => {
  const cache = new Map<number, string>()
  return (ms: number): string => {
    const key = Math.floor(ms / 60_000)
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    const day = toAestDay(new Date(ms), tz)
    cache.set(key, day)
    return day
  }
}

// Whole-hour, 30-minute, 45-minute and DST-observing zones. The sub-hour ones are the point: an
// HOUR-keyed memo would pass every whole-hour zone and be wrong in Kathmandu and Chatham.
const ZONES = [
  'Australia/Brisbane', 'UTC', 'America/New_York', 'Europe/London',
  'Asia/Kolkata', 'Asia/Kathmandu', 'Pacific/Chatham', 'Australia/Adelaide',
]

describe('DV-13 minute-keyed day bucketing', () => {
  it('returns exactly what a per-row toAestDay returns, across offset shapes', () => {
    // A day's worth of seconds-apart samples straddling every local midnight above.
    const base = Date.UTC(2026, 8, 22, 0, 0, 0)
    for (const tz of ZONES) {
      const memo = localDayMemo(tz)
      for (let i = 0; i < 2000; i++) {
        const ms = base + i * 43_000  // ~12 h apart in total, stepping through many minutes
        expect(memo(ms)).toBe(toAestDay(new Date(ms), tz))
      }
    }
  })

  it('agrees on both sides of a local midnight, to the second', () => {
    const tz = 'Australia/Brisbane'
    const memo = localDayMemo(tz)
    // 2026-09-23 00:00 Brisbane is 2026-09-22 14:00 UTC.
    const midnight = Date.UTC(2026, 8, 22, 14, 0, 0)
    for (let s = -120; s <= 120; s++) {
      const ms = midnight + s * 1000
      expect(memo(ms)).toBe(toAestDay(new Date(ms), tz))
    }
    expect(memo(midnight - 1000)).toBe('2026-09-22')
    expect(memo(midnight)).toBe('2026-09-23')
  })

  it('agrees across a DST transition', () => {
    const tz = 'America/New_York'
    const memo = localDayMemo(tz)
    // 2026-11-01 06:00 UTC — the US fall-back hour.
    const around = Date.UTC(2026, 10, 1, 4, 0, 0)
    for (let m = 0; m < 240; m++) {
      const ms = around + m * 60_000
      expect(memo(ms)).toBe(toAestDay(new Date(ms), tz))
    }
  })

  it('actually collapses the calls, or it is not a fix', () => {
    const tz = 'Australia/Brisbane'
    const cache = new Map<number, string>()
    let calls = 0
    const base = Date.now() - 3 * 86_400_000
    for (let i = 0; i < 58_856; i++) {
      const key = Math.floor((base + i * 4_400) / 60_000)
      if (!cache.has(key)) { calls++; cache.set(key, toAestDay(new Date(base + i * 4_400), tz)) }
    }
    // 58,856 rows over ~3 days of minutes — two orders of magnitude fewer formatter calls.
    expect(calls).toBeLessThan(5_000)
    expect(calls).toBeLessThan(58_856 / 10)
  })

  // The cases above pin the TECHNIQUE. This pins the route to it: an edit to hour-keying would pass
  // every whole-hour zone in this file and be silently wrong in Kathmandu and Chatham, so the route
  // must not quietly acquire a coarser key.
  it('keys the route\'s own memo by minute, and calls the formatter once per key', () => {
    // Matched on the VALUE, in either literal form — `60000` and `60_000` are the same divisor and
    // an assertion that fails on one of them is pinning syntax, not the contract.
    expect(ROUTE).toMatch(/Math\.floor\(ms \/ 60_?000\)/)
    expect(ROUTE).not.toMatch(/Math\.floor\(ms \/ 3_?600_?000\)/)
    // One formatter call per bucketed row is what this replaced — it must not come back.
    expect(ROUTE).not.toMatch(/const day = toAestDay\(new Date\(r\.measuredAt\), tz\)/)
    // And the memo must actually be consulted by the bucketing loop.
    expect(ROUTE).toMatch(/const day = localDay\(new Date\(r\.measuredAt\)\.getTime\(\)\)/)
  })
})
