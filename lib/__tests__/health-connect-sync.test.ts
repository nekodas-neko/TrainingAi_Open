import { describe, it, expect } from 'vitest'
import { mapExerciseTypeToActivityType, HC_SYNC_READ_TYPES, HC_ENRICH_READ_TYPES, toLocalDate, hourInTz } from '../health-connect-sync'

describe('mapExerciseTypeToActivityType', () => {
  it('maps known Health Connect exercise types to activity_types slugs', () => {
    expect(mapExerciseTypeToActivityType('EXERCISE_TYPE_WALKING')).toBe('walk')
    expect(mapExerciseTypeToActivityType('EXERCISE_TYPE_RUNNING')).toBe('run')
    expect(mapExerciseTypeToActivityType('EXERCISE_TYPE_RUNNING_TREADMILL')).toBe('run')
    expect(mapExerciseTypeToActivityType('EXERCISE_TYPE_BIKING')).toBe('cycle')
    expect(mapExerciseTypeToActivityType('EXERCISE_TYPE_BIKING_STATIONARY')).toBe('cycle')
    expect(mapExerciseTypeToActivityType('EXERCISE_TYPE_HIKING')).toBe('hike')
    expect(mapExerciseTypeToActivityType('EXERCISE_TYPE_SWIMMING_POOL')).toBe('swim')
    expect(mapExerciseTypeToActivityType('EXERCISE_TYPE_SWIMMING_OPEN_WATER')).toBe('swim')
    expect(mapExerciseTypeToActivityType('EXERCISE_TYPE_YOGA')).toBe('yoga')
    expect(mapExerciseTypeToActivityType('EXERCISE_TYPE_STRETCHING')).toBe('stretch')
    expect(mapExerciseTypeToActivityType('EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING')).toBe('hiit')
  })

  it('falls back to "other" for unrecognized exercise types', () => {
    expect(mapExerciseTypeToActivityType('EXERCISE_TYPE_ROWING_MACHINE')).toBe('other')
    expect(mapExerciseTypeToActivityType('')).toBe('other')
    expect(mapExerciseTypeToActivityType('UNKNOWN')).toBe('other')
  })
})

describe('HC_READ_TYPES parity', () => {
  const syncSet = new Set<string>(HC_SYNC_READ_TYPES)
  const enrichSet = new Set<string>(HC_ENRICH_READ_TYPES)

  it('HC_SYNC_READ_TYPES contains all expected types for full sync', () => {
    const expected = ['Steps', 'Weight', 'ActivitySession', 'SleepSession', 'BodyFat',
      'Nutrition', 'RestingHeartRate', 'OxygenSaturation', 'HeartRateSeries',
      'TotalCaloriesBurned', 'HeartRateVariabilityRmssd']
    for (const t of expected) {
      expect(syncSet.has(t), `HC_SYNC_READ_TYPES missing '${t}'`).toBe(true)
    }
  })

  it('HC_ENRICH_READ_TYPES is a subset of HC_SYNC_READ_TYPES', () => {
    for (const t of enrichSet) {
      expect(syncSet.has(t), `HC_ENRICH_READ_TYPES has '${t}' not in HC_SYNC_READ_TYPES`).toBe(true)
    }
  })

  it('canRead.has checks in syncHealthConnect only use types from HC_SYNC_READ_TYPES', () => {
    // These are the types currently checked via canRead.has() in syncHealthConnect.
    // If a type is added here without being added to HC_SYNC_READ_TYPES, this test fails.
    const checkedTypes = ['Steps', 'Weight', 'BodyFat', 'Nutrition',
      'RestingHeartRate', 'OxygenSaturation', 'ActivitySession', 'SleepSession',
      'TotalCaloriesBurned', 'HeartRateVariabilityRmssd']
    for (const t of checkedTypes) {
      expect(syncSet.has(t), `canRead.has('${t}') but it's not in HC_SYNC_READ_TYPES — add it or remove the check`).toBe(true)
    }
  })
})


describe('TN-44 — Health Connect buckets in the USER\'s timezone, not the device\'s', () => {
  // Both helpers used to resolve the DEVICE zone (`Intl...resolvedOptions().timeZone`,
  // `Date.getHours()`), which is invisible until the phone leaves the zone the data was recorded in.
  //
  // These cases use FIXED-OFFSET zones and an explicit instant, so they fire on every CI run rather
  // than only inside the window where the bug shows — the shape CLAUDE.md's date-arithmetic rule
  // asks for. `Etc/GMT-10` is UTC+10 (the sign is inverted in that namespace, deliberately used
  // here rather than `Australia/Brisbane` so the assertion cannot move with a tz-database update).
  const BRISBANE = 'Etc/GMT-10'   // UTC+10
  const NEW_YORK = 'Etc/GMT+5'    // UTC−5

  it('puts a reading on the day it happened in the user\'s zone', () => {
    // 2026-03-01T18:00Z = 2026-03-02 04:00 at UTC+10, still 2026-03-01 13:00 at UTC−5.
    const iso = '2026-03-01T18:00:00.000Z'
    expect(toLocalDate(iso, BRISBANE)).toBe('2026-03-02')
    expect(toLocalDate(iso, NEW_YORK)).toBe('2026-03-01')
  })

  it('reads the overnight hour in the user\'s zone, so the 00:00–08:00 window keeps its meaning', () => {
    // 2026-03-01T18:00Z is 04:00 for a UTC+10 user — inside the overnight window the HRV and SpO2
    // loops filter on — and 13:00 for a UTC−5 one, which is outside it. Reading the device's clock
    // is what silently empties that window when the phone travels.
    const iso = '2026-03-01T18:00:00.000Z'
    expect(hourInTz(iso, BRISBANE)).toBe(4)
    expect(hourInTz(iso, NEW_YORK)).toBe(13)
  })

  it('keeps midnight on the right side of the boundary', () => {
    // Exactly 00:00 at UTC+10. An off-by-one here is the whole defect class.
    const iso = '2026-03-01T14:00:00.000Z'
    expect(hourInTz(iso, BRISBANE)).toBe(0)
    expect(toLocalDate(iso, BRISBANE)).toBe('2026-03-02')
  })
})
