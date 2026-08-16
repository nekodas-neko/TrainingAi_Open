import { describe, it, expect } from 'vitest'
import { computeSetHrStats, type RichSetMarker, type HrBaseline } from '../set-hr-stats'
import type { HrReading } from '../hr-analysis'

// Readings authored at explicit seconds-from-epoch so every derived metric is hand-verifiable.
function readings(pairs: [number, number][]): HrReading[] {
  return pairs.map(([tSec, bpm]) => ({ timestamp: new Date(tSec * 1000), bpm }))
}

const baseline: HrBaseline = { maxHr: 190, restingHr: 60 }

// One 30s set (start 10s, end 40s) peaking at 170, then a 60s rest that decays to 80.
const SET1: RichSetMarker = {
  setLogId: 'set-1', exerciseLogId: 'ex-1', exerciseId: 'exid-1', exerciseName: 'Bench Press',
  setNumber: 1, phaseType: 'peak', intensityPct: 90, plannedPct: 90,
  restTakenSec: 60, plannedRestSec: 60, setStartMs: 10_000, setEndMs: 40_000, loggedAt: new Date(40_000),
}

const R1 = readings([
  [5, 88], [8, 90],                                  // pre-set baseline ~90
  [12, 120], [20, 145], [30, 160], [38, 170], [40, 165], // working set: peak 170, end 165
  [45, 150], [50, 135], [60, 120], [70, 105], [80, 95], [90, 88], [100, 80], // rest decay
])

describe('computeSetHrStats — fully-worked single set', () => {
  const [row] = computeSetHrStats(R1, [SET1], baseline)

  it('peak/avg over the true working-set window', () => {
    expect(row.peakBpm).toBe(170)
    expect(row.avgBpm).toBe(152) // mean(120,145,160,170,165)
    expect(row.bpmAtEnd).toBe(165)
  })

  it('drop curve — beats lost during rest at fixed offsets', () => {
    expect(row.drop30s).toBe(60)  // 165 − bpm@70s(105)
    expect(row.drop60s).toBe(85)  // 165 − bpm@100s(80); rest ≥ 60s so == classic HRR1
    expect(row.troughBpm).toBe(80)
  })

  it('return-to-pre-set recovers within the rest window', () => {
    expect(row.secToPreset).toBe(50) // HR first ≤ 90 at 90s → 90−40
    expect(row.recoveredPreset).toBe(true)
  })

  it('return-to-resting is censored (never reached within rest)', () => {
    expect(row.secToResting).toBeNull()
    expect(row.recoveredResting).toBe(false) // hadData, but never crossed 60
  })

  it('%HRR recovered by rest end + time to 50% HRR', () => {
    expect(row.pctHrrAtRestEnd).toBe(82) // (170−80)/(170−60)
    expect(row.secToHrr50).toBe(30)      // ≤115 first at 70s → 70−40
  })

  it('coverage + carried dimensions', () => {
    expect(row.coverageOk).toBe(true)
    expect(row.readingsCount).toBe(12)
    expect(row.intensityPct).toBe(90)
    expect(row.phaseType).toBe('peak')
    expect(row.restAdequate).toBe(true) // hrr1 85 ≥ 15
  })
})

describe('computeSetHrStats — edge cases', () => {
  it('sparse coverage flags coverage_ok false', () => {
    const sparse = readings([[40, 150], [90, 100]]) // 2 samples across the span
    const [row] = computeSetHrStats(sparse, [SET1], baseline)
    expect(row.coverageOk).toBe(false)
  })

  it('no per-set timing → proxy peak from legacy, rest metrics still bounded', () => {
    const noTiming: RichSetMarker = { ...SET1, setStartMs: null, setEndMs: null }
    const [row] = computeSetHrStats(R1, [noTiming], baseline)
    // avg needs a real window → null; peak falls back to the legacy proxy (non-null here).
    expect(row.avgBpm).toBeNull()
    expect(row.peakBpm).not.toBeNull()
  })

  it('empty readings → all HR metrics null, no throw', () => {
    const [row] = computeSetHrStats([], [SET1], baseline)
    expect(row.peakBpm).toBeNull()
    expect(row.drop60s).toBeNull()
    expect(row.secToPreset).toBeNull()
    expect(row.recoveredPreset).toBeNull() // no data to look at → unknown, not false
    expect(row.coverageOk).toBe(false)
  })

  it('recovery horizon is bounded by the NEXT set start, not the full rest cap', () => {
    const setA: RichSetMarker = { ...SET1, setLogId: 'a', restTakenSec: null }
    // Next set starts at 55s → only 15s of rest observed; a +60s drop point is past the horizon.
    const setB: RichSetMarker = { ...SET1, setLogId: 'b', setNumber: 2, setStartMs: 55_000, setEndMs: 70_000, loggedAt: new Date(70_000) }
    const [rowA] = computeSetHrStats(R1, [setA, setB], baseline)
    expect(rowA.drop60s).toBeNull() // 40s+60s = 100s ≫ next start 55s
    expect(rowA.drop30s).toBeNull() // 70s > 55s horizon too
  })
})

// Provenance per set (2026-08-05). The `source` column has existed since migration 139 and was
// never written — 582 production rows, all null — so a set's HR carried no record of which device
// measured it. Strap and ring differ in accuracy under load, and "were those sets ring-only?" is
// the first question asked of any suspect per-set HR.
describe('computeSetHrStats — source', () => {
  const withSource = (pairs: [number, number, string | null][]) =>
    pairs.map(([tSec, bpm, source]) => ({ timestamp: new Date(tSec * 1000), bpm, source }))

  it('reports the single device that measured the working set', () => {
    const [row] = computeSetHrStats(
      withSource([[12, 120, 'chest_strap'], [30, 160, 'chest_strap'], [38, 170, 'chest_strap']]),
      [SET1], baseline)
    expect(row.source).toBe('chest_strap')
  })

  it('reports mixed when the set window spans two devices', () => {
    const [row] = computeSetHrStats(
      withSource([[12, 120, 'chest_strap'], [30, 160, 'oura_ble'], [38, 170, 'chest_strap']]),
      [SET1], baseline)
    expect(row.source).toBe('mixed')
  })

  it('is null when nothing in the window carried a source', () => {
    // Not 'unknown' — a made-up label would be indistinguishable from a real one.
    const [row] = computeSetHrStats(R1, [SET1], baseline)
    expect(row.source).toBeNull()
  })

  it('reads only the working-set window, not the rest that follows', () => {
    // The rest period is where the ring takes over when a strap is removed mid-workout; attributing
    // the ring to the SET would be wrong.
    const [row] = computeSetHrStats(
      withSource([[12, 120, 'chest_strap'], [38, 170, 'chest_strap'], [60, 120, 'oura_ble'], [90, 88, 'oura_ble']]),
      [SET1], baseline)
    expect(row.source).toBe('chest_strap')
  })

  it('falls back to the whole reading set when the set has no usable window', () => {
    // A set with no start/end still reports the device it was measured on rather than nothing.
    const noWindow: RichSetMarker = { ...SET1, setStartMs: null, setEndMs: null }
    const [row] = computeSetHrStats(
      withSource([[12, 120, 'oura_ble'], [38, 170, 'oura_ble']]), [noWindow], baseline)
    expect(row.source).toBe('oura_ble')
  })
})
