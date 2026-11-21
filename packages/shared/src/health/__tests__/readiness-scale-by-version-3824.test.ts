// #3824 review fixes: a stored readiness score keeps the scale it was written on (no stored row is
// rewritten), so every cut is chosen by the row's model version, every cross-day comparison converts
// old-scale days first, and resilience reads the exact pre-#3778 sub-score.
import { describe, expect, it } from 'vitest'
import {
  baselineContributorCurve,
  preCentreContributorScore,
  preCentreSubScore,
  READINESS_MODEL_VERSION,
  READINESS_WEIGHTS,
} from '../readiness-composite'
import {
  cutFor,
  LOW_READINESS_ALERT_BELOW,
  READINESS_CUTS,
  readinessCutFires,
  readinessScaleOf,
} from '../readiness-decision-thresholds'
import { centreShiftDelta, toCurrentReadinessScale } from '../readiness-scale'
import { liveReadinessByDayOnCurrentScale, liveReadinessReadingForDay } from '../live-readiness'
import { readinessVerdictForDay, toReadinessVerdictDays } from '../readiness-verdict'
import { computeHealthAlertActions, healthAlertInput, type HealthAlertInput } from '../health-alerts'
import { restDayGuidance } from '../rest-day-guidance'
import { buildUserPrompt } from '../../ai-periodization/prompt'
import type { PrescriptionSignals } from '../../ai-periodization/signals'
import type { SessionPeriodization } from '../../types/ai-periodization'
import { shiftDateStr } from '../../date-utils'

const V17 = 'v17:version-keyed-baselines:2026-11-04'
const V18 = READINESS_MODEL_VERSION

/** A stored contributor map with the three centred inputs at `z` (good direction) and the rest fixed. */
function contributorsAt(z: number, scale: 'v17' | 'v18') {
  const sub = (d: 'higher-better' | 'lower-better') => {
    const v18 = baselineContributorCurve(d === 'higher-better' ? z : -z, d)
    return Math.round(scale === 'v18' ? v18 : preCentreSubScore(v18))
  }
  return {
    restingHeartRate: { score: sub('lower-better'), input: -z, provisional: false, gap: null },
    hrvBalance: { score: sub('higher-better'), input: z, provisional: false, gap: null },
    sleepBalance: { score: sub('higher-better'), input: z, provisional: false, gap: null },
    temperature: { score: 100, input: 0, provisional: false, gap: null },
  }
}

describe('cutFor: the cut matches the scale of the score it judges', () => {
  it('reads the scale from the stamp', () => {
    expect(readinessScaleOf(V17)).toBe('centre-50')
    expect(readinessScaleOf(null)).toBe('centre-50')
    expect(readinessScaleOf(undefined)).toBe('centre-50')
    expect(readinessScaleOf(V18)).toBe('centre-75')
    expect(readinessScaleOf('v19:later:2027-01-01')).toBe('centre-75')
  })

  it('gives every named cut its old value for an old-scale score and its new one for v18', () => {
    for (const key of Object.keys(READINESS_CUTS) as (keyof typeof READINESS_CUTS)[]) {
      expect(cutFor(key, V17)).toBe(READINESS_CUTS[key].before)
      expect(cutFor(key, null)).toBe(READINESS_CUTS[key].before)
      expect(cutFor(key, V18)).toBe(READINESS_CUTS[key].after)
    }
  })

  it('a pre-release 60–66 is not "low" for training stress; the same number on v18 is', () => {
    for (let s = 60; s <= 66; s++) {
      expect(readinessCutFires('otsLowReadiness', s, V17)).toBe(false)
      expect(readinessCutFires('otsLowReadiness', s, V18)).toBe(true)
    }
    expect(readinessCutFires('otsLowReadiness', 59, V17)).toBe(true)
    expect(readinessCutFires('otsLowReadiness', 67, V18)).toBe(false)
  })

  it('the rest-day card judges a stored pre-release score at 60 / 75', () => {
    expect(restDayGuidance({ readinessScore: 62, readinessModelVersion: V17, soreMuscles: [], sleepScore: null, consecutiveRestDays: 0 }).band).toBe('partial')
    expect(restDayGuidance({ readinessScore: 62, readinessModelVersion: V18, soreMuscles: [], sleepScore: null, consecutiveRestDays: 0 }).band).toBe('rest')
    expect(restDayGuidance({ readinessScore: 76, readinessModelVersion: V17, soreMuscles: [], sleepScore: null, consecutiveRestDays: 0 }).band).toBe('recovered')
    expect(restDayGuidance({ readinessScore: 76, soreMuscles: [], sleepScore: null, consecutiveRestDays: 0 }).band).toBe('partial')
  })
})

