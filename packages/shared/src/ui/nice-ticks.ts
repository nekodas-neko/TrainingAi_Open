/**
 * Round tick values for a chart axis: about `count` ticks (three unless asked), on a 1/2/5 step.
 *
 * A flat range (`hi − lo` under 1e-6) returns `[lo]`, one gridline at the value. Without that, a
 * flat series at a value that is not a multiple of the tiny step got no ticks at all. Preview's
 * copy carried that guard and the current app's did not (#3041). The current app's one caller,
 * the heart-response chart, pads its range by at least 1 on each side, so it never reaches the
 * guard and none of its charts change.
 */
export function niceTicks(lo: number, hi: number, count = 3): number[] {
  if (hi - lo < 1e-6) return [lo]
  const raw = (hi - lo) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 5, 10].find(m => m * mag >= raw) ?? 10) * mag
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6)
  return out
}

/**
 * [lo, hi] widened outwards to the round values the gridlines sit on, with those ticks, the way
 * chart.js's linear scale does it (`generateTicks`, bounds 'ticks'): space the ticks for
 * `maxTicks`, and when that gives more spaces than `maxTicks - 1` allows, widen the spacing and
 * round the ends to it. The current app's 14-day cards pass `maxTicksLimit: 4`, so a 35-65 range
 * reads 20/40/60/80, not 30...70. Preview's 14-day line charts call it with
 * `WEB_TREND_Y_AXIS.maxTicks`. The lowest gridline is then the bottom of the plot. A flat range keeps
 * its one tick and is not widened.
 */
export function niceScale(
  lo: number,
  hi: number,
  maxTicks = 4,
): { min: number; max: number; ticks: number[] } {
  if (hi - lo < 1e-6) return { min: lo, max: hi, ticks: [lo] }
  const niceNum = (range: number) => {
    const base = 10 ** Math.floor(Math.log10(range))
    const fraction = range / base
    return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * base
  }
  const maxSpaces = Math.max(1, maxTicks - 1)
  let spacing = niceNum((hi - lo) / maxSpaces)
  const spaces = Math.ceil(hi / spacing - 1e-9) - Math.floor(lo / spacing + 1e-9)
  if (spaces > maxSpaces) spacing = niceNum((spaces * spacing) / maxSpaces)
  const round = (v: number) => Math.round(v * 1e6) / 1e6
  const min = round(Math.floor(lo / spacing + 1e-9) * spacing)
  const max = round(Math.ceil(hi / spacing - 1e-9) * spacing)
  const ticks: number[] = []
  for (let v = min; v <= max + 1e-9; v += spacing) ticks.push(round(v))
  return { min, max, ticks }
}

/**
 * The y axis of the current app's 14-day trend cards (`components/health/trend-sparkline.tsx`):
 * chart.js `ticks.font.size: 8` and `maxTicksLimit: 4`. Preview's dense line charts read this
 * rather than restating the numbers.
 */
export const WEB_TREND_Y_AXIS = { fontSize: 8, maxTicks: 4 } as const
