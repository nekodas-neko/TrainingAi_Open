import { describe, it, expect } from 'vitest'
import { computeSleepScore, SLEEP_WEIGHTS } from '@trainingai/shared/health/sleep-score'
import { computeActivityScore, ACTIVITY_MODEL } from '@trainingai/shared/health/activity-score'
import { READINESS_WEIGHTS } from '@trainingai/shared/health/readiness-composite'
import { getDailyGoals } from '@trainingai/shared/health/daily-goals'
import { renormalisedContributors, fixedWeightContributors } from '../contributors'
import { buildSleepAudit } from '../sleep'
import { buildActivityAudit } from '../activity'
import { buildReadinessAudit } from '../readiness'
import { buildHeartRateAudit } from '../heart-rate'
import type { SleepSession } from '@trainingai/shared/types/body'
import type { OuraDailySummaryRow } from '@/lib/data/repository'

const TZ = 'Australia/Brisbane'

function night(overrides: Partial<SleepSession> = {}): SleepSession {
  return {
    id: 's1',
    userId: 'u1',
    date: '2026-07-24',
    sleepStart: new Date('2026-07-23T13:00:00Z'),
    sleepEnd: new Date('2026-07-23T21:00:00Z'),
    createdAt: new Date('2026-07-24T00:00:00Z'),
    durationHours: 8,
    ...overrides,
  }
}

function summary(overrides: Partial<OuraDailySummaryRow> = {}): OuraDailySummaryRow {
  return {
    date: '2026-07-24',
    sleepDurationHours: 7.9, sleepEfficiency: 91, deepSleepHours: 1.4, remSleepHours: 1.7,
    restlessPeriods: 12, sleepLatencySec: 720, hrvAvgMs: 60, rhrLowBpm: 53, rhrAvgBpm: 56,
    recoveryIndexHours: 5.4, tempMeanC: 34.8, tempDevC: 0.05, metAvg: 1.3, breathAvgRpm: 14.2,
    hrvBaseline: { meanX8: 480, devX8: 48 },
    rhrBaseline: { meanX8: 424, devX8: 24 },
    tempBaseline: { meanX8: 27840, devX8: 80 },
    sleepBaseline: { meanX8: 3792, devX8: 360 },
    metBaseline: { meanX8: 10, devX8: 2 },
    breathBaseline: { meanX8: 1136, devX8: 64 },
    nHistory: 22,
    ...overrides,
  }
}

describe('renormalisedContributors', () => {
  it('redistributes an excluded contributor\'s weight and reproduces the score', () => {
    // Only two of three contributors ran, so the weights renormalise over those two.
    const specs = [
      { key: 'a', label: 'A', input: { value: 1 } },
      { key: 'b', label: 'B', input: { value: 2 } },
      { key: 'c', label: 'C', input: { value: null } },
    ]
    const rows = renormalisedContributors(specs, { a: 80, b: 60 }, { a: 30, b: 10, c: 60 })

    const a = rows.find(r => r.key === 'a')!
    const b = rows.find(r => r.key === 'b')!
    const c = rows.find(r => r.key === 'c')!

    expect(a.effectiveWeight).toBe(0.75)   // 30 / (30+10)
    expect(b.effectiveWeight).toBe(0.25)
    expect(c.effectiveWeight).toBeNull()
    expect(c.excludedReason).toBeTruthy()

    // The contributions must sum to the weighted mean the model itself would produce.
    const total = rows.reduce((s, r) => s + (r.contribution ?? 0), 0)
    expect(total).toBeCloseTo((80 * 30 + 60 * 10) / 40, 6)
  })

  it('keeps absolute weights for a fixed-weight model', () => {
    const rows = fixedWeightContributors(
      [{ key: 'x', label: 'X', input: { value: 1 }, subScore: 50, provisional: false }],
      { x: 0.25 },
    )
    expect(rows[0].effectiveWeight).toBe(0.25)
    expect(rows[0].contribution).toBe(12.5)
  })
})

