// Oura Cloud documents → our rows (#2859): every field the spec provides lands, nothing else does.
import { describe, expect, it } from 'vitest'
import { mapHeartRateRows, mapOuraDocuments, parseOuraDocument, OURA_DOCUMENT_TYPE_NAMES, OURA_ENUMS, type OuraDocument } from '../documents'
import { DAY, FIXTURES, heartRateRows, sleepPeriod, dailyActivity } from './fixtures'

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
      'readinessScore', 'temperatureDeviation', 'temperatureTrendDeviation',
      'sleepScore',
      'activityScore', 'activeCalories', 'totalCalories', 'equivalentWalkingDistance', 'highActivityTimeSec',
      'mediumActivityTimeSec', 'lowActivityTimeSec', 'sedentaryTimeSec', 'restingTimeSec', 'nonWearTimeSec',
      'avgMetMinutes', 'highActivityMetMinutes', 'mediumActivityMetMinutes', 'lowActivityMetMinutes',
      'breathingDisturbanceIndex', 'stressHigh', 'recoveryHigh', 'resilienceLevel', 'resilienceContributors',
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

  // #2895 review, item 7: until #2860 these would replace our own on the Sleep and Activity screens.
  // #2982 keeps them, in `oura_cloud_daily`, as Oura's reference (only readiness's feeds an input, #2984).
  it('keeps Oura\'s contributors and the stress day summary out of oura_daily, in oura_cloud_daily', () => {
    const { daily, cloudDaily } = mapOuraDocuments(all())
    for (const k of ['readinessContributors', 'sleepContributors', 'activityContributors', 'daySummary'] as const) {
      expect(daily[0][k], k).toBeUndefined()
    }
    expect(cloudDaily).toHaveLength(1)
    expect(cloudDaily[0]).toMatchObject({
      date: DAY,
      readinessContributors: FIXTURES.daily_readiness.contributors,
      sleepContributors: FIXTURES.daily_sleep.contributors,
      activityContributors: FIXTURES.daily_activity.contributors,
      daySummary: 'normal',
    })
  })

  // #2982: every field this batch reads lands non-null from a spec-shaped document.
  it('maps every new daily_activity field, with the MET series\' own interval', () => {
    const [row] = mapOuraDocuments(all()).cloudDaily
    for (const k of ['met', 'class5Min', 'inactivityAlerts', 'sedentaryMetMinutes', 'targetCalories', 'targetMeters', 'metersToTarget'] as const) {
      expect(row[k], k).not.toBeNull()
      expect(row[k], k).not.toBeUndefined()
    }
    expect(row.met).toEqual({ interval: 60, items: [1.2, null, 3.5], timestamp: `${DAY}T04:00:00+10:00` })
    expect(row).toMatchObject({ class5Min: '0123345', inactivityAlerts: 1, sedentaryMetMinutes: 10, targetCalories: 500, targetMeters: 10000, metersToTarget: 1200 })
  })

  it('maps every new sleep-period field, reading each series\' own interval', () => {
    const { sleepPeriods } = mapOuraDocuments(all())
    expect(sleepPeriods).toHaveLength(1)
    const p = sleepPeriods[0]
    for (const k of Object.keys(p) as (keyof typeof p)[]) expect(p[k], k).not.toBeNull()
    expect(p).toMatchObject({
      ouraId: 'sl-1', day: DAY, sleepType: 'long_sleep', sleepPhase30Sec: '4422113', movement30Sec: '1121341',
      sleepAlgorithmVersion: 'v2', lowBatteryAlert: false, sleepAnalysisReason: 'foreground_sleep_analysis', period: 0, ringId: 'ring-enc-1',
    })
    expect(p.heartRate?.interval).toBe(300)
    expect(p.hrv?.interval).toBe(600)
    expect(p.heartRate?.items).toEqual([58, null, 52.5])
  })

  it('maps a session with its series and mood', () => {
    const { sessions } = mapOuraDocuments(all())
    expect(sessions).toEqual([{
      ouraId: 'se-1', day: DAY, sessionType: 'breathing', mood: 'good',
      startDatetime: new Date('2026-10-10T02:00:00.000Z'), endDatetime: new Date('2026-10-10T02:10:00.000Z'),
      heartRate: FIXTURES.session.heart_rate, heartRateVariability: FIXTURES.session.heart_rate_variability, motionCount: FIXTURES.session.motion_count,
    }])
  })

  it('reads an off-spec value in a new field as null, without dropping a document that parsed before', () => {
    const sleep = parseOuraDocument('sleep', {
      ...sleepPeriod, heart_rate: { interval: 'five minutes', items: [] }, sleep_phase_30_sec: '4x', sleep_algorithm_version: 'v9',
    })
    expect(sleep).not.toBeNull()
    const { sleep: nights, sleepPeriods } = mapOuraDocuments([sleep!])
    expect(nights).toHaveLength(1)
    expect(sleepPeriods[0]).toMatchObject({ heartRate: null, sleepPhase30Sec: null, sleepAlgorithmVersion: null, hrv: sleepPeriod.hrv })
    const activity = parseOuraDocument('daily_activity', { ...dailyActivity, met: null, class_5_min: '9', inactivity_alerts: 'one' })
    expect(activity).not.toBeNull()
    expect(mapOuraDocuments([activity!]).cloudDaily[0]).toMatchObject({ met: null, class5Min: null, inactivityAlerts: null })
  })

  // #3080: HRV and resting HR are set after the write, from the day's main period among every stored
  // one (`syncOuraMainSleepBodyMetrics`, tested against Postgres), never from one batch's documents.
  it('writes body metrics from activity and SpO2, and leaves the sleep vitals to the main-period sync', () => {
    const { body } = mapOuraDocuments(all())
    expect(body).toEqual([{ date: DAY, steps: 9123, activeCalories: 512, spo2Pct: 96.4 }])
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
      label: 'Morning run',
      startDatetime: new Date('2026-10-09T21:00:00.000Z'), endDatetime: new Date('2026-10-09T21:40:00.000Z'),
    }])
  })

  // #3033: v1.42's two live-heart-rate sources dropped the whole workout while we read v1.34's four.
  it.each(['live_third_party_heart_rate', 'live_oura_heart_rate'])('parses and maps a workout whose source is %s', source => {
    const doc = parseOuraDocument('workout', { ...FIXTURES.workout, source })
    expect(doc).not.toBeNull()
    expect(mapOuraDocuments([doc!]).workouts).toMatchObject([{ id: 'wo-1', activity: 'running', source }])
  })

  it('keeps a workout whose source is not in the spec, or missing, with a null source', () => {
    for (const raw of [{ ...FIXTURES.workout, source: 'some_future_source' }, { ...FIXTURES.workout, source: null }, { ...FIXTURES.workout, source: undefined }]) {
      const doc = parseOuraDocument('workout', raw)
      expect(doc).not.toBeNull()
      expect(mapOuraDocuments([doc!]).workouts).toMatchObject([{ id: 'wo-1', calories: 420.5, label: 'Morning run', source: null }])
    }
  })

  it('still drops a workout that breaks a field we cannot do without', () => {
    expect(parseOuraDocument('workout', { ...FIXTURES.workout, start_datetime: 'this morning' })).toBeNull()
    // #3081: a new intensity is a value, not a broken field (see the unknown-values tests); a number is.
    expect(parseOuraDocument('workout', { ...FIXTURES.workout, intensity: 3 })).toBeNull()
  })

  it('lists a deleted period for a tombstone and skips a rest period', () => {
    const deleted = parseOuraDocument('sleep', { ...sleepPeriod, id: 'gone', type: 'deleted' })!
    const rest = parseOuraDocument('sleep', { ...sleepPeriod, id: 'rest', type: 'rest' })!
    const out = mapOuraDocuments([deleted, rest])
    expect(out.deletedSleepIds).toEqual(['gone'])
    expect(out.sleep).toEqual([])
    // Both keep their period detail, with the type that says what they are (#2982).
    expect(out.sleepPeriods.map(p => [p.ouraId, p.sleepType])).toEqual([['gone', 'deleted'], ['rest', 'rest']])
  })

  it('lists a period Oura retyped to rest for a tombstone that keeps its type, never as sleep (#3080)', () => {
    const rest = parseOuraDocument('sleep', { ...sleepPeriod, id: 'r-1', type: 'rest' })!
    const out = mapOuraDocuments([rest])
    expect(out.sleep).toEqual([])
    expect(out.retypedSleepIds).toEqual(['r-1'])
    expect(out.deletedSleepIds).toEqual([])
    expect(out.sleepPeriods.map(p => p.sleepType)).toEqual(['rest'])
  })

  it('drops a document that is not the spec\'s shape rather than storing half of it', () => {
    expect(parseOuraDocument('daily_stress', { id: 'x', day: DAY, day_summary: 3 })).toBeNull()
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

  it('maps heart-rate rows with Oura\'s label as context, and drops implausible bpm', () => {
    const rows = [...heartRateRows, { timestamp: '2026-10-10T00:10:00+00:00', timestamp_unix: 0, bpm: 0, source: 'awake' as const }]
    expect(mapHeartRateRows(rows.map(r => ({ ...r, source: r.source as 'awake' })))).toEqual([
      { timestamp: new Date('2026-10-10T00:00:00Z'), bpm: 61, context: 'awake' },
      { timestamp: new Date('2026-10-10T00:05:00Z'), bpm: 64, context: 'awake' },
    ])
  })
})

