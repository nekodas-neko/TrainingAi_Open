// The Body Battery card's wording, shared by the current app (components/body-battery-card.tsx) and
// the native app (mobile/.../BodyBatteryDetails.tsx, and the Energy hero's origin line) so the two
// cannot drift. Only text lives here;
// layout and colour stay with each app.

/**
 * Q-276 — what question this number answers, always visible. Readiness and Body Battery sit one
 * above the other on Home and correlate weakly by end of day, so a reader takes them for the same
 * thing. The owner settled it: they are different questions, and this line is why the distinction
 * is on screen every day.
 */
export const BODY_BATTERY_EXPLAINER =
  'Energy left right now — opens at your readiness and drains as you use it.'

export const BODY_BATTERY_TREND_LABEL = {
  charging: 'Charging',
  draining: 'Draining',
  steady: 'Steady',
} as const

/** Where the day's starting level came from, as a suffix to "Started at N". */
export function bodyBatteryAnchorSuffix(source: 'readiness' | 'sleep' | 'default'): string {
  if (source === 'readiness') return ' from readiness'
  if (source === 'sleep') return ' from sleep'
  return ''
}

/** The level legitimately moves once today's readiness lands; saying so explains the change. */
export const BODY_BATTERY_PROVISIONAL_SUFFIX = ' · provisional until readiness lands'

/**
 * The sparse-day paragraph, in the three runs around its two figures (sample count, samples an
 * hour) so each app can style the numbers its own way.
 */
export const BODY_BATTERY_SPARSE_DAY = [
  'Your ring recorded only ',
  ' heart-rate readings since you woke — about ',
  " an hour. The ring stops sampling when you are still, so today's line is mostly gaps held flat rather than a measured calm. Treat the number as a rough guide.",
] as const
