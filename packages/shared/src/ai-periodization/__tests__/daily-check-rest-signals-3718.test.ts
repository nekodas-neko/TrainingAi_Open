import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { decideDailyRest, restSignals, type DailyRestInput } from '../daily-rest-decision'
import { deloadReasons, deloadCauseLine } from '../deload-reasons'
import { computeAiDynamicNextSession, type AiDynamicInput } from '../ai-dynamic'
import { buildSystemPrompt } from '../prompt'
import { hrvTrendReading, spo2TrendReading } from '../../health/recovery-trends'
import {
  PROMPT_REST_DAY_READINESS_BELOW, REST_DAY_SLEEP_TREND_BELOW, REST_DAY_HRV_TREND_BELOW, REST_DAY_SPO2_TREND_BELOW,
} from '../../health/readiness-decision-thresholds'
import { READINESS_MODEL_VERSION } from '../../health/readiness-composite'
import { shiftDateStr } from '../../date-utils'
import type { BodyMetrics } from '../../types/body'
import type { ProgramSession } from '../../types/program'

// Issue 3718, step 1: the daily check suggests rest on the three signals of the AI prescription
// prompt's rest-day rule it did not read — a very low readiness without a training streak, sleep and
// HRV trends both poor, and a low blood-oxygen trend — on the same cuts the prompt prints.

const TODAY = '2026-11-04'
const V = READINESS_MODEL_VERSION
const fresh = (ratio: number) => ({ ratio, newestDate: TODAY })
const stale = (ratio: number) => ({ ratio, newestDate: shiftDateStr(TODAY, -1) })

const calm: DailyRestInput = {
  today: TODAY, readinessScore: 80, readinessModelVersion: V,
  sleepTrend: fresh(1), hrvTrend: fresh(1), spo2Trend: fresh(1),
  consecutiveTrainingDays: 0, temperatureDeviation: null, temperatureBaselineDays: 0, temperatureTrusted: false,
  illnessFlag: null, selfReportedSick: false, energyLevel: null,
}

/** The words Home shows for a decision, as both apps build them from the response. */
function words(input: DailyRestInput) {
  const d = decideDailyRest(input)
  const rec = {
    deloadOrRestRecommended: d.recommended, deloadStrength: d.strength, temperatureAlert: d.temperatureAlert,
    consecutiveTrainingDays: input.consecutiveTrainingDays,
    ...(d.restSignals.length > 0 ? { restSignals: d.restSignals } : {}),
    signals: { ouraReadiness: input.readinessScore, ouraReadinessModelVersion: input.readinessModelVersion },
  }
  return { d, reasons: deloadReasons(rec), cause: deloadCauseLine(rec) }
}

describe('each AI-rule signal on its own suggests rest, with its reason (#3718)', () => {
  it('a calm day suggests nothing', () => {
    expect(decideDailyRest(calm)).toEqual({ recommended: false, strength: 'soft', temperatureAlert: false, restSignals: [] })
  })

  it('very low readiness the day after a rest day suggests rest, strongly', () => {
    const { d, reasons, cause } = words({ ...calm, readinessScore: PROMPT_REST_DAY_READINESS_BELOW - 1, consecutiveTrainingDays: 0 })
    expect(d).toMatchObject({ recommended: true, strength: 'strong', restSignals: ['readinessVeryLow'] })
    expect(reasons.map(r => r.text)).toContain(
      `Readiness ${PROMPT_REST_DAY_READINESS_BELOW - 1} — under ${PROMPT_REST_DAY_READINESS_BELOW}, low enough that a rest day is the better call.`)
    expect(cause).toBe('Readiness very low')
  })

  it('sleep and HRV trends both poor suggest rest', () => {
    const { d, reasons, cause } = words({ ...calm, sleepTrend: fresh(0.7), hrvTrend: fresh(0.7) })
    expect(d).toMatchObject({ recommended: true, strength: 'recommended', restSignals: ['sleepAndHrvLow'] })
    expect(reasons).toEqual([{ kind: 'sleepAndHrv', text: 'Sleep and HRV have both run well below your usual over the last 3 nights.' }])
    expect(cause).toBe('Sleep and HRV both low')
  })

  it('a low blood-oxygen trend suggests rest', () => {
    const { d, reasons, cause } = words({ ...calm, spo2Trend: fresh(0.95) })
    expect(d).toMatchObject({ recommended: true, strength: 'recommended', restSignals: ['spo2Low'] })
    expect(reasons).toEqual([{
      kind: 'spo2',
      text: 'Blood oxygen has been below your usual over the last 3 nights — often an early sign of illness or incomplete recovery.',
    }])
    expect(cause).toBe('Blood oxygen low')
  })
})