// #3081 (same class as #3033): a value Oura adds to an enum keeps its document, is stored as null
// (a sleep type as sent), and is counted for the ingest's report. Each new or unknown value below is
// a fixture of its own, so one field cannot pass for another.
describe('Oura documents with a value the pinned spec does not list (#3081)', () => {
  const NEW = 'a_value_oura_added'
  const parse = (t: Parameters<typeof parseOuraDocument>[0], over: Record<string, unknown>) => {
    const doc = parseOuraDocument(t, { ...FIXTURES[t], ...over })
    expect(doc, `${t} kept`).not.toBeNull()
    return doc!
  }

  it("stores v1.42's two new sleep analysis reasons, uncounted", () => {
    for (const reason of ['background_sleep_analysis', 'background_created_foreground_updated']) {
      const out = mapOuraDocuments([parse('sleep', { sleep_analysis_reason: reason })])
      expect(out.sleepPeriods[0].sleepAnalysisReason).toBe(reason)
      expect(out.unknownValues).toEqual({})
    }
  })

  it.each([
    ['daily_stress', 'day_summary', 'daily_stress.day_summary', (o: ReturnType<typeof mapOuraDocuments>) => o.cloudDaily[0].daySummary],
    ['daily_resilience', 'level', 'daily_resilience.level', (o: ReturnType<typeof mapOuraDocuments>) => o.daily[0].resilienceLevel],
    ['workout', 'intensity', 'workout.intensity', (o: ReturnType<typeof mapOuraDocuments>) => o.workouts[0].intensity],
    ['workout', 'source', 'workout.source', (o: ReturnType<typeof mapOuraDocuments>) => o.workouts[0].source],
    ['session', 'type', 'session.type', (o: ReturnType<typeof mapOuraDocuments>) => o.sessions[0].sessionType],
    ['session', 'mood', 'session.mood', (o: ReturnType<typeof mapOuraDocuments>) => o.sessions[0].mood],
    ['sleep', 'sleep_analysis_reason', 'sleep.sleep_analysis_reason', (o: ReturnType<typeof mapOuraDocuments>) => o.sleepPeriods[0].sleepAnalysisReason],
    ['sleep', 'sleep_algorithm_version', 'sleep.sleep_algorithm_version', (o: ReturnType<typeof mapOuraDocuments>) => o.sleepPeriods[0].sleepAlgorithmVersion],
  ] as const)('keeps a %s with a new %s, stores it as null and counts it', (type, field, key, read) => {
    const out = mapOuraDocuments([parse(type, { [field]: NEW })])
    expect(read(out)).toBeNull()
    expect(out.unknownValues).toEqual({ [key]: 1 })
    // A value the spec lists is kept and not counted.
    const listed = OURA_ENUMS[key][0]
    const ok = mapOuraDocuments([parse(type, { [field]: listed })])
    expect(read(ok)).toBe(listed)
    expect(ok.unknownValues).toEqual({})
  })

  it('counts per field across a batch', () => {
    const out = mapOuraDocuments([
      parse('workout', { id: 'w1', intensity: NEW }), parse('workout', { id: 'w2', intensity: NEW }),
      parse('session', { id: 's1', type: NEW }),
    ])
    expect(out.workouts).toHaveLength(2)
    expect(out.sessions).toHaveLength(1)
    expect(out.unknownValues).toEqual({ 'workout.intensity': 2, 'session.type': 1 })
  })

  // The exception: a sleep type is stored as sent and the period is written, but it is never the night.
  it('keeps a sleep period with a new type: stored raw, written as a period, never removed', () => {
    const out = mapOuraDocuments([parse('sleep', { type: NEW })])
    expect(out.sleepPeriods.map(p => p.sleepType)).toEqual([NEW])
    expect(out.sleep.map(r => r.ouraId)).toEqual([sleepPeriod.id])
    expect(out.deletedSleepIds).toEqual([])
    expect(out.retypedSleepIds).toEqual([])
    expect(out.unknownValues).toEqual({ 'sleep.type': 1 })
  })

  it('still drops a document whose enum field is not a string at all', () => {
    expect(parseOuraDocument('sleep', { ...sleepPeriod, type: 7 })).toBeNull()
    expect(parseOuraDocument('daily_resilience', { ...FIXTURES.daily_resilience, level: null })).toBeNull()
  })
})
