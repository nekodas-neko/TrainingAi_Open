import { describe, it, expect, vi } from 'vitest'
import { phaseBandsPlugin, type PhaseBand } from '@/components/activity/phase-bands-plugin'

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
})
