export type BodyBatteryLabel = 'Charged' | 'Good' | 'Low' | 'Drained'

/**
 * The one colour table for a body-battery level. Two had drifted for the same concept — a
 * continuous `hsl()` ramp keyed on the number (theme-blind, so it ignored the light palette) and a
 * three-token map keyed on the label. The token map wins; the ramp's continuity bought nothing,
 * since both call sites paint a single colour for the whole card.
 *
 * Keyed on the LABEL, not the number, because `/api/body-battery` already computes the band and
 * ships it as `label` — a client re-deriving the 75/50/25 tiers is a second copy of that formula.
 */
export function bodyBatteryColor(label: BodyBatteryLabel): string {
  const band = bodyBatteryBand(label)
  if (band === 'drained') return 'var(--destructive)'
  if (band === 'low') return 'var(--accent-amber)'
  return 'var(--accent-green)'
}

/**
 * The three colour bands the labels fall into: Drained, Low, and Good / Charged together. The rule
 * lives here so an app that paints in theme colours rather than CSS variables (the native app)
 * reads the same bands.
 */
export type BodyBatteryBand = 'drained' | 'low' | 'good'

export function bodyBatteryBand(label: BodyBatteryLabel): BodyBatteryBand {
  if (label === 'Drained') return 'drained'
  if (label === 'Low') return 'low'
  return 'good'
}
