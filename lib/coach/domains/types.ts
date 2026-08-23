import type { getDb } from '@/lib/data/postgres/client'
import type { CoachPatch, PatchChange } from '../patch'

export type Db = ReturnType<typeof getDb>

export type ConsequenceKind = 'warn' | 'info' | 'good'
export interface Consequence {
  kind: ConsequenceKind
  text: string
}

/** A field whose stored value no longer matches the patch's `from`. */
export interface Drift {
  changeId: string
  field: string
  expected: string
  actual: string
}

export interface PreviewResult {
  consequences: Consequence[]
  drift: Drift[]
  /** Null when the target is gone or is not the caller's. */
  target: { id: string | null; label: string } | null
}

export type ApplyOutcome =
  | { ok: true; changeId: string; summary: string }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'stale'; drift: Drift[] }
  | { ok: false; reason: 'invalid'; detail: string }

/**
 * One of these per writable domain.
 *
 * `apply` receives only the changes the user accepted and must write **nothing** if it is going to
 * refuse — a half-applied patch is worse than a rejected one, because the confirmation the user
 * saw no longer describes what happened.
 *
 * `undo` restores from the `beforeState` that `apply` captured in the same request. Re-deriving it
 * later would read a row that may already have moved.
 */
export interface DomainHandler {
  preview(db: Db, userId: string, patch: CoachPatch): Promise<PreviewResult>
  apply(
    db: Db,
    userId: string,
    patch: CoachPatch,
    accepted: PatchChange[],
  ): Promise<
    | { ok: true; summary: string; beforeState: Record<string, unknown>; targetId: string }
    | Exclude<ApplyOutcome, { ok: true }>
  >
  undo(
    db: Db,
    userId: string,
    targetId: string,
    beforeState: Record<string, unknown>,
  ): Promise<{ ok: true } | Exclude<ApplyOutcome, { ok: true }>>
  /**
   * The target's current values, keyed by patch field — what `undoCoachChange` compares against
   * the change's `to` before restoring (Q-468).
   *
   * **The map's keys are the check's scope.** A change whose field is absent is not scalar state
   * on the target and is not compared — `removed`, `newExerciseMuscles` and the rest of the
   * create-on-swap fields describe an action, not a value that can have moved. That is the same
   * distinction apply draws with its per-domain `skip` predicates, expressed once instead of
   * five times.
   *
   * `null` means there is nothing to compare — the target is gone, or was never a row. Undo still
   * runs: a removal's undo re-inserts precisely the row that is missing, so "gone" is the expected
   * state there rather than a reason to refuse.
   */
  currentState(
    db: Db,
    userId: string,
    targetId: string,
  ): Promise<Record<string, unknown> | null>
}

/**
 * Shared drift check for scalar fields. Kept in one place so every domain refuses a moved base the
 * same way — and, since Q-468, so that undo refuses one by exactly the same rule.
 *
 * `side` is which end of the change the stored value is compared against:
 *
 * - **`'from'`** (apply) — "is the target still where this suggestion was written against?"
 * - **`'to'`** (undo) — "does the target still hold what this change set?" Without it, undo read
 *   its `beforeState` and wrote it back over whatever was there. Measured entirely inside the
 *   Coach's own flow: change A (Barbell→Dumbbell), change B (Dumbbell→Incline), then undo A →
 *   200 and the row became `Barbell` while the history still claimed B was in effect. Undoing
 *   everything afterwards left `Dumbbell` — a value the user never chose.
 */
export function driftAgainst(
  accepted: PatchChange[],
  current: Record<string, unknown>,
  skip: (c: PatchChange) => boolean = () => false,
  side: 'from' | 'to' = 'from',
): Drift[] {
  const out: Drift[] = []
  for (const c of accepted) {
    if (skip(c)) continue
    const actual = current[c.field]
    const expected = (c as Record<string, unknown>)[side]
    if (String(actual ?? '') !== String(expected ?? '')) {
      out.push({
        changeId: c.id,
        field: c.field,
        expected: String(expected ?? '—'),
        actual: String(actual ?? '—'),
      })
    }
  }
  return out
}
