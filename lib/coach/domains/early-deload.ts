import { and, eq, gte, inArray, isNull, lt } from 'drizzle-orm'
import * as s from '@/lib/data/postgres/schema'
import { aestMidnight } from '@trainingai/shared/date-utils'
import { countSessionsSinceStart } from '@/lib/data/postgres/slices/programs'
import type { Consequence, DomainHandler, Db, PreviewResult } from './types'

/**
 * Starting (or cancelling) a deload week ahead of schedule.
 *
 * **Why this is a write domain and not a `handOff`.** The obvious wiring was a link to the
 * `EarlyDeloadCard` on `/session-select` — but that card renders only when
 * `readiness.earlyDeloadRecommended` is already true, which is precisely when the user would NOT
 * need to ask. Handing off to a screen whose control may not be there is the dead end the
 * `HandoffSchema` comment warns about.
 *
 * **Why the model does not supply the date.** The only sensible start is *today*, and today is a
 * timezone question the model has no business answering (CLAUDE.md's standing rule). So the field
 * is the boolean `deloadNow` and the server stamps the date — the model proposes, code applies.
 *
 * **Why tier 2 rather than tier 3.** It is undoable and the app itself confirms the same action in
 * a single tap on the home card. Demanding a hold-to-confirm here would make Coach heavier than the
 * button it is standing in for. `program_phase` stays tier 3 because that one can move you
 * backwards through a block; this one only moves the deload forward in time.
 */

interface DeloadState {
  programId: string
  programName: string
  earlyDeloadWeekStart: string | null
  sessionsPerCycle: number | null
  sessionsThisCycle: number
  /** Sessions logged today — the rows `confirmEarlyDeload` flags, and the ones undo must restore. */
  todaySessionIds: string[]
  deloadNow: boolean
}

function dayBounds(today: string): { start: Date; end: Date } {
  const [y, m, d] = today.split('-').map(Number)
  return { start: aestMidnight(y, m, d), end: aestMidnight(y, m, d + 1) }
}

async function loadState(db: Db, userId: string, today: string): Promise<DeloadState | null> {
  const [program] = await db
    .select({
      id: s.programs.id,
      name: s.programs.name,
      earlyDeloadWeekStart: s.programs.earlyDeloadWeekStart,
      sessionsPerCycle: s.programs.sessionsPerCycle,
    })
    .from(s.programs)
    .where(and(eq(s.programs.userId, userId), eq(s.programs.isActive, true)))
    .limit(1)
  if (!program) return null

  const { start, end } = dayBounds(today)
  const todayRows = await db
    .select({ id: s.workoutSessions.id })
    .from(s.workoutSessions)
    .where(and(
      eq(s.workoutSessions.userId, userId),
      gte(s.workoutSessions.startedAt, start),
      lt(s.workoutSessions.startedAt, end),
      isNull(s.workoutSessions.deletedAt),
    ))

  return {
    programId: program.id,
    programName: program.name,
    earlyDeloadWeekStart: program.earlyDeloadWeekStart ?? null,
    sessionsPerCycle: program.sessionsPerCycle,
    sessionsThisCycle: await countSessionsSinceStart(db, userId, program.id),
    todaySessionIds: todayRows.map(r => r.id),
    deloadNow: program.earlyDeloadWeekStart != null,
  }
}

