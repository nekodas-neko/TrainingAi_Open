// #3778 — the readiness centre at 75 (owner, 15 Nov, direction A). Pins the curve's anchor points, the
// fallbacks, the composite at baseline, and every decision cut that moved with it.
import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  baselineContributorCurve,
  baselineFallbackScore,
  computeReadinessComposite,
  preCentreSubScore,
  rederiveReadinessFromStored,
  READINESS_BASELINE_CENTRE,
  READINESS_MODEL,
  READINESS_MODEL_VERSION,
} from '../readiness-composite'
import * as T from '../readiness-decision-thresholds'
import { DELOAD_READINESS_SOFT_MIN, DELOAD_READINESS_RECOMMENDED_MIN } from '../../ai-periodization/deload-constants'
import { restDayGuidance } from '../rest-day-guidance'
import { guideFor, guideMeaning } from '../contributor-guide'
import { applyRecoveryGate } from '../../running/recovery-gate'
import { buildSystemPrompt } from '../../ai-periodization/prompt'

const r1 = (x: number) => Math.round(x * 10) / 10

describe('the curve (one definition, baselineContributorCurve)', () => {
  // The table in the PR and in the function's doc comment. z in the good direction.
  const ANCHORS: [z: number, score: number][] = [
    [-3, 6.7], [-1.5, 15], [-0.9, 30], [-0.5, 50], [0, 75], [0.5, 83.3], [0.9, 90], [1.5, 95], [3, 97.8],
  ]
  it.each(ANCHORS)('z = %s scores %s', (z, score) => {
    expect(r1(baselineContributorCurve(z, 'higher-better'))).toBe(score)
    expect(r1(baselineContributorCurve(-z, 'lower-better'))).toBe(score)
  })

  it('is the centre exactly at baseline', () => {
    expect(READINESS_BASELINE_CENTRE).toBe(75)
    expect(baselineContributorCurve(0, 'higher-better')).toBe(75)
  })

  it('does not flatten into 100 at the top: strictly rising and never rounding to 100 by 6σ', () => {
    let prev = -Infinity
    for (let z = 0; z <= 6; z += 0.25) {
      const s = baselineContributorCurve(z, 'higher-better')
      expect(s).toBeGreaterThan(prev)
      prev = s
    }
    expect(Math.round(baselineContributorCurve(6, 'higher-better'))).toBeLessThan(100)
    // A great day and an exceptional one still read apart after rounding.
    expect(Math.round(baselineContributorCurve(1.5, 'higher-better'))).toBeLessThan(Math.round(baselineContributorCurve(3, 'higher-better')))
  })

  it('still reaches low scores at the bottom', () => {
    expect(baselineContributorCurve(-1.5, 'higher-better')).toBeLessThanOrEqual(15)
    expect(baselineContributorCurve(-3, 'higher-better')).toBeLessThan(10)
    expect(baselineContributorCurve(-6, 'higher-better')).toBeGreaterThan(0)
  })

  it('is the old curve with its halves rescaled (keeps the maths)', () => {
    for (let z = -4; z <= 4; z += 0.1) {
      const old = preCentreSubScore(baselineContributorCurve(z, 'higher-better'))
      // The pre-#3778 formula, written out: linear 50 + 33.3z with algebraic tails past ±0.9σ.
      const raw = 50 + z * (50 / 1.5)
      const expected = raw > 80 ? 100 - 20 / (1 + (raw - 80) / 20) : raw < 20 ? 20 / (1 + (20 - raw) / 20) : raw
      expect(old).toBeCloseTo(expected, 9)
    }
  })

  it('leaves temperature exactly where it was', () => {
    expect(baselineContributorCurve(0, 'closer-better')).toBe(100)
    expect(r1(baselineContributorCurve(1, 'closer-better'))).toBe(33.3)
    expect(baselineFallbackScore('closer-better')).toBe(50)
  })
})

describe('the composite', () => {
  const base = { previousNightScore: 70, activityBalanceScore: 65, recoveryIndexHours: 2, nHistory: 60 }

  it('scores 75 on each centred contributor at baseline and 100 on temperature', () => {
    const r = computeReadinessComposite({ ...base, rhrZ: 0, hrvZ: 0, sleepBalanceZ: 0, tempZ: 0 })
    expect(r.contributors.restingHeartRate.score).toBe(75)
    expect(r.contributors.hrvBalance.score).toBe(75)
    expect(r.contributors.sleepBalance.score).toBe(75)
    expect(r.contributors.temperature.score).toBe(100)
    // 0.444 × 75 + 0.111 × 100 + 0.178 × 70 + 0.167 × 65 + 0.1 × 40 — High on an all-baseline day.
    expect(r.score).toBe(72)
  })

  it('falls back to the centre, not 50, for the centred three — learning reads as an ordinary night', () => {
    const cold = computeReadinessComposite({ ...base, rhrZ: 0.4, hrvZ: null, sleepBalanceZ: null, tempZ: null, nHistory: 3 })
    expect(cold.contributors.restingHeartRate).toMatchObject({ score: 75, gap: 'awaiting_baseline' })
    expect(cold.contributors.hrvBalance).toMatchObject({ score: 75, gap: 'no_input' })
    expect(cold.contributors.temperature).toMatchObject({ score: 50, gap: 'no_input' })
    expect(cold.contributors.previousNight.score).toBe(70)
  })

  it('still lets a genuinely poor night read Low', () => {
    const r = computeReadinessComposite({ ...base, rhrZ: 1.8, hrvZ: -1.8, sleepBalanceZ: -1.5, tempZ: 1, previousNightScore: 40 })
    expect(r.score).toBeLessThan(50)
  })

  it('stamps v18 and exposes the centre in the model', () => {
    expect(READINESS_MODEL_VERSION.startsWith('v18:')).toBe(true)
    expect(READINESS_MODEL.baselineCentre).toBe(75)
  })

  it('re-derives a stored unscored centred contributor at the centre', () => {
    const stored = computeReadinessComposite({ ...base, rhrZ: null, hrvZ: 0.5, sleepBalanceZ: -0.5, tempZ: 0 })
    const again = rederiveReadinessFromStored(stored.contributors)!
    expect(again.drifted).toEqual([])
    expect(again.score).toBe(stored.score)
    const { restingHeartRate: _dropped, ...withoutRhr } = stored.contributors
    expect(rederiveReadinessFromStored(withoutRhr)!.score).toBe(stored.score)
  })

  it('reads a centred sub-score back on its old scale for the resilience port', () => {
    expect(preCentreSubScore(75)).toBe(50)
    expect(preCentreSubScore(100)).toBe(100)
    expect(preCentreSubScore(0)).toBe(0)
    expect(preCentreSubScore(90)).toBe(80)
    expect(preCentreSubScore(30)).toBe(20)
  })
})

