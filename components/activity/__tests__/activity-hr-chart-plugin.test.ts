import { describe, it, expect, vi } from 'vitest'
import { clipSegmentsAt } from '@trainingai/shared/walking/clip-segments'
import { buildIntervalPlan } from '@/lib/walk/interval-plan'
import { phaseBandsPlugin, phaseBandsFromSegments, type PhaseBand } from '@/components/activity/phase-bands-plugin'

// Minimal fake chart.js `Chart` — only the surface phaseBandsPlugin's beforeDatasetsDraw reads.
function fakeChart(bands: PhaseBand[] | undefined) {
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    globalAlpha: 1,
    fillStyle: '',
  }
  const chart = {
    options: {
      plugins: bands ? { phaseBands: { bands, fastColor: 'FAST', slowColor: 'SLOW' } } : {},
    },
    chartArea: { top: 10, bottom: 110, left: 0, right: 200 },
    scales: {
      // 1 chart-minute == 10px, for an easy-to-check mapping.
      x: { getPixelForValue: (min: number) => min * 10 },
    },
    ctx,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
  return { chart, ctx }
}

describe('phaseBandsPlugin', () => {
  it('draws nothing when no bands are configured', () => {
    const { chart, ctx } = fakeChart(undefined)
    phaseBandsPlugin.beforeDatasetsDraw?.(chart, {} as never, {} as never)
    expect(ctx.fillRect).not.toHaveBeenCalled()
  })

  it('draws nothing for an empty bands array', () => {
    const { chart, ctx } = fakeChart([])
    phaseBandsPlugin.beforeDatasetsDraw?.(chart, {} as never, {} as never)
    expect(ctx.fillRect).not.toHaveBeenCalled()
  })

  it('fills one rect per band at the mapped pixel range, colored by kind', () => {
    const bands: PhaseBand[] = [
      { fromMin: 0, toMin: 3, kind: 'slow' },
      { fromMin: 3, toMin: 6, kind: 'fast' },
    ]
    const { chart, ctx } = fakeChart(bands)
    phaseBandsPlugin.beforeDatasetsDraw?.(chart, {} as never, {} as never)

    expect(ctx.save).toHaveBeenCalledTimes(1)
    expect(ctx.restore).toHaveBeenCalledTimes(1)
    expect(ctx.fillRect).toHaveBeenCalledTimes(2)
    // slow band: x 0..30, full chart-area height (100..10 = 100px)
    expect(ctx.fillRect).toHaveBeenNthCalledWith(1, 0, 10, 30, 100)
    // fast band: x 30..60
    expect(ctx.fillRect).toHaveBeenNthCalledWith(2, 30, 10, 30, 100)
  })

  it('does nothing when the chart has no chartArea yet (pre-layout)', () => {
    const { chart, ctx } = fakeChart([{ fromMin: 0, toMin: 1, kind: 'fast' }])
    chart.chartArea = undefined
    phaseBandsPlugin.beforeDatasetsDraw?.(chart, {} as never, {} as never)
    expect(ctx.fillRect).not.toHaveBeenCalled()
  })

  it('clips a band that runs past the plot to the chart area', () => {
    // Chart area is x 0..200 at 10px/min; a band to minute 30 would reach x 300.
    const { chart, ctx } = fakeChart([{ fromMin: 15, toMin: 30, kind: 'slow' }])
    phaseBandsPlugin.beforeDatasetsDraw?.(chart, {} as never, {} as never)
    expect(ctx.fillRect).toHaveBeenCalledWith(150, 10, 50, 100)
  })

  it('draws nothing for a band wholly past the plot', () => {
    const { chart, ctx } = fakeChart([{ fromMin: 25, toMin: 30, kind: 'fast' }])
    phaseBandsPlugin.beforeDatasetsDraw?.(chart, {} as never, {} as never)
    expect(ctx.fillRect).not.toHaveBeenCalled()
  })
})

describe('phaseBandsFromSegments on an early-saved walk (#3188)', () => {
  // [slow 0-180, fast 180-360, slow 360-540, fast 540-720]
  const plan = buildIntervalPlan({ sets: 2, fastSec: 180, slowSec: 180, warmupSec: 0, cooldownSec: 0, treadmill: false })

  it('paints no band for blocks never reached and ends the current one at the stop', () => {
    const bands = phaseBandsFromSegments(clipSegmentsAt(plan.segments, 240))
    expect(bands).toEqual([
      { fromMin: 0, toMin: 3, kind: 'slow' },
      { fromMin: 3, toMin: 4, kind: 'fast' },
    ])
    expect(Math.max(...bands.map(b => b.toMin))).toBeLessThanOrEqual(240 / 60)
  })

  it('keeps every band for a walk finished normally', () => {
    expect(phaseBandsFromSegments(clipSegmentsAt(plan.segments, 720))).toHaveLength(4)
  })
})
