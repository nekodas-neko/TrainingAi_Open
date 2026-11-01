// #2984 — readiness night inputs chosen per input, with normals learned per device.
//
// Dates are fixed strings and `today` is passed in, so nothing here depends on the clock.
import { describe, it, expect } from 'vitest'
import { updateBaseline, type Baseline } from '@trainingai/shared/health/personal-baseline'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { computeReadinessComposite, rederiveReadinessFromStored, BASELINE_MIN_NIGHTS } from '@trainingai/shared/health/readiness-composite'
import { computeIllnessRadar } from '@trainingai/shared/health/illness-radar'
import {
  resolveReadinessNightInputs, compositeNightFields, illnessNightFields, RING_SUMMARY_SOURCE,
  type NightInputSources, type RingSummaryInput,
} from '@/lib/health/readiness-night-inputs'

const TODAY = '2026-10-18'
const day = (back: number) => shiftDateStr(TODAY, -back)

const fold = (value: number, n = 30): Baseline => {
  let b: Baseline | null = null
  for (let i = 0; i < n; i++) b = updateBaseline(b, value + (i % 3) - 1, i)
  return b!
}

/** A full ring row: every field, and a prior row carrying every baseline. */
const fullRing = (date: string, over: Partial<RingSummaryInput> = {}): RingSummaryInput => ({
  date, nHistory: 60,
  rhrLowBpm: 50, hrvAvgMs: 58, tempMeanC: 36.4, breathAvgRpm: 14.2, sleepDurationHours: 7.4,
  recoveryIndexHours: 4.5, tempDevC: 0.05,
  rhrBaseline: fold(52), hrvBaseline: fold(55), tempBaseline: fold(3640), breathBaseline: fold(142), sleepBaseline: fold(450),
  ...over,
})

/** The partial Bluetooth row of 18 Oct: a row for tonight with almost nothing in it. */
const partialRing = (date: string): RingSummaryInput => ({
  date, nHistory: 61,
  rhrLowBpm: null, hrvAvgMs: null, tempMeanC: null, breathAvgRpm: null, sleepDurationHours: null,
  recoveryIndexHours: null, tempDevC: null,
  rhrBaseline: null, hrvBaseline: null, tempBaseline: null, breathBaseline: null, sleepBaseline: null,
})

/** `n` earlier nights from `source`, plus tonight's when `tonight` is set. */
const bodyNights = (source: string, n: number, tonight = true) => [
  ...Array.from({ length: n }, (_, i) => ({
    date: day(i + 1), hrvMs: 50 + (i % 5), restingHeartRate: 54 + (i % 3), hrvSource: source, restingHeartRateSource: source,
  })),
  ...(tonight ? [{ date: TODAY, hrvMs: 44, restingHeartRate: 58, hrvSource: source, restingHeartRateSource: source }] : []),
]
const sleepNights = (source: string, n: number) => Array.from({ length: n + 1 }, (_, i) => ({
  date: day(i), durationHours: 7 + (i % 4) * 0.2, respiratoryRate: 14 + (i % 3) * 0.3,
  durationSource: source, respiratoryRateSource: source,
}))
const ouraTemps = (n: number) => Array.from({ length: n + 1 }, (_, i) => ({ date: day(i), temperatureDeviation: i === 0 ? 0.4 : (i % 3 - 1) * 0.1 }))

const base = (over: Partial<NightInputSources> = {}): NightInputSources => ({
  today: TODAY, summaries: [], bodyMetrics: [], nights: [], ouraDaily: [], ouraCloudContributors: [], ...over,
})