describe('every decision cut moved with the centre', () => {
  it('pins each before → after', () => {
    expect(T.READINESS_DECISION_THRESHOLDS.map(t => [t.name, t.before, t.after])).toEqual([
      ['rest-day: recovered', 75, 80],
      ['rest-day: rest fully', 60, 67],
      ['session pick: low readiness', 60, 67],
      ['deload grade: soft', 70, 76],
      ['deload grade: recommended', 50, 56],
      ['AI prompt: rest day', 40, 45],
      ['early-deload card', 45, 51],
      ['running gate: rest', 50, 57],
      ['running gate: soften', 65, 72],
      ['training stress: low readiness', 60, 67],
    ])
  })

  it('the production SQL carries the same cuts as the module', () => {
    const sql = readFileSync(path.resolve(__dirname, '../../../../../scripts/tuning/readiness-centre-75.sql'), 'utf8')
    for (const t of T.READINESS_DECISION_THRESHOLDS) {
      expect(sql).toContain(`'${t.name}', '${t.side}', ${t.before}, ${t.after})`)
    }
  })

  it('the deload grade constants are the module’s', () => {
    expect(DELOAD_READINESS_SOFT_MIN).toBe(T.DELOAD_READINESS_SOFT_MIN)
    expect(DELOAD_READINESS_RECOMMENDED_MIN).toBe(T.DELOAD_READINESS_RECOMMENDED_MIN)
  })

  it('rest-day guidance: rest under 67, recovered from 80', () => {
    const g = (readinessScore: number) => restDayGuidance({ readinessScore, soreMuscles: [], sleepScore: 70, consecutiveRestDays: 0 }).band
    expect(g(66)).toBe('rest')
    expect(g(67)).toBe('partial')
    expect(g(79)).toBe('partial')
    expect(g(80)).toBe('recovered')
  })

  it('running gate: rest under 57, soften under 72', () => {
    const p = { type: 'tempo', durationMin: 40, distanceKm: null, targets: {}, rationale: '', frameworkKey: 'x' } as unknown as Parameters<typeof applyRecoveryGate>[0]
    const gate = (readiness: number) => applyRecoveryGate(p, {
      readiness, readinessProvisional: false, acwr: null, hoursSinceLowerBodyStrength: null, lastLowerBodyVolumeKg: 0,
      monotony: null, hoursSinceLastHardRun: null, sleepHoursLastNight: null,
    }).action
    expect(gate(56)).toBe('rest')
    expect(gate(57)).toBe('soften')
    expect(gate(71)).toBe('soften')
    expect(gate(72)).toBe('proceed')
  })

  it('the AI prompt states the moved rest-day cut', () => {
    const prompt = buildSystemPrompt('strength')
    expect(prompt).toContain('OR external_readiness < 45,')
    expect(prompt).not.toContain('external_readiness < 40')
  })
})

describe('contributor text reads against baseline', () => {
  const hrv = guideFor('hrvBalance')!
  it('a centred contributor reads "below your baseline" under 75', () => {
    expect(guideMeaning(hrv, 'hrvBalance', 74)).toBe(hrv.low)
    expect(guideMeaning(hrv, 'hrvBalance', 75)).toBe(hrv.high)
  })
  it('anything else keeps the cut at 50', () => {
    const sleep = guideFor('previousNight')!
    expect(guideMeaning(sleep, 'previousNight', 60)).toBe(sleep.high)
    expect(guideMeaning(hrv, 'hrv_balance', 60)).toBe(hrv.high)
  })
})

describe('the stored-day replay', () => {
  it('projects a stored v17 row to within a point of what v18 computes from the same inputs', async () => {
    const { syntheticStoredRows, SYNTHETIC_POPULATIONS, projectCentreShift } = await import('../../../../../scripts/tuning/readiness-centre-replay-report')
    const { READINESS_WEIGHTS } = await import('../readiness-composite')
    const centred = { restingHeartRate: 'lower-better', hrvBalance: 'higher-better', sleepBalance: 'higher-better' } as const
    for (const row of syntheticStoredRows(SYNTHETIC_POPULATIONS[0], 500)) {
      const map = row.contributors as Record<string, { score: number; input?: number }>
      const v18 = Math.round((Object.keys(READINESS_WEIGHTS) as (keyof typeof READINESS_WEIGHTS)[]).reduce((s, k) => {
        const c = map[k]
        const sub = k in centred ? Math.round(baselineContributorCurve(c.input!, centred[k as keyof typeof centred])) : c.score
        return s + sub * READINESS_WEIGHTS[k]
      }, 0))
      expect(Math.abs(projectCentreShift(row)!.projected - v18)).toBeLessThanOrEqual(1)
    }
  })
})
