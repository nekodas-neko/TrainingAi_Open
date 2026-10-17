import { seriesShape } from '@trainingai/shared/health/series-gaps';

// Pure geometry for the chart components' opt-in axes, gridlines and target line. Kept free of
// React so it can be unit-tested. `niceTicks` used to live in the nutrition feature; it is here
// now and re-exported from there.

/** Round-number gridline values spanning [lo, hi], about three of them. */
export function niceTicks(lo: number, hi: number): number[] {
  if (hi - lo < 1e-6) return [lo];
  const span = hi - lo;
  const raw = span / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step)
    out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** A reference line a chart can draw, e.g. a daily goal. */
export type ChartTarget = { value: number; label: string };

/** Widen [min, max] so a target line never sits outside the plot. */
export function includeTarget(
  min: number,
  max: number,
  target?: ChartTarget,
): readonly [number, number] {
  if (!target || !Number.isFinite(target.value)) return [min, max];
  return [Math.min(min, target.value), Math.max(max, target.value)];
}

/** Pixel y (0 = top) of `value` in a plot `height` tall whose scale runs min..max. */
export function yPixel(value: number, min: number, max: number, height: number): number {
  if (max === min) return height / 2;
  return height - ((value - min) / (max - min)) * height;
}

/**
 * Axis label text for a set of gridline values: decimals follow the tick step so labels never
 * repeat, and ticks that are all multiples of 100 and reach 1000 abbreviate ("12.5k") to stay short.
 */
export function tickLabels(ticks: readonly number[]): string[] {
  const step = ticks.length > 1 ? Math.round(Math.abs(ticks[1] - ticks[0]) * 1e6) / 1e6 : 0;
  const compact = ticks.some((t) => Math.abs(t) >= 1000) && ticks.every((t) => t % 100 === 0);
  const decimals = step > 0 ? Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) : 2;
  return ticks.map((t) =>
    compact && t !== 0 ? `${Number((t / 1000).toFixed(1))}k` : String(Number(t.toFixed(decimals))),
  );
}

/** Width of the y-axis label column: the longest label at ~7 px a character, floored at 32. */
export function yAxisWidth(texts: readonly string[], fontScale = 1): number {
  const longest = Math.max(0, ...texts.map((t) => t.length));
  return Math.max(32, Math.ceil(longest * 7 * fontScale) + 8);
}

/** The target if it can be drawn (a finite value), else undefined. */
export function drawableTarget(target?: ChartTarget): ChartTarget | undefined {
  return target && Number.isFinite(target.value) ? target : undefined;
}

/** Spoken summary of a chart's scale for its accessibility label, e.g. ". Range 0 to 2700. Goal 2500". */
export function guideSummary(min: number, max: number, target?: ChartTarget): string {
  const round = (v: number) => Math.round(v * 10) / 10;
  return `. Range ${round(min)} to ${round(max)}${target ? `. ${target.label} ${target.value}` : ''}`;
}

/**
 * Where an SVG with `viewBox="0 0 vbWidth vbHeight"` and the default `xMidYMid meet` draws inside a
 * `width` x `height` box. Lets overlays (labels, target lines) line up with SVG content exactly.
 */
export function meetBox(width: number, height: number, vbWidth: number, vbHeight: number) {
  const scale = Math.min(width / vbWidth, height / vbHeight);
  return {
    scale,
    offsetX: (width - vbWidth * scale) / 2,
    offsetY: (height - vbHeight * scale) / 2,
  };
}

/** True when `axisLabels` has one entry per point and some are blank: the caller has thinned the axis
 *  and each remaining label belongs under its own point, not spread across the row. */
export function isPointAlignedAxis(labelCount: number, pointCount: number, labels: readonly string[]) {
  return labelCount === pointCount && pointCount > 1 && labels.some((label) => label === '');
}

/** Pixel centre, from the left of the chart view, of the point at `x`. Mirrors LineChart's own
 *  viewBox maths (12..308 of 320, fitted by `meetBox`) so a label lands under its point. */
export function pointCentreX(
  x: number,
  xMin: number,
  xMax: number,
  plotWidth: number,
  plotHeight: number,
  leftInset = 0,
) {
  const box = meetBox(plotWidth, plotHeight, 320, 90);
  const vb = xMin === xMax ? 160 : 12 + ((x - xMin) / (xMax - xMin)) * 296;
  return leftInset + box.offsetX + box.scale * vb;
}

/**
 * Which points of a line get a dot. 'all' dots every reading; 'isolated' dots only the latest one
 * and a reading with no neighbour either side (a line needs two points, so it would not show at
 * all), as the current app's sparklines do.
 */
export function dotMask(values: readonly (number | null)[], mode: 'all' | 'isolated'): boolean[] {
  const { isolated } = seriesShape([...values]);
  return values.map(
    (value, index) =>
      value !== null && (mode === 'all' || index === values.length - 1 || isolated[index]),
  );
}