// #2265: a night the owner marked partial has no hours to balance, but its breathing is real.
describe('resolveReadinessNightInputs — a marked partial night', () => {
  const MARK = '2026-10-18T01:00:00.000Z'
  const nights = (markTonight: boolean) => sleepNights('oura_cloud', 20).map(n =>
    n.date === TODAY ? { ...n, durationHours: 3.2, ...(markTonight ? { partialNightAt: MARK } : {}) } : n)
  const resolve = (markTonight: boolean) => resolveReadinessNightInputs(base({
    bodyMetrics: bodyNights('oura_cloud', 20), nights: nights(markTonight), ouraDaily: ouraTemps(20),
  }))

  it('drops sleep balance for the marked night and keeps breathing and HRV', () => {
    const unmarked = resolve(false)
    expect(unmarked.inputs.sleepBalance?.z).not.toBeNull()

    const marked = resolve(true)
    // No hours for tonight, so there is nothing to balance: the input is absent, not a bad night.
    expect(marked.inputs.sleepBalance).toBeUndefined()
    expect(marked.inputs.breathing).toEqual(unmarked.inputs.breathing)
    expect(marked.inputs.breathing?.z).not.toBeNull()
    expect(marked.inputs.hrvBalance).toEqual(unmarked.inputs.hrvBalance)
  })
})

describe('resolveReadinessNightInputs — per input, not per row', () => {
  it('a partial ring row plus a full Oura night takes every input from Oura', () => {
    const r = resolveReadinessNightInputs(base({
      summaries: [fullRing(day(1)), partialRing(TODAY)],
      bodyMetrics: bodyNights('oura_cloud', 20),
      nights: sleepNights('oura_cloud', 20),
      ouraDaily: ouraTemps(20),
      ouraCloudContributors: [{ date: TODAY, readinessContributors: { recovery_index: 82, hrv_balance: 70 } }],
    }))
    expect(r.nightDate).toBe(TODAY)
    expect(r.ringSummary?.date).toBe(TODAY)
    for (const key of ['restingHeartRate', 'hrvBalance', 'temperature', 'sleepBalance', 'breathing'] as const) {
      expect(r.inputs[key]?.source, key).toBe('oura_cloud')
      expect(r.inputs[key]?.z, key).not.toBeNull()
    }
    expect(r.recoveryIndex).toEqual({ contributor: 82, source: 'oura_cloud' })
    expect(r.temperatureDeviation).toEqual({ value: 0.4, source: 'cloud' })

    const composite = computeReadinessComposite({ ...compositeNightFields(r), previousNightScore: 80, prevDayActivityScore: 70, activityBalanceScore: 70, nHistory: 61 })
    const present = Object.values(composite.contributors).filter(c => c.gap !== 'no_input')
    expect(present).toHaveLength(8)
    expect(composite.contributors.recoveryIndex).toMatchObject({ score: 82, scale: 'oura_contributor', source: 'oura_cloud' })
    expect(composite.contributors.hrvBalance.source).toBe('oura_cloud')
  })

  it('a full ring row still wins every input it can score', () => {
    const r = resolveReadinessNightInputs(base({
      summaries: [fullRing(day(1)), fullRing(TODAY)],
      bodyMetrics: bodyNights('oura_cloud', 20),
      nights: sleepNights('oura_cloud', 20),
      ouraDaily: ouraTemps(20),
      ouraCloudContributors: [{ date: TODAY, readinessContributors: { recovery_index: 82 } }],
    }))
    for (const key of ['restingHeartRate', 'hrvBalance', 'temperature', 'sleepBalance', 'breathing'] as const) {
      expect(r.inputs[key]?.source, key).toBe(RING_SUMMARY_SOURCE)
      expect(r.inputs[key]?.nights, key).toBe(60)
    }
    expect(r.recoveryIndex).toEqual({ hours: 4.5, source: RING_SUMMARY_SOURCE })
    expect(r.temperatureDeviation).toEqual({ value: 0.05, source: 'ble' })
  })

  it('a full ring night with no Oura data scores exactly as the ring path did', () => {
    const prior = fullRing(day(1))
    const ring = fullRing(TODAY)
    const r = resolveReadinessNightInputs(base({ summaries: [prior, ring] }))
    const { baselineNights, sources, ...fields } = compositeNightFields(r)
    expect(Object.values(baselineNights!)).toEqual([60, 60, 60, 60])
    expect(Object.values(sources!).every(s => s === RING_SUMMARY_SOURCE)).toBe(true)
    const day0 = { previousNightScore: 80, prevDayActivityScore: 70, activityBalanceScore: 70, nHistory: 60 }
    const now = computeReadinessComposite({ ...fields, baselineNights, ...day0 })
    const before = computeReadinessComposite({ ...fields, recoveryIndexHours: ring.recoveryIndexHours, ...day0 })
    expect(now.score).toBe(before.score)
  })

  it('a mixed night takes each field from where it exists', () => {
    const ring = fullRing(TODAY, { hrvAvgMs: null, tempMeanC: null, tempDevC: null, recoveryIndexHours: null })
    const r = resolveReadinessNightInputs(base({
      summaries: [fullRing(day(1)), ring],
      bodyMetrics: bodyNights('oura_cloud', 20),
      nights: sleepNights('oura_cloud', 20),
      ouraDaily: ouraTemps(20),
      ouraCloudContributors: [{ date: TODAY, readinessContributors: { recovery_index: 64 } }],
    }))
    expect(r.inputs.restingHeartRate?.source).toBe(RING_SUMMARY_SOURCE)
    expect(r.inputs.sleepBalance?.source).toBe(RING_SUMMARY_SOURCE)
    expect(r.inputs.breathing?.source).toBe(RING_SUMMARY_SOURCE)
    expect(r.inputs.hrvBalance?.source).toBe('oura_cloud')
    expect(r.inputs.temperature?.source).toBe('oura_cloud')
    expect(r.recoveryIndex).toEqual({ contributor: 64, source: 'oura_cloud' })
    expect(r.temperatureDeviation?.source).toBe('cloud')
  })

  it('a ring row for an earlier night does not stand in for tonight', () => {
    const r = resolveReadinessNightInputs(base({
      summaries: [fullRing(day(2)), fullRing(day(1))],
      bodyMetrics: bodyNights('oura_cloud', 20),
    }))
    expect(r.nightDate).toBe(TODAY)
    expect(r.ringSummary).toBeNull()
    expect(r.inputs.hrvBalance?.source).toBe('oura_cloud')
    expect(r.recoveryIndex).toBeNull()
  })

  it('never keys a night after today', () => {
    const r = resolveReadinessNightInputs(base({ nights: [{ date: shiftDateStr(TODAY, 1), durationHours: 7 }], bodyMetrics: bodyNights('health_connect', 3) }))
    expect(r.nightDate).toBe(TODAY)
  })
})

