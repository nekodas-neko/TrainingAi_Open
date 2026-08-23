import { and, eq, sql } from 'drizzle-orm'
import * as s from '@/lib/data/postgres/schema'
import { FIELD_LABEL, type PatchChange } from '../patch'
import type { Consequence, DomainHandler, Db, PreviewResult } from './types'
import { driftAgainst } from './types'

/**
 * The periodisation model behind a program — the only tier-3 domain.
 *
 * What makes it tier 3 is not that it writes more rows. It is that **one of its effects removes
 * something**: `sessionsPerCycle` and the phase set together decide which phase you are in, so
 * changing either can move you backwards through a block you have already earned. Every other
 * domain either sets a number you can set back, or edits one row you can see.
 */

interface PhaseState {
  programId: string
  programName: string
  phaseSetId: string | null
  sessionsPerCycle: number | null
  phaseMode: string
  loggedSessions: number
  exerciseCount: number
}

async function loadState(db: Db, userId: string): Promise<PhaseState | null> {
  const [program] = await db
    .select({
      id: s.programs.id,
      name: s.programs.name,
      phaseSetId: s.programs.phaseSetId,
      sessionsPerCycle: s.programs.sessionsPerCycle,
      phaseMode: s.programs.phaseMode,
    })
    .from(s.programs)
    .where(and(eq(s.programs.userId, userId), eq(s.programs.isActive, true)))
    .limit(1)
  if (!program) return null

  const [{ n: loggedSessions }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.workoutSessions)
    .where(eq(s.workoutSessions.userId, userId))

  const exercises = await db
    .select({ id: s.sessionExercises.id })
    .from(s.sessionExercises)
    .innerJoin(s.programSessions, eq(s.sessionExercises.sessionId, s.programSessions.id))
    .where(eq(s.programSessions.programId, program.id))

  return {
    programId: program.id,
    programName: program.name,
    phaseSetId: program.phaseSetId,
    sessionsPerCycle: program.sessionsPerCycle,
    phaseMode: program.phaseMode,
    loggedSessions: Number(loggedSessions ?? 0),
    exerciseCount: exercises.length,
  }
}

async function phaseSetName(db: Db, userId: string, id: string | null): Promise<string> {
  if (!id) return 'none'
  const [row] = await db
    .select({ name: s.phaseSets.name })
    .from(s.phaseSets)
    .where(eq(s.phaseSets.id, id))
    .limit(1)
  return row?.name ?? 'unknown'
}

export const programPhaseHandler: DomainHandler = {
  async currentState(db, userId) {
    const state = await loadState(db, userId)
    return state ? (state as unknown as Record<string, unknown>) : null
  },

  async preview(db, userId, patch): Promise<PreviewResult> {
    const state = await loadState(db, userId)
    if (!state) return { consequences: [], drift: [], target: null }

    const drift = driftAgainst(patch.changes, state as unknown as Record<string, unknown>)
    const consequences: Consequence[] = []

    const cycleChange = patch.changes.find(c => c.field === 'sessionsPerCycle')
    const setChange = patch.changes.find(c => c.field === 'phaseSetId')

    if (cycleChange || setChange) {
      // The destructive one, and the reason this is tier 3. Cycles completed are derived from
      // logged sessions ÷ sessionsPerCycle, so moving either input moves where you are in the
      // block — potentially backwards, past work you have already done.
      const before = state.sessionsPerCycle ?? 1
      const after = Number(cycleChange?.to ?? before) || 1
      const cyclesBefore = Math.floor(state.loggedSessions / before)
      const cyclesAfter = Math.floor(state.loggedSessions / after)
      if (cyclesAfter < cyclesBefore) {
        consequences.push({
          kind: 'warn',
          text: `Moves you back from cycle ${cyclesBefore + 1} to cycle ${cyclesAfter + 1} — you lose ${cyclesBefore - cyclesAfter} cycle${cyclesBefore - cyclesAfter === 1 ? '' : 's'} of progress toward your next deload`,
        })
      } else if (cyclesAfter > cyclesBefore) {
        consequences.push({
          kind: 'info',
          text: `Moves you forward from cycle ${cyclesBefore + 1} to cycle ${cyclesAfter + 1}`,
        })
      }
    }

    if (setChange) {
      const from = await phaseSetName(db, userId, setChange.from as string | null)
      const to = await phaseSetName(db, userId, setChange.to as string | null)
      consequences.push({ kind: 'info', text: `Periodisation model ${from} → ${to}` })
    }

    if (state.exerciseCount > 0) {
      consequences.push({
        kind: 'warn',
        text: `Re-prescribes every exercise in ${state.programName} — ${state.exerciseCount} in total`,
      })
    }

    consequences.push({ kind: 'good', text: 'Logged history and personal records are untouched' })

    return {
      consequences,
      drift,
      target: { id: state.programId, label: state.programName },
    }
  },

  async apply(db, userId, patch, accepted) {
    const state = await loadState(db, userId)
    if (!state) return { ok: false, reason: 'not_found' }

    const drift = driftAgainst(accepted, state as unknown as Record<string, unknown>)
    if (drift.length > 0) return { ok: false, reason: 'stale', drift }

    const beforeState: Record<string, unknown> = {}
    const set: Record<string, unknown> = {}
    for (const c of accepted) {
      beforeState[c.field] = (state as unknown as Record<string, unknown>)[c.field] ?? null
      set[c.field] = c.to
    }

    // Scoped by user as well as id: `programs.id` came from our own read, but an UPDATE on a
    // client-influenced patch is exactly where an unscoped write becomes a cross-user edit.
    await db.update(s.programs).set(set)
      .where(and(eq(s.programs.id, state.programId), eq(s.programs.userId, userId)))

    return {
      ok: true,
      summary: `Changed ${accepted.map(c => FIELD_LABEL[c.field]).join(', ')} on ${state.programName}`,
      beforeState,
      targetId: state.programId,
    }
  },

  async undo(db, userId, targetId, before) {
    const set: Record<string, unknown> = {}
    for (const [field, value] of Object.entries(before)) set[field] = value
    if (Object.keys(set).length === 0) return { ok: true }
    await db.update(s.programs).set(set)
      .where(and(eq(s.programs.id, targetId), eq(s.programs.userId, userId)))
    return { ok: true }
  },
}

export type PhaseChange = PatchChange & { field: 'phaseSetId' | 'sessionsPerCycle' | 'phaseMode' }
