import { describe, it, expect } from 'vitest'
import { sixMwtVo2max, cooperVo2max, baselineHrr1, restingHrFrom, maxHrFrom } from '../fitness-tests'
import type { HrReading } from '@trainingai/shared/workout/hr-analysis'

describe('sixMwtVo2max', () => {
  it('uses Burr 2011 (healthy-adult) when profile terms are present', () => {
    // 70.161 + 0.023·600 − 0.276·80 − 6.79·0 − 0.193·60 − 0.191·30
    //   = 70.161 + 13.8 − 22.08 − 0 − 11.58 − 5.73 = 44.571 → 44.6
    expect(sixMwtVo2max({ distanceM: 600, age: 30, sex: 'male', weightKg: 80, restingHr: 60 })).toBe(44.6)
  })

  it('subtracts the female sex term', () => {
    // 70.161 + 13.8 − 0.276·65 − 6.79 − 11.58 − 5.73 = 41.921 → 41.9
    expect(sixMwtVo2max({ distanceM: 600, age: 30, sex: 'female', weightKg: 65, restingHr: 60 })).toBe(41.9)
  })

  it('falls back to Ross 2010 (distance-only) when profile terms are missing', () => {
    // 4.948 + 0.023·500 = 16.448 → 16.4
    expect(sixMwtVo2max({ distanceM: 500, age: null, sex: null, weightKg: null, restingHr: null })).toBe(16.4)
  })
})

describe('cooperVo2max (Cooper 1968: (metres − 504.9)/44.73)', () => {
  it('computes VO2max from 12-minute run distance', () => {
    expect(cooperVo2max(2400)).toBe(42.4) // (2400−504.9)/44.73 = 42.37 → 42.4
  })
})

describe('baselineHrr1 (reuses analyseHrRecovery — no re-implementation)', () => {
  it('anchors recovery at the peak-HR instant and returns the drop 60s later (E2-9)', () => {
    const t0 = new Date('2026-07-17T10:00:00Z')
    // rest → hard effort (peak at +90s) → post-effort rest recorded (peak+60s = +150s).
    const readings: HrReading[] = [
      { timestamp: t0, bpm: 70 },
      { timestamp: new Date(t0.getTime() + 90_000), bpm: 160 },   // peak = end of effort
      { timestamp: new Date(t0.getTime() + 150_000), bpm: 120 },  // 60s into recovery
    ]
    // Peak 160 − bpm at peak+60s (120) = 40; all samples are inside the capture.
    expect(baselineHrr1(readings)).toBe(40)
  })
  it('returns null when no post-peak rest minute was captured', () => {
    const t0 = new Date('2026-07-17T10:00:00Z')
    const readings: HrReading[] = [
      { timestamp: t0, bpm: 70 },
      { timestamp: new Date(t0.getTime() + 90_000), bpm: 160 }, // peak at the very end
    ]
    expect(baselineHrr1(readings)).toBeNull()
  })

  it('computes the drop from a full guided rest→effort→recovery capture', () => {
    // Simulate a phased HRR test: 60s rest, 60s effort (peak at +120s), 60s recovery, one sample / 5s.
    // The guided recovery phase keeps recording, so peak-anchored baselineHrr1 has the +60s sample.
    const start = new Date('2026-07-17T10:00:00Z').getTime()
    const readings: HrReading[] = []
    for (let t = 0; t <= 180; t += 5) {
      const bpm =
        t < 60 ? 70 :                          // rest
        t < 120 ? 70 + (t - 60) * 1.4 :        // effort ramps to ~154
        154 - (t - 120) * 0.9                  // recovery falls back toward 100
      readings.push({ timestamp: new Date(start + t * 1000), bpm: Math.round(bpm) })
    }
    // Peak (~154 at +120s) minus HR 60s later (~100 at +180s) → a real, positive drop.
    const drop = baselineHrr1(readings)
    expect(drop).not.toBeNull()
    expect(drop!).toBeGreaterThan(30)
  })
})

describe('restingHrFrom / maxHrFrom', () => {
  // A realistic capture: HR climbing to a 165 plateau, plus one 214 bpm motion artefact.
  const at = (i: number) => new Date(i * 1000)
  const readings: HrReading[] = [
    ...[58, 60, 62, 64, 66].map((bpm, i) => ({ timestamp: at(i), bpm })),
    ...Array.from({ length: 10 }, (_, i) => ({ timestamp: at(10 + i), bpm: 165 })),
    { timestamp: at(30), bpm: 214 }, // artefact — in-band, so only corroboration rejects it
  ]

  it('max is the corroborated plateau, not the lone spike', () => {
    expect(maxHrFrom(readings)).toBe(165)
  })
  it('resting is the corroborated low, not the single lowest sample', () => {
    // 5th-lowest of 58/60/62/64/66/165x10/214 — a lone dropout can't set a resting HR.
    expect(restingHrFrom(readings)).toBe(66)
  })
  it('drops readings outside the plausible band outright', () => {
    const withGarbage = [...readings, ...Array.from({ length: 8 }, (_, i) => ({ timestamp: at(40 + i), bpm: 250 }))]
    // Eight corroborating 250s still can't set the max — 250 is not a human heart rate.
    expect(maxHrFrom(withGarbage)).toBe(165)
  })
  it('too few readings to corroborate → null rather than an unverified peak', () => {
    const sparse: HrReading[] = [
      { timestamp: at(0), bpm: 62 },
      { timestamp: at(1), bpm: 58 },
      { timestamp: at(2), bpm: 165 },
    ]
    expect(maxHrFrom(sparse)).toBeNull()
    expect(restingHrFrom(sparse)).toBeNull()
  })
  it('empty → null', () => {
    expect(restingHrFrom([])).toBeNull()
    expect(maxHrFrom([])).toBeNull()
  })
})
