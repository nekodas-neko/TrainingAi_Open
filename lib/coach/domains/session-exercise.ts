import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { hasVisibleCharacter, BLANK_EXERCISE_NAME_MESSAGE } from '@trainingai/shared/validation/visible-name'
import { recommendExerciseRole, UNCLASSIFIED_EXERCISE_ROLE } from '@trainingai/shared/workout/exercise-role'
import { isLighterRole } from '@trainingai/shared/ai-periodization/role-plausibility'
import type { ExerciseRole } from '@trainingai/shared/types/program'
import * as s from '@/lib/data/postgres/schema'
import { progressionStyleIdsOwned } from '@/lib/data/postgres/slices/programs'
import { voidSessionPrescription } from '@/lib/data/postgres/slices/periodization'
import { normalizeMuscle } from '@trainingai/shared/muscles'
import { FIELD_LABEL, type PatchChange } from '../patch'
import type { Consequence, DomainHandler, Db, HandlerApplyResult, PreviewResult } from './types'
import { driftAgainst } from './types'
import { withBoundedLockWait, withDomainLock } from '../lock-wait'
import { lockProgramRow, lockProgramOfSession } from '@/lib/data/postgres/program-row-lock'

export interface TargetRow {
  id: string
  sessionId: string
  exerciseName: string
  exerciseId: string | null
  styleId: string | null
  position: number
  muscleGroups: string[]
  exerciseRole: ExerciseRole
  sessionName: string
  programId: string
  phaseMode: 'manual' | 'automatic' | 'ai_dynamic'
  /** The program's Accessory phase has a primary style, which an accessory uses over its own. */
  accessoryPhaseStyled: boolean
}

/** Under `ai_dynamic` the stored AI plan replaces the exercise's style whenever it drives the bar,
 *  and the rules fallback is the only reader left, so a style change has nothing to act on (#3895). */
const STYLE_UNUSED_UNDER_AI = 'The progression style is not used while the AI plan is on'

/** Whether an exercise's own progression style can reach the bar. `automatic` lets the phase's style
 *  override it for primary and secondary lifts (`resolveStyleForExercise`); an accessory keeps its
 *  own style only when the Accessory phase has none. */
function styleCanApply(row: TargetRow): boolean {
  if (row.phaseMode === 'ai_dynamic') return false
  if (row.phaseMode === 'automatic') return row.exerciseRole === 'accessory' && !row.accessoryPhaseStyled
  return true
}

/** A program only enters the pull delta when its `updated_at` moves, and the delta is what carries
 *  a session-exercise change to another device (the client replaces a changed program's children
 *  wholesale). Every write here that is not a `saveProgram` has to move it itself. */
function bumpProgramOfSession(db: Db, sessionId: string) {
  return db.update(s.programs).set({ updatedAt: new Date() })
    .where(sql`${s.programs.id} = (SELECT program_id FROM program_sessions WHERE id = ${sessionId})`)
}

/** Ownership by join: `session_exercises` has no `user_id`, and the id comes from the client.
 *  Also the Coach context's check (`lib/coach/context.ts`), so the two cannot disagree on what is yours. */
export async function loadTarget(db: Db, userId: string, id: string): Promise<TargetRow | null> {
  const [row] = await db
    .select({
      id: s.sessionExercises.id,
      sessionId: s.sessionExercises.sessionId,
      exerciseName: s.sessionExercises.exerciseName,
      exerciseId: s.sessionExercises.exerciseId,
      styleId: s.sessionExercises.styleId,
      position: s.sessionExercises.position,
      muscleGroups: s.sessionExercises.muscleGroups,
      exerciseRole: s.sessionExercises.exerciseRole,
      sessionName: s.programSessions.name,
      programId: s.programs.id,
      phaseMode: s.programs.phaseMode,
      accessoryPhaseStyled: sql<boolean>`EXISTS (SELECT 1 FROM program_phases pp
        WHERE pp.phase_set_id = ${s.programs.phaseSetId} AND pp.phase_type = 'accessory' AND pp.primary_style_id IS NOT NULL)`,
    })
    .from(s.sessionExercises)
    .innerJoin(s.programSessions, eq(s.sessionExercises.sessionId, s.programSessions.id))
    .innerJoin(s.programs, eq(s.programSessions.programId, s.programs.id))
    .where(and(
      eq(s.sessionExercises.id, id),
      eq(s.programs.userId, userId),
      isNull(s.sessionExercises.deletedAt),
      isNull(s.programSessions.deletedAt),
    ))
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

  // #4076: the caller read the library, found no `name`, and inserts here. A second apply landing in
  // between (an admin's double tap) used to fail this insert on the unique name as a raw 500. The
  // loser now takes the row the first one made, which is what a swap to that name should land on.
  // The insert waits on the other apply's uncommitted row, so it runs in its own small transaction with
  // the lock wait bounded (lib/coach/lock-wait.ts). It commits on its own, as the bare insert did.
  return db.transaction(async tx => {
    const t = tx as unknown as Db
    return withBoundedLockWait(t, async () => {
      const [created] = await t
        .insert(s.exerciseLibrary)
        .values({ name, muscles, equipment, createdBy: userId })
        .onConflictDoNothing({ target: s.exerciseLibrary.name })
        .returning({ id: s.exerciseLibrary.id })
      if (created) return { id: created.id, muscles }

      const [won] = await t
        .select({ id: s.exerciseLibrary.id, muscles: s.exerciseLibrary.muscles, mergedInto: s.exerciseLibrary.mergedInto })
        .from(s.exerciseLibrary)
        .where(eq(s.exerciseLibrary.name, name))
        .limit(1)
      if (!won || won.mergedInto) return { error: `"${name}" has been merged into another exercise` }
      return { id: won.id, muscles: (won.muscles as { muscle: string }[] | null) ?? [] }
    })
  })
}

