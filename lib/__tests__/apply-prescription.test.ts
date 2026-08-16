import { describe, it, expect } from 'vitest'
import { prescriptionDrivesLoad, prescriptionStyleForExercise } from '@trainingai/shared/ai-periodization/apply-prescription'
import { calculate1RM } from '@trainingai/shared/1rm'
import type { AiPrescriptionExercise } from '@trainingai/shared/types/ai-periodization'

describe('prescriptionDrivesLoad', () => {
  it('drives load when accepted, regardless of action', () => {
    expect(prescriptionDrivesLoad('stay', 'accepted')).toBe(true)
    expect(prescriptionDrivesLoad('transition_recommended', 'accepted')).toBe(true)
    expect(prescriptionDrivesLoad('deload_recommended', 'accepted')).toBe(true)
  })

  it('drives load when auto-applied', () => {
    expect(prescriptionDrivesLoad('stay', 'auto_applied')).toBe(true)
  })

  it('drives load for a pending plain "stay" (the default-on case)', () => {
    expect(prescriptionDrivesLoad('stay', 'pending')).toBe(true)
  })

  // A phase transition changes which block you're in NEXT; it says nothing about today's
  // numbers, which went through the full reconcile → autoregulation → time-budget chain.
  // Discarding them left 4 of 5 live sessions silently running the base progression style
  // (prod audit 2026-07-28) — the transition itself still needs explicit acceptance.
  it('drives load for a pending phase transition — the numbers apply, the phase change waits', () => {
    expect(prescriptionDrivesLoad('transition_recommended', 'pending')).toBe(true)
  })

  it('does NOT drive load for a pending recovery decision', () => {
    expect(prescriptionDrivesLoad('deload_recommended', 'pending')).toBe(false)
    expect(prescriptionDrivesLoad('session_swap_recommended', 'pending')).toBe(false)
    expect(prescriptionDrivesLoad('rest_day_recommended', 'pending')).toBe(false)
  })

  it('does NOT drive load when dismissed or none', () => {
    expect(prescriptionDrivesLoad('stay', 'dismissed')).toBe(false)
    expect(prescriptionDrivesLoad('stay', 'consumed')).toBe(false)
    expect(prescriptionDrivesLoad('stay', 'none')).toBe(false)
  })
})

describe('prescriptionStyleForExercise', () => {
  const presc: AiPrescriptionExercise = {
    sessionExerciseId: 'se-1',
    name: 'Barbell Bench Press',
    sets: 5,
    reps: 6,
    pct: 72.5,
    restSec: 180,
  }

  it('expands into one style set per prescribed set, all carrying the same pct/reps/rest', () => {
    const style = prescriptionStyleForExercise(presc)
    expect(style).toHaveLength(5)
    for (const s of style) {
      expect(s.pct).toBe(72.5)
      expect(s.reps).toBe(6)
      expect(s.restSec).toBe(180)
      expect(s.useFor1rm).toBe(true)
    }
  })

  it('honours a single-set prescription', () => {
    expect(prescriptionStyleForExercise({ ...presc, sets: 1 })).toHaveLength(1)
  })
})

describe('1RM behaviour through the prescription style (last-set push)', () => {
  const presc: AiPrescriptionExercise = {
    sessionExerciseId: 'se-1', name: 'Bench', sets: 5, reps: 5, pct: 72.5, restSec: 180,
  }
  const style = prescriptionStyleForExercise(presc)
  const prev1rm = 100
  const weight = Math.ceil((prev1rm * presc.pct / 100) / 1.25) * 1.25 // the loaded bar weight
  const weights = Array(5).fill(weight)

  it('hitting the prescription exactly reproduces the current 1RM (flat)', () => {
    const { estimated1rm } = calculate1RM(weights, [5, 5, 5, 5, 5], style)
    expect(estimated1rm).toBeCloseTo(100, 0)
  })

  it('beating the last set raises the estimated 1RM', () => {
    const flat = calculate1RM(weights, [5, 5, 5, 5, 5], style).estimated1rm
    const amrap = calculate1RM(weights, [5, 5, 5, 5, 6], style).estimated1rm // AMRAP / +1 last set
    expect(amrap).toBeGreaterThan(flat)
  })

  it('missing the prescription lowers the estimate (self-regulating)', () => {
    const flat = calculate1RM(weights, [5, 5, 5, 5, 5], style).estimated1rm
    const missed = calculate1RM(weights, [5, 5, 5, 4, 4], style).estimated1rm
    expect(missed).toBeLessThan(flat)
  })
})
