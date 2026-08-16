import { describe, it, expect } from 'vitest'
import { mapExerciseTypeToActivityType, HC_SYNC_READ_TYPES, HC_ENRICH_READ_TYPES } from '../health-connect-sync'

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
