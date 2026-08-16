import { describe, it, expect } from 'vitest'
import { computeDefaultVolumeTargets, volumeLandmarks } from '@trainingai/shared/ai-periodization/volume-targets'

const sessions = [
  { exercises: [
    { muscleGroups: ['Chest', 'Triceps'] },
    { muscleGroups: ['Shoulders'] },
  ] },
  { exercises: [
    { muscleGroups: ['Back', 'Biceps'] },
  ] },
]

describe('computeDefaultVolumeTargets', () => {
  it('emits one lowercased target per distinct muscle trained', () => {
    const t = computeDefaultVolumeTargets('hypertrophy', sessions)
    const muscles = t.map(x => x.muscleGroup).sort()
    expect(muscles).toEqual(['back', 'biceps', 'chest', 'shoulders', 'triceps'])
  })

  it('gives large muscles more weekly sets than small ones', () => {
    const t = computeDefaultVolumeTargets('hypertrophy', sessions)
    const chest = t.find(x => x.muscleGroup === 'chest')!.targetSetsPerWeek
    const biceps = t.find(x => x.muscleGroup === 'biceps')!.targetSetsPerWeek
    expect(chest).toBeGreaterThan(biceps)
  })

  it('scales targets by goal (hypertrophy > strength)', () => {
    const hyper = computeDefaultVolumeTargets('hypertrophy', sessions).find(x => x.muscleGroup === 'chest')!.targetSetsPerWeek
    const str = computeDefaultVolumeTargets('strength', sessions).find(x => x.muscleGroup === 'chest')!.targetSetsPerWeek
    expect(hyper).toBeGreaterThan(str)
  })

  it('supports the blend goals', () => {
    const pb = computeDefaultVolumeTargets('powerbuilding', sessions)
    expect(pb.find(x => x.muscleGroup === 'chest')!.targetSetsPerWeek).toBeGreaterThan(0)
  })

  it('falls back to strength landmarks for an unknown goal', () => {
    const unknown = computeDefaultVolumeTargets('nonsense', sessions).find(x => x.muscleGroup === 'chest')!.targetSetsPerWeek
    const strength = computeDefaultVolumeTargets('strength', sessions).find(x => x.muscleGroup === 'chest')!.targetSetsPerWeek
    expect(unknown).toBe(strength)
  })

  it('returns empty when no muscles are present', () => {
    expect(computeDefaultVolumeTargets('strength', [{ exercises: [{ muscleGroups: [] }] }])).toEqual([])
  })
})

describe('volumeLandmarks', () => {
  it('gives each muscle its own hypertrophy-baseline landmarks (not a large/small binary)', () => {
    // chest baseline MEV 8 / MAV 16 / MRV 22, goal multiplier 1.0 at hypertrophy
    expect(volumeLandmarks('hypertrophy', 'chest')).toEqual({ mev: 8, mav: 16, mrv: 22 })
    // strength multiplier 0.65 applied to biceps baseline (MEV 6 / MAV 14 / MRV 22)
    expect(volumeLandmarks('strength', 'biceps')).toEqual({ mev: 4, mav: 9, mrv: 14 })
  })
  it('gives biceps a wider MEV-MRV band than chest despite being smaller', () => {
    const chest = volumeLandmarks('hypertrophy', 'chest')
    const biceps = volumeLandmarks('hypertrophy', 'biceps')
    expect(biceps.mrv - biceps.mev).toBeGreaterThan(chest.mrv - chest.mev)
  })
  it('normalizes synonyms and falls back to strength for unknown goals', () => {
    expect(volumeLandmarks('hypertrophy', 'Quadriceps')).toEqual(volumeLandmarks('hypertrophy', 'quads'))
    expect(volumeLandmarks('nonsense', 'chest').mav).toBe(10)
  })
})
