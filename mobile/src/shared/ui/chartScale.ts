import { standaloneOrLatest } from '@trainingai/shared/health/series-gaps';
import { niceTicks } from '@trainingai/shared/ui/nice-ticks';

// Pure geometry for the chart components' opt-in axes, gridlines and target line. Kept free of
// React so it can be unit-tested. `niceTicks` itself lives in `@trainingai/shared/ui/nice-ticks`.

/** Round-number gridline values spanning [lo, hi], about three of them. Shared with the current app (#3041). */
export { niceTicks };

/**
 * [lo, hi] widened outwards to the round values the gridlines sit on, with those ticks, the way
 * chart.js's linear scale does it (`generateTicks`, bounds 'ticks'): space the ticks for
 * `maxTicks`, and when that gives more spaces than `maxTicks - 1` allows, widen the spacing and
 * round the ends to it. The current app's 14-day cards pass `maxTicksLimit: 4`, so a 35-65 range
 * reads 20/40/60/80, not 30...70. The lowest gridline is then the bottom of the plot. A flat range
 * keeps its one tick and is not widened.
 */
export function niceScale(
  lo: number,
  hi: number,
  maxTicks = 4,
): { min: number; max: number; ticks: number[] } {
  if (hi - lo < 1e-6) return { min: lo, max: hi, ticks: [lo] };
  const niceNum = (range: number) => {
    const base = 10 ** Math.floor(Math.log10(range));
    const fraction = range / base;
    return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * base;
  };
  const maxSpaces = Math.max(1, maxTicks - 1);
  let spacing = niceNum((hi - lo) / maxSpaces);
  const spaces = Math.ceil(hi / spacing - 1e-9) - Math.floor(lo / spacing + 1e-9);
  if (spaces > maxSpaces) spacing = niceNum((spaces * spacing) / maxSpaces);
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  const min = round(Math.floor(lo / spacing + 1e-9) * spacing);
  const max = round(Math.ceil(hi / spacing - 1e-9) * spacing);
  const ticks: number[] = [];
  for (let v = min; v <= max + 1e-9; v += spacing) ticks.push(round(v));
  return { min, max, ticks };
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
 * repeat. Ticks write out in full with a thousands separator ("500", "1,500", as chart.js's default
 * number format does in the current app) until a label would be five digits: those, when all
 * multiples of 100, abbreviate ("12.5k") to stay short.
 */
export function tickLabels(ticks: readonly number[]): string[] {
  const step = ticks.length > 1 ? Math.round(Math.abs(ticks[1] - ticks[0]) * 1e6) / 1e6 : 0;
  const compact = ticks.some((t) => Math.abs(t) >= 10000) && ticks.every((t) => t % 100 === 0);
  const decimals = step > 0 ? Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) : 2;
  return ticks.map((t) =>
    compact && t !== 0
      ? `${Number((t / 1000).toFixed(1))}k`
      : Number(t.toFixed(decimals)).toLocaleString('en-AU', { maximumFractionDigits: decimals }),
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
  stretch = false,
) {
  // Stretched, the viewBox fills the box (x 0..320 across the whole width); otherwise it is fitted and inset.
  if (stretch) {
    return leftInset + (xMin === xMax ? plotWidth / 2 : ((x - xMin) / (xMax - xMin)) * plotWidth);
  }
  const box = meetBox(plotWidth, plotHeight, 320, 90);
  const vb = xMin === xMax ? 160 : 12 + ((x - xMin) / (xMax - xMin)) * 296;
  return leftInset + box.offsetX + box.scale * vb;
}

/**
 * Where an axis label `boxWidth` wide goes, given the pixel centre of its point. The label is
 * centred under the point, but a point near either end would push it past the chart's edge and
 * clip it ("Sat", "Sun"), so the box is slid back inside and the text aligned to the edge it
 * leans on, which keeps the whole word visible and as close to its point as the edge allows.
 */
export function axisLabelBox(centre: number, boxWidth: number, totalWidth: number) {
  const left = centre - boxWidth / 2;
  if (totalWidth <= boxWidth) return { left: 0, alignItems: 'center' as const };
  if (left < 0) return { left: 0, alignItems: 'flex-start' as const };
  if (left + boxWidth > totalWidth) {
    return { left: totalWidth - boxWidth, alignItems: 'flex-end' as const };
  }
  return { left, alignItems: 'center' as const };
}

/**
 * Which points of a line get a dot. 'all' dots every reading; 'isolated' dots only the latest one
 * and a reading with no neighbour either side (a line needs two points, so it would not show at
 * all), as the current app's sparklines do. 'none' draws no dots, like the Strength Trend's Sparkline.
 */
export function dotMask(
  values: readonly (number | null)[],
  mode: 'all' | 'isolated' | 'none',
): boolean[] {
  if (mode === 'none') return values.map(() => false);
  const standalone = standaloneOrLatest([...values]);
  return values.map((value, index) => value !== null && (mode === 'all' || standalone[index]));
}

/** What a line does where a day has no reading: 'break' leaves a gap (a missing day stays visible),
 *  'connect' joins the readings either side, as the current app does for body measurements. */
export type GapMode = 'break' | 'connect';

/**
 * Split a day-by-day series of points (null = no reading) into the runs a line is drawn through.
 * 'break' starts a new run after every empty day; 'connect' draws one run through all the readings,
 * which is how a weight taken every few days becomes a line instead of floating dots.
 */
export function lineSegments<T>(points: readonly (T | null)[], gaps: GapMode): T[][] {
  if (gaps === 'connect') {
    const all = points.filter((point): point is T => point !== null);
    return [all];
  }
  const segments: T[][] = [[]];
  for (const point of points) {
    if (point !== null) {
      segments.at(-1)!.push(point);
    } else if (segments.at(-1)!.length) {
      segments.push([]);
    }
  }
  return segments;
}

/** Index of the newest reading (last non-null), or -1 when there is none. */
export function lastReadingIndex(values: readonly (number | null)[]): number {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return i;
  return -1;
}
