import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stripComments } from '../../../scripts/lib/strip-comments.js'
import { hrDayChartPropsEqual, type HrDayChartProps } from '../hr-day-chart-equal'

/**
 * OR-162 — `HrDayChart` skips a re-render when nothing it draws has changed.
 *
 * **The cases that must NOT be skipped are the point of this file**, exactly as for
 * `trend-sparkline-equal.test.ts`: a comparator that returns `true` too eagerly does not crash, it
 * leaves yesterday's line on screen, and nobody notices until the numbers are old. Device sweep 4a
 * counted 30 canvas `font` writes per tab switch on Home and 80 on Health from this chart, all of
 * them while the panel was hidden, so the whole saving is the risk these cases pin.
 */
const reading = (timestamp: string, bpm: number, source: string | null = 'ble') =>
  ({ timestamp, bpm, source })

const props = (over: Partial<HrDayChartProps> = {}): HrDayChartProps => ({
  readings: [reading('2026-09-26T08:00:00Z', 62), reading('2026-09-26T08:05:00Z', 64)],
  date: '2026-09-26',
  workoutSessions: [{ sessionName: 'Upper', startedAt: '2026-09-26T09:00:00Z', completedAt: '2026-09-26T10:00:00Z' }],
  sleepWindow: { startMin: 1320, endMin: 420 },
  stressSeries: [{ t: 1_758_000_000, level: 0.2 }],
  stressTimezone: 'Australia/Brisbane',
  ...over,
})

describe('hrDayChartPropsEqual', () => {
  it('skips when a refetch returns the same day in a NEW array — the whole bug', () => {
    // The tab-switch epoch bumps, both call sites refetch, and `setState` gets a value-identical
    // array. React's default shallow compare sees a new reference and re-renders.
    expect(hrDayChartPropsEqual(props(), props())).toBe(true)
  })

  it('skips on referential identity without walking the readings', () => {
    const readings = [reading('2026-09-26T08:00:00Z', 62)]
    expect(hrDayChartPropsEqual(props({ readings }), props({ readings }))).toBe(true)
  })

  it('REDRAWS when a reading arrives', () => {
    expect(hrDayChartPropsEqual(
      props(),
      props({ readings: [...props().readings, reading('2026-09-26T08:10:00Z', 66)] }),
    )).toBe(false)
  })

  it('REDRAWS when a bpm changes with the count held', () => {
    expect(hrDayChartPropsEqual(
      props(),
      props({ readings: [reading('2026-09-26T08:00:00Z', 62), reading('2026-09-26T08:05:00Z', 99)] }),
    )).toBe(false)
  })

  it('REDRAWS when only a reading SOURCE changes — it draws the sleep/rest shading', () => {
    // `findSourceWindows` bands the chart off `source`, so this is visible even though the line is
    // unchanged. It is the field most easily mistaken for metadata.
    expect(hrDayChartPropsEqual(
      props(),
      props({ readings: [reading('2026-09-26T08:00:00Z', 62, 'rest'), reading('2026-09-26T08:05:00Z', 64)] }),
    )).toBe(false)
  })

  it('REDRAWS at the midnight rollover', () => {
    expect(hrDayChartPropsEqual(props(), props({ date: '2026-09-27' }))).toBe(false)
  })

  it('REDRAWS when the sleep window moves, and skips when it is re-derived to the same minutes', () => {
    expect(hrDayChartPropsEqual(props(), props({ sleepWindow: { startMin: 1300, endMin: 420 } }))).toBe(false)
    expect(hrDayChartPropsEqual(props(), props({ sleepWindow: { startMin: 1320, endMin: 420 } }))).toBe(true)
  })

  it('REDRAWS when the sleep window appears or disappears', () => {
    expect(hrDayChartPropsEqual(props({ sleepWindow: null }), props())).toBe(false)
    expect(hrDayChartPropsEqual(props(), props({ sleepWindow: undefined }))).toBe(false)
  })

  it('REDRAWS when a workout is logged — it draws a named band and a legend row', () => {
    expect(hrDayChartPropsEqual(props(), props({ workoutSessions: [] }))).toBe(false)
    expect(hrDayChartPropsEqual(
      props(),
      props({ workoutSessions: [{ sessionName: 'Lower', startedAt: '2026-09-26T09:00:00Z', completedAt: '2026-09-26T10:00:00Z' }] }),
    )).toBe(false)
  })

  it('REDRAWS when a workout in progress completes', () => {
    expect(hrDayChartPropsEqual(
      props(),
      props({ workoutSessions: [{ sessionName: 'Upper', startedAt: '2026-09-26T09:00:00Z', completedAt: null }] }),
    )).toBe(false)
  })

  it('REDRAWS when the stress overlay moves', () => {
    expect(hrDayChartPropsEqual(props(), props({ stressSeries: [{ t: 1_758_000_000, level: 0.9 }] }))).toBe(false)
    expect(hrDayChartPropsEqual(props(), props({ stressSeries: [] }))).toBe(false)
    expect(hrDayChartPropsEqual(props(), props({ stressSeries: undefined }))).toBe(false)
  })

  it('REDRAWS when the zone the stress buckets are placed in changes', () => {
    // A travelling phone would otherwise keep drawing a Brisbane morning in the afternoon.
    expect(hrDayChartPropsEqual(props(), props({ stressTimezone: 'Europe/London' }))).toBe(false)
  })

  it('REDRAWS when any presentational prop changes', () => {
    for (const over of [
      { compact: true }, { showLegend: false }, { lineColor: '#fff' },
      { bucketMinutes: 30 }, { showBackfill: true },
    ] as Partial<HrDayChartProps>[]) {
      expect(hrDayChartPropsEqual(props(), props(over)), JSON.stringify(over)).toBe(false)
    }
  })
})

/**
 * A comparator nothing calls saves nothing. Both charts on the tab-switch path are pinned here
 * rather than only the one this entry changed — `TrendSparkline` was given the same treatment in
 * #1675 and has never had a guard, and the failure mode is identical: dropping the second argument
 * to `memo` leaves a component that still reads as optimised and skips nothing.
 */
const source = (file: string) =>
  stripComments(readFileSync(join(__dirname, '..', file), 'utf8')) as string

describe('the charts on the tab-switch path stay memoised by value', () => {
  it('HrDayChart is exported through memo with its comparator', () => {
    expect(source('hr-day-chart.tsx')).toMatch(/memo\(\s*HrDayChartBase\s*,\s*hrDayChartPropsEqual\s*\)/)
  })

  it('TrendSparkline is exported through memo with its comparator', () => {
    expect(source('trend-sparkline.tsx')).toMatch(/memo\(\s*TrendSparklineBase\s*,\s*trendSparklinePropsEqual\s*\)/)
  })
})
