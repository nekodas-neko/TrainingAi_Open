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