export const sessionExerciseHandler: DomainHandler = {
  async currentState(db, userId, targetId) {
    const row = await loadTarget(db, userId, targetId)
    return row ? (row as unknown as Record<string, unknown>) : null
  },

  async preview(db, userId, patch): Promise<PreviewResult> {
    if (!patch.targetId) return { consequences: [], drift: [], target: null }
    const row = await loadTarget(db, userId, patch.targetId)
    if (!row) return { consequences: [], drift: [], target: null }

    const drift = driftAgainst(patch.changes, row as unknown as Record<string, unknown>, c => c.field === 'removed')

    const consequences: Consequence[] = []
    const swap = patch.changes.find(c => c.field === 'exerciseName')
    const removal = patch.changes.find(c => c.field === 'removed')

    // Q-403. The owner did not know this was a PROGRAM edit rather than a change for today, and
    // said so plainly: "You dont want to be changing excercises during a program or you will lose
    // progress for it". The card is where that has to be said — a prompt instruction is advisory
    // and the model already ignores one of them 3 times out of 3, whereas this is rendered from the
    // patch itself and cannot be forgotten. Named first so it is read before the detail below.
    if (swap || removal) {
      consequences.push({
        kind: 'warn',
        text: `Changes the ${row.sessionName} session itself, so it applies every ${row.sessionName} day from now on — not just today. Progression history on ${row.exerciseName} stops advancing. For a one-off change today, use the swap inside the workout instead.`,
      })
    }

    // A swap to a name the catalogue does not have creates it — say so before it happens, and say
    // what it will be recorded as training, because those muscles go on to drive deload weighting,
    // muscle recovery and volume ACWR.
    const newMuscles = patch.changes.find(c => c.field === 'newExerciseMuscles')
    const proposedMuscles = newMuscles
      ? (newMuscles.to as string).split(',').map(m => m.trim()).filter(Boolean)
      : undefined
    // #4129: a swap to a name with nothing visible in it would put a nameless lift in the plan.
    if (swap && !hasVisibleCharacter(String(swap.to ?? ''))) {
      return { consequences, drift, target: { id: row.id, label: `${row.exerciseName} in ${row.sessionName}` }, refusal: BLANK_EXERCISE_NAME_MESSAGE }
    }
    if (swap) {
      const [existing] = await db
        .select({
          id: s.exerciseLibrary.id,
          muscles: s.exerciseLibrary.muscles,
          equipment: s.exerciseLibrary.equipment,
        })
        .from(s.exerciseLibrary)
        .where(eq(s.exerciseLibrary.name, swap.to as string))
        .limit(1)

      if (!existing && proposedMuscles?.length) {
        consequences.push({
          kind: 'info',
          text: `Adds "${swap.to}" to the exercise library, recorded as training ${formatList(proposedMuscles)}`,
        })
      }

      // **The role stays with the slot (#2215), and the card says so either way.** The role is the
      // slot's place in the programme and selects the progression style, so it decides the
      // prescribed sets and percentages. Q-405 made a swap recompute it from the catalogue, after an
      // inherited `secondary` loaded a Jefferson Curl at 80%; the owner then met the reverse — on a
      // session with no Primary by design, the recommender PROMOTED the incoming exercise to primary
      // without being asked. A role change is now its own, asked-for edit. What Q-405 guarded against
      // survives as a warning when the incoming movement looks lighter than the slot it inherits.
      consequences.push({
        kind: 'info',
        text: `Role unchanged (${row.exerciseRole}) — the prescribed sets and percentages stay this slot's`,
      })
      const recommended = existing
        ? recommendExerciseRole({
            muscles: (existing.muscles as { muscle: string }[] | null) ?? [],
            equipment: existing.equipment ?? [],
          })
        : null
      if (recommended ? isLighterRole(recommended, row.exerciseRole) : row.exerciseRole !== 'accessory') {
        consequences.push({
          kind: 'warn',
          text: recommended
            ? `"${swap.to}" is usually trained as ${recommended === 'accessory' ? 'an accessory' : `a ${recommended}`}, and will be loaded as this slot's ${row.exerciseRole} — if that is too heavy for it, change its role in the program editor afterwards`
            : `Nothing is known about "${swap.to}" yet, and it will be loaded as this slot's ${row.exerciseRole} — if it should be lighter, change its role in the program editor afterwards`,
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

    // Only claim an effect the change has (#3895). A style change under the AI plan has none, and
    // apply refuses it; under `automatic` the phase's style wins for primary and secondary lifts.
    const styleChange = patch.changes.find(c => c.field === 'styleId')
    if (styleChange && row.phaseMode === 'ai_dynamic') {
      consequences.push({ kind: 'warn', text: `${STYLE_UNUSED_UNDER_AI}, so this change cannot be applied` })
    } else if (styleChange && !styleCanApply(row)) {
      consequences.push({
        kind: 'warn',
        text: row.exerciseRole === 'accessory'
          ? 'The Accessory phase\'s progression style is used for this accessory, so its own style has no effect while phases run automatically'
          : `The phase's progression style is used for this ${row.exerciseRole} lift, so its own style has no effect while phases run automatically`,
      })
    }
    const hasEffect = !!(swap || removal)
      || patch.changes.some(c => c.field === 'position')
      || (!!styleChange && styleCanApply(row))
    if (hasEffect) {
      consequences.push({
        kind: 'good',
        text: `Takes effect next time you train ${row.sessionName} — no logged history changes`,
      })
    }
    // The stored AI plan is voided by the apply and again by an undo; an undo puts the exercise back,
    // not the old plan (#3895 review). Said before the tap, in the words the lifter will see.
    if (hasEffect && row.phaseMode === 'ai_dynamic') {
      consequences.push({
        kind: 'info',
        text: 'Your plan for this session will be rebuilt. Undo puts the exercise back, and the plan is rebuilt again',
      })
    }

    return { consequences, drift, target: { id: row.id, label: `${row.exerciseName} in ${row.sessionName}` } }
  },

  async apply(db, userId, patch, accepted) {
    if (!patch.targetId) return { ok: false, reason: 'invalid', detail: 'No exercise selected' }
    const targetId = patch.targetId
    // #4082: read, stale check and write under one lock per user and target, so a double tap (two swaps of
    // one slot) is refused as stale instead of both writing and both recording the same "before". The swap's
    // library insert nests as a savepoint and keeps its own bounded wait.
    return withDomainLock<HandlerApplyResult>(db, userId, `session_exercise:${targetId}`, async t => {
      const row = await loadTarget(t, userId, targetId)
      if (!row) return { ok: false, reason: 'not_found' }
      // #4096: the program row first, before any exercise row or library row is written, as the editor's save
      // does (it holds the program and then deletes and re-inserts the exercises). Bounded like the domain lock:
      // a miss is the usual `busy`, nothing written.
      await withBoundedLockWait(t, () => lockProgramRow(t, row.programId))

      // `removed` carries plain booleans so the tool schema stays Gemini-compatible (see patch.ts),
      // which means "remove this" has to be checked here rather than by the type.
      const badRemoval = accepted.find(c => c.field === 'removed' && c.to !== true)
      if (badRemoval) return { ok: false, reason: 'invalid', detail: 'A removal must set `to` to true' }

      const drift = driftAgainst(accepted, row as unknown as Record<string, unknown>, c => c.field === 'removed')
      if (drift.length > 0) return { ok: false, reason: 'stale', drift }

      // `styleId` is written verbatim onto the exercise row, so it must name one of the caller's own
      // progression styles — the same check the program save route makes (RV-32). Checked before the
      // swap below, which can create a library row: a refused change leaves nothing behind.
      const styleChange = accepted.find(c => c.field === 'styleId')
      if (styleChange && row.phaseMode === 'ai_dynamic') {
        return { ok: false, reason: 'invalid', detail: STYLE_UNUSED_UNDER_AI }
      }
      if (styleChange && !(await progressionStyleIdsOwned(t, userId, [styleChange.to as string | null]))) {
        return { ok: false, reason: 'invalid', detail: 'That progression style is not one of yours' }
      }

      // Resolve a swap before writing anything, so a bad name fails the whole apply rather than
      // leaving a half-applied patch behind.
      const swap = accepted.find(c => c.field === 'exerciseName')
      if (swap && !hasVisibleCharacter(String(swap.to ?? ''))) {
        return { ok: false, reason: 'invalid', detail: BLANK_EXERCISE_NAME_MESSAGE }
      }
      let replacement: { id: string; muscles: { muscle: string }[] } | null = null
      // No role is written: the slot keeps its own (#2215 — see `preview`).
      if (swap) {
        const [entry] = await t
          .select({
            id: s.exerciseLibrary.id,
            muscles: s.exerciseLibrary.muscles,
            equipment: s.exerciseLibrary.equipment,
            mergedInto: s.exerciseLibrary.mergedInto,
          })
          .from(s.exerciseLibrary)
          .where(eq(s.exerciseLibrary.name, swap.to as string))
          .limit(1)
        if (!entry) {
          const created = await createMissingExercise(t, userId, swap.to as string, accepted)
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
        // LB-66: tombstone, and bump the parent program so the pull delta re-sends the subtree —
        // see `bumpProgramOfSession`. `undo` lifts the tombstone off this same row.
        await t.update(s.sessionExercises).set({ deletedAt: new Date() })
          .where(eq(s.sessionExercises.id, row.id))
        await t.update(s.programs).set({ updatedAt: new Date() })
          .where(eq(s.programs.id, row.programId))
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
        await t.update(s.sessionExercises).set(set).where(eq(s.sessionExercises.id, row.id))
      }

      // #3895: the stored AI plan was made for the session as it was, and keeps driving the bar until
      // it expires. Void it, as the program editor's save does (`clearProgramPrescriptions`), so the
      // next open regenerates against the changed session. Phase and counts are untouched.
      await voidSessionPrescription(t, userId, row.sessionId)

      return { ok: true, summary: summarize(accepted, row), beforeState, targetId: row.id }
  
    })
  },

  async undo(db, userId, targetId, before) {
    if (before.removed) {
      const r = before.removed as Record<string, unknown>
      // LB-66: the removal is a tombstone, so undo lifts it off the SAME row — re-inserting a
      // replacement would strand the original id, and the Coach addresses an exercise by id.
      // Ownership is already settled upstream: `undoCoachChange` loads the change record scoped
      // to the caller before it reaches any handler.
      // #4096: the program row first, as in `apply`.
      await withBoundedLockWait(db, () => lockProgramOfSession(db, r.sessionId as string))
      const [lifted] = await db.update(s.sessionExercises)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(and(eq(s.sessionExercises.id, targetId), isNotNull(s.sessionExercises.deletedAt)))
        .returning({ id: s.sessionExercises.id })
      if (lifted) {
        await bumpProgramOfSession(db, r.sessionId as string)
        await voidSessionPrescription(db, userId, r.sessionId as string)
        return { ok: true }
      }
      // A change applied before LB-66 hard-deleted its row, and its undo window can still be open.
      await db.insert(s.sessionExercises).values({
        sessionId: r.sessionId as string,
        exerciseName: r.exerciseName as string,
        exerciseId: (r.exerciseId as string | null) ?? null,
        styleId: (r.styleId as string | null) ?? null,
        position: r.position as number,
        muscleGroups: (r.muscleGroups as string[]) ?? [],
        exerciseRole: (r.exerciseRole as ExerciseRole | undefined) ?? UNCLASSIFIED_EXERCISE_ROLE,
      })
      await bumpProgramOfSession(db, r.sessionId as string)
      await voidSessionPrescription(db, userId, r.sessionId as string)
      return { ok: true }
    }

    // Re-verify ownership on the way back: the row may have been deleted or reassigned since.
    const row = await loadTarget(db, userId, targetId)
    if (!row) return { ok: false, reason: 'not_found' }
    await withBoundedLockWait(db, () => lockProgramRow(db, row.programId))

    const set: Record<string, unknown> = { updatedAt: new Date() }
    if ('exerciseName' in before) {
      set.exerciseName = before.exerciseName
      set.muscleGroups = before.muscleGroups ?? []
      // `in` rather than a truthiness check: the FK is legitimately null on rows that predate the
      // catalogue link, and null is the value to restore.
      if ('exerciseId' in before) set.exerciseId = before.exerciseId ?? null
      if ('exerciseRole' in before && before.exerciseRole) set.exerciseRole = before.exerciseRole
    }
    if ('styleId' in before) set.styleId = before.styleId
    if ('position' in before) set.position = before.position
    await db.update(s.sessionExercises).set(set).where(eq(s.sessionExercises.id, targetId))
    // A plan regenerated since the apply was made for the changed session, so it goes too.
    await voidSessionPrescription(db, userId, row.sessionId)
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
      // Captured though a swap no longer writes the role (#2215): restoring an unchanged value is a
      // no-op, and an undo that ever has to put a role back still can.
      before.exerciseRole = target.exerciseRole
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
        exerciseRole: target.exerciseRole,
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
