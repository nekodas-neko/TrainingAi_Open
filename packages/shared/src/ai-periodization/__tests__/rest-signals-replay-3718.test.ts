import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { summariseRestSignalReplay, type ReplayDay } from '../rest-signals-replay'
import type { DailyRestInput } from '../daily-rest-decision'
import {
  READINESS_CUTS, CENTRE_75_FROM_MODEL, REST_DAY_SLEEP_TREND_BELOW, REST_DAY_HRV_TREND_BELOW, REST_DAY_SPO2_TREND_BELOW,
} from '../../health/readiness-decision-thresholds'
import { MIN_WEAR_HOURS } from '../../health/wear-confidence'
import { READINESS_MODEL_VERSION } from '../../health/readiness-composite'

// #3718: the count the owner signs off before the three new rest signals ship.

const day = (over: Partial<DailyRestInput>, trained = false): ReplayDay => ({
  trained,
  input: {
    today: '2026-11-04', readinessScore: 80, readinessModelVersion: READINESS_MODEL_VERSION,
    sleepTrend: null, hrvTrend: null, spo2Trend: null,
    consecutiveTrainingDays: 0, temperatureDeviation: null, temperatureBaselineDays: 0, temperatureTrusted: false,
    illnessFlag: null, selfReportedSick: false, energyLevel: null,
    ...over,
  },
})
const fresh = (ratio: number) => ({ ratio, newestDate: '2026-11-04' })

describe('summariseRestSignalReplay', () => {
  it('counts each signal, the days already suggested for another reason, and the days trained', () => {
    const s = summariseRestSignalReplay([
      day({}),                                                   // nothing
      day({ readinessScore: 30 }),                               // new, strong
      day({ readinessScore: 30, consecutiveTrainingDays: 4 }, true), // the streak already suggested it (strong)
      day({ spo2Trend: fresh(0.9), energyLevel: 'low' }),        // low energy already suggested a soft nudge
      day({ sleepTrend: fresh(0.6), hrvTrend: fresh(0.6), spo2Trend: fresh(0.9) }, true),
    ])
    expect(s.days).toBe(5)
    expect(s.bySignal.readinessVeryLow).toEqual({ flagged: 2, alreadySuggested: 1, alreadySuggestedNotSoft: 1, trained: 1 })
    expect(s.bySignal.spo2Low).toEqual({ flagged: 2, alreadySuggested: 1, alreadySuggestedNotSoft: 0, trained: 1 })
    expect(s.bySignal.sleepAndHrvLow).toEqual({ flagged: 1, alreadySuggested: 0, alreadySuggestedNotSoft: 0, trained: 1 })
    expect(s.anySignal).toEqual({ flagged: 4, alreadySuggested: 2, alreadySuggestedNotSoft: 1, trained: 2 })
    expect(s.newlySuggested).toBe(2)
    // Raised: the two new ones, and the low-energy day (soft → strong). The streak day was strong already.
    expect(s.gradeRaised).toBe(3)
    expect(s.evaluable).toEqual({ readinessVeryLow: 5, sleepAndHrvLow: 1, spo2Low: 2 })
  })

  it('returns counts only', () => {
    const s = summariseRestSignalReplay([day({ readinessScore: 30 })])
    expect(JSON.stringify(s)).not.toMatch(/2026|30/)
  })
})

describe('the production SQL uses the shared cuts', () => {
  const sql = readFileSync(resolve(__dirname, '../../../../../scripts/tuning/rest-signals-3718.sql'), 'utf8')
  const p = /SELECT (\d+) AS readiness_below_v18, (\d+) AS readiness_below_v17, (\d+) AS centre_75_from_model,\s*([\d.]+)::float8 AS sleep_below, ([\d.]+)::float8 AS hrv_below, ([\d.]+)::float8 AS spo2_below, (\d+) AS min_wear_hours/.exec(sql)
  it('its parameter row matches the constants', () => {
    expect(p).not.toBeNull()
    const [, after, before, centre, sleep, hrv, spo2, wear] = p!.map(Number)
    expect({ after, before, centre, sleep, hrv, spo2, wear }).toEqual({
      after: READINESS_CUTS.promptRestDay.after, before: READINESS_CUTS.promptRestDay.before, centre: CENTRE_75_FROM_MODEL,
      sleep: REST_DAY_SLEEP_TREND_BELOW, hrv: REST_DAY_HRV_TREND_BELOW, spo2: REST_DAY_SPO2_TREND_BELOW, wear: MIN_WEAR_HOURS,
    })
  })
  it('reads only claude_ro views and never writes', () => {
    const body = sql.replace(/--.*$/gm, '')
    expect(body).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT)\b/i)
    for (const [, schema] of body.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)\./gi)) expect(schema).toBe('claude_ro')
  })
})
