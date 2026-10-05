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
  /**
   * OR-209. What the MODEL returned for this exercise, exactly as parsed, before reconciliation and
   * the deterministic chain rewrote it. `model.pct` against `given.pct` is the delta RV-65's
   * remove-the-model decision turns on. **It is RAW, so `pct` is often a 0-1 fraction** (0.775 where
   * `given.pct` is 77.5; measured on the first live row): run `normalizePctFraction`
   * (`reconcile-prescription.ts`) before comparing, and note reconciliation also clamps to 30-100.
   * Null when the model omitted the exercise and reconciliation
   * backfilled it. ABSENT (not null) on a row written before 2026-10-05, which is a different fact:
   * those rows never recorded it, and cannot be backfilled, because `session_periodization` keeps one
   * overwritten row per session.
   */
  model?: { sets: number; reps: number; pct: number; restSec: number } | null
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

const pick = (e: { sets: number; reps: number; pct: number; restSec: number }) => ({ sets: e.sets, reps: e.reps, pct: e.pct, restSec: e.restSec })

/** One exercise as the model returned it, keyed by the id it echoed back. */
export interface ModelExercise { sessionExerciseId: string; sets: number; reps: number; pct: number; restSec: number }

export function buildPrescriptionShadow(input: {
  modelPhase: string
  modelPhaseAction: string
  final: AiPrescription
  rules: AiPrescription | null
  /** OR-209. Omit and rows carry no `model` key at all, which is what a pre-OR-209 caller means. */
  modelExercises?: readonly ModelExercise[]
}): PrescriptionShadow {
  const rulesById = new Map((input.rules?.exercises ?? []).map(e => [e.sessionExerciseId, e]))
  // The FIRST entry for an id wins, matching the de-duplication reconciliation does with the same list.
  const modelById = input.modelExercises ? new Map<string, ModelExercise>() : null
  if (modelById) for (const m of input.modelExercises!) if (!modelById.has(m.sessionExerciseId)) modelById.set(m.sessionExerciseId, m)
  return {
    modelPhase: input.modelPhase,
    modelPhaseAction: input.modelPhaseAction,
    finalPhase: input.final.phase,
    finalPhaseAction: input.final.phaseAction,
    rows: input.final.exercises.map(e => {
      const r = rulesById.get(e.sessionExerciseId)
      const row: PrescriptionShadowRow = { sessionExerciseId: e.sessionExerciseId, name: e.name, given: pick(e), rules: r ? pick(r) : null }
      if (modelById) {
        const m = modelById.get(e.sessionExerciseId)
        row.model = m ? pick(m) : null
      }
      return row
    }),
  }
}
