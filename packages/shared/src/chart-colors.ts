// Chart.js paints on a <canvas>, whose fillStyle/strokeStyle cannot resolve CSS
// custom properties — a `var(--x)` color silently falls back to black. Resolve it
// to the concrete computed value at paint time instead. Client-only (typeof window
// guard) since chart components using this can still render once during SSR.
export function resolveColor(color: string): string {
  if (color.startsWith("var(") && typeof window !== "undefined") {
    const name = color.slice(4, -1).split(",")[0].trim();
    const resolved = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (resolved) return resolved;
  }
  return color;
}

/**
 * LB-153 — the ONE categorical palette for anything that colours by index: the workout's set cards,
 * the AI chat's charts, the HR-recovery traces. Three copies used to disagree, and all three spent
 * green, amber and red, which everywhere else in the app mean good, warning and bad. So set 1 amber
 * and set 2 green read as a verdict on the set rather than its number.
 *
 * The owner's rule (2026-09-27): no colour here may also mean good/warning/bad elsewhere. Every hue
 * is therefore drawn from blue through pink (roughly 200°–330° in OKLCH), well clear of the
 * green/amber/red of `scoreBand` and the ACWR bands. Reversal is this table.
 */
export const CATEGORICAL_PALETTE = [
  '#38bdf8', // sky
  '#a78bfa', // violet
  '#f472b6', // pink
  '#6366f1', // indigo
  '#22d3ee', // cyan
  '#e879f9', // fuchsia
] as const

/** Colour for index `i`. Past the table it keeps to the same blue-to-pink band, stepping by the
 *  golden angle inside that band so neighbours stay distinct, and never strays into a verdict colour. */
export function categoricalColor(i: number): string {
  if (i < CATEGORICAL_PALETTE.length) return CATEGORICAL_PALETTE[i]
  const BAND_START = 200, BAND_WIDTH = 130
  const hue = BAND_START + ((i * 137.508) % BAND_WIDTH)
  return `oklch(0.72 0.15 ${hue.toFixed(1)})`
}
