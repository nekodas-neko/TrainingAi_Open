import { describe, it, expect, vi } from 'vitest'

// The model runs from a recording of itself, so this suite needs no `.onnx` file — see
// `lib/oura-models/inference/__tests__/helpers/replay-session.ts`. The assembler itself — windowing
// the raw night, the 5-min stage reduction, the BDI derivation — still runs for real, which is the
// whole point of this file.
vi.mock('@/lib/oura-models/inference/session', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/oura-models/inference/session')>()
  const { makeReplayGetSession } = await import('@/lib/oura-models/inference/__tests__/helpers/replay-session')
  return { ...actual, getSession: makeReplayGetSession(actual.getSession) }
})

import { assembleSleepNetNight, sleepNetDump, sleepNetStages5Min, bdiFromApnea, type SleepNetAssembleInput } from '../sleepnet-assemble'
import type { StageCode } from '../inference/sleepnet'

/** Build a synthetic ~7 h night of decoded-row-shaped inputs. */
function synthInput(): SleepNetAssembleInput {
  const t0 = 1_700_000_000_000
  const end = t0 + 7 * 3600 * 1000
  const ibiRows: SleepNetAssembleInput['ibiRows'] = []
  // one IBI batch every ~10 s, 10 beats each (~1 s intervals)
  for (let ev = t0; ev < end; ev += 10_000) {
    ibiRows.push({
      tsMs: ev,
      ibiMs: Array.from({ length: 10 }, (_, k) => 1000 + 20 * Math.sin((ev / 1000 + k) / 50)),
      quality: Array.from({ length: 10 }, () => 1),
    })
  }
  const motionRows: SleepNetAssembleInput['motionRows'] = []
  for (let ev = t0; ev < end; ev += 30_000) motionRows.push({ tsMs: ev, acmMad: Math.abs(3 * Math.sin(ev / 600_000)) })
  const spo2Rows: SleepNetAssembleInput['spo2Rows'] = []
  for (let ev = t0; ev < end; ev += 60_000) spo2Rows.push({ tsMs: ev, spo2: [97 + Math.sin(ev / 300_000)] })
  return { bedtimeStartMs: t0, bedtimeEndMs: end, ibiRows, motionRows, spo2Rows }
}

describe('SleepNet raw-night assembler + dump', () => {
  it('assembles well-formed, time-ordered inputs', () => {
    const night = assembleSleepNetNight(synthInput())
    expect(night.ibi.tsMs.length).toBeGreaterThan(1000)
    expect(night.ibi.tsMs.length).toBe(night.ibi.ibiMs.length)
    // beats are strictly non-decreasing in time
    for (let i = 1; i < night.ibi.tsMs.length; i++) expect(night.ibi.tsMs[i]).toBeGreaterThanOrEqual(night.ibi.tsMs[i - 1])
    expect(night.motion.value.length).toBeGreaterThan(100)
  })

  it('runs the model end-to-end and produces a staging dump', async () => {
    const dump = await sleepNetDump(synthInput())
    expect(dump.counts.ibiBeats).toBeGreaterThan(1000)
    expect(dump.staging, `fell back: ${dump.fallbackReason}`).not.toBeNull()
    const p = dump.staging!.stagePct
    const sum = p.deep + p.light + p.rem + p.awake
    expect(sum).toBeGreaterThan(99)
    expect(sum).toBeLessThan(101)
    // stages are tallied over the real bedtime window (7 h ≈ 840 epochs), not the padded 1800 grid
    expect(dump.staging!.epochs).toBeGreaterThan(700)
    expect(dump.staging!.epochs).toBeLessThan(900)
  })

  it('produces exactly nEpochs 5-min stages + a BDI for the rollup', async () => {
    const nEpochs = 95 // heuristic grid for a ~7.9 h night
    const out = await sleepNetStages5Min(synthInput(), nEpochs)
    expect(out).not.toBeNull()
    expect(out!.stages.length).toBe(nEpochs)
    const valid = new Set(['deep', 'light', 'rem', 'awake'])
    for (const s of out!.stages) expect(valid.has(s)).toBe(true)
    // a real-ish night should contain some sleep (not all wake)
    expect(out!.stages.some((s) => s !== 'awake')).toBe(true)
    // BDI is a finite, non-negative index
    expect(Number.isFinite(out!.bdi.perHour)).toBe(true)
    expect(out!.bdi.perHour).toBeGreaterThanOrEqual(0)
  })
})

describe('bdiFromApnea', () => {
  const codes = (spec: number[]): StageCode[] => spec as StageCode[]

  it('counts disturbed asleep epochs per hour of sleep, ignoring awake epochs', () => {
    // 6 asleep epochs (codes 1/2/3) = 3 min sleep = 0.05 h; 2 of them disturbed.
    const stage = codes([2, 2, 2, 1, 3, 2])
    const apnea = [true, false, true, false, false, false]
    const bdi = bdiFromApnea(apnea, stage)
    expect(bdi.disturbedEpochs).toBe(2)
    expect(bdi.pctOfSleep).toBeCloseTo((2 / 6) * 100, 1)
    expect(bdi.perHour).toBeCloseTo(2 / ((6 * 0.5) / 60), 1)
  })

  it('drops apnea flags that fall on awake epochs (code 4)', () => {
    const stage = codes([4, 2, 4, 1])          // 2 asleep, 2 awake
    const apnea = [true, false, true, false]   // both flags land on awake epochs
    const bdi = bdiFromApnea(apnea, stage)
    expect(bdi.disturbedEpochs).toBe(0)
    expect(bdi.pctOfSleep).toBe(0)
    expect(bdi.perHour).toBe(0)
  })

  it('returns zero index when there is no sleep', () => {
    const bdi = bdiFromApnea([true, true], codes([4, 4]))
    expect(bdi.perHour).toBe(0)
    expect(bdi.pctOfSleep).toBe(0)
  })
})