describe('normals re-learn per device', () => {
  it('an Oura value never scores against the ring\'s nights', () => {
    // 25 ring nights, then Oura's first night: the ring's history is not Oura's normal.
    const r = resolveReadinessNightInputs(base({
      summaries: [fullRing(day(1)), partialRing(TODAY)],
      bodyMetrics: [...bodyNights('oura_ble', 25, false), ...bodyNights('oura_cloud', 0)],
    }))
    expect(r.inputs.hrvBalance).toEqual({ z: null, nights: 0, source: 'oura_cloud' })
    const c = computeReadinessComposite({ ...compositeNightFields(r), previousNightScore: null, prevDayActivityScore: null, activityBalanceScore: null, nHistory: 61 })
    expect(c.contributors.hrvBalance).toMatchObject({ score: 50, provisional: true, gap: 'awaiting_baseline', source: 'oura_cloud' })
  })

  it('stays awaiting its baseline until the device has BASELINE_MIN_NIGHTS nights, then scores', () => {
    const young = resolveReadinessNightInputs(base({ bodyMetrics: bodyNights('oura_cloud', BASELINE_MIN_NIGHTS - 1) }))
    expect(young.inputs.hrvBalance).toMatchObject({ z: null, nights: BASELINE_MIN_NIGHTS - 1 })
    const ready = resolveReadinessNightInputs(base({ bodyMetrics: bodyNights('oura_cloud', BASELINE_MIN_NIGHTS) }))
    expect(ready.inputs.hrvBalance?.nights).toBe(BASELINE_MIN_NIGHTS)
    expect(ready.inputs.hrvBalance?.z).toBeLessThan(0) // 44 ms against a ~52 ms normal
  })

  it('the other device\'s nights do not change the z', () => {
    const own = resolveReadinessNightInputs(base({ bodyMetrics: bodyNights('oura_cloud', 20) }))
    const mixed = resolveReadinessNightInputs(base({
      bodyMetrics: [...bodyNights('oura_cloud', 20), ...Array.from({ length: 20 }, (_, i) => ({ date: day(i + 1), hrvMs: 120, hrvSource: 'health_connect' }))],
    }))
    expect(mixed.inputs.hrvBalance?.z).toBe(own.inputs.hrvBalance?.z)
  })

  it('scores Oura\'s temperature deviation in centi-°C, so a small deviation is not rounded away', () => {
    const r = resolveReadinessNightInputs(base({ bodyMetrics: bodyNights('oura_cloud', 20), ouraDaily: ouraTemps(20) }))
    expect(r.inputs.temperature?.z).toBeGreaterThan(1)
  })
})

