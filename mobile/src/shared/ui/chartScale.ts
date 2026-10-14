// Pure geometry for the chart components' opt-in axes, gridlines and target line. Kept free of
// React so it can be unit-tested. `niceTicks` used to live in the nutrition feature; it is here
// now and re-exported from there.

/** Round-number gridline values spanning [lo, hi], about three of them. */
export function niceTicks(lo: number, hi: number): number[] {
  const span = Math.max(hi - lo, 1e-6);
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
export function yPixel(
  value: number,
  min: number,
  max: number,
  height: number,
): number {
  if (max === min) return height / 2;
  return height - ((value - min) / (max - min)) * height;
}

/** Axis label text: at most one decimal, no trailing zero. */
export function tickLabel(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/**
 * Where an SVG with `viewBox="0 0 vbWidth vbHeight"` and the default `xMidYMid meet` draws inside a
 * `width` x `height` box. Lets overlays (labels, target lines) line up with SVG content exactly.
 */
export function meetBox(
  width: number,
  height: number,
  vbWidth: number,
  vbHeight: number,
) {
  const scale = Math.min(width / vbWidth, height / vbHeight);
  return {
    scale,
    offsetX: (width - vbWidth * scale) / 2,
    offsetY: (height - vbHeight * scale) / 2,
  };
}
