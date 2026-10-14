// Oura Cloud documents → our rows (#2859): every field the spec provides lands, nothing else does.
import { describe, expect, it } from 'vitest'
import { mapHeartRateRows, mapOuraDocuments, parseOuraDocument, OURA_DOCUMENT_TYPE_NAMES, type OuraDocument } from '../documents'
import { DAY, FIXTURES, heartRateRows, sleepPeriod } from './fixtures'

const all = (): OuraDocument[] => OURA_DOCUMENT_TYPE_NAMES.map(t => {
  const doc = parseOuraDocument(t, FIXTURES[t])
  if (!doc) throw new Error(`fixture for ${t} does not parse`)
  return doc
})

describe('Oura Cloud document mapping (#2859)', () => {
  it('parses every stored type from a spec-shaped document', () => {
    expect(all()).toHaveLength(OURA_DOCUMENT_TYPE_NAMES.length)
  })

  it('folds one day of daily documents into one oura_daily row with every field set', () => {
    const { daily } = mapOuraDocuments(all())
    expect(daily).toHaveLength(1)
    const row = daily[0]
    expect(row.date).toBe(DAY)
    const expected = [
      'readinessScore', 'temperatureDeviation', 'temperatureTrendDeviation', 'readinessContributors',
      'sleepScore', 'sleepContributors',
      'activityScore', 'activeCalories', 'totalCalories', 'equivalentWalkingDistance', 'highActivityTimeSec',
      'mediumActivityTimeSec', 'lowActivityTimeSec', 'sedentaryTimeSec', 'restingTimeSec', 'nonWearTimeSec',
      'avgMetMinutes', 'highActivityMetMinutes', 'mediumActivityMetMinutes', 'lowActivityMetMinutes', 'activityContributors',
      'breathingDisturbanceIndex', 'stressHigh', 'recoveryHigh', 'daySummary', 'resilienceLevel', 'resilienceContributors',
      'vascularAge', 'pulseWaveVelocity', 'vo2Max',
    ] as const
    for (const k of expected) expect(row[k], k).not.toBeNull()
    for (const k of expected) expect(row[k], k).not.toBeUndefined()
    // Seconds, as the spec says, not minutes.
    expect(row.stressHigh).toBe(5400)
    expect(row.highActivityTimeSec).toBe(1200)
    // sleep_time is not read in part 2, so its columns stay absent and the merge keeps what is stored.
    expect(row.recommendedBedtimeStart).toBeUndefined()
  })

  it('writes body metrics from activity, SpO2 and the main sleep', () => {
    const { body } = mapOuraDocuments(all())
    expect(body).toEqual([{ date: DAY, steps: 9123, activeCalories: 512, spo2Pct: 96.4, hrvMs: 62, restingHeartRate: 47 }])
  })

  it('maps a sleep period with every duration in hours and keeps Oura\'s id', () => {
    const { sleep } = mapOuraDocuments(all())
    expect(sleep).toHaveLength(1)
    const s = sleep[0]
    expect(s.ouraId).toBe('sl-1')
    expect(s.date).toBe(DAY)
    expect(s.sleepStart.toISOString()).toBe('2026-10-09T12:30:00.000Z')
    expect(s.sleepEnd.toISOString()).toBe('2026-10-09T20:30:00.000Z')
    expect(s.durationHours).toBeCloseTo(7.25)
    expect(s.deepSleepHours).toBe(1.5)
    expect(s.remSleepHours).toBe(2)
    expect(s.lightSleepHours).toBe(3.75)
    expect(s.awakHours).toBe(0.75)
    expect(s.timeInBedHours).toBe(8)
    for (const k of ['efficiency', 'onsetLatencySec', 'averageHrvMs', 'avgHeartRate', 'lowestHeartRate', 'restlessPeriods', 'respiratoryRate', 'sleepPhase5Min'] as const) {
      expect(s[k], k).not.toBeNull()
    }
    // A sleep period carries no score of its own; the day's score comes from daily_sleep.
    expect(s.sleepScore).toBeUndefined()
  })

  it('maps a workout', () => {
    const { workouts } = mapOuraDocuments(all())
    expect(workouts).toEqual([{
      id: 'wo-1', day: DAY, activity: 'running', calories: 420.5, distanceM: 6012.3, intensity: 'moderate', source: 'autodetected',
      startDatetime: new Date('2026-10-09T21:00:00.000Z'), endDatetime: new Date('2026-10-09T21:40:00.000Z'),
    }])
  })

  it('lists a deleted period for a tombstone and skips a rest period', () => {
    const deleted = parseOuraDocument('sleep', { ...sleepPeriod, id: 'gone', type: 'deleted' })!
    const rest = parseOuraDocument('sleep', { ...sleepPeriod, id: 'rest', type: 'rest' })!
    const out = mapOuraDocuments([deleted, rest])
    expect(out.deletedSleepIds).toEqual(['gone'])
    expect(out.sleep).toEqual([])
  })

  it('takes the longest long_sleep of a day for HRV and resting HR, never a nap', () => {
    const nap = parseOuraDocument('sleep', { ...sleepPeriod, id: 'nap', type: 'late_nap', average_hrv: 99, lowest_heart_rate: 40, total_sleep_duration: 99999 })!
    const night = parseOuraDocument('sleep', sleepPeriod)!
    const { body, sleep } = mapOuraDocuments([nap, night])
    expect(sleep.map(s => s.ouraId).sort()).toEqual(['nap', 'sl-1'])
    expect(body[0]).toMatchObject({ hrvMs: 62, restingHeartRate: 47 })
  })

  it('drops a document that is not the spec\'s shape rather than storing half of it', () => {
    expect(parseOuraDocument('daily_stress', { id: 'x', day: DAY, day_summary: 'very_stressful' })).toBeNull()
    expect(parseOuraDocument('daily_activity', { id: 'x', day: DAY })).toBeNull()
    expect(parseOuraDocument('sleep', { ...sleepPeriod, bedtime_start: 'yesterday' })).toBeNull()
    expect(parseOuraDocument('daily_readiness', { ...FIXTURES.daily_readiness, day: '10/10/2026' })).toBeNull()
    expect(parseOuraDocument('daily_readiness', { ...FIXTURES.daily_readiness, day: '2026-02-31' })).toBeNull()
    // Either separator is a day; it is stored in the dash form.
    expect(parseOuraDocument('daily_readiness', { ...FIXTURES.daily_readiness, day: '2026/10/10' })?.doc.day).toBe(DAY)
  })

  it('keeps a null the spec allows as null, so the merge keeps the stored value', () => {
    const doc = parseOuraDocument('daily_readiness', { ...FIXTURES.daily_readiness, score: null, temperature_deviation: null })!
    const { daily } = mapOuraDocuments([doc])
    expect(daily[0].readinessScore).toBeNull()
    expect(daily[0].temperatureDeviation).toBeNull()
  })

  it('maps heart-rate rows and drops implausible bpm', () => {
    const rows = [...heartRateRows, { timestamp: '2026-10-10T00:10:00+00:00', timestamp_unix: 0, bpm: 0, source: 'awake' as const }]
    expect(mapHeartRateRows(rows.map(r => ({ ...r, source: r.source as 'awake' })))).toEqual([
      { timestamp: new Date('2026-10-10T00:00:00Z'), bpm: 61 },
      { timestamp: new Date('2026-10-10T00:05:00Z'), bpm: 64 },
    ])
  })
})
