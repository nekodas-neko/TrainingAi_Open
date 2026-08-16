import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runStressResilience, resilienceLevelToBand, computeResilienceForDay, type ResilienceModelInput, type DailyIndices } from '@/lib/health/stress-resilience'
import { daytimeStressScalingParams } from '@/lib/health/daytime-stress'
import { hasRealConstants } from '@/lib/oura-models/__fixtures__/real-constants'

const fx = JSON.parse(fs.readFileSync(
  path.join(process.cwd(), 'lib', 'oura-models', 'onnx', '__fixtures__', 'stress_resilience_2_2_1.golden.json'), 'utf8'))
const flat = (k: string): number[] => fx[k].flat
const scalar = (k: string): number => fx[k].flat[0]

function inputFromGolden(): ResilienceModelInput {
  return {
    sleepStartTimestampsMs: flat('in_0'),
    sleepEndTimestampsMs: flat('in_1'),
    sleepScore: scalar('in_2'),
    hrvBalance: scalar('in_3'),
    recoveryIndex: scalar('in_4'),
    restingHeartRate: scalar('in_5'),
    stressLim: scalar('in_6'),
    saturationStressDeviation: scalar('in_7'),
    saturationRecoveryDeviation: scalar('in_8'),
    recoveryLim: scalar('in_9'),
    stress: flat('in_10'),
    stressTimestampsMs: flat('in_11'),
    dailyStressList: flat('in_12'),
    dailyRestorativeTimeList: flat('in_13'),
    dailySleepRecoveryList: flat('in_14'),
  }
}

describe('stress-resilience core parity vs TorchScript golden', () => {
  it.skipIf(!hasRealConstants())('matches all 13 model outputs within 1e-3', () => {
    const out = runStressResilience(inputFromGolden())
    const got = [
      out.dailyStress, out.dailyRestorativeTime, out.dailySleepRecovery,
      out.dailyQuantizedStress, out.dailyQuantizedRestorativeTime, out.dailyQuantizedSleepRecovery,
      out.longTermRestorativeTime, out.longTermSleepRecovery, out.longTermRecovery, out.longTermStress,
      out.resilienceLevel, out.granularResilienceLevel, out.confidence,
    ]
    for (let k = 0; k < 13; k++) {
      expect(Math.abs(got[k] - scalar(`out_${k}`)), `out_${k}: got ${got[k]} vs ref ${scalar(`out_${k}`)}`).toBeLessThan(1e-3)
    }
  })

  it('gates the resilience level to NaN when the window has < 5 valid days', () => {
    const i = inputFromGolden()
    i.dailyStressList = [0.1, 0.1, 0.1]; i.dailyRestorativeTimeList = [0.2, 0.2, 0.2]; i.dailySleepRecoveryList = [0.6, 0.6, 0.6]
    const out = runStressResilience(i)
    expect(Number.isNaN(out.resilienceLevel)).toBe(true)   // 3 prior + today = 4 valid < 5
    expect(Number.isNaN(out.dailyStress)).toBe(false)      // today's index still computed
  })
})

describe('daytimeStressScalingParams', () => {
  it('emits a negative stress limit, positive recovery limit, and ∓1 saturations', () => {
    const p = daytimeStressScalingParams(50)
    expect(p.stressLim).toBeLessThan(0)
    expect(p.recoveryLim).toBeGreaterThan(0)
    expect(p.saturationStressDeviation).toBe(-1)
    expect(p.saturationRecoveryDeviation).toBe(1)
  })
})

// Every case here runs the daytime-stress scaling on its way in, so the indices, the resolved
// level and the coverage gate all move with the vendor's table — including the two that read as
// pure gate assertions. The NaN-window gate in the parity describe above does not, and stays.
describe.skipIf(!hasRealConstants())('computeResilienceForDay orchestrator', () => {
  const prior = (n: number): DailyIndices[] =>
    Array.from({ length: n }, () => ({ dailyStress: 30, dailyRestorativeTime: 38, dailySleepRecovery: 29 }))
  // ≥4 h of 10-min daytime buckets, no sleep overlap → passes the coverage gate.
  const series = Array.from({ length: 30 }, (_, k) => ({ tMs: 28_800_000 + k * 600_000, level: 0 }))

  it('computes today\'s indices and resolves a level when contributors + coverage are present', () => {
    const res = computeResilienceForDay({
      sleepStartMs: [], sleepEndMs: [], sleepScore: 72, hrvBalance: 60, recoveryIndex: 58,
      restingHeartRate: 55, stressSeries: series, nightHrvBaselineMs: 50,
    }, prior(5))
    expect(res.dailyIndices).not.toBeNull()
    expect(Number.isFinite(res.dailyIndices!.dailyStress)).toBe(true)
    expect(res.level).not.toBeNull()
    expect(res.level!).toBeGreaterThanOrEqual(1)
    expect(res.level!).toBeLessThanOrEqual(5)
    expect(res.confidence!).toBeCloseTo(6 / 14, 6)   // 5 prior + today
  })

  it('skips today (null indices) when a required contributor is provisional, but still resolves off the prior window', () => {
    const res = computeResilienceForDay({
      sleepStartMs: [], sleepEndMs: [], sleepScore: 72, hrvBalance: 60, recoveryIndex: null,
      restingHeartRate: 55, stressSeries: series, nightHrvBaselineMs: 50,
    }, prior(5))
    expect(res.dailyIndices).toBeNull()          // provisional recovery-index → no fabricated index
    expect(res.level).not.toBeNull()             // 5 prior valid days ≥ window_min_length
    expect(res.confidence!).toBeCloseTo(5 / 14, 6)
  })

  it('returns a null level while the window has < 5 valid days', () => {
    const res = computeResilienceForDay({
      sleepStartMs: [], sleepEndMs: [], sleepScore: 72, hrvBalance: 60, recoveryIndex: 58,
      restingHeartRate: 55, stressSeries: series, nightHrvBaselineMs: 50,
    }, prior(3))
    expect(res.dailyIndices).not.toBeNull()       // today's index still computed
    expect(res.level).toBeNull()                  // 3 prior + today = 4 < 5
  })
})

describe('resilienceLevelToBand', () => {
  it('maps 1-5 to Oura band labels', () => {
    expect(resilienceLevelToBand(1)).toBe('low')
    expect(resilienceLevelToBand(2)).toBe('limited')
    expect(resilienceLevelToBand(3)).toBe('adequate')
    expect(resilienceLevelToBand(4)).toBe('solid')
    expect(resilienceLevelToBand(5)).toBe('strong')
  })
})
