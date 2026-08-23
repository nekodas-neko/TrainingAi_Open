import { describe, it, expect } from 'vitest'
import {
  resolveIngestDate,
  INGEST_PAST_TOLERANCE_DAYS,
} from '../ingest-clock'

/**
 * Q-494 — `health-connect/ingest` bounded its date by regex (shape) and never by range.
 *
 * Measured against a running route before the fix:
 *   POST {"date":"9999/12/30","weightKg":499} -> 200 {"date":"9999-12-30"}
 *   getMostRecentConfirmedWeightKg           -> 9999-12-30, 499 kg
 *
 * `ORDER BY date DESC LIMIT 1` then answers that **permanently** — no later write can outrank it —
 * and two readers use that shape: the BLE scale's confirmation step and `deriveActivityKcal`, which
 * multiplies body weight into every activity-calorie estimate.
 */
const TODAY = '2026-08-19'

describe('resolveIngestDate (Q-494)', () => {
  it('clamps the year-9999 capture to today — the measured exploit', () => {
    expect(resolveIngestDate('9999/12/30', TODAY)).toBe(TODAY)
    expect(resolveIngestDate('9999-12-30', TODAY)).toBe(TODAY)
  })

  it('clamps any future date, including tomorrow', () => {
    expect(resolveIngestDate('2026-08-20', TODAY)).toBe(TODAY)
    expect(resolveIngestDate('2027-01-01', TODAY)).toBe(TODAY)
  })

  it('passes an in-range date through untouched, in either separator', () => {
    expect(resolveIngestDate('2026-08-17', TODAY)).toBe('2026-08-17')
    expect(resolveIngestDate('2026/08/17', TODAY)).toBe('2026-08-17')
    expect(resolveIngestDate(TODAY, TODAY)).toBe(TODAY)
  })

  it('defaults to today when the date is absent', () => {
    expect(resolveIngestDate(undefined, TODAY)).toBe(TODAY)
  })

  // The regex the route already had accepts this; `Date` normalises it to March 3 rather than
  // refusing, so without the round-trip check a non-existent day would be stored as a real one.
  it('rejects a regex-passing non-date rather than silently rolling it over', () => {
    expect(resolveIngestDate('2026-02-31', TODAY)).toBe(TODAY)
    expect(resolveIngestDate('2026-13-01', TODAY)).toBe(TODAY)
    expect(resolveIngestDate('not-a-date', TODAY)).toBe(TODAY)
    expect(resolveIngestDate('', TODAY)).toBe(TODAY)
  })

  describe('the past bound', () => {
    it('clamps beyond the tolerance to the boundary day', () => {
      expect(resolveIngestDate('2020-01-01', TODAY)).toBe('2026-08-12')
      expect(resolveIngestDate('2026-08-11', TODAY)).toBe('2026-08-12')
    })

    it('leaves the boundary day itself alone', () => {
      expect(resolveIngestDate('2026-08-12', TODAY)).toBe('2026-08-12')
      expect(INGEST_PAST_TOLERANCE_DAYS).toBe(7)
    })

    // This is the one place it deliberately differs from `resolveMeasuredAt`, which returns `now`
    // in both directions. That is right for an instant; this route writes a DAILY AGGREGATE, and
    // re-dating a ten-day-old day onto today would merge stale steps and macros into the day every
    // "today" and "most recent" read depends on.
    it('never re-dates a stale day onto today', () => {
      expect(resolveIngestDate('2020-01-01', TODAY)).not.toBe(TODAY)
    })
  })

  it('crosses a month and a year boundary correctly when clamping back', () => {
    expect(resolveIngestDate('2019-01-01', '2026-01-03')).toBe('2025-12-27')
  })
})
