import type { Plugin } from 'chart.js'

export interface PhaseBand {
  fromMin: number
  toMin: number
  kind: 'fast' | 'slow'
}

/** The fast/slow blocks of a plan as chart bands; pass the clipped list so unreached blocks paint none. */
export function phaseBandsFromSegments(
  segments: { kind: string; startSec: number; endSec: number }[],
): PhaseBand[] {
  return segments
    .filter(seg => seg.kind === 'fast' || seg.kind === 'slow')
    .map(seg => ({ fromMin: seg.startSec / 60, toMin: seg.endSec / 60, kind: seg.kind as 'fast' | 'slow' }))
}

// Custom chart.js plugin instead of a new dependency (no chartjs-plugin-annotation in the repo
// today) — paints a translucent background rect per phase band behind the HR line. Kept in its
// own pure (non-JSX) module so the draw logic can be unit tested directly — this repo's vitest
// setup has no React/JSX transform, so a `.tsx` file can't be imported into a test.
export const phaseBandsPlugin: Plugin<'line'> = {
  id: 'phaseBands',
  beforeDatasetsDraw(chart) {
    const bands = (chart.options.plugins as { phaseBands?: { bands: PhaseBand[]; fastColor: string; slowColor: string } })
      ?.phaseBands?.bands
    const { chartArea, scales, ctx } = chart
    if (!bands || bands.length === 0 || !chartArea) return
    const opts = (chart.options.plugins as { phaseBands: { fastColor: string; slowColor: string } }).phaseBands
    const xScale = scales.x
    ctx.save()
    ctx.globalAlpha = 0.12
    for (const band of bands) {
      // The x max is the last HR sample, so a band can reach past the plot; keep it inside.
      const xStart = Math.max(xScale.getPixelForValue(band.fromMin), chartArea.left)
      const xEnd = Math.min(xScale.getPixelForValue(band.toMin), chartArea.right)
      if (xEnd <= xStart) continue
      ctx.fillStyle = band.kind === 'fast' ? opts.fastColor : opts.slowColor
      ctx.fillRect(xStart, chartArea.top, xEnd - xStart, chartArea.bottom - chartArea.top)
    }
    ctx.restore()
  },
}
