import { describe, expect, it } from 'vitest'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import {
  MIN_FIT_DAYS, buildTuneReport, fitAgainst, fitSimplexWeights, formatTuneReport, type FitRow, type TuneInput,
} from '../tuning/tune-against-oura-report'

/**
 * #2986. Every number here is synthetic: the tool reads the owner's health data, and nothing of it
 * belongs in the repo.
 */

function prng(seed: number) {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SLEEP_KEYS = ['deep_sleep', 'efficiency', 'latency', 'rem_sleep', 'restfulness', 'timing', 'total_sleep']
const SLEEP_TRUE = [0.10, 0.10, 0.10, 0.10, 0.15, 0.10, 0.35]
const TZ = 'Australia/Brisbane'
const FROM = '2026-10-01'

/** A night in Brisbane: 22:30 the evening before `wake` to 06:30 on `wake` (UTC+10). */
const night = (wake: string, shiftHours = 0) => {
  const prev = shiftDateStr(wake, -1)
  const start = new Date(`${prev}T12:30:00Z`)
  start.setUTCHours(start.getUTCHours() + shiftHours)
  return { start, end: new Date(start.getTime() + 8 * 3_600_000) }
}

/** `days` days of fully paired synthetic data, with Oura's sleep score a known blend of its contributors. */
function fixture(days: number, seed = 1): TuneInput {
  const rnd = prng(seed)
  const dates = Array.from({ length: days }, (_, i) => shiftDateStr(FROM, i))
  const input: TuneInput = {
    tz: TZ, from: FROM, to: dates[dates.length - 1],
    ouraDaily: [], ouraCloudDaily: [], ouraSleepPeriods: [], sleepSessions: [], derived: [], shadow: [],
  }
  for (const d of dates) {
    const contrib = Object.fromEntries(SLEEP_KEYS.map(k => [k, 50 + Math.round(rnd() * 50)]))
    const sleepScore = SLEEP_KEYS.reduce((s, k, i) => s + contrib[k] * SLEEP_TRUE[i], 0)
    const readiness = 55 + rnd() * 40
    const activity = 50 + rnd() * 45
    input.ouraDaily.push({
      date: d, readinessScore: readiness, sleepScore, activityScore: activity,
      sourceMap: { readiness_score: 'oura_cloud', sleep_score: 'oura_cloud', activity_score: 'oura_cloud' },
    })
    input.ouraCloudDaily.push({
      date: d, sleepContributors: contrib,
      readinessContributors: { hrv_balance: 60 + rnd() * 30, resting_heart_rate: 70 + rnd() * 25 },
      activityContributors: { stay_active: 60 + rnd() * 30 },
    })
    const n = night(d)
    input.ouraSleepPeriods.push({ day: d, bedtimeStart: n.start, bedtimeEnd: n.end, sleepType: 'long_sleep' })
    input.sleepSessions.push({ date: d, sleepStart: n.start, sleepEnd: n.end, durationHours: 7.5 })
    input.derived.push({ day: d, sleepScore: sleepScore - 3, sleepContributors: contrib, readinessScore: readiness + 2, readinessContributors: null })
    input.shadow.push({
      date: d, modelVersion: 3, shadowReadiness: readiness + 1, sleepPillar: sleepScore + 4,
      heartPillar: 70, activityPillar: 75, bodyPillar: 80,
      units: {
        'sleep.duration': { score: 90 }, 'sleep.efficiency': { score: contrib.efficiency },
        'activity.yesterday_load': { score: 80, daytimeThrough: shiftDateStr(d, -1) },
      },
    })
  }
  return input
}

describe('fitSimplexWeights', () => {
  it('recovers known non-negative weights that sum to 1', () => {
    const rnd = prng(7)
    const truth = [0.4, 0.3, 0.2, 0.1, 0]
    const X = Array.from({ length: 40 }, () => truth.map(() => 40 + rnd() * 60))
    const y = X.map(r => r.reduce((s, x, j) => s + x * truth[j], 0) + (rnd() - 0.5))
    const fit = fitSimplexWeights(X, y)
    fit.weights.forEach((w, j) => expect(w).toBeCloseTo(truth[j], 1))
    expect(fit.weights.every(w => w >= 0)).toBe(true)
    expect(fit.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
    expect(fit.r2!).toBeGreaterThan(0.95)
  })
})

describe('fitAgainst', () => {
  const rows = (n: number): FitRow[] => Array.from({ length: n }, (_, i) => ({ date: shiftDateStr(FROM, i), target: 60 + i, features: { a: 60 + i, b: 50 } }))

  it(`reports fewer than ${MIN_FIT_DAYS} days as not yet meaningful, with no weights`, () => {
    const fit = fitAgainst('x', rows(MIN_FIT_DAYS - 1))
    expect(fit.meaningful).toBe(false)
    expect(fit.weights).toBeNull()
    expect(fit.daysUsed).toBe(MIN_FIT_DAYS - 1)
    const report = buildTuneReport(fixture(MIN_FIT_DAYS - 1))
    const text = formatTuneReport(report).join('\n')
    expect(text).toContain(`not yet meaningful: ${MIN_FIT_DAYS - 1} paired days, a fit needs ${MIN_FIT_DAYS}`)
    expect(report.ouraFits.every(f => !f.meaningful)).toBe(true)
  })

  it('fits at exactly the threshold', () => {
    expect(fitAgainst('x', rows(MIN_FIT_DAYS)).meaningful).toBe(true)
  })

  it('leaves out an input missing on most days and counts the days it drops', () => {
    const r: FitRow[] = rows(20).map((row, i) => ({ ...row, features: { ...row.features!, c: i < 5 ? 70 : null } }))
    r[3] = { ...r[3], features: { ...r[3].features!, b: null } }
    r[4] = { ...r[4], target: null }
    const fit = fitAgainst('x', r, { a: 3, b: 1, c: 1 })
    expect(fit.droppedInputs).toEqual([{ name: 'c', missingDays: 15 }])
    expect(fit.dropped).toEqual({ 'no Oura score': 1, 'an input missing': 1 })
    expect(fit.daysUsed).toBe(18)
    expect(fit.weights!.find(w => w.name === 'a')!.ours).toBeCloseTo(0.75, 9)
  })
})

describe('buildTuneReport', () => {
  it('recovers Oura\'s sleep weights from its own contributors', () => {
    const fit = buildTuneReport(fixture(30)).ouraFits[1]
    expect(fit.meaningful).toBe(true)
    expect(fit.daysUsed).toBe(30)
    for (const [i, k] of SLEEP_KEYS.entries()) {
      expect(fit.weights!.find(w => w.name === k)!.fitted).toBeCloseTo(SLEEP_TRUE[i], 2)
    }
    expect(fit.r2!).toBeGreaterThan(0.999)
  })

  it('counts an Oura score our rollup wrote as not Oura\'s in the contributor fit too', () => {
    const input = fixture(20)
    input.ouraDaily[0].sourceMap = { sleep_score: 'oura_ble' }
    const fit = buildTuneReport(input).ouraFits[1]
    expect(fit.dropped).toEqual({ 'score not from Oura': 1 })
    expect(fit.daysUsed).toBe(19)
  })

  it('keeps a real provisional recovery index in the readiness fit and drops the neutral fallbacks', () => {
    const input = fixture(20)
    const rnd = prng(3)
    for (const [i, row] of input.derived.entries()) {
      const hrv = 50 + rnd() * 40
      const ri = 50 + rnd() * 40
      // Real Oura readiness as a known blend of the two inputs that have values.
      input.ouraDaily[i].readinessScore = 0.7 * hrv + 0.3 * ri
      row.readinessScore = 70
      row.readinessContributors = {
        hrvBalance: { score: hrv, provisional: false, input: 0.4, gap: null },
        // Scored, but provisional: Oura's contributor (#2984) on even days, the hours curve on odd.
        recoveryIndex: i % 2 === 0
          ? { score: ri, provisional: true, input: ri, gap: null, scale: 'oura_contributor' }
          : { score: ri, provisional: true, input: 5.5, gap: null },
        temperature: { score: 50, provisional: true, input: null, gap: 'no_input' },
        sleepBalance: { score: 50, provisional: true, input: null, gap: 'awaiting_baseline' },
        // A row written before `gap` existed: no input means the neutral fallback.
        restingHeartRate: { score: 50, provisional: true, input: null },
      }
    }
    const fit = buildTuneReport(input).ourFits[2]
    expect(fit.meaningful).toBe(true)
    expect(fit.daysUsed).toBe(20)
    expect(fit.weights!.map(w => w.name).sort()).toEqual(['hrvBalance', 'recoveryIndex'])
    expect(fit.weights!.find(w => w.name === 'recoveryIndex')!.fitted).toBeCloseTo(0.3, 2)
    expect(fit.droppedInputs.map(d => d.name)).toEqual(expect.arrayContaining(['temperature', 'sleepBalance', 'restingHeartRate']))
  })

  it('pairs a fully matched range and reports the difference', () => {
    const [sleepPillar, sleepScore, readiness] = buildTuneReport(fixture(20)).comparisons
    expect(sleepPillar.summary.n).toBe(20)
    expect(sleepPillar.summary.meanDiff).toBeCloseTo(4, 9)
    expect(sleepPillar.summary.sdDiff).toBeCloseTo(0, 9)
    expect(sleepPillar.summary.rho).toBeCloseTo(1, 9)
    expect(sleepScore.summary.meanDiff).toBeCloseTo(-3, 9)
    expect(readiness.summary.meanDiff).toBeCloseTo(2, 9)
  })

  it('drops and counts a day missing either side, or read from different nights', () => {
    const input = fixture(20)
    const d = (i: number) => shiftDateStr(FROM, i)
    input.shadow = input.shadow.filter(s => s.date !== d(2))                     // no row of ours
    input.ouraDaily = input.ouraDaily.filter(r => r.date !== d(4))               // no Oura score
    input.ouraDaily.find(r => r.date === d(6))!.sourceMap = { sleep_score: 'oura_ble' } // our rollup's, not Oura's
    input.ouraSleepPeriods = input.ouraSleepPeriods.filter(p => p.day !== d(8))  // night can't be confirmed
    const moved = night(d(10), -10)                                              // Oura read an earlier sleep
    Object.assign(input.ouraSleepPeriods.find(p => p.day === d(10))!, { bedtimeStart: moved.start, bedtimeEnd: moved.end })

    const sleepPillar = buildTuneReport(input).comparisons[0]
    expect(sleepPillar.summary.n).toBe(15)
    expect(sleepPillar.dropped).toEqual({
      'no shadow row of ours': 1,
      'no Oura score': 1,
      'score not from Oura': 1,
      'no Oura sleep period to confirm the night': 1,
      'different nights': 1,
    })
    expect(sleepPillar.days.map(p => p.ouraDate)).not.toContain(d(10))
    const text = formatTuneReport(buildTuneReport(input)).join('\n')
    expect(text).toContain('days used 15; dropped: 1 no shadow row of ours')
  })

  it('pairs Oura\'s activity day with the next morning\'s Activity pillar', () => {
    const input = fixture(20)
    const activity = buildTuneReport(input).comparisons[4]
    // The last Oura day has no next-morning row in range, so it drops; every other day pairs A → A + 1.
    expect(activity.days).toHaveLength(19)
    expect(activity.days.every(p => p.ourDate === shiftDateStr(p.ouraDate, 1))).toBe(true)
    expect(activity.dropped).toEqual({ 'no shadow row of ours': 1 })

    input.shadow.find(s => s.date === shiftDateStr(FROM, 5))!.units!['activity.yesterday_load'].daytimeThrough = shiftDateStr(FROM, 2)
    expect(buildTuneReport(input).comparisons[4].dropped['our Activity pillar did not read that day']).toBe(1)
  })

  it('reads one shadow model version and says how many rows it ignored', () => {
    const input = fixture(15)
    input.shadow.push({ ...input.shadow[0], modelVersion: 2, sleepPillar: 0 })
    const report = buildTuneReport(input)
    expect(report.shadowVersion).toBe(3)
    expect(report.shadowOtherVersions).toBe(1)
    expect(report.comparisons[0].summary.meanDiff).toBeCloseTo(4, 9)
  })
})

describe('#2826: against how the owner felt', () => {
  const RATINGS = ['drained', 'low', 'ok', 'good', 'pumped'] as const
  /** Readiness rises with the energy rating, so the rank correlation is perfect. */
  const feelFixture = (days: number) => {
    const input = fixture(days)
    input.feel = input.shadow.map((s, i) => ({ date: s.date, energyLevel: RATINGS[i % 5] }))
    input.shadow.forEach((s, i) => { s.shadowReadiness = 50 + (i % 5) * 10 })
    return input
  }

  it('correlates shadow readiness with the same day\'s energy rating', () => {
    const feel = buildTuneReport(feelFixture(20)).feel
    expect(feel.ratedDays).toBe(20)
    expect(feel.distinctRatings).toBe(5)
    const readiness = feel.correlations.find(c => c.label === 'Shadow readiness')!
    expect(readiness.n).toBe(20)
    expect(readiness.rho).toBeCloseTo(1, 6)
  })

  it('says a check is not yet meaningful under 14 rated days, or with one answer on every day', () => {
    expect(formatTuneReport(buildTuneReport(feelFixture(10))).join('\n')).toContain(`not yet meaningful: a check needs ${MIN_FIT_DAYS} rated days`)
    const flat = feelFixture(20)
    flat.feel = flat.feel!.map(f => ({ ...f, energyLevel: 'ok' }))
    expect(buildTuneReport(flat).feel.distinctRatings).toBe(1)
    expect(formatTuneReport(buildTuneReport(flat)).join('\n')).toContain('more than one distinct answer')
  })

  it('skips an answer that is not a rating, and a day outside the range', () => {
    const input = feelFixture(20)
    input.feel!.push({ date: '2020-01-01', energyLevel: 'pumped' }, { date: input.feel![0].date, energyLevel: 'whatever' })
    expect(buildTuneReport(input).feel.ratedDays).toBe(20)
  })

  it('reads as empty when no ratings were read', () => {
    expect(buildTuneReport(fixture(20)).feel).toMatchObject({ ratedDays: 0, distinctRatings: 0 })
  })
})
