import { and, eq, isNull, sql } from 'drizzle-orm'
import * as s from '@/lib/data/postgres/schema'
import { normalizeMuscle } from '@trainingai/shared/muscles'
import { todayInTz, DEFAULT_TZ } from '@trainingai/shared/date-utils'
import type { PatchChange } from '../patch'
import type { Consequence, DomainHandler, Db, PreviewResult } from './types'
import { driftAgainst } from './types'

/**
 * Logging an injury, and nothing else.
 *
 * **Coach deliberately does not act on the injury.** The owner asked that it behave exactly as
 * manual injury entry does, and that behaviour already exists end to end:
 *
 *   - `packages/shared/src/ai-periodization/signals.ts` derives `activeInjuredMusclesInSession`
 *     from active injuries;
 *   - the periodization prompt weighs it and can return `session_swap_recommended` or
 *     `deload_recommended`;
 *   - `emergency-deload.ts` deliberately excludes injuries as a *blunt standalone* trigger (AI-4)
 *     so severity and muscle get weighed instead — that comment is a decision, not an oversight;
 *   - `injurySafeAlternatives` drives per-exercise substitutions at workout time.
 *
 * So the write here is a single row, and everything downstream happens because the row exists.
 * The round-3 mockup drew a "flag N exercises" toggle; that was a second implementation of
 * machinery the app already has, and it is not built.
 */

/**
 * What `apply` writes when the proposal carries no severity — which, since Q-227, is the normal case
 * rather than the exception: the model is told to leave the field out instead of guessing. Named
 * once because `preview` has to tell the user this exact value before `apply` writes it; two copies
 * of the literal would let the confirmation screen promise one thing and the row record another.
 */
const ASSUMED_SEVERITY = 'moderate'

async function activeInjury(db: Db, userId: string, muscleName: string) {
  const [row] = await db
    .select({
      id: s.injuries.id,
      muscleName: s.injuries.muscleName,
      severity: s.injuries.severity,
      notes: s.injuries.notes,
      resolvedDate: s.injuries.resolvedDate,
    })
    .from(s.injuries)
    .where(and(
      eq(s.injuries.userId, userId),
      sql`lower(${s.injuries.muscleName}) = lower(${muscleName})`,
      isNull(s.injuries.resolvedDate),
      isNull(s.injuries.deletedAt),
    ))
    .limit(1)
  return row ?? null
}

/**
 * Muscle groups on a program row are unsided and often plural ("shoulders"); an injury is written
 * the way a person says it ("left shoulder"). Strip the side and match on the singular stem, or
 * the affected-exercise count silently reads zero for every side-qualified injury — which is most
 * of them, and looks identical to "nothing in your program trains this".
 */
function injuryMuscleKey(raw: string): string {
  const stripped = raw.trim().toLowerCase().replace(/^(left|right|l|r)\s+/, '')
  return normalizeMuscle(stripped).replace(/s$/, '')
}

/** How many exercises in the active program train the injured muscle — a count, not advice. */
async function affectedExercises(db: Db, userId: string, muscleName: string): Promise<string[]> {
  const rows = await db
    .select({ name: s.sessionExercises.exerciseName, muscles: s.sessionExercises.muscleGroups })
    .from(s.sessionExercises)
    .innerJoin(s.programSessions, eq(s.sessionExercises.sessionId, s.programSessions.id))
    .innerJoin(s.programs, eq(s.programSessions.programId, s.programs.id))
    .where(and(eq(s.programs.userId, userId), eq(s.programs.isActive, true)))
  const target = injuryMuscleKey(muscleName)
  return rows.filter(r => (r.muscles ?? []).some(m => injuryMuscleKey(m) === target)).map(r => r.name)
}