describe('just inside each cut does not fire', () => {
  it('readiness exactly at the rest cut', () => {
    expect(restSignals({ ...calm, readinessScore: PROMPT_REST_DAY_READINESS_BELOW })).toEqual([])
  })
  it('sleep at its cut, HRV well under', () => {
    expect(restSignals({ ...calm, sleepTrend: fresh(REST_DAY_SLEEP_TREND_BELOW), hrvTrend: fresh(0.5) })).toEqual([])
  })
  it('HRV at its cut, sleep well under', () => {
    expect(restSignals({ ...calm, sleepTrend: fresh(0.5), hrvTrend: fresh(REST_DAY_HRV_TREND_BELOW) })).toEqual([])
  })
  it('only one of sleep and HRV poor', () => {
    expect(restSignals({ ...calm, sleepTrend: fresh(0.5), hrvTrend: fresh(1) })).toEqual([])
  })
  it('blood oxygen at its cut', () => {
    expect(restSignals({ ...calm, spo2Trend: fresh(REST_DAY_SPO2_TREND_BELOW) })).toEqual([])
  })
})

describe('missing or stale input never suggests rest', () => {
  it('no readiness today', () => {
    expect(restSignals({ ...calm, readinessScore: null })).toEqual([])
  })
  it('a missing sleep or HRV trend', () => {
    expect(restSignals({ ...calm, sleepTrend: null, hrvTrend: fresh(0.5) })).toEqual([])
    expect(restSignals({ ...calm, sleepTrend: fresh(0.5), hrvTrend: null })).toEqual([])
  })
  it('trends whose newest night is not last night', () => {
    expect(restSignals({ ...calm, sleepTrend: stale(0.5), hrvTrend: fresh(0.5) })).toEqual([])
    expect(restSignals({ ...calm, sleepTrend: fresh(0.5), hrvTrend: stale(0.5) })).toEqual([])
    expect(restSignals({ ...calm, spo2Trend: stale(0.9) })).toEqual([])
  })
  it('a missing blood-oxygen trend', () => {
    expect(restSignals({ ...calm, spo2Trend: null })).toEqual([])
  })
})

describe('a source without the capability never triggers it', () => {
  // Nights from a device that sends HRV but no blood oxygen: the generic `spo2Pct` is never set.
  const rows: BodyMetrics[] = Array.from({ length: 10 }, (_, i) => ({
    id: `m${i}`, userId: 'u', date: shiftDateStr(TODAY, -i), createdAt: new Date(0),
    hrvMs: i < 3 ? 30 : 60, hrvSource: 'any_source',
  }))
  it('no blood-oxygen readings ⇒ no trend ⇒ no signal', () => {
    expect(spo2TrendReading(rows, [])).toBeNull()
    const hrv = hrvTrendReading(rows, [], new Map())
    expect(hrv).toEqual({ ratio: 0.5, newestDate: TODAY })
    expect(restSignals({ ...calm, hrvTrend: hrv, spo2Trend: spo2TrendReading(rows, []) })).toEqual([])
  })
  it('the same nights with a falling blood oxygen do fire it', () => {
    const withSpo2 = rows.map((r, i) => ({ ...r, spo2Pct: i < 3 ? 93 : 97, spo2Source: 'any_source' }))
    const spo2 = spo2TrendReading(withSpo2, [])
    expect(spo2?.newestDate).toBe(TODAY)
    expect(restSignals({ ...calm, spo2Trend: spo2 })).toEqual(['spo2Low'])
  })
})

