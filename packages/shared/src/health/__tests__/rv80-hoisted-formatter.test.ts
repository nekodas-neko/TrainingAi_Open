// RV-80 — the formatter is hoisted out of the per-row loop, and must stay per-CALL.
//
// `computeMovedHours` built an `Intl.DateTimeFormat` inside a loop that runs once per heart-rate
// row, on a path `sync-provider` warms at every app launch (readiness, TTL 5 min — up to 12
// recomputes an hour per active device). Measured here on the owner's real day sizes: 2,831 rows
// 161 ms → 21 ms (7.6×), 5,606 rows 343 ms → 30 ms (11.4×). The ratio GROWS with row count, so a
// single figure understates the training days that matter most.
//
// `hourly-movement.test.ts` already covers the BEHAVIOUR — day exclusion, hour boundaries, the
// waking window — and passes unchanged, which is what makes the hoist behaviour-preserving. What it
// does not cover is the hazard the hoist introduces: a formatter that is cached too far out.
// Lifting it one more level, to module scope, would bind the FIRST caller's timezone for the
// lifetime of the process and be invisible to every existing test, because they all use one zone.
import { describe, it, expect } from 'vitest'
import { computeMovedHours } from '@trainingai/shared/health/hourly-movement'

/** One reading per hour across a UTC day, all well above the rest threshold. */
const activeDay = (dateUtc: string) =>
  Array.from({ length: 24 }, (_, h) => ({
    timestamp: new Date(`${dateUtc}T${String(h).padStart(2, '0')}:30:00Z`),
    bpm: 140,
  }))

describe('the hoisted formatter is per call, not per module (RV-80)', () => {
  // THE control. Two calls, two zones, in one process — which is exactly what a module-level
  // formatter would get wrong and nothing else here would notice.
  it('a second call in a different timezone is not answered in the first one', () => {
    const rows = activeDay('2026-09-20')

    const brisbane = computeMovedHours({
      hrRows: rows, maxHr: 190, restingHr: 60, tz: 'Australia/Brisbane', dateIso: '2026-09-20',
    })
    const utc = computeMovedHours({
      hrRows: rows, maxHr: 190, restingHr: 60, tz: 'UTC', dateIso: '2026-09-20',
    })

    // Brisbane is UTC+10 with no DST, so the same 24 UTC readings land on different local days and
    // different local hours in the two zones. Equality here would mean the zone was ignored.
    expect(brisbane).not.toBe(utc)

    // ...and the order must not matter either: re-asking the first zone still answers in it.
    expect(computeMovedHours({
      hrRows: rows, maxHr: 190, restingHr: 60, tz: 'Australia/Brisbane', dateIso: '2026-09-20',
    })).toBe(brisbane)
  })

  // The entry records "the real route was not run against a 5,606-row day" as not established.
  // This does not run the route, but it does run the function at that volume and check the answer
  // is still bounded by the goal window rather than drifting with size.
  it('still answers correctly at a real training day volume', () => {
    // 5,606 rows ≈ one every 15 s across a day, the owner's largest measured day.
    const rows = Array.from({ length: 5606 }, (_, i) => ({
      timestamp: new Date(Date.UTC(2026, 8, 19, 14, 0, 0) + i * 15_000),
      bpm: 140,
    }))
    const moved = computeMovedHours({
      hrRows: rows, maxHr: 190, restingHr: 60, tz: 'Australia/Brisbane', dateIso: '2026-09-20',
    })

    // The window is [7, 22) — 15 hours — and no volume of readings can exceed it.
    expect(moved).toBeGreaterThan(0)
    expect(moved).toBeLessThanOrEqual(15)
  })
})