describe('the illness radar reads the composite\'s own z-scores (PS-42)', () => {
  it('gets the same z for every shared biomarker', () => {
    const r = resolveReadinessNightInputs(base({
      summaries: [fullRing(day(1)), fullRing(TODAY, { hrvAvgMs: null })],
      bodyMetrics: bodyNights('oura_cloud', 20),
      ouraDaily: ouraTemps(20),
    }))
    const composite = compositeNightFields(r)
    const illness = illnessNightFields(r)
    expect(illness.rhrZ).toBe(composite.rhrZ)
    expect(illness.hrvZ).toBe(composite.hrvZ)
    expect(illness.tempZ).toBe(composite.tempZ)
    expect(illness.nHistory).toBe(BASELINE_MIN_NIGHTS + 6) // the Oura normal (20 nights) is the youngest
    const radar = computeIllnessRadar(illness)
    expect(radar.biomarkers.hrvBalance?.z).toBeCloseTo(composite.hrvZ!, 2)
  })

  it('stays learning while every z sits on a young normal', () => {
    const r = resolveReadinessNightInputs(base({ bodyMetrics: bodyNights('oura_cloud', 3) }))
    expect(illnessNightFields(r).nHistory).toBe(0)
    expect(computeIllnessRadar(illnessNightFields(r)).flag).toBe('learning')
  })
})

describe('the recovery-index contributor on its own scale', () => {
  it('re-derives from the stored row without going through the hours curve', () => {
    const c = computeReadinessComposite({
      rhrZ: null, hrvZ: null, tempZ: null, sleepBalanceZ: null, previousNightScore: null, prevDayActivityScore: null,
      activityBalanceScore: null, nHistory: 0, recoveryIndexContributor: 71, sources: { recoveryIndex: 'oura_cloud' },
    })
    expect(c.contributors.recoveryIndex).toMatchObject({ score: 71, input: 71, scale: 'oura_contributor', provisional: true, gap: null })
    const stored = JSON.parse(JSON.stringify(c.contributors))
    expect(rederiveReadinessFromStored(stored)?.drifted).toEqual([])
  })

  it('hours still win when the ring has them', () => {
    const c = computeReadinessComposite({
      rhrZ: null, hrvZ: null, tempZ: null, sleepBalanceZ: null, previousNightScore: null, prevDayActivityScore: null,
      activityBalanceScore: null, nHistory: 0, recoveryIndexHours: 5, recoveryIndexContributor: 10,
    })
    expect(c.contributors.recoveryIndex.score).toBe(100)
    expect(c.contributors.recoveryIndex.scale).toBeUndefined()
  })
})