describe('buildSleepAudit', () => {
  // Sub-scores are exposed rounded, so a rebuilt sum lands within 1 of the score by construction.
  it('contributions rebuild the score computeSleepScore returns, within rounding', () => {
    const s = night({ efficiency: 92, remSleepHours: 1.6, deepSleepHours: 1.3, onsetLatencySec: 700, restlessPeriods: 10, awakHours: 0.5 })
    const audit = buildSleepAudit({ date: '2026-07-24', tz: TZ, sleepSessions: [s], derived: null })
    const direct = computeSleepScore(s, TZ, { hrvBaselineMs: null })!

    expect(audit.score).toBe(direct.score)
    const total = audit.contributors.reduce((sum, c) => sum + (c.contribution ?? 0), 0)
    expect(Math.abs(total - direct.score)).toBeLessThanOrEqual(1)
    expect(audit.inputs.contributionSum.value).toBeCloseTo(total, 2)
  })

  it('excludes the HRV contributor until enough prior nights carry a reading', () => {
    const target = night({ averageHrvMs: 55 })
    const priors = Array.from({ length: 3 }, (_, i) => night({
      id: `p${i}`, date: `2026-07-2${i}`,
      sleepStart: new Date(`2026-07-1${i}T13:00:00Z`),
      sleepEnd: new Date(`2026-07-1${i}T21:00:00Z`),
      averageHrvMs: 60,
    }))
    const audit = buildSleepAudit({ date: '2026-07-24', tz: TZ, sleepSessions: [target, ...priors], derived: null })

    const hrv = audit.contributors.find(c => c.key === 'hrv')!
    expect(hrv.subScore).toBeNull()
    expect(hrv.excludedReason).toBeTruthy()
    expect(audit.gaps.join(' ')).toContain('3 prior night(s)')
  })

  it('includes the HRV contributor once the baseline matures, and never uses the scored night in its own baseline', () => {
    const target = night({ averageHrvMs: 40 })
    const priors = Array.from({ length: 8 }, (_, i) => night({
      id: `p${i}`, date: `2026-07-${String(10 + i).padStart(2, '0')}`,
      sleepStart: new Date(`2026-07-${String(9 + i).padStart(2, '0')}T13:00:00Z`),
      sleepEnd: new Date(`2026-07-${String(9 + i).padStart(2, '0')}T21:00:00Z`),
      averageHrvMs: 80,
    }))
    const audit = buildSleepAudit({ date: '2026-07-24', tz: TZ, sleepSessions: [target, ...priors], derived: null })

    const hrv = audit.contributors.find(c => c.key === 'hrv')!
    expect(hrv.subScore).not.toBeNull()
    // Baseline is the 8 prior nights at 80 ms exactly — the 40 ms night must not drag it down.
    expect(audit.inputs.hrvBaselineMs.value).toBe(80)
    expect(hrv.input.value).toBeCloseTo(0.5, 3)
  })

  it('flags drift when the persisted score disagrees with the recompute', () => {
    const s = night({ efficiency: 92 })
    const derived = { day: '2026-07-24', sleepScore: 41, sleepContributors: null, source: 'ble' } as never
    const audit = buildSleepAudit({ date: '2026-07-24', tz: TZ, sleepSessions: [s], derived })
    expect(audit.storedMatchesRecompute).toBe(false)
    expect(audit.notes.join(' ')).toContain('differs')
  })

  it('reports no-data rather than throwing when the day has no session', () => {
    const audit = buildSleepAudit({ date: '2026-07-24', tz: TZ, sleepSessions: [], derived: null })
    expect(audit.score).toBeNull()
    expect(audit.source).toBe('no-data')
    expect(audit.gaps.join(' ')).toContain('No sleep session')
  })

  it('exposes every model weight it scores with', () => {
    const audit = buildSleepAudit({ date: '2026-07-24', tz: TZ, sleepSessions: [night()], derived: null })
    for (const c of audit.contributors) {
      expect(c.weight).toBe(SLEEP_WEIGHTS[c.key as keyof typeof SLEEP_WEIGHTS])
    }
  })
})

