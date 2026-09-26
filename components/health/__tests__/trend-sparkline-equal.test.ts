import { describe, expect, it } from 'vitest'
import { trendSparklinePropsEqual, type TrendSparklineCompared } from '../trend-sparkline-equal'
import type { HealthTrendDay } from '@/app/api/health/trends/route'

/**
 * DV-12 — `TrendSparkline` skips a re-render when nothing it draws has changed.
 *
 * **The cases that must NOT be skipped are the point of this file.** A comparator that returns `true`
 * too eagerly does not crash: it leaves a stale chart on screen, and that is invisible until someone
 * notices the numbers are old. The measured win is 578 canvas `font`-setter calls → 0 on every switch
 * to the Health tab; the risk it buys is exactly this, so every "must redraw" case is pinned.
 */
const day = (date: string, over: Partial<HealthTrendDay> = {}) =>
  ({ date, steps: 1000, proteinPerKg: 1.5, waterMl: 2000, ...over }) as HealthTrendDay

const props = (over: Partial<TrendSparklineCompared> = {}): TrendSparklineCompared => ({
  trends: [day('2026-09-01'), day('2026-09-02')],
  field: 'steps', label: 'Steps', color: '#2dd4bf', unit: '',
  ...over,
})

describe('trendSparklinePropsEqual', () => {
  it('skips when a refetch returns the same values in a NEW array — the whole bug', () => {
    // The tab re-show bumps `epoch`, the screen refetches, and the new array is value-identical.
    // React's default shallow compare sees a different reference and re-renders.
    expect(trendSparklinePropsEqual(props(), props())).toBe(true)
  })

  it('skips on referential identity without walking the array', () => {
    const trends = [day('2026-09-01')]
    expect(trendSparklinePropsEqual(props({ trends }), props({ trends }))).toBe(true)
  })

  it('REDRAWS when the drawn field changes', () => {
    expect(trendSparklinePropsEqual(
      props(),
      props({ trends: [day('2026-09-01'), day('2026-09-02', { steps: 9999 })] }),
    )).toBe(false)
  })

  it('REDRAWS when a day is added or removed', () => {
    expect(trendSparklinePropsEqual(props(), props({ trends: [day('2026-09-01')] }))).toBe(false)
  })

  it('REDRAWS when the dates shift — same count, different days', () => {
    // The window rolls at midnight with the same length, and the x labels come from `date`.
    expect(trendSparklinePropsEqual(
      props(),
      props({ trends: [day('2026-09-02'), day('2026-09-03')] }),
    )).toBe(false)
  })

  it('REDRAWS when any presentational prop changes', () => {
    for (const over of [{ field: 'waterMl' as const }, { label: 'Other' }, { color: '#fff' }, { unit: 'ml' }]) {
      expect(trendSparklinePropsEqual(props(), props(over)), JSON.stringify(over)).toBe(false)
    }
  })

  it('ignores a field this sparkline does not draw', () => {
    // Five of these sit on Health, each pointed at a different metric. A refetch that moves protein
    // must redraw the protein one and leave the other four alone — that is the saving, not a bug.
    expect(trendSparklinePropsEqual(
      props({ field: 'steps' }),
      props({ field: 'steps', trends: [day('2026-09-01', { proteinPerKg: 99 }), day('2026-09-02')] }),
    )).toBe(true)
  })

  it('treats null and a number as different, so a gap appearing redraws', () => {
    expect(trendSparklinePropsEqual(
      props(),
      props({ trends: [day('2026-09-01'), day('2026-09-02', { steps: null })] }),
    )).toBe(false)
  })
})
