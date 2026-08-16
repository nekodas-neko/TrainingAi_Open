import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runDailyShortTermBaselines, type DailyBaselinesInput } from '@/lib/oura-models/daily-baselines'

const fx = JSON.parse(fs.readFileSync(
  path.join(process.cwd(), 'lib', 'oura-models', 'onnx', '__fixtures__', 'daily_short_term_baselines_1_1_0.golden.json'), 'utf8'))
const flat = (k: string): number[] => fx[k].flat
const scalar = (k: string): number => fx[k].flat[0]

function inputFromGolden(): DailyBaselinesInput {
  return {
    dhrvMedians: flat('in_0'),
    skinTempMedians: flat('in_1'),
    hrMinMedians: flat('in_2'),
    totalSleepDurations: flat('in_3'),
    lowestHeartRates: flat('in_4'),
    highestTemperatures: flat('in_5'),
    averageHrvs: flat('in_6'),
  }
}

describe('daily-short-term-baselines parity vs TorchScript golden', () => {
  it('matches all 4 baseline outputs within 1e-3', () => {
    const out = runDailyShortTermBaselines(inputFromGolden())
    expect(Math.abs(out.dhrvBaseline - scalar('out_0'))).toBeLessThan(1e-3)
    expect(Math.abs(out.skinTempBaseline - scalar('out_1'))).toBeLessThan(1e-3)
    expect(Math.abs(out.hrMinBaseline - scalar('out_2'))).toBeLessThan(1e-3)
    expect(Math.abs(out.nightHrvBaseline - scalar('out_3'))).toBeLessThan(1e-3)
  })

  it('returns NaN baselines when a median array is outside the 5-21 window', () => {
    const i = inputFromGolden()
    i.dhrvMedians = [40, 41, 42] // 3 obs < 5
    const out = runDailyShortTermBaselines(i)
    expect(Number.isNaN(out.dhrvBaseline)).toBe(true)
  })

  it('night-HRV baseline drops days failing the physiological filter', () => {
    const i = inputFromGolden()
    // Zero out sleep duration on every day → no day passes the ≥14400s gate → NaN median.
    i.totalSleepDurations = i.totalSleepDurations.map(() => 0)
    const out = runDailyShortTermBaselines(i)
    expect(Number.isNaN(out.nightHrvBaseline)).toBe(true)
    expect(Number.isNaN(out.dhrvBaseline)).toBe(false) // other baselines still compute
  })
})