describe('buildActivityAudit', () => {
  const goals = getDailyGoals({ weightKg: 82, heightCm: 180, ageYears: 36, sex: 'male', activityLevel: null })

  const base = {
    date: '2026-07-24', goals, goalProfile: {},
    steps: 9000, activeCalories: 500, zoneMinutes: 30, moveHours: 10,
    sessions7d: 3, volume7dKg: 18000, typicalSessionVolumeKg: 6000,
    acwr: null as number | null, acwrExcludedReason: null as string | null, derived: null,
  }

  it('contributions rebuild the pre-taper score, within rounding', () => {
    const audit = buildActivityAudit(base)
    const direct = computeActivityScore({
      steps: base.steps, activeCalories: base.activeCalories, zoneMinutes: base.zoneMinutes,
      moveHours: base.moveHours, moveHoursGoal: 14, sessions7d: base.sessions7d,
      volume7dKg: base.volume7dKg, typicalSessionVolumeKg: base.typicalSessionVolumeKg, goals, acwr: null,
    })!
    const total = audit.contributors.reduce((s, c) => s + (c.contribution ?? 0), 0)
    expect(Math.abs(total - direct.preTaperScore)).toBeLessThanOrEqual(1)
    expect(audit.inputs.contributionSum.value).toBeCloseTo(total, 2)
  })

  it('names each missing daily-movement signal in the gaps', () => {
    const audit = buildActivityAudit({ ...base, steps: null, activeCalories: null, zoneMinutes: null, moveHours: null })
    const gaps = audit.gaps.join(' ')
    expect(gaps).toContain('step count')
    expect(gaps).toContain('active-calorie')
    expect(gaps).toContain('zone-minutes')
    expect(gaps).toContain('move-every-hour')
  })

  it('explains the over-exertion taper when ACWR bites', () => {
    const audit = buildActivityAudit({ ...base, acwr: 1.9 })
    expect(audit.notes.join(' ')).toContain('taper applied')
    expect(audit.inputs.preTaperScore.value).not.toBe(audit.score)
  })

  it('records why the taper was skipped', () => {
    const audit = buildActivityAudit({ ...base, acwr: null, acwrExcludedReason: 'program is younger than 28 days' })
    expect(audit.notes.join(' ')).toContain('younger than 28 days')
  })

  it('flags the whole strength lane as absent on an untrained week', () => {
    const audit = buildActivityAudit({ ...base, sessions7d: 0, volume7dKg: 0 })
    expect(audit.gaps.join(' ')).toContain('weight 45 of 100')
    expect(audit.contributors.find(c => c.key === 'strengthFreq')!.subScore).toBeNull()
  })
})

