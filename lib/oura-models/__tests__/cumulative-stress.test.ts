import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runCumulativeStress, type CumulativeStressInput } from '@/lib/oura-models/cumulative-stress'
import { hasRealConstants } from '@/lib/oura-models/__fixtures__/real-constants'

const fx = JSON.parse(
  fs.readFileSync(
    path.join(
      process.cwd(),
      'lib',
      'oura-models',
      'onnx',
      '__fixtures__',
      'cumulative_stress_1_2_2.golden.json',
    ),
    'utf8',
  ),
)
// The harness writes NaN outputs as JSON null — coerce back to NaN on read.
const num = (v: number | null): number => (v === null ? NaN : v)
const flat = (k: string): number[] => (fx[k].flat as (number | null)[]).map(num)
const scalar = (k: string): number => num(fx[k].flat[0])

function inputFromGolden(): CumulativeStressInput {
  return {
    gotUps: flat('in_0'),
    lowestHeartRate: flat('in_1'),
    sleepPhase30Sec: flat('in_2'),
    hrvItems: flat('in_3'),
    averageHrv: flat('in_4'),
    restingHrAverage: flat('in_5'),
    temperatureAvg: flat('in_6'),
    averageMetMinutes: flat('in_7'),
    longSleepHrv: flat('in_8'),
    hrvMedianHR5min: flat('in_9'),
    hrvQuality5min: flat('in_10'),
    tempSkin: flat('in_11'),
    sleepFragmentationIndex: flat('in_12'),
    normHrvMedianHR5min: flat('in_13'),
    medianHrvQuality5min: flat('in_14'),
    normalisedIqr: flat('in_15'),
    normTempWake: flat('in_16'),
    highestTemperature: flat('in_17'),
    temperatureDev: flat('in_18'),
    temperatureDevBaseline: flat('in_19'),
    totalSleepDuration: flat('in_20'),
    nDaysToOvulation: flat('in_21'),
    nDaysToPeriod: flat('in_22'),
    cyclePhase: flat('in_23'),
    interpretedCyclePhase: flat('in_24'),
    bedtimeStart: flat('in_25'),
    tempSkinTimestamps: flat('in_26'),
  }
}

// NaN-aware closeness: both NaN → equal; else |a−b| < 1e-3.
function close(a: number, b: number): boolean {
  if (Number.isNaN(a) && Number.isNaN(b)) return true
  return Math.abs(a - b) < 1e-3
}

// Every assertion here is the vendor's forward pass, including the two that look like property
// checks: both the 0–100 band and the all-NaN short-history case are decided by thresholds inside
// the constants, so a synthetic table makes them arbitrary rather than merely different.
describe.skipIf(!hasRealConstants())('cumulative-stress (ChronicStress) parity vs TorchScript golden', () => {
  it('matches all 19 outputs within 1e-3', () => {
    const out = runCumulativeStress(inputFromGolden())

    // Scalar outputs out_0..out_16 map 1:1 to the forward return tuple order.
    const scalarChecks: Array<[string, number]> = [
      ['out_0', out.chronicStressScore],
      ['out_1', out.contributorFragmentation],
      ['out_2', out.contributorHeart],
      ['out_3', out.contributorSleepMotions],
      ['out_4', out.contributorActivity],
      ['out_5', out.contributorTemperature],
      ['out_6', out.sleepFragmentationIndexLatest],
      ['out_7', out.normHrvMedianHR5minLatest],
      ['out_8', out.medianHrvQuality5minLatest],
      ['out_9', out.normalisedIqrLatest],
      ['out_10', out.normTempWakeLatest],
      ['out_11', out.interpretedCyclePhaseLatest],
      ['out_12', out.uiFragmentation],
      ['out_13', out.uiHeart],
      ['out_14', out.uiSleepMotions],
      ['out_15', out.uiActivity],
      ['out_16', out.uiTemperature],
    ]
    for (const [key, got] of scalarChecks) {
      const exp = scalar(key)
      expect(close(got, exp), `${key}: got ${got}, expected ${exp}`).toBe(true)
    }

    // out_17: cluster probabilities [5].
    const clusterExp = flat('out_17')
    expect(out.clusterProba.length).toBe(clusterExp.length)
    for (let i = 0; i < clusterExp.length; i++) {
      expect(close(out.clusterProba[i], clusterExp[i]), `out_17[${i}]`).toBe(true)
    }

    // out_18: debug metrics [20].
    const debugExp = flat('out_18')
    expect(out.debugMetrics.length).toBe(debugExp.length)
    for (let i = 0; i < debugExp.length; i++) {
      expect(close(out.debugMetrics[i], debugExp[i]), `out_18[${i}]: got ${out.debugMetrics[i]}, expected ${debugExp[i]}`).toBe(true)
    }
  })

  it('score = round(positive_cluster_proba × 100) and lands in the 0–100 band', () => {
    const out = runCumulativeStress(inputFromGolden())
    expect(out.chronicStressScore).toBe(21)
    expect(out.chronicStressScore).toBeGreaterThanOrEqual(0)
    expect(out.chronicStressScore).toBeLessThanOrEqual(100)
  })

  it('returns all-NaN outputs when required history is too short (can_produce_score = 0)', () => {
    const i = inputFromGolden()
    // Blank the got_ups history → its non-NaN count drops below min_days_required (21).
    i.gotUps = i.gotUps.map(() => NaN)
    const out = runCumulativeStress(i)
    expect(Number.isNaN(out.chronicStressScore)).toBe(true)
    expect(Number.isNaN(out.contributorFragmentation)).toBe(true)
    expect(out.clusterProba.every((x) => Number.isNaN(x))).toBe(true)
    // Intermediates from the latest night are still emitted (they don't depend on the score gate).
    expect(Number.isNaN(out.normHrvMedianHR5minLatest)).toBe(false)
  })
})