describe('the one converter onto the current scale', () => {
  it('leaves a v18 score as stored', () => {
    expect(toCurrentReadinessScale(61, V18, null)).toBe(61)
  })

  it('moves a v17 score by the centred contributors alone', () => {
    // All three at baseline: each sub-score 50 → 75, weighted 0.15 + 0.15 + 0.10 over 0.90.
    const map = contributorsAt(0, 'v17')
    const expected = 25 * (READINESS_WEIGHTS.restingHeartRate + READINESS_WEIGHTS.hrvBalance + READINESS_WEIGHTS.sleepBalance)
    expect(centreShiftDelta(map)).toBeCloseTo(expected, 6)
    expect(toCurrentReadinessScale(55, V17, map)).toBe(Math.round(55 + expected))
  })

  it('barely moves a day far below baseline', () => {
    const delta = centreShiftDelta(contributorsAt(-3, 'v17'))!
    // An ordinary day moves about 11; a day 3σ off on all three, about 1.
    expect(delta).toBeGreaterThanOrEqual(0)
    expect(delta).toBeLessThan(2)
  })

  it('cannot convert an old row with no contributor map, and says so with null', () => {
    expect(toCurrentReadinessScale(55, V17, null)).toBeNull()
    expect(toCurrentReadinessScale(55, null, { sleepScore: 70 })).toBeNull()
    expect(toCurrentReadinessScale(null, V18, null)).toBeNull()
  })

  it('a v17 row converts to what v18 would have stored for the same inputs', () => {
    for (const z of [-1.2, -0.4, 0, 0.3, 0.8, 1.6]) {
      const other = 30 // the non-centred part of the composite, identical under both versions
      const sum = (m: ReturnType<typeof contributorsAt>) => other +
        m.restingHeartRate.score * READINESS_WEIGHTS.restingHeartRate +
        m.hrvBalance.score * READINESS_WEIGHTS.hrvBalance +
        m.sleepBalance.score * READINESS_WEIGHTS.sleepBalance
      const v17 = contributorsAt(z, 'v17')
      const v18 = contributorsAt(z, 'v18')
      expect(toCurrentReadinessScale(Math.round(sum(v17)), V17, v17)).toBeCloseTo(Math.round(sum(v18)), -0.5)
    }
  })

  it('live readiness by day: on the current scale, unconvertible days left out', () => {
    const rows = [
      { day: '2026-11-13', readinessScore: 55, readinessSource: 'ble-derived', modelVersions: { readiness: V17 }, readinessContributors: contributorsAt(0, 'v17') },
      { day: '2026-11-14', readinessScore: 50, readinessSource: 'ble-derived', modelVersions: null, readinessContributors: null },
      { day: '2026-11-15', readinessScore: 66, readinessSource: 'generic-derived', modelVersions: { readiness: V18 }, readinessContributors: contributorsAt(0, 'v18') },
    ]
    const map = liveReadinessByDayOnCurrentScale(rows as never)
    expect(map.get('2026-11-13')).toBe(66)
    expect(map.has('2026-11-14')).toBe(false)
    expect(map.get('2026-11-15')).toBe(66)
    expect(liveReadinessReadingForDay('2026-11-13', rows as never)).toEqual({ score: 55, modelVersion: V17 })
    expect(liveReadinessReadingForDay('2026-11-14', rows as never)).toEqual({ score: 50, modelVersion: null })
  })
})

describe('the "is today unusual?" verdict keeps working across the release', () => {
  const TARGET = '2026-11-20'
  const history = Array.from({ length: 28 }, (_, i) => ({
    day: shiftDateStr(TARGET, -(i + 1)),
    // An ordinary month on v17: around 55, inputs at baseline.
    readinessScore: 53 + (i % 5),
    modelVersions: { readiness: V17 },
    readinessContributors: contributorsAt(0, 'v17'),
  }))

  it('judges a v18 day against 28 converted v17 days instead of going silent', () => {
    const days = toReadinessVerdictDays(history)
    // The same ordinary day on v18 reads normal, not "better than usual".
    const ordinary = readinessVerdictForDay({ date: TARGET, score: 66, modelVersion: V18 }, days)
    expect(ordinary).not.toBeNull()
    expect(ordinary!.verdict).toBe('normal')
    expect(ordinary!.baselineDays).toBe(28)
    expect(ordinary!.band.median).toBe(66)
    // A genuinely low day still reads poor.
    expect(readinessVerdictForDay({ date: TARGET, score: 45, modelVersion: V18 }, days)?.verdict).toBe('poor')
  })

  it('an old row with no contributor map cannot be converted, and does not count', () => {
    const days = toReadinessVerdictDays(history.map((h, i) => (i === 0 ? { ...h, readinessContributors: null } : h)))
    expect(readinessVerdictForDay({ date: TARGET, score: 66, modelVersion: V18 }, days)).toBeNull()
  })

  it('a past v17 day is still judged on v17 days, as it was', () => {
    const days = toReadinessVerdictDays(history)
    const past = shiftDateStr(TARGET, 1)
    expect(readinessVerdictForDay({ date: past, score: 55, modelVersion: V17 }, days)?.band.median).toBe(55)
  })
})