describe('buildReadinessAudit', () => {
  const common = {
    date: '2026-07-24', sleepScore: 82, activityScore: 70, prevDayActivityScore: 65,
    checkinEnergy: 'good', ouraDaily: null, derived: null,
  }

  // Readiness weights are absolute and its sub-scores are already integers, so this is exact
  // up to the model's single final rounding — no renormalisation slack.
  it('contributions sum to the composite score', () => {
    const audit = buildReadinessAudit({ ...common, summary: summary(), priorSummary: summary({ date: '2026-07-23' }) })
    const total = audit.contributors.reduce((s, c) => s + (c.contribution ?? 0), 0)
    expect(Math.round(total)).toBe(audit.inputs.compositeScore.value)
    expect(audit.inputs.contributionSum.value).toBeCloseTo(total, 2)
  })

  it('uses absolute weights that match the model table', () => {
    const audit = buildReadinessAudit({ ...common, summary: summary(), priorSummary: summary({ date: '2026-07-23' }) })
    for (const c of audit.contributors) {
      expect(c.weight).toBe(READINESS_WEIGHTS[c.key as keyof typeof READINESS_WEIGHTS])
    }
    expect(audit.contributors.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 6)
  })

  it('marks the four baseline-relative contributors provisional while baselines are cold', () => {
    const cold = summary({ nHistory: 3 })
    const audit = buildReadinessAudit({ ...common, summary: cold, priorSummary: summary({ date: '2026-07-23', nHistory: 2 }) })
    for (const key of ['restingHeartRate', 'hrvBalance', 'temperature', 'sleepBalance']) {
      const c = audit.contributors.find(x => x.key === key)!
      expect(c.provisional).toBe(true)
      expect(c.subScore).toBe(50)
    }
    expect(audit.gaps.join(' ')).toContain('3/14 nights')
  })

  it('subtracts the illness suppression from the displayed score and says so', () => {
    // A fever-shaped night: temp far above baseline, RHR up, HRV down.
    const bad = summary({ tempMeanC: 35.4, rhrLowBpm: 61, hrvAvgMs: 41, breathAvgRpm: 16.1 })
    const audit = buildReadinessAudit({ ...common, summary: bad, priorSummary: summary({ date: '2026-07-23' }) })

    const suppression = audit.inputs.illnessSuppression.value as number
    expect(suppression).toBeGreaterThan(0)
    expect(audit.score).toBe((audit.inputs.compositeScore.value as number) - suppression)
    expect(audit.notes.join(' ')).toContain('Illness radar')
  })

  it('reports no-data rather than fabricating a score without a daily summary', () => {
    const audit = buildReadinessAudit({ ...common, summary: null, priorSummary: null })
    expect(audit.score).toBeNull()
    expect(audit.contributors).toHaveLength(0)
    expect(audit.gaps.join(' ')).toContain('No oura_daily_summary row')
  })

  it('notes a missing check-in as a hard cap on attainable readiness', () => {
    const audit = buildReadinessAudit({ ...common, checkinEnergy: null, summary: summary(), priorSummary: summary({ date: '2026-07-23' }) })
    expect(audit.gaps.join(' ')).toContain('No morning check-in')
    expect(audit.contributors.find(c => c.key === 'checkin')!.subScore).toBe(50)
  })
})

describe('buildHeartRateAudit', () => {
  const rows = [
    { timestamp: new Date('2026-07-24T00:00:00Z'), bpm: 52, source: 'ring' },
    { timestamp: new Date('2026-07-24T06:00:00Z'), bpm: 88, source: 'ring' },
    { timestamp: new Date('2026-07-24T14:00:00Z'), bpm: 140, source: 'strap' },
  ]

  it('summarises the intraday series and its coverage', () => {
    const audit = buildHeartRateAudit({
      date: '2026-07-24', hrRows: rows, recentRhr: 56, baselineRhr: 53,
      recentHrv: 58, baselineHrv: 62, ageYears: 36,
      rhrSampleDays: 20, hrvSampleDays: 20, lowWearDaysExcluded: 2,
    })
    expect(audit.inputs.hrMinToday.value).toBe(52)
    expect(audit.inputs.hrMaxToday.value).toBe(140)
    expect(audit.inputs.intradaySampleCount.value).toBe(3)
    expect(audit.inputs.restingHrDelta.value).toBe(3)
    expect(audit.inputs.hrvDelta.value).toBe(-4)
    expect(audit.notes.join(' ')).toContain('low-wear day')
  })

  it('carries no score — it is a measurement, not a weighted model', () => {
    const audit = buildHeartRateAudit({
      date: '2026-07-24', hrRows: [], recentRhr: null, baselineRhr: null,
      recentHrv: null, baselineHrv: null, ageYears: null,
      rhrSampleDays: 0, hrvSampleDays: 0, lowWearDaysExcluded: 0,
    })
    expect(audit.score).toBeNull()
    expect(audit.contributors).toHaveLength(0)
    expect(audit.gaps.join(' ')).toContain('No intraday HR samples')
  })
})

describe('model specs are exported whole', () => {
  it('the activity model lists every weight the score uses', () => {
    const goals = getDailyGoals({ weightKg: 82, heightCm: 180, ageYears: 36, sex: 'male', activityLevel: null })
    const result = computeActivityScore({
      steps: 9000, activeCalories: 500, zoneMinutes: 30, moveHours: 10, moveHoursGoal: 14,
      sessions7d: 3, volume7dKg: 18000, typicalSessionVolumeKg: 6000, goals, acwr: null,
    })!
    for (const key of Object.keys(result.components)) {
      expect(ACTIVITY_MODEL.weights).toHaveProperty(key)
    }
  })
})
