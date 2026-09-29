import type { AiPrescription, AiPrescriptionExercise } from '@trainingai/shared/types/ai-periodization'

/**
 * BF-199 Phase 1: what the rules prescriber WOULD have said, beside what the lifter was given.
 *
 * Nothing reads this to decide anything. It exists so Phase 2 can be judged on evidence: how
 * often rules and model agree on reps and pct, what the rest values really look like, and how
 * often the model's own phase decision survives reconciliation, which nobody has measured.
 * Plan: docs/superpowers/plans/2026-09-29-rules-prescription-engine.md.
 */
export interface PrescriptionShadowRow {
  sessionExerciseId: string
  name: string
  given: { sets: number; reps: number; pct: number; restSec: number }
  /** Null when the rules path had nothing for this exercise (no style), which is itself a finding. */
  rules: { sets: number; reps: number; pct: number; restSec: number } | null
}

export interface PrescriptionShadow {
  /** The model's own answer, before reconciliation rewrote it. */
  modelPhase: string
  modelPhaseAction: string
  /** What was stored and shown. */
  finalPhase: string
  finalPhaseAction: string
  rows: PrescriptionShadowRow[]
}

const pick = (e: AiPrescriptionExercise) => ({ sets: e.sets, reps: e.reps, pct: e.pct, restSec: e.restSec })

export function buildPrescriptionShadow(input: {
  modelPhase: string
  modelPhaseAction: string
  final: AiPrescription
  rules: AiPrescription | null
}): PrescriptionShadow {
  const rulesById = new Map((input.rules?.exercises ?? []).map(e => [e.sessionExerciseId, e]))
  return {
    modelPhase: input.modelPhase,
    modelPhaseAction: input.modelPhaseAction,
    finalPhase: input.final.phase,
    finalPhaseAction: input.final.phaseAction,
    rows: input.final.exercises.map(e => {
      const r = rulesById.get(e.sessionExerciseId)
      return { sessionExerciseId: e.sessionExerciseId, name: e.name, given: pick(e), rules: r ? pick(r) : null }
    }),
  }
}
