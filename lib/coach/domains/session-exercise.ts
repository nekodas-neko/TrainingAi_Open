import { and, eq } from 'drizzle-orm'
import * as s from '@/lib/data/postgres/schema'
import { normalizeMuscle } from '@trainingai/shared/muscles'
import { FIELD_LABEL, type PatchChange } from '../patch'
import type { Consequence, DomainHandler, Db, PreviewResult } from './types'
import { driftAgainst } from './types'

interface TargetRow {
  id: string
  sessionId: string
  exerciseName: string
  exerciseId: string | null
  styleId: string | null
  position: number
  muscleGroups: string[]
  sessionName: string
}

/** Ownership by join: `session_exercises` has no `user_id`, and the id comes from the client. */
async function loadTarget(db: Db, userId: string, id: string): Promise<TargetRow | null> {
  const [row] = await db
    .select({
      id: s.sessionExercises.id,
      sessionId: s.sessionExercises.sessionId,
      exerciseName: s.sessionExercises.exerciseName,
      exerciseId: s.sessionExercises.exerciseId,
      styleId: s.sessionExercises.styleId,
      position: s.sessionExercises.position,
      muscleGroups: s.sessionExercises.muscleGroups,
      sessionName: s.programSessions.name,
    })
    .from(s.sessionExercises)
    .innerJoin(s.programSessions, eq(s.sessionExercises.sessionId, s.programSessions.id))
    .innerJoin(s.programs, eq(s.programSessions.programId, s.programs.id))
    .where(and(eq(s.sessionExercises.id, id), eq(s.programs.userId, userId)))
    .limit(1)
  return (row as TargetRow) ?? null
}

async function muscleDelta(
  db: Db,
  currentMuscles: string[],
  replacementName: string | null,
  /** Muscles proposed for an exercise that does not exist yet — the only case where the coverage
   *  delta cannot be read from the catalogue, and is still known rather than guessed. */
  proposedMuscles?: string[],
) {
  const current = new Set(currentMuscles.map(normalizeMuscle))
  if (!replacementName) return { dropped: [...current], added: [] as string[] }

  const [replacement] = await db
    .select({ muscles: s.exerciseLibrary.muscles })
    .from(s.exerciseLibrary)
    .where(eq(s.exerciseLibrary.name, replacementName))
    .limit(1)
  // Unknown replacement and nothing proposed: say nothing rather than guess. A wrong coverage claim
  // is worse than a missing one, and apply rejects an unknown exercise anyway.
  if (!replacement && !proposedMuscles?.length) return { dropped: [] as string[], added: [] as string[] }

  const next = new Set(
    replacement
      ? (replacement.muscles as { muscle: string }[] | null ?? []).map(m => normalizeMuscle(m.muscle))
      : proposedMuscles!.map(normalizeMuscle),
  )
  return {
    dropped: [...current].filter(m => !next.has(m)),
    added: [...next].filter(m => !current.has(m)),
  }
}

