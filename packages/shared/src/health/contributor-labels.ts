// Oura contributor keys → human labels. Keys per the Oura v2 API docs
// (daily_readiness / daily_sleep / daily_activity contributors).
export const CONTRIBUTOR_LABELS: Record<string, string> = {
  activity_balance: 'Activity balance',
  body_temperature: 'Body temperature',
  hrv_balance: 'HRV balance',
  previous_day_activity: 'Previous day activity',
  previous_night: 'Previous night',
  recovery_index: 'Recovery index',
  resting_heart_rate: 'Resting heart rate',
  sleep_balance: 'Sleep balance',
  deep_sleep: 'Deep sleep',
  efficiency: 'Efficiency',
  latency: 'Latency',
  rem_sleep: 'REM sleep',
  restfulness: 'Restfulness',
  timing: 'Timing',
  total_sleep: 'Total sleep',
  meet_daily_targets: 'Meet daily targets',
  move_every_hour: 'Move every hour',
  recovery_time: 'Recovery time',
  stay_active: 'Stay active',
  training_frequency: 'Training frequency',
  training_volume: 'Training volume',
  // The app's OWN readiness composite (`READINESS_WEIGHTS`, readiness-composite.ts). Six of its
  // eight keys are the Oura names in camelCase and resolve through `labelFor`'s fallback; the other
  // two were renamed and do not, and rendered as raw keys until RV-201. Keep this list in step with
  // `READINESS_WEIGHTS`. `checkin` left the composite in #2224 and stays here for the derived rows
  // written before that, which still carry it.
  checkin: 'Morning check-in',
  temperature: 'Body temperature',
  prevDayActivity: 'Previous day activity',
  // RV-217. The sleep model's own three components, which have NO Oura counterpart — Oura's
  // daily_sleep set is exactly the seven snake_case keys above, so `sleepComponentsToContributors`
  // passes these through unmapped by design. They rendered as the raw lowercase keys "hrv", "hr"
  // and "schedule" on the Sleep contributors list, beside seven properly labelled rows. Same
  // shape as the readiness three above, and the same fix.
  hrv: 'HRV',
  hr: 'Heart rate',
  schedule: 'Sleep schedule',
  // Activity Score v2 (own components, 2026-07-22) — camelCase, distinct from the Oura keys above.
  steps: 'Steps',
  activeEnergy: 'Active energy',
  zoneMinutes: 'Zone minutes',
  moveHours: 'Move every hour',
  strengthFreq: 'Training frequency (7d)',
  strengthVolume: 'Training volume (7d)',
}

/** `hrvBalance` → `hrv_balance`. Not applied to a key the map already holds. */
const snakeCase = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()

/**
 * The human label for a contributor key, matching either casing.
 *
 * The map is keyed in Oura's snake_case, and the app's OWN derived row writes the same
 * contributors in camelCase — so `hrvBalance` fell through to the raw key and the readiness
 * insight read "hrvBalance 25/100" (RV-201, found 2026-09-26 alongside the `[object Object]`
 * half of the same defect). An exact hit still wins, so the Activity Score v2 keys below, which
 * are deliberately camelCase and listed as such, are unaffected.
 */
export function labelFor(key: string): string {
  return CONTRIBUTOR_LABELS[key] ?? CONTRIBUTOR_LABELS[snakeCase(key)] ?? key.replace(/_/g, ' ')
}