describe('the "Readiness is low" push fires on a named cut (owner decision)', () => {
  const base: HealthAlertInput = {
    illnessFlag: null, illnessAdvisory: null, readinessLabel: 'Moderate', readinessHasData: true,
    stressHighMinutes: null, stressCurrent: null,
  }
  const fires = (over: Partial<HealthAlertInput>) =>
    computeHealthAlertActions({ ...base, ...over }).filter(a => a.type === 'fire').map(a => a.alertType)

  it('defaults to the rate-preserving 57 from the production count', () => {
    expect(LOW_READINESS_ALERT_BELOW).toBe(57)
    expect(READINESS_CUTS.lowReadinessAlert).toMatchObject({ before: 50, after: 57, side: 'below' })
  })

  it('fires under 57 whatever the label says, not from 57', () => {
    expect(fires({ readinessScore: 56, readinessLabel: 'Moderate' })).toEqual(['readiness'])
    expect(fires({ readinessScore: 57, readinessLabel: 'Moderate' })).toEqual([])
    expect(fires({ readinessScore: 40, readinessLabel: 'Low' })).toEqual(['readiness'])
  })

  it('reads the score from the readiness response', () => {
    expect(healthAlertInput({ readiness: { score: 54, label: 'Moderate', hasSufficientData: true } }).readinessScore).toBe(54)
    expect(fires(healthAlertInput({ readiness: { score: 54, label: 'Moderate', hasSufficientData: true } }))).toEqual(['readiness'])
  })

  it('does not name the band in a push that can fire beside a Moderate label', () => {
    const action = computeHealthAlertActions({ ...base, readinessScore: 55 }).find(a => a.alertType === 'readiness')
    expect(action?.type).toBe('fire')
    expect(action && action.type === 'fire' ? action.body : '').not.toContain('Low')
  })
})

describe('resilience reads the exact pre-#3778 sub-score', () => {
  const oldRounded = (z: number) => {
    const raw = 50 + z * (50 / 1.5)
    const W = 20
    const lo = raw < W ? W / (1 + (W - raw) / W) : raw
    const shaped = lo > 100 - W ? 100 - W / (1 + (lo - (100 - W)) / W) : lo
    return Math.max(0, Math.min(100, Math.round(shaped)))
  }

  it('matches v17 to the point where inverting the rounded v18 score is a point off', () => {
    let disagreements = 0
    for (let z = -3; z <= 3; z += 0.01) {
      const v18 = { score: Math.round(baselineContributorCurve(z, 'higher-better')), input: z }
      expect(preCentreContributorScore(v18, 'higher-better')).toBe(oldRounded(z))
      if (Math.round(preCentreSubScore(v18.score)) !== oldRounded(z)) disagreements++
    }
    // The old path (invert the rounded new score) really was off on some days.
    expect(disagreements).toBeGreaterThan(0)
  })

  it('reads lower-better the right way round', () => {
    const z = 0.7 // resting HR 0.7σ above normal: a bad night
    const c = { score: Math.round(baselineContributorCurve(z, 'lower-better')), input: z }
    expect(preCentreContributorScore(c, 'lower-better')).toBe(oldRounded(-z))
  })
})

describe('the prescription prompt shows the score', () => {
  const signals = {
    trainingGoal: 'strength', autoApplyPrescriptions: false, effectiveTimeBudgetMin: 60, exercises: [],
    phase: 'accumulation', sessionsInPhase: 2, hoursSinceLastSession: 48, consecutiveSessionDaysOfThisType: 0,
    soreMusclesInSession: [], soreMusclesOutOfSession: [], sorenessLogDate: 'none', activeInjuredMusclesInSession: [],
    morningCheckin: null, rpeTrend: null, repCompletionRate: null, weeklyTargets: {}, weeklyLogged: {},
    volumeBudgetPerMuscleGroup: {}, acwr: null, sleepTrend: null, hrvTrend: null, spo2Trend: null, illness: null,
    externalReadiness: null, confidenceTier: 1, confidence: 0.5, confidenceReasons: [],
  } as unknown as PrescriptionSignals
  const prompt = (externalReadiness: number, externalReadinessModelVersion: string | null | undefined) =>
    buildUserPrompt({ ...signals, externalReadiness, externalReadinessModelVersion }, {} as SessionPeriodization, '2026-11-15')

  it('is unchanged on the current scale', () => {
    expect(prompt(62, V18)).toContain('External readiness score: 62/100 (one signal among many)\n')
    expect(prompt(62, undefined)).toContain('External readiness score: 62/100 (one signal among many)\n')
  })

  // #3718: the line named the prompt's rest-day cut, which left with the rule. The score still reads.
  it('names no rest-day cut for a score from before the move', () => {
    expect(prompt(42, V17)).toContain('External readiness score: 42/100 (one signal among many)\n')
    expect(prompt(42, null)).not.toContain('rest-day cut')
  })
})
