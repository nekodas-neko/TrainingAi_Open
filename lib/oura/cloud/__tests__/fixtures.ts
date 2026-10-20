// Oura Cloud documents shaped exactly as the pinned spec's models (#2859), with every field we store
// set to a non-null value, so a test can prove each one lands. The spec ships no response examples,
// so these follow `components.schemas` in `.claude/skills/oura-api/references/openapi-v1.34.json`
// field for field (names, types and enums).

export const OURA_USER = 'oura-user-2859'
export const DAY = '2026-10-10'

export const dailyReadiness = {
  id: 'rd-1', day: DAY, score: 82, timestamp: `${DAY}T00:00:00+10:00`,
  temperature_deviation: -0.12, temperature_trend_deviation: 0.05,
  contributors: {
    activity_balance: 80, body_temperature: 95, hrv_balance: 74, previous_day_activity: 88,
    previous_night: 79, recovery_index: 90, resting_heart_rate: 85, sleep_balance: 77, sleep_regularity: 70,
  },
}

export const dailySleep = {
  id: 'ds-1', day: DAY, score: 78, timestamp: `${DAY}T00:00:00+10:00`,
  contributors: { deep_sleep: 70, efficiency: 88, latency: 90, rem_sleep: 66, restfulness: 72, timing: 85, total_sleep: 80 },
}

export const dailyActivity = {
  id: 'da-1', day: DAY, score: 74, timestamp: `${DAY}T04:00:00+10:00`,
  active_calories: 512, average_met_minutes: 1.6, class_5_min: '0123345',
  contributors: { meet_daily_targets: 60, move_every_hour: 95, recovery_time: 100, stay_active: 70, training_frequency: 80, training_volume: 90 },
  equivalent_walking_distance: 9800, high_activity_met_minutes: 30, high_activity_time: 1200, inactivity_alerts: 1,
  low_activity_met_minutes: 210, low_activity_time: 14400, medium_activity_met_minutes: 120, medium_activity_time: 2700,
  met: { interval: 60, items: [1.2, null, 3.5], timestamp: `${DAY}T04:00:00+10:00` }, meters_to_target: 1200, non_wear_time: 1800,
  resting_time: 28800, sedentary_met_minutes: 10, sedentary_time: 30000, steps: 9123, target_calories: 500,
  target_meters: 10000, total_calories: 2650,
}

export const dailySpo2 = { id: 'sp-1', day: DAY, breathing_disturbance_index: 4, spo2_percentage: { average: 96.4 } }

export const dailyStress = { id: 'st-1', day: DAY, stress_high: 5400, recovery_high: 7200, day_summary: 'normal' }

export const dailyResilience = {
  id: 'rs-1', day: DAY, level: 'solid', contributors: { sleep_recovery: 70.5, daytime_recovery: 55.2, stress: 61 },
}

export const dailyCardiovascularAge = { id: 'ca-1', day: DAY, vascular_age: 34, pulse_wave_velocity: 6.8 }

export const vo2Max = { id: 'vo-1', day: DAY, timestamp: `${DAY}T06:00:00+10:00`, vo2_max: 47 }
/** `PublicSleepTime`: a window from 22:15 to 23:00 the night before, as seconds from local midnight. */
export const sleepTime = {
  id: 'st-1', day: DAY,
  optimal_bedtime: { day_tz: 36000, start_offset: -6300, end_offset: -3600 },
  recommendation: 'follow_optimal_bedtime', status: 'optimal_found',
}

export const sleepPeriod = {
  id: 'sl-1', day: DAY, type: 'long_sleep', period: 0, low_battery_alert: false,
  bedtime_start: '2026-10-09T22:30:00+10:00', bedtime_end: '2026-10-10T06:30:00+10:00',
  time_in_bed: 28800, total_sleep_duration: 26100, awake_time: 2700, light_sleep_duration: 13500,
  deep_sleep_duration: 5400, rem_sleep_duration: 7200, efficiency: 91, latency: 600,
  average_heart_rate: 54.3, lowest_heart_rate: 47, average_hrv: 62, average_breath: 14.6, restless_periods: 180,
  sleep_phase_5_min: '4422113',
  // Each series carries its own interval; these differ on purpose.
  heart_rate: { interval: 300, items: [58, null, 52.5], timestamp: '2026-10-09T22:30:00+10:00' },
  hrv: { interval: 600, items: [48, 61], timestamp: '2026-10-09T22:30:00+10:00' },
  movement_30_sec: '1121341', readiness: null, readiness_score_delta: null, sleep_algorithm_version: 'v2',
  sleep_analysis_reason: 'foreground_sleep_analysis', sleep_phase_30_sec: '4422113', sleep_score_delta: null,
  ring_id: 'ring-enc-1', app_sleep_phase_5_min: null,
}

export const workout = {
  id: 'wo-1', day: DAY, activity: 'running', calories: 420.5, distance: 6012.3, intensity: 'moderate',
  label: 'Morning run', source: 'autodetected', start_datetime: '2026-10-10T07:00:00+10:00', end_datetime: '2026-10-10T07:40:00+10:00',
}

export const session = {
  id: 'se-1', day: DAY, type: 'breathing', mood: 'good',
  start_datetime: '2026-10-10T12:00:00+10:00', end_datetime: '2026-10-10T12:10:00+10:00',
  heart_rate: { interval: 5, items: [66, 64, null], timestamp: '2026-10-10T12:00:00+10:00' },
  heart_rate_variability: { interval: 5, items: [40, 44], timestamp: '2026-10-10T12:00:00+10:00' },
  motion_count: { interval: 5, items: [0, 1], timestamp: '2026-10-10T12:00:00+10:00' },
}

export const heartRateRows = [
  { timestamp: '2026-10-10T00:00:00+00:00', timestamp_unix: 1791936000, bpm: 61, source: 'awake' },
  { timestamp: '2026-10-10T00:05:00+00:00', timestamp_unix: 1791936300, bpm: 64, source: 'awake' },
]

/** Every stored document type, by the webhook's `data_type`, with its fixture. */
export const FIXTURES = {
  daily_readiness: dailyReadiness,
  daily_sleep: dailySleep,
  daily_activity: dailyActivity,
  daily_spo2: dailySpo2,
  daily_stress: dailyStress,
  daily_resilience: dailyResilience,
  daily_cardiovascular_age: dailyCardiovascularAge,
  vo2_max: vo2Max,
  sleep_time: sleepTime,
  sleep: sleepPeriod,
  workout,
  session,
} as const

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