export function earlyDeloadHandler(today: string): DomainHandler {
  return {
    async currentState(db, userId) {
      const state = await loadState(db, userId, today)
      return state ? { deloadNow: state.deloadNow } : null
    },

    async preview(db, userId, patch): Promise<PreviewResult> {
      const state = await loadState(db, userId, today)
      if (!state) return { consequences: [], drift: [], target: null }

      const change = patch.changes.find(c => c.field === 'deloadNow')
      const consequences: Consequence[] = []
      const drift = change && Boolean(change.from) !== state.deloadNow
        ? [{
            changeId: change.id,
            field: 'deloadNow',
            expected: String(change.from),
            actual: String(state.deloadNow),
          }]
        : []

      if (change?.to === true) {
        // Measured, not described. Sessions per cycle is the denominator the phase engine uses;
        // how far in the user already is says exactly how early this is.
        const per = state.sessionsPerCycle ?? 0
        if (per > 0) {
          const into = state.sessionsThisCycle % per
          const remaining = per - into
          consequences.push({
            kind: 'info',
            text: `You are ${into} of ${per} sessions into this cycle — the deload starts ${remaining} session${remaining === 1 ? '' : 's'} early`,
          })
        }
        if (state.todaySessionIds.length > 0) {
          // The real cost, and the one nobody expects: flagged sessions are excluded from every
          // cycle count in `slices/programs.ts`, so today's work stops advancing the block.
          const n = state.todaySessionIds.length
          consequences.push({
            kind: 'warn',
            text: `${n} session${n === 1 ? '' : 's'} logged today stop${n === 1 ? 's' : ''} counting toward your cycle`,
          })
        }
        consequences.push({ kind: 'good', text: 'Logged history and personal records are untouched' })
      } else if (change?.to === false) {
        consequences.push({ kind: 'info', text: 'Ends the deload week — normal prescriptions resume' })
        if (state.todaySessionIds.length > 0) {
          consequences.push({
            kind: 'good',
            text: `${state.todaySessionIds.length} session${state.todaySessionIds.length === 1 ? '' : 's'} logged today count toward your cycle again`,
          })
        }
      }

      return { consequences, drift, target: { id: state.programId, label: state.programName } }
    },

    async apply(db, userId, patch, accepted) {
      const state = await loadState(db, userId, today)
      if (!state) return { ok: false, reason: 'not_found' }

      const change = accepted.find(c => c.field === 'deloadNow')
      if (!change) return { ok: false, reason: 'invalid', detail: 'Nothing to change' }
      if (Boolean(change.from) !== state.deloadNow) {
        return {
          ok: false,
          reason: 'stale',
          drift: [{
            changeId: change.id,
            field: 'deloadNow',
            expected: String(change.from),
            actual: String(state.deloadNow),
          }],
        }
      }
      if (change.to === state.deloadNow) {
        return { ok: false, reason: 'invalid', detail: 'That is already the case' }
      }

      const starting = change.to === true
      await db.transaction(async tx => {
        await tx.update(s.programs)
          .set({ earlyDeloadWeekStart: starting ? today : null })
          .where(and(eq(s.programs.id, state.programId), eq(s.programs.userId, userId)))
        if (state.todaySessionIds.length > 0) {
          await tx.update(s.workoutSessions)
            .set({ isEarlyDeload: starting })
            .where(and(
              eq(s.workoutSessions.userId, userId),
              inArray(s.workoutSessions.id, state.todaySessionIds),
            ))
        }
      })

      return {
        ok: true,
        summary: starting
          ? `Started a deload week on ${state.programName}`
          : `Cancelled the deload week on ${state.programName}`,
        beforeState: {
          earlyDeloadWeekStart: state.earlyDeloadWeekStart,
          sessionIds: state.todaySessionIds,
          wasFlagged: !starting,
        },
        targetId: state.programId,
      }
    },

    async undo(db, userId, targetId, before) {
      const sessionIds = Array.isArray(before.sessionIds) ? (before.sessionIds as string[]) : []
      const wasFlagged = before.wasFlagged === true
      await db.transaction(async tx => {
        await tx.update(s.programs)
          .set({ earlyDeloadWeekStart: (before.earlyDeloadWeekStart as string | null) ?? null })
          .where(and(eq(s.programs.id, targetId), eq(s.programs.userId, userId)))
        if (sessionIds.length > 0) {
          await tx.update(s.workoutSessions)
            .set({ isEarlyDeload: wasFlagged })
            .where(and(
              eq(s.workoutSessions.userId, userId),
              inArray(s.workoutSessions.id, sessionIds),
            ))
        }
      })
      return { ok: true }
    },
  }
}
