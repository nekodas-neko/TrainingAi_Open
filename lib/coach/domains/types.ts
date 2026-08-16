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
}

/** Shared drift check for scalar fields: compare each accepted change's `from` against the value
 *  actually stored. Kept in one place so every domain refuses a moved base the same way. */
export function driftAgainst(
  accepted: PatchChange[],
  current: Record<string, unknown>,
  skip: (c: PatchChange) => boolean = () => false,
): Drift[] {
  const out: Drift[] = []
  for (const c of accepted) {
    if (skip(c)) continue
    const actual = current[c.field]
    if (String(actual ?? '') !== String((c as { from?: unknown }).from ?? '')) {
      out.push({
        changeId: c.id,
        field: c.field,
        expected: String((c as { from?: unknown }).from ?? '—'),
        actual: String(actual ?? '—'),
      })
    }
  }
  return out
}
