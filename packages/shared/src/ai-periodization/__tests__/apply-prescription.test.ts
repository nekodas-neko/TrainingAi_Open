import { describe, it, expect } from 'vitest'
import { prescriptionStyleForExercise, prescriptionDrivesLoad } from '@trainingai/shared/ai-periodization/apply-prescription'
import type { AiPrescriptionExercise } from '@trainingai/shared/types/ai-periodization'

const BASE: AiPrescriptionExercise = {
  sessionExerciseId: 'ex-1',
  name: 'Incline Bench Press',
  sets: 2,
  reps: 8,
  pct: 50,
  restSec: 90,
}

describe('prescriptionStyleForExercise', () => {
  it('counts every set toward the 1RM estimate for a genuine working-pct prescription', () => {
    const style = prescriptionStyleForExercise(BASE)
    expect(style).toHaveLength(2)
    expect(style.every(s => s.useFor1rm === true)).toBe(true)
  })

  it('Q-115: excludes every set from the 1RM estimate when the exercise is deloaded — a light,\n' +
     'deliberately submaximal set run through the working-pct formula inflates the estimate', () => {
    const style = prescriptionStyleForExercise({ ...BASE, deloaded: true })
    expect(style).toHaveLength(2)
    expect(style.every(s => s.useFor1rm === false)).toBe(true)
  })
})

describe('prescriptionDrivesLoad', () => {
  it('follows an accepted or auto-applied prescription', () => {
    expect(prescriptionDrivesLoad('stay', 'accepted')).toBe(true)
    expect(prescriptionDrivesLoad('deload_recommended', 'auto_applied')).toBe(true)
  })

  it('a pending recovery decision (deload/swap/rest) only drives load once accepted', () => {
    expect(prescriptionDrivesLoad('deload_recommended', 'pending')).toBe(false)
    expect(prescriptionDrivesLoad('session_swap_recommended', 'pending')).toBe(false)
    expect(prescriptionDrivesLoad('rest_day_recommended', 'pending')).toBe(false)
  })

  it('a pending stay/transition drives load by default', () => {
    expect(prescriptionDrivesLoad('stay', 'pending')).toBe(true)
    expect(prescriptionDrivesLoad('transition_recommended', 'pending')).toBe(true)
  })
})