export const injuryHandler: DomainHandler = {
  async preview(db, userId, patch): Promise<PreviewResult> {
    const muscle = patch.changes.find(c => c.field === 'muscleName')?.to as string | undefined
    const resolving = patch.changes.find(c => c.field === 'resolved')
    const existing = muscle ? await activeInjury(db, userId, muscle) : null

    const consequences: Consequence[] = []
    if (resolving) {
      consequences.push({ kind: 'good', text: 'Your program stops working around it from your next session' })
      return {
        consequences,
        drift: [],
        target: { id: existing?.id ?? patch.targetId, label: muscle ? `${muscle} injury` : 'injury' },
      }
    }

    if (muscle) {
      const affected = await affectedExercises(db, userId, muscle)
      if (affected.length > 0) {
        consequences.push({
          kind: 'warn',
          text: `${affected.length} exercise${affected.length === 1 ? '' : 's'} in your program train${affected.length === 1 ? 's' : ''} this: ${affected.slice(0, 3).join(', ')}${affected.length > 3 ? '…' : ''}`,
        })
      }
      // The prompt now tells the model to leave `severity` out rather than guess one (Q-227). When
      // it does, `apply` writes ASSUMED_SEVERITY — so the assumption moves from the model to us, and
      // it would otherwise be silent. Severity feeds real prescription decisions, and the manual
      // injury sheet has always made the user tap it, so the confirmation has to say what it is
      // about to record. A supplied severity needs no line: it is already a visible change row.
      if (!patch.changes.some(c => c.field === 'severity')) {
        consequences.push({
          kind: 'info',
          text: `Recorded as ${ASSUMED_SEVERITY} — change it in Health → Injuries if that is not right`,
        })
      }
      // Stating what happens next rather than doing it — the periodization engine owns this.
      consequences.push({
        kind: 'info',
        text: 'Your next session will weigh this when it decides load, and can suggest swaps or a lighter session',
      })
      consequences.push({ kind: 'good', text: 'Nothing is removed from your program, and no logged history changes' })
    }

    return {
      consequences,
      drift: existing ? driftAgainst(patch.changes, existing as unknown as Record<string, unknown>, c => c.field === 'muscleName' || c.field === 'resolved') : [],
      target: { id: existing?.id ?? null, label: muscle ? `${muscle} injury` : 'injury' },
    }
  },

  async apply(db, userId, patch, accepted) {
    const muscleChange = accepted.find(c => c.field === 'muscleName')
    const resolving = accepted.find(c => c.field === 'resolved' && c.to === true)
    const severity = accepted.find(c => c.field === 'severity')?.to as string | undefined
    const notes = accepted.find(c => c.field === 'notes')?.to as string | undefined

    if (resolving) {
      const id = patch.targetId
      if (!id) return { ok: false, reason: 'invalid', detail: 'No injury selected to mark recovered' }
      const [row] = await db
        .select({ id: s.injuries.id, muscleName: s.injuries.muscleName, resolvedDate: s.injuries.resolvedDate })
        .from(s.injuries)
        .where(and(eq(s.injuries.id, id), eq(s.injuries.userId, userId)))
        .limit(1)
      if (!row) return { ok: false, reason: 'not_found' }

      const today = todayInTz(DEFAULT_TZ)
      await db.update(s.injuries).set({ resolvedDate: today, updatedAt: new Date() })
        .where(and(eq(s.injuries.id, id), eq(s.injuries.userId, userId)))
      return {
        ok: true,
        summary: `Marked ${row.muscleName} recovered`,
        beforeState: { resolvedDate: row.resolvedDate },
        targetId: id,
      }
    }

    if (!muscleChange) return { ok: false, reason: 'invalid', detail: 'No body area given' }
    const muscleName = muscleChange.to as string

    const existing = await activeInjury(db, userId, muscleName)
    if (existing) {
      // Already logged and unresolved — update rather than stacking a duplicate, which would make
      // `activeInjuredMusclesInSession` count the same problem twice.
      await db.update(s.injuries)
        .set({ ...(severity ? { severity } : {}), ...(notes !== undefined ? { notes } : {}), updatedAt: new Date() })
        .where(and(eq(s.injuries.id, existing.id), eq(s.injuries.userId, userId)))
      return {
        ok: true,
        summary: `Updated ${muscleName} injury (${severity ?? existing.severity})`,
        beforeState: { severity: existing.severity, notes: existing.notes, existed: true },
        targetId: existing.id,
      }
    }

    const [created] = await db
      .insert(s.injuries)
      .values({
        userId,
        muscleName,
        severity: severity ?? ASSUMED_SEVERITY,
        notes: notes ?? null,
        startedDate: todayInTz(DEFAULT_TZ),
      })
      .returning({ id: s.injuries.id })

    return {
      ok: true,
      summary: `Logged ${muscleName} injury (${severity ?? ASSUMED_SEVERITY})`,
      beforeState: { existed: false },
      targetId: created.id,
    }
  },

  async undo(db, userId, targetId, before) {
    // An injury Coach created is removed on undo; one it updated is put back as it was. A created
    // row is soft-deleted rather than hard-deleted, because `getSyncDelta` needs a tombstone for
    // the delete to reach other devices.
    if (before.existed === false) {
      await db.update(s.injuries).set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(s.injuries.id, targetId), eq(s.injuries.userId, userId)))
      return { ok: true }
    }

    const set: Record<string, unknown> = { updatedAt: new Date() }
    if ('severity' in before) set.severity = before.severity
    if ('notes' in before) set.notes = before.notes
    if ('resolvedDate' in before) set.resolvedDate = before.resolvedDate
    await db.update(s.injuries).set(set)
      .where(and(eq(s.injuries.id, targetId), eq(s.injuries.userId, userId)))
    return { ok: true }
  },
}

/** Unused today but kept beside the handler: the fields a future "which injury?" picker needs. */
export type InjuryChange = PatchChange & { field: 'muscleName' | 'severity' | 'notes' | 'resolved' }
