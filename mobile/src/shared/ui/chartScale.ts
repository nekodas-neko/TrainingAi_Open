import { standaloneOrLatest } from '@trainingai/shared/health/series-gaps';
import { niceTicks, niceScale } from '@trainingai/shared/ui/nice-ticks';

// Pure geometry for the chart components' opt-in axes, gridlines and target line. Kept free of
// React so it can be unit-tested. `niceTicks` itself lives in `@trainingai/shared/ui/nice-ticks`.

/** Round-number gridline values spanning [lo, hi], about three of them. Shared with the current app (#3041). */
export { niceTicks, niceScale };

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

/** Width of the y-axis label column: the longest label at `charWidth` px a character (7 at 12 px type), floored at 32. */
export function yAxisWidth(texts: readonly string[], fontScale = 1, charWidth = 7): number {
  const longest = Math.max(0, ...texts.map((t) => t.length));
  return Math.max(32, Math.ceil(longest * charWidth * fontScale) + 8);
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

/**
 * The viewBox height that makes a 320-wide viewBox exactly fill a `plotWidth` x `plotHeight` box, so
 * the plot uses the whole height it is given instead of being letterboxed to 320:90 (the "short
 * chart with empty space below" on a taller card). 90 until the box is measured.
 */
export function chartViewBoxHeight(plotWidth: number, plotHeight: number): number {
  return plotWidth > 1 && plotHeight > 0 ? (320 * plotHeight) / plotWidth : 90;
}

/** Top and bottom margin inside that viewBox: 12 units, less on a very short sparkline. */
export function chartPadY(vbHeight: number): number {
  return Math.min(12, (vbHeight * 12) / 90);
}

/**
 * Extend round gridline values upward until the last one reaches `top`. Chart.js, which draws the
 * current app's bar charts, rounds the axis up to the next tick, so the tallest bar sits under a
 * label ("6,000", not "4,000" with a bar poking past it).
 */
export function coverTicks(ticks: readonly number[], top: number): number[] {
  if (ticks.length < 2) return [...ticks];
  const step = ticks[1] - ticks[0];
  const out = [...ticks];
  let last = out[out.length - 1];
  while (last < top - 1e-9) {
    last = Math.round((last + step) * 1e6) / 1e6;
    out.push(last);
  }
  return out;
}

/** True when `axisLabels` has one entry per point and some are blank: the caller has thinned the axis
 *  and each remaining label belongs under its own point, not spread across the row. */
export function isPointAlignedAxis(labelCount: number, pointCount: number, labels: readonly string[]) {
  // A thinned axis (blanks between labels) or a label on every point of a dense series (14 days):
  // each belongs under its own point. A short list of end labels keeps the even spread.
  return (
    labelCount === pointCount &&
    pointCount > 1 &&
    (pointCount >= DENSE_AXIS_POINTS || labels.some((label) => label === ''))
  );
}

/** Labels at or above this many make an axis dense: set at the 9 px tick size the current app's charts use. */
export const DENSE_AXIS_POINTS = 10;

/**
 * An SVG path through `points` as chart.js draws a line with `tension`: a cubic through every point
 * whose control points lean along the line between its neighbours, scaled by how far each neighbour
 * is. The first and last point have one control point each, so the curve starts and ends on them.
 * `tension` 0 is a straight polyline. The current app's 14-day charts use 0.4.
 */
export function smoothPath(points: readonly { x: number; y: number }[], tension = 0.4): string {
  if (points.length === 0) return '';
  const move = `M${points[0].x},${points[0].y}`;
  if (points.length < 3 || tension === 0) {
    return points.slice(1).reduce((d, p) => `${d} L${p.x},${p.y}`, move);
  }
  const control = points.map((p, i) => {
    const prev = points[i - 1] ?? p;
    const next = points[i + 1] ?? p;
    const d01 = Math.hypot(p.x - prev.x, p.y - prev.y);
    const d12 = Math.hypot(next.x - p.x, next.y - p.y);
    const total = d01 + d12;
    const fa = total ? (tension * d01) / total : 0;
    const fb = total ? (tension * d12) / total : 0;
    return {
      before: { x: p.x - fa * (next.x - prev.x), y: p.y - fa * (next.y - prev.y) },
      after: { x: p.x + fb * (next.x - prev.x), y: p.y + fb * (next.y - prev.y) },
    };
  });
  let d = move;
  for (let i = 1; i < points.length; i++) {
    const a = control[i - 1].after;
    const b = control[i].before;
    d += ` C${a.x},${a.y} ${b.x},${b.y} ${points[i].x},${points[i].y}`;
  }
  return d;
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
  const box = meetBox(plotWidth, plotHeight, 320, chartViewBoxHeight(plotWidth, plotHeight));
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
