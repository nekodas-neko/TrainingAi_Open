import { describe, it, expect } from 'vitest'
import { mapExerciseTypeToActivityType, HC_SYNC_READ_TYPES, HC_ENRICH_READ_TYPES, toLocalDate, hourInTz, localDateTimeToIso, syncWindowIso, sessionClockTimes } from '../health-connect-sync'

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
      'TotalCaloriesBurned', 'HeartRateVariabilityRmssd', 'HeartRateSeries']
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


// #2438 — three places built or formatted an instant in a zone other than the user's, which shows only
// when the phone's zone differs from the profile zone (or the user is outside Brisbane). Fixed-offset
// zones and explicit instants, so they fire on every CI run rather than only in the window where the
// bug shows. `Etc/GMT-10` is UTC+10 and `Etc/GMT+5` is UTC-5; the sign is inverted in that namespace.
describe('#2438 — Health Connect builds and formats instants in the USER\'s timezone', () => {
  const BRISBANE = 'Etc/GMT-10'   // UTC+10
  const NEW_YORK = 'Etc/GMT+5'    // UTC-5

  describe('enrichment: a session\'s local date + "HH:MM" becomes the right instant', () => {
    it('reads 07:30 on 2026-03-02 as 21:30Z the day before for a UTC+10 user', () => {
      expect(localDateTimeToIso('2026-03-02', '07:30', BRISBANE)).toBe('2026-03-01T21:30:00.000Z')
    })

    it('reads the same wall time as 12:30Z for a UTC-5 user: the zone is the user\'s, not the device\'s', () => {
      // The old builder used `new Date(y, m - 1, d, h, mi)`, the DEVICE's zone, so both of these
      // returned the same instant on any one phone whatever the profile said.
      expect(localDateTimeToIso('2026-03-02', '07:30', NEW_YORK)).toBe('2026-03-02T12:30:00.000Z')
      expect(localDateTimeToIso('2026-03-02', '07:30', BRISBANE)).not.toBe(localDateTimeToIso('2026-03-02', '07:30', NEW_YORK))
    })

    it('carries an over-midnight end into the next calendar day, across a month end', () => {
      expect(localDateTimeToIso('2026-02-28', '00:20', BRISBANE, 1)).toBe('2026-02-28T14:20:00.000Z')
      expect(localDateTimeToIso('2026-12-31', '00:10', NEW_YORK, 1)).toBe('2027-01-01T05:10:00.000Z')
    })
  })

  describe('the sync window starts and ends at the user\'s local midnight', () => {
    it('is user-local midnight to user-local midnight, so each 24 h aggregate window is one user day', () => {
      const w = syncWindowIso('2026-03-10', 3, BRISBANE)
      expect(w).toEqual({ startIso: '2026-03-07T14:00:00.000Z', endIso: '2026-03-10T14:00:00.000Z' })
      // 3 days of 24 h, ending at the midnight AFTER today.
      expect((Date.parse(w.endIso) - Date.parse(w.startIso)) / 3_600_000).toBe(72)
    })

    it('moves with the user\'s zone, not the phone\'s', () => {
      const bris = syncWindowIso('2026-03-10', 1, BRISBANE)
      const ny = syncWindowIso('2026-03-10', 1, NEW_YORK)
      expect(bris.startIso).toBe('2026-03-09T14:00:00.000Z')
      expect(ny.startIso).toBe('2026-03-10T05:00:00.000Z')
    })

    it('a window of one day is exactly today', () => {
      const w = syncWindowIso('2026-03-10', 1, BRISBANE)
      expect(toLocalDate(w.startIso, BRISBANE)).toBe('2026-03-10')
      expect(toLocalDate(new Date(Date.parse(w.endIso) - 1).toISOString(), BRISBANE)).toBe('2026-03-10')
    })
  })

  describe('exercise sessions are stored with the user\'s clock times', () => {
    // 2026-03-01T21:30Z to 22:15Z is 07:30 to 08:15 on 2026-03-02 for UTC+10 and 16:30 to 17:15
    // on 2026-03-01 for UTC-5.
    const start = '2026-03-01T21:30:00.000Z'
    const end = '2026-03-01T22:15:00.000Z'

    it('formats a UTC+10 user\'s session as 07:30 to 08:15', () => {
      expect(sessionClockTimes(start, end, BRISBANE)).toEqual({ startTime: '07:30', endTime: '08:15' })
    })

    it('formats a UTC-5 user\'s as 16:30 to 17:15, not Brisbane\'s clock', () => {
      // `msToHHMMInTz(r.startTime)` with no zone fell back to Brisbane for everyone.
      expect(sessionClockTimes(start, end, NEW_YORK)).toEqual({ startTime: '16:30', endTime: '17:15' })
    })
  })

  it('stores an enrichment round trip consistently: stored clock time maps back to the session instant', () => {
    const { startTime } = sessionClockTimes('2026-03-01T21:30:00.000Z', '2026-03-01T22:15:00.000Z', NEW_YORK)
    const date = toLocalDate('2026-03-01T21:30:00.000Z', NEW_YORK)
    expect(localDateTimeToIso(date, startTime, NEW_YORK)).toBe('2026-03-01T21:30:00.000Z')
  })
})
