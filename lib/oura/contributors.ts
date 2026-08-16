// Oura contributor keys → human labels. Keys per the Oura v2 API docs
// (daily_readiness / daily_sleep / daily_activity contributors).
const CONTRIBUTOR_LABELS: Record<string, string> = {
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
  // Activity Score v2 (own components, 2026-07-22) — camelCase, distinct from the Oura keys above.
  steps: 'Steps',
  activeEnergy: 'Active energy',
  zoneMinutes: 'Zone minutes',
  moveHours: 'Move every hour',
  strengthFreq: 'Training frequency (7d)',
  strengthVolume: 'Training volume (7d)',
}

export function labelFor(key: string): string {
  return CONTRIBUTOR_LABELS[key] ?? key.replace(/_/g, ' ')
}

// "HRV balance 82/100, Resting heart rate 90/100, …" — sorted worst-first so the
// model sees the weak spots without parsing nested JSON.
export function formatContributors(contributors: Record<string, number | null> | null | undefined): string {
  if (!contributors) return 'no contributor data'
  const entries = Object.entries(contributors)
    .filter((e): e is [string, number] => e[1] != null)
    .sort((a, b) => a[1] - b[1])
  if (entries.length === 0) return 'no contributor data'
  return entries.map(([k, v]) => `${labelFor(k)} ${v}/100`).join(', ')
}
