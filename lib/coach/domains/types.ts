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
  /** #3896: the change cannot be made as asked (a rep range or rest outside the limits), in plain
   *  words. The card shows it and offers no Apply. Absent for every domain that cannot refuse. */
  refusal?: string
  /** #3896 F1: each relative request the preview worked out (`more_reps` → `"12-15"`). Apply carries
   *  these instead of the word, so what is stored is what the card showed. */
  resolved?: { changeId: string; to: string }[]
}

export type ApplyOutcome =
  | { ok: true; changeId: string; summary: string }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'stale'; drift: Drift[] }
  | { ok: false; reason: 'invalid'; detail: string }
  /** Gave up waiting for a lock another writer held (#4080). Nothing was written; the same request can be sent again. */
  | { ok: false; reason: 'busy' }

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
  /**
   * #3896 step 5: apply and undo run in one transaction with the `coach_changes` write, so the
   * domain's own writes and the record of them commit together. The handler receives the
   * transaction as its `db`, and may throw `StaleLiftPreference`-style errors carrying `drift` to
   * roll everything back as stale. Domains without it keep their existing, untransacted path.
   */
  transactional?: boolean
  preview(db: Db, userId: string, patch: CoachPatch): Promise<PreviewResult>
  /**
   * Reads a transactional `apply` needs that go through the connection pool, run BEFORE the
   * transaction opens so that `apply` never holds one connection while waiting on another. Its result
   * is passed to `apply` as `prepared`. Anything that must be checked against the rows the change
   * writes (a `from` value) stays in `apply`, inside the transaction.
   */
  prepare?(db: Db, userId: string, patch: CoachPatch): Promise<unknown>
  apply(
    db: Db,
    userId: string,
    patch: CoachPatch,
    accepted: PatchChange[],
    prepared?: unknown,
  ): Promise<
    | { ok: true; summary: string; beforeState: Record<string, unknown>; targetId: string }
    | Exclude<ApplyOutcome, { ok: true }>
  >
  undo(
    db: Db,
    userId: string,
    targetId: string,
    beforeState: Record<string, unknown>,
  ): Promise<{ ok: true; /** Said to the user after the summary when the undo restored nothing. */ note?: string } | Exclude<ApplyOutcome, { ok: true }>>
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

/** What a handler's `apply` returns: the written change, or a refusal. */
export type HandlerApplyResult = Awaited<ReturnType<DomainHandler['apply']>>

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
