import { describe, it, expect } from 'vitest'
import {
  extractNightlyTrainingSamples,
  fitDaytimeHrvModel,
  evaluateDaytimeHrvModel,
  MIN_TRAINING_SAMPLES,
  type TrainingSample,
  type SleepWindow,
} from '@trainingai/shared/health/daytime-hrv-model'
import type { OuraRawSampleRow } from '@/lib/data/repository'

describe('fitDaytimeHrvModel', () => {
  it('recovers known coefficients from noise-free synthetic data', () => {
    const intercept = 2.0, hrCoef = -0.01, tempCoef = 0.3
    const samples: TrainingSample[] = []
    for (let i = 0; i < 60; i++) {
      const hr = 50 + i
      const temp = 33 + (i % 7) * 0.4
      const rmssd = Math.exp(intercept + hrCoef * hr + tempCoef * temp)
      samples.push({ hr, temp, rmssd })
    }
    const model = fitDaytimeHrvModel(samples)
    expect(model).not.toBeNull()
    expect(model!.intercept).toBeCloseTo(intercept, 4)
    expect(model!.hrCoef).toBeCloseTo(hrCoef, 4)
    expect(model!.tempCoef).toBeCloseTo(tempCoef, 4)
    expect(model!.residualStd).toBeCloseTo(0, 4)
    expect(model!.nSamples).toBe(60)
  })

  it('returns null below the minimum training-sample floor', () => {
    const samples: TrainingSample[] = Array.from({ length: MIN_TRAINING_SAMPLES - 1 }, (_, i) => ({
      hr: 50 + i, temp: 34, rmssd: 40,
    }))
    expect(fitDaytimeHrvModel(samples)).toBeNull()
  })

  it('returns null for a singular system (no HR/temp variance)', () => {
    const samples: TrainingSample[] = Array.from({ length: 60 }, () => ({ hr: 55, temp: 34, rmssd: 40 }))
    expect(fitDaytimeHrvModel(samples)).toBeNull()
  })
})

describe('evaluateDaytimeHrvModel', () => {
  const model = { intercept: 2.0, hrCoef: -0.01, tempCoef: 0.3, residualStd: 0.1, nSamples: 100 }

  it('returns a positive rmssd for a resting (low-MET) moment', () => {
    const out = evaluateDaytimeHrvModel(model, 60, 34, 0.5)
    expect(out).not.toBeNull()
    expect(out!).toBeGreaterThan(0)
  })

  it('gates to null above the MET active threshold', () => {
    expect(evaluateDaytimeHrvModel(model, 60, 34, 3.0)).toBeNull()
  })

  it('returns null for non-finite inputs', () => {
    expect(evaluateDaytimeHrvModel(model, NaN, 34, 0.5)).toBeNull()
  })
})

describe('extractNightlyTrainingSamples', () => {
  const sleep: SleepWindow[] = [{ sleepStart: new Date('2026-07-20T20:00:00Z'), sleepEnd: new Date('2026-07-21T06:00:00Z') }]

  function hrvRow(measuredAt: string, rmssdMs: number[], hrBpm: number[]): OuraRawSampleRow {
    return {
      ringTimestampDs: 0, tag: 0x5d, eventName: 'hrv_event', bodyHex: '', measuredAt,
      decoded: { rmssd_ms: rmssdMs, hr_bpm: hrBpm },
    }
  }
  function tempRow(measuredAt: string, tempsC: number[]): OuraRawSampleRow {
    return { ringTimestampDs: 0, tag: 0x46, eventName: 'temp_event', bodyHex: '', measuredAt, decoded: { temps_c: tempsC } }
  }

  it('pairs an in-window hrv event with a nearby temp reading', () => {
    const rows = [hrvRow('2026-07-20T22:00:00Z', [40], [60]), tempRow('2026-07-20T21:55:00Z', [34.5])]
    const out = extractNightlyTrainingSamples(rows, sleep)
    expect(out).toEqual([{ hr: 60, temp: 34.5, rmssd: 40 }])
  })

  it('excludes hrv events outside the sleep window', () => {
    const rows = [hrvRow('2026-07-20T12:00:00Z', [40], [60]), tempRow('2026-07-20T12:00:00Z', [34.5])]
    expect(extractNightlyTrainingSamples(rows, sleep)).toEqual([])
  })

  it('drops a pair whose paired hr_bpm is out of the plausible band', () => {
    const rows = [hrvRow('2026-07-20T22:00:00Z', [40, 42], [60, 200]), tempRow('2026-07-20T22:00:00Z', [34])]
    const out = extractNightlyTrainingSamples(rows, sleep)
    expect(out).toEqual([{ hr: 60, temp: 34, rmssd: 40 }])
  })

  it('skips an hrv event with no temp reading nearby', () => {
    const rows = [hrvRow('2026-07-20T22:00:00Z', [40], [60])]
    expect(extractNightlyTrainingSamples(rows, sleep)).toEqual([])
  })

  it('drops a non-positive rmssd value', () => {
    const rows = [hrvRow('2026-07-20T22:00:00Z', [0], [60]), tempRow('2026-07-20T22:00:00Z', [34])]
    expect(extractNightlyTrainingSamples(rows, sleep)).toEqual([])
  })
})