function formatList(items: string[]): string {
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** `"Hamstrings, Lower back"` → main-role assignments. Split on commas only; a muscle name can
 *  contain a space ("Lower back") and splitting on those would shred it into two bogus groups. */
function parseMuscleList(raw: string): { muscle: string; role: 'main' }[] {
  return raw
    .split(',')
    .map(m => m.trim())
    .filter(Boolean)
    .map(muscle => ({ muscle, role: 'main' as const }))
}

/**
 * Create the catalogue entry a swap names but the library does not have.
 *
 * Only reachable when the patch carries `newExerciseMuscles`, so it can never fire from a plain
 * swap whose `to` was a typo — that still refuses with "is not in the exercise library".
 *
 * **Admin-gated, matching `POST /api/exercises` exactly.** `exercise_library` is a single shared
 * catalogue keyed by a unique name, so a row one person adds is a row everybody sees; that is why
 * the existing route gates it, and Coach must not become the way around a policy it did not set.
 * Widening it to all users is an owner decision, not a side effect of adding a widget.
 */
async function createMissingExercise(
  db: Db,
  userId: string,
  name: string,
  accepted: PatchChange[],
): Promise<{ id: string; muscles: { muscle: string }[] } | { error: string }> {
  const musclesChange = accepted.find(c => c.field === 'newExerciseMuscles')
  if (!musclesChange) return { error: `"${name}" is not in the exercise library` }

  const [user] = await db
    .select({ isAdmin: s.users.isAdmin })
    .from(s.users)
    .where(eq(s.users.id, userId))
    .limit(1)
  if (!user?.isAdmin) {
    return { error: `Adding "${name}" to the shared exercise library needs an admin account` }
  }

  const muscles = parseMuscleList(musclesChange.to as string)
  if (muscles.length === 0) return { error: `No muscles given for "${name}"` }

  const equipmentChange = accepted.find(c => c.field === 'newExerciseEquipment')
  const equipment = equipmentChange
    ? (equipmentChange.to as string).split(',').map(e => e.trim()).filter(Boolean)
    : []

  const [created] = await db
    .insert(s.exerciseLibrary)
    .values({ name, muscles, equipment, createdBy: userId })
    .returning({ id: s.exerciseLibrary.id })

  return { id: created.id, muscles }
}

export const sessionExerciseHandler: DomainHandler = {
  async preview(db, userId, patch): Promise<PreviewResult> {
    if (!patch.targetId) return { consequences: [], drift: [], target: null }
    const row = await loadTarget(db, userId, patch.targetId)
    if (!row) return { consequences: [], drift: [], target: null }

    const drift = driftAgainst(patch.changes, row as unknown as Record<string, unknown>, c => c.field === 'removed')

    const consequences: Consequence[] = []
    const swap = patch.changes.find(c => c.field === 'exerciseName')
    const removal = patch.changes.find(c => c.field === 'removed')

    // A swap to a name the catalogue does not have creates it — say so before it happens, and say
    // what it will be recorded as training, because those muscles go on to drive deload weighting,
    // muscle recovery and volume ACWR.
    const newMuscles = patch.changes.find(c => c.field === 'newExerciseMuscles')
    const proposedMuscles = newMuscles
      ? (newMuscles.to as string).split(',').map(m => m.trim()).filter(Boolean)
      : undefined
    if (swap && proposedMuscles?.length) {
      const [existing] = await db
        .select({ id: s.exerciseLibrary.id })
        .from(s.exerciseLibrary)
        .where(eq(s.exerciseLibrary.name, swap.to as string))
        .limit(1)
      if (!existing) {
        consequences.push({
          kind: 'info',
          text: `Adds "${swap.to}" to the exercise library, recorded as training ${formatList(proposedMuscles)}`,
        })
      }
    }

    if (swap || removal) {
      const delta = await muscleDelta(db, row.muscleGroups, swap ? (swap.to as string) : null, proposedMuscles)
      if (delta.dropped.length > 0) {
        consequences.push({ kind: 'warn', text: `Stops training ${formatList(delta.dropped)} in this session` })
      }
      if (delta.added.length > 0) {
        consequences.push({ kind: 'good', text: `Adds ${formatList(delta.added)}` })
      }

      const [pr] = await db
        .select({ estimated1rm: s.personalRecords.estimated1rm })
        .from(s.personalRecords)
        .where(and(eq(s.personalRecords.userId, userId), eq(s.personalRecords.exerciseName, row.exerciseName)))
        .limit(1)
      if (pr) {
        consequences.push({
          kind: 'info',
          text: `Your ${Math.round(pr.estimated1rm)} kg ${row.exerciseName} record is kept, but stops progressing`,
        })
      }
    }

    consequences.push({
      kind: 'good',
      text: `Takes effect next time you train ${row.sessionName} — no logged history changes`,
    })

    return { consequences, drift, target: { id: row.id, label: `${row.exerciseName} in ${row.sessionName}` } }
  },

  async apply(db, userId, patch, accepted) {
    if (!patch.targetId) return { ok: false, reason: 'invalid', detail: 'No exercise selected' }
    const row = await loadTarget(db, userId, patch.targetId)
    if (!row) return { ok: false, reason: 'not_found' }

    // `removed` carries plain booleans so the tool schema stays Gemini-compatible (see patch.ts),
    // which means "remove this" has to be checked here rather than by the type.
    const badRemoval = accepted.find(c => c.field === 'removed' && c.to !== true)
    if (badRemoval) return { ok: false, reason: 'invalid', detail: 'A removal must set `to` to true' }

    const drift = driftAgainst(accepted, row as unknown as Record<string, unknown>, c => c.field === 'removed')
    if (drift.length > 0) return { ok: false, reason: 'stale', drift }

    // Resolve a swap before writing anything, so a bad name fails the whole apply rather than
    // leaving a half-applied patch behind.
    const swap = accepted.find(c => c.field === 'exerciseName')
    let replacement: { id: string; muscles: { muscle: string }[] } | null = null
    if (swap) {
      const [entry] = await db
        .select({ id: s.exerciseLibrary.id, muscles: s.exerciseLibrary.muscles, mergedInto: s.exerciseLibrary.mergedInto })
        .from(s.exerciseLibrary)
        .where(eq(s.exerciseLibrary.name, swap.to as string))
        .limit(1)
      if (!entry) {
        const created = await createMissingExercise(db, userId, swap.to as string, accepted)
        if ('error' in created) return { ok: false, reason: 'invalid', detail: created.error }
        replacement = created
      } else {
        // A merged-away catalogue row is kept only so historical FKs stay valid (migration 165) — it
        // must never become a new selection.
        if (entry.mergedInto) return { ok: false, reason: 'invalid', detail: `"${swap.to}" has been merged into another exercise` }
        replacement = { id: entry.id, muscles: (entry.muscles as { muscle: string }[] | null) ?? [] }
      }
    }

    const beforeState = captureBefore(accepted, row)

    if (accepted.some(c => c.field === 'removed')) {
      await db.delete(s.sessionExercises).where(eq(s.sessionExercises.id, row.id))
    } else {
      const set: Record<string, unknown> = { updatedAt: new Date() }
      for (const c of accepted) {
        if (c.field === 'exerciseName' && replacement) {
          set.exerciseName = c.to
          set.exerciseId = replacement.id
          set.muscleGroups = replacement.muscles.map(m => m.muscle)
        } else if (c.field === 'styleId') set.styleId = c.to
        else if (c.field === 'position') set.position = c.to
      }
      await db.update(s.sessionExercises).set(set).where(eq(s.sessionExercises.id, row.id))
    }

    return { ok: true, summary: summarize(accepted, row), beforeState, targetId: row.id }
  },

  async undo(db, userId, targetId, before) {
    if (before.removed) {
      const r = before.removed as Record<string, unknown>
      await db.insert(s.sessionExercises).values({
        sessionId: r.sessionId as string,
        exerciseName: r.exerciseName as string,
        exerciseId: (r.exerciseId as string | null) ?? null,
        styleId: (r.styleId as string | null) ?? null,
        position: r.position as number,
        muscleGroups: (r.muscleGroups as string[]) ?? [],
      })
      return { ok: true }
    }

    // Re-verify ownership on the way back: the row may have been deleted or reassigned since.
    const row = await loadTarget(db, userId, targetId)
    if (!row) return { ok: false, reason: 'not_found' }

    const set: Record<string, unknown> = { updatedAt: new Date() }
    if ('exerciseName' in before) {
      set.exerciseName = before.exerciseName
      set.muscleGroups = before.muscleGroups ?? []
      // `in` rather than a truthiness check: the FK is legitimately null on rows that predate the
      // catalogue link, and null is the value to restore.
      if ('exerciseId' in before) set.exerciseId = before.exerciseId ?? null
    }
    if ('styleId' in before) set.styleId = before.styleId
    if ('position' in before) set.position = before.position
    await db.update(s.sessionExercises).set(set).where(eq(s.sessionExercises.id, targetId))
    return { ok: true }
  },
}

/** Only the fields being written, so undo restores exactly what changed and nothing else. */
function captureBefore(accepted: PatchChange[], target: TargetRow): Record<string, unknown> {
  const before: Record<string, unknown> = {}
  for (const c of accepted) {
    if (c.field === 'exerciseName') {
      before.exerciseName = target.exerciseName
      before.muscleGroups = target.muscleGroups
      // The FK, not just the display name. A swap writes all three; an undo that restored only the
      // name left the row reading "Barbell Romanian Deadlift" while `exercise_id` still pointed at
      // the replacement — observed 2026-08-09, and invisible to anything that reads the name.
      before.exerciseId = target.exerciseId
    } else if (c.field === 'styleId') before.styleId = target.styleId
    else if (c.field === 'position') before.position = target.position
    else if (c.field === 'removed') {
      before.removed = {
        sessionId: target.sessionId,
        exerciseName: target.exerciseName,
        exerciseId: target.exerciseId,
        styleId: target.styleId,
        position: target.position,
        muscleGroups: target.muscleGroups,
      }
    }
  }
  return before
}

function summarize(accepted: PatchChange[], target: TargetRow): string {
  const swap = accepted.find(c => c.field === 'exerciseName')
  if (swap) return `Swapped ${target.exerciseName} → ${swap.to} in ${target.sessionName}`
  if (accepted.some(c => c.field === 'removed')) return `Removed ${target.exerciseName} from ${target.sessionName}`
  return `Updated ${target.exerciseName} in ${target.sessionName} (${accepted.map(c => FIELD_LABEL[c.field]).join(', ')})`
}
