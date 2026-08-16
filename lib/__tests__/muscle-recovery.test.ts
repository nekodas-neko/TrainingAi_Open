import { describe, it, expect } from 'vitest'
import { computeMuscleRecovery } from '@trainingai/shared/ai-periodization/muscle-recovery'

const NOW = Date.parse('2026-07-01T00:00:00Z')
const library = [
  { id: 'e1', name: 'Bench Press', muscles: [{ muscle: 'chest', role: 'main' as const }], equipment: [], exerciseType: 'weighted' as const },
]
const session = (hoursAgo: number, volume: number) => ({
  id: `ws-${hoursAgo}`, startedAt: new Date(NOW - hoursAgo * 3_600_000),
  exercises: [{ exerciseName: 'Bench Press', volume }],
}) as never // cast to WorkoutSession-compatible; keep only the fields computeMuscleRecovery reads

describe('computeMuscleRecovery — volume-scaled time constant (C10)', () => {
  it('a typical-volume bout recovers on the 24h constant: 63% at 24h', () => {
    // ratio = latest bout 1000 / median 1000 = 1 → tau 24 → pct = 100×(1−e^(−24/24)) = 63.212 → 63
    const out = computeMuscleRecovery([session(24, 1000)], library, { now: NOW })
    expect(out).toEqual([{ muscle: 'chest', pct: 63, hoursAgo: 24 }])
  })

  it('a double-volume bout recovers slower', () => {
    // bouts [1000, 1000, 2000] → median 1000; latest bout 2000 → ratio 2 → tau = clamp(48,16,48) = 48
    // pct at 24h = 100×(1−e^(−24/48)) = 39.347 → 39
    const out = computeMuscleRecovery([session(24, 2000), session(96, 1000), session(168, 1000)], library, { now: NOW })
    expect(out.find(m => m.muscle === 'chest')!.pct).toBe(39)
  })

  it('a light bout recovers faster (tau floors at 16h)', () => {
    // latest 500 vs median 1000 → ratio 0.5 → tau = clamp(12,16,48) = 16 → 100×(1−e^(−24/16)) = 77.687 → 78
    const out = computeMuscleRecovery([session(24, 500), session(96, 1000), session(168, 1000)], library, { now: NOW })
    expect(out.find(m => m.muscle === 'chest')!.pct).toBe(78)
  })
})
