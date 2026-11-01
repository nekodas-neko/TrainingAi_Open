export type WashSize = { width: number; height: number };

/**
 * The accent wash is an SVG laid over the card. Android sizes a `100%` SVG once, from the card's
 * first layout, and does not repaint it when the card grows (a figure or a line arrives after
 * the first frame), so the wash stopped short and the rest of the card showed its flat base (#3506).
 * The wash is drawn at the card's own measured size instead, and again whenever that changes.
 * Nothing here is a fixed height: it is whatever the card measured.
 */
export function washSize(
  width: number,
  height: number,
  previous: WashSize | null,
): WashSize | null {
  if (!(width > 0) || !(height > 0)) return previous;
  if (previous && previous.width === width && previous.height === height) return previous;
  return { width, height };
}