describe('the three-training-day rule works as before', () => {
  it('under three days and a fair readiness: nothing', () => {
    expect(decideDailyRest({ ...calm, consecutiveTrainingDays: 2, readinessScore: 60 }).recommended).toBe(false)
  })
  it('three days, graded by readiness on its own scale', () => {
    expect(decideDailyRest({ ...calm, consecutiveTrainingDays: 3, readinessScore: 80 })).toMatchObject({ recommended: true, strength: 'soft', restSignals: [] })
    expect(decideDailyRest({ ...calm, consecutiveTrainingDays: 3, readinessScore: 60 })).toMatchObject({ recommended: true, strength: 'recommended', restSignals: [] })
    expect(decideDailyRest({ ...calm, consecutiveTrainingDays: 3, readinessScore: 50 })).toMatchObject({ recommended: true, strength: 'strong', restSignals: [] })
    expect(decideDailyRest({ ...calm, consecutiveTrainingDays: 3, readinessScore: null })).toMatchObject({ recommended: true, strength: 'soft' })
  })
  it('the streak keeps its own cause line when a rest signal also fires', () => {
    const { d, cause } = words({ ...calm, consecutiveTrainingDays: 4, spo2Trend: fresh(0.9) })
    expect(d).toMatchObject({ strength: 'recommended', restSignals: ['spo2Low'] })
    expect(cause).toBe('4 sessions in a row')
  })
  it('a soft streak nudge is raised to recommended by a rest signal, never lowered', () => {
    expect(decideDailyRest({ ...calm, consecutiveTrainingDays: 3, sleepTrend: fresh(0.6), hrvTrend: fresh(0.6) }).strength).toBe('recommended')
    expect(decideDailyRest({ ...calm, illnessFlag: 'fever', spo2Trend: fresh(0.9) }).strength).toBe('strong')
  })
})

describe('the daily check uses the cuts the AI prompt prints', () => {
  const prompt = buildSystemPrompt('strength')
  it('the prompt states each cut from the shared constant', () => {
    expect(prompt).toContain(`sleep_score_trend < ${REST_DAY_SLEEP_TREND_BELOW} AND hrv_trend < ${REST_DAY_HRV_TREND_BELOW}`)
    expect(prompt).toContain(`external_readiness < ${PROMPT_REST_DAY_READINESS_BELOW}`)
    expect(prompt).toContain(`spo2_trend < ${REST_DAY_SPO2_TREND_BELOW}`)
  })
  it('and the check fires just under each of those same numbers', () => {
    const e = 1e-6
    expect(restSignals({ ...calm, readinessScore: PROMPT_REST_DAY_READINESS_BELOW - e })).toEqual(['readinessVeryLow'])
    expect(restSignals({ ...calm, sleepTrend: fresh(REST_DAY_SLEEP_TREND_BELOW - e), hrvTrend: fresh(REST_DAY_HRV_TREND_BELOW - e) })).toEqual(['sleepAndHrvLow'])
    expect(restSignals({ ...calm, spo2Trend: fresh(REST_DAY_SPO2_TREND_BELOW - e) })).toEqual(['spo2Low'])
  })
})

describe('computeAiDynamicNextSession carries the signals to Home', () => {
  const NOW = Date.parse(`${TODAY}T12:00:00+10:00`)
  const session: ProgramSession = {
    id: 'a', programId: 'p', name: 'A', position: 0, timeBudgetMinutes: 60,
    exercises: [{ id: 'e', sessionId: 'a', exerciseName: 'lift', muscleGroups: ['quads'], position: 0, exerciseRole: 'primary' }],
  }
  const base: AiDynamicInput = {
    sessions: [session], history: [], muscleAssignments: {}, muscleRecovery: [], soreMuscles: [],
    readinessScore: 80, readinessModelVersion: V, temperatureDeviation: null, timezone: 'Australia/Brisbane',
    reminderEnabled: false, reminderTime: null, sleepTrend: null, energyLevel: null, hrvTrend: null,
    illnessFlag: null, stressHighMinutes: null,
  }
  beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
  afterAll(() => { vi.useRealTimers() })

  it('no trends passed: unchanged, and no restSignals field', () => {
    const r = computeAiDynamicNextSession(base)
    expect(r.deloadOrRestRecommended).toBe(false)
    expect(r).not.toHaveProperty('restSignals')
  })
  it('a low blood-oxygen trend from last night suggests rest', () => {
    const r = computeAiDynamicNextSession({
      ...base, restTrends: { sleepScore: null, sleepDuration: null, hrv: null, spo2: fresh(0.9) },
    })
    expect(r).toMatchObject({ deloadOrRestRecommended: true, deloadStrength: 'recommended', restSignals: ['spo2Low'] })
  })
  it('the sleep-score trend is read before the duration trend, as the prompt says', () => {
    const r = computeAiDynamicNextSession({
      ...base, restTrends: { sleepScore: fresh(0.9), sleepDuration: fresh(0.5), hrv: fresh(0.5), spo2: null },
    })
    expect(r.deloadOrRestRecommended).toBe(false)
    const d = computeAiDynamicNextSession({
      ...base, restTrends: { sleepScore: null, sleepDuration: fresh(0.5), hrv: fresh(0.5), spo2: null },
    })
    expect(d.restSignals).toEqual(['sleepAndHrvLow'])
  })
})
