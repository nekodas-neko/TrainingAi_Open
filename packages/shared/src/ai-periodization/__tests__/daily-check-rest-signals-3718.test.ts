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
import { formatTrendRatio, shownTrendRatio } from '../../health/trend-ratio-shown'
import type { BodyMetrics } from '../../types/body'
import type { ProgramSession } from '../../types/program'

// Issue 3718, step 1: the daily check suggests rest on the three signals of the AI prescription
// prompt's rest-day rule it did not read — a very low readiness without a training streak, sleep and
// HRV trends both poor, and a low blood-oxygen trend — on the same cuts the prompt prints.

const TODAY = '2026-11-04'
const V = READINESS_MODEL_VERSION
const fresh = (ratio: number) => ({ ratio, newestDate: TODAY, oldestDate: shiftDateStr(TODAY, -2) })
const stale = (ratio: number) => ({ ratio, newestDate: shiftDateStr(TODAY, -1), oldestDate: shiftDateStr(TODAY, -3) })

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
    expect(hrv).toEqual({ ratio: 0.5, newestDate: TODAY, oldestDate: shiftDateStr(TODAY, -2) })
    expect(restSignals({ ...calm, hrvTrend: hrv, spo2Trend: spo2TrendReading(rows, []) })).toEqual([])
  })
  it('the same nights with a falling blood oxygen do fire it', () => {
    const withSpo2 = rows.map((r, i) => ({ ...r, spo2Pct: i < 3 ? 93 : 97, spo2Source: 'any_source' }))
    const spo2 = spo2TrendReading(withSpo2, [])
    expect(spo2?.newestDate).toBe(TODAY)
    expect(restSignals({ ...calm, spo2Trend: spo2 })).toEqual(['spo2Low'])
  })
})

describe('the check compares the two-decimal ratio the AI is shown (#3718 F1)', () => {
  it('blood oxygen: 0.9671 prints as 0.97 and does not fire, 0.9649 prints 0.96 and does', () => {
    expect(restSignals({ ...calm, spo2Trend: fresh(0.9671) })).toEqual([])
    expect(restSignals({ ...calm, spo2Trend: fresh(0.9649) })).toEqual(['spo2Low'])
  })
  it('sleep and HRV: 0.7451 prints as 0.75 and does not fire, 0.7449 prints 0.74 and does', () => {
    expect(restSignals({ ...calm, sleepTrend: fresh(0.7451), hrvTrend: fresh(0.7451) })).toEqual([])
    expect(restSignals({ ...calm, sleepTrend: fresh(0.7449), hrvTrend: fresh(0.7449) })).toEqual(['sleepAndHrvLow'])
    expect(restSignals({ ...calm, sleepTrend: fresh(0.7449), hrvTrend: fresh(0.7451) })).toEqual([])
  })
  it('the prompt prints the same value the check compares', () => {
    for (const r of [0.9671, 0.9649, 0.7451, 0.7449, 0.745, 0.965]) {
      expect(shownTrendRatio(r)).toBe(Number(formatTrendRatio(r)))
    }
    expect(formatTrendRatio(0.9671)).toBe('0.97')
  })
})

describe('a "last 3 nights" signal does not fire across a gap (#3718 F2)', () => {
  const rowsOn = (offsets: number[], older: number, recent: number): BodyMetrics[] => [
    ...offsets.map(o => ({ id: `r${o}`, userId: 'u', date: shiftDateStr(TODAY, -o), createdAt: new Date(0), spo2Pct: recent, spo2Source: 's' })),
    ...[10, 11, 12, 13, 14].map(o => ({ id: `o${o}`, userId: 'u', date: shiftDateStr(TODAY, -o), createdAt: new Date(0), spo2Pct: older, spo2Source: 's' })),
  ]
  const fire = (offsets: number[]) => restSignals({ ...calm, spo2Trend: spo2TrendReading(rowsOn(offsets, 98, 90), []) })

  it('three consecutive nights fire', () => { expect(fire([0, 1, 2])).toEqual(['spo2Low']) })
  it('one missed night still fires', () => { expect(fire([0, 1, 3])).toEqual(['spo2Low']) })
  it('a four-night gap does not (today, today-5, today-6)', () => { expect(fire([0, 5, 6])).toEqual([]) })
  it('the reading carries the oldest of the recent three', () => {
    expect(spo2TrendReading(rowsOn([0, 5, 6], 98, 90), [])).toMatchObject({ newestDate: TODAY, oldestDate: shiftDateStr(TODAY, -6) })
  })
  it('the AI prompt value for the same rows is unchanged by the gap rule', () => {
    const gappy = spo2TrendReading(rowsOn([0, 5, 6], 98, 90), [])!
    const tight = spo2TrendReading(rowsOn([0, 1, 2], 98, 90), [])!
    // Same ratio either way: the prompt still prints it; only the daily check ignores the gappy one.
    expect(formatTrendRatio(gappy.ratio)).toBe(formatTrendRatio(tight.ratio))
    expect(gappy.ratio).toBeLessThan(0.97)
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
  it('the rendered prompt still carries the literal wording (#3718 byte-identical rule)', () => {
    expect(prompt).toContain('sleep_score_trend < 0.75 AND hrv_trend < 0.75')
    expect(prompt).toContain('spo2_trend < 0.97')
    expect(prompt).toContain('external_readiness < 45')
  })
  it('and the check fires just under each of those same numbers', () => {
    // One displayed step (0.01) under the cut: the ratios are compared as the prompt prints them.
    const step = 0.01
    expect(restSignals({ ...calm, readinessScore: PROMPT_REST_DAY_READINESS_BELOW - 1e-6 })).toEqual(['readinessVeryLow'])
    expect(restSignals({ ...calm, sleepTrend: fresh(REST_DAY_SLEEP_TREND_BELOW - step), hrvTrend: fresh(REST_DAY_HRV_TREND_BELOW - step) })).toEqual(['sleepAndHrvLow'])
    expect(restSignals({ ...calm, spo2Trend: fresh(REST_DAY_SPO2_TREND_BELOW - step) })).toEqual(['spo2Low'])
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
