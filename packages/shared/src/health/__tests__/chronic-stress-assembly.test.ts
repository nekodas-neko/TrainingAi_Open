import { describe, it, expect } from 'vitest'
import {
  computeChronicStress,
  chronicStressScoreToInt,
  type ChronicStressNightSignals,
} from '../chronic-stress-assembly'
import type { DailySummaryRow } from '../daily-summary'
// Relative, not `@/` — packages/shared has no path mapping into the app root.
import { hasRealConstants } from '../../../../../lib/oura-models/__fixtures__/real-constants'

// A fully-populated synthetic night `d` (0-indexed). Small per-metric ramps keep the factor
// analysis non-singular; the values are physiologically plausible but arbitrary.
function makeRow(d: number): DailySummaryRow {
  const date = `2026-06-${String(d + 1).padStart(2, '0')}`
  return {
    date,
    sleepDurationHours: 6,
    sleepEfficiency: 90,
    deepSleepHours: 1.5,
    remSleepHours: 1.5,
    restlessPeriods: 2 + (d % 3),
    sleepLatencySec: 600,
    hrvAvgMs: 40 + d * 0.5,
    rhrLowBpm: 50 + d * 0.2,
    rhrAvgBpm: 55 + d * 0.2,
    recoveryIndexHours: 2,
    tempMeanC: 34,
    metAvg: 1.0 + d * 0.05,
    breathAvgRpm: 14,
    tempDevC: 0.1 + d * 0.001,
    hrvBaseline: null,
    rhrBaseline: null,
    tempBaseline: null,
    sleepBaseline: null,
    metBaseline: null,
    breathBaseline: null,
    nHistory: d + 1,
  }
}

const BASE_MS = 1_700_000_000_000

// Signals whose skin-temp sample aligns to an awake minute so `normTempWake` is non-NaN — the
// hardest of the 9 gated series to satisfy synthetically.
function makeSignals(d: number): ChronicStressNightSignals {
  const bedtimeStartMs = BASE_MS + d * 86_400_000
  const bedtimeStartSec = Math.floor(bedtimeStartMs / 1000)
  const bedtimeStart30s = Math.floor(bedtimeStartSec / 30) * 30
  // 480 30-sec epochs (4h): all light (2) except epochs 100-101 → 1-min index 50 is awake (4).
  const sleepPhase30Sec = Array(480).fill(2)
  sleepPhase30Sec[100] = 4
  sleepPhase30Sec[101] = 4
  const wakeSec = 50 * 60 + bedtimeStart30s
  return {
    sleepPhase30Sec,
    hrvItems: Array.from({ length: 60 }, (_, i) => 40 + d * 0.3 + (i % 7)),
    hrvMedianHR5min: [60 + d * 0.1, 61 + d * 0.1, 60 + d * 0.1],
    hrvQuality5min: [95 + (d % 3), 96, 97],
    tempSkin: [34 + d * 0.05],
    tempSkinTimestamps: [wakeSec * 1000],
    bedtimeStart: bedtimeStartMs,
    highestTemperature: 35,
  }
}

describe('computeChronicStress assembly', () => {
  // A finite score means the model cleared its own thresholds, which live in the constants. The
  // cold-start, empty-input and rounding cases below are decided before that and stay in CI.
  it.skipIf(!hasRealConstants())('produces a finite score + 5 UI contributors from 31 complete nights', () => {
    const rows: DailySummaryRow[] = Array.from({ length: 31 }, (_, d) => makeRow(d))
    const signals = new Map<string, ChronicStressNightSignals>()
    rows.forEach((r, d) => signals.set(r.date, makeSignals(d)))

    const res = computeChronicStress(rows, signals)
    expect(res).not.toBeNull()
    const score = chronicStressScoreToInt(res!.chronicStressScore)
    // The whole point of the assembly test: complete data DOES yield a score (the sandbox can't
    // otherwise prove the wiring produces a non-null value — real device data is 21+ nights away).
    expect(score).not.toBeNull()
    expect(score! >= 0 && score! <= 100).toBe(true)
    for (const c of [res!.uiFragmentation, res!.uiHeart, res!.uiSleepMotions, res!.uiActivity, res!.uiTemperature]) {
      expect(Number.isFinite(c)).toBe(true)
    }
  })

  it('returns a null-able (NaN) score with too few nights (cold-start / learning state)', () => {
    const rows: DailySummaryRow[] = Array.from({ length: 10 }, (_, d) => makeRow(d))
    const signals = new Map<string, ChronicStressNightSignals>()
    rows.forEach((r, d) => signals.set(r.date, makeSignals(d)))

    const res = computeChronicStress(rows, signals)
    expect(res).not.toBeNull()
    expect(chronicStressScoreToInt(res!.chronicStressScore)).toBeNull()
  })

  it('empty input → null', () => {
    expect(computeChronicStress([], new Map())).toBeNull()
  })

  it('chronicStressScoreToInt rounds and maps NaN → null', () => {
    expect(chronicStressScoreToInt(NaN)).toBeNull()
    expect(chronicStressScoreToInt(42.6)).toBe(43)
    expect(chronicStressScoreToInt(Infinity)).toBeNull()
  })
})
