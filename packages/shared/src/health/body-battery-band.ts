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
  if (label === 'Drained') return 'var(--destructive)'
  if (label === 'Low') return 'var(--accent-amber)'
  return 'var(--accent-green)' // Good / Charged
}
