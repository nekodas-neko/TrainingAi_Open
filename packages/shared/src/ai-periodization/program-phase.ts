import { toAestDay, weekStartForDay, shiftDateStr, dateStrMidnightInTz } from '@trainingai/shared/date-utils'
import { DELOAD_FLOOR } from '@trainingai/shared/ai-periodization/phase-guards'
import type {
  AiPrescription, PendingTransition, PeriodizationPhase, SessionPeriodization,
} from '@trainingai/shared/types/ai-periodization'

// One phase for the whole program (#3766, the rule the owner signed on 15 Nov).
//
// The program holds the phase and every session type follows it. There is no program-level table:
// all of the program's `session_periodization` rows carry the same `phase` and `phase_started_at`,
// and a move writes every row in one statement. Time in a phase is counted in TRAINING WEEKS: a
// local Monday-to-Sunday week with at least one completed session of the program. `sessions_in_phase`
// keeps its per-type session count, which stays true because every row shares the phase start.

/** The caps, in training weeks. The same numbers the per-type caps used in sessions; the deload
 *  drops from 2 sessions of one type to 1 week of everything. */
export const PROGRAM_PHASE_CAP_WEEKS: Record<Exclude<PeriodizationPhase, 'baseline'>, number> = {
  accumulation: 6,
  intensification: 5,
  realisation: 2,
  deload: 1,
}

/** The order a program moves through. Deload closes the cycle back to accumulation. */
export const NEXT_PROGRAM_PHASE: Record<PeriodizationPhase, PeriodizationPhase> = {
  baseline: 'accumulation',
  accumulation: 'intensification',
  intensification: 'realisation',
  realisation: 'deload',
  deload: 'accumulation',
}

/** The switch-over's first accumulation block, shortened to 3 weeks (signed with the rule). */
export const SWITCH_OVER_BLOCK_WEEKS = 3

/** The switch-over never starts before this local Monday (the first one after the sign-off). */
export const PROGRAM_PHASE_SWITCH_EARLIEST = '2026-11-16'

/** Phase actions that mean "stay, for a recovery reason". Any one of them in the current week's
 *  answers holds the program where it is. */
const RECOVERY_ACTIONS = new Set(['deload_recommended', 'rest_day_recommended', 'session_swap_recommended'])

export type PhaseRow = Pick<
  SessionPeriodization,
  'programSessionId' | 'phase' | 'phaseStartedAt' | 'sessionsInPhase' | 'baselineComplete' | 'pendingTransition'
>

/** One completed session of the program (completed, not deleted, with logged sets). */
export interface ProgramCompletion {
  programSessionId: string
  completedAt: Date
}

/** The latest model answer for one session type. */
export interface PhaseVote {
  programSessionId: string
  phase: string
  phaseAction: string
}

/** The local Monday ("YYYY-MM-DD") of the training week an instant falls in. */
export function trainingWeekOf(at: Date, tz: string): string {
  return weekStartForDay(toAestDay(at, tz))
}

/** Rows that take part in the program's phase: a session type still measuring its baseline has
 *  not joined it yet. */
function phasedRows<T extends PhaseRow>(rows: T[]): T[] {
  return rows.filter(r => r.baselineComplete && r.phase !== 'baseline')
}

/** Every phased row on one phase and one start. A program with no phased row is aligned. */
export function isProgramAligned(rows: PhaseRow[]): boolean {
  const phased = phasedRows(rows)
  if (phased.length === 0) return true
  const [first] = phased
  return phased.every(r => r.phase === first.phase && r.phaseStartedAt.getTime() === first.phaseStartedAt.getTime())
}

export interface ProgramPhaseView {
  aligned: boolean
  phase: PeriodizationPhase | null
  phaseStartedAt: Date | null
  /** Training weeks in the phase before the current local week. The cap compares against this, so
   *  the move is offered at the first session of the week after the cap, never mid-week. */
  trainingWeeksDone: number
  /** `trainingWeeksDone + 1`: the week the program is in now. */
  weekNumber: number
  capWeeks: number | null
  /** Session types with a completed session in the current local week, since the phase began. */
  trainedThisWeek: Set<string>
  /** The current local week's Monday. */
  currentWeek: string
}

export function programPhaseView(
  rows: PhaseRow[],
  completions: ProgramCompletion[],
  tz: string,
  now: Date = new Date(),
): ProgramPhaseView {
  const currentWeek = trainingWeekOf(now, tz)
  const phased = phasedRows(rows)
  const aligned = isProgramAligned(rows)
  if (!aligned || phased.length === 0) {
    return {
      aligned, phase: null, phaseStartedAt: null, trainingWeeksDone: 0, weekNumber: 1, capWeeks: null,
      trainedThisWeek: new Set(), currentWeek,
    }
  }
  const { phase, phaseStartedAt, pendingTransition } = phased[0]
  const weeks = new Set<string>()
  const trainedThisWeek = new Set<string>()
  for (const c of completions) {
    if (c.completedAt.getTime() < phaseStartedAt.getTime()) continue
    const week = trainingWeekOf(c.completedAt, tz)
    weeks.add(week)
    if (week === currentWeek) trainedThisWeek.add(c.programSessionId)
  }
  const trainingWeeksDone = [...weeks].filter(w => w < currentWeek).length
  return {
    aligned,
    phase,
    phaseStartedAt,
    trainingWeeksDone,
    weekNumber: trainingWeeksDone + 1,
    capWeeks: programPhaseCapWeeks(phase, pendingTransition),
    trainedThisWeek,
    currentWeek,
  }
}

/** The cap for the phase the program is in. A scheduled move (the switch-over's short first block)
 *  overrides the standard cap for that one block; any move clears it. */
export function programPhaseCapWeeks(phase: PeriodizationPhase, pending: PendingTransition | null): number | null {
  if (phase === 'baseline') return null
  if (pending?.afterTrainingWeeks != null && pending.newPhase === NEXT_PROGRAM_PHASE[phase]) return pending.afterTrainingWeeks
  return PROGRAM_PHASE_CAP_WEEKS[phase]
}

/**
 * At the cap, a plain "stay" becomes the program's move to the next phase. Recovery actions are
 * left alone, as the per-type ceilings did. The loads stay the current phase's, so (as with the old
 * ceilings) `canAutoApplyTransition` refuses to apply it without a tap.
 */
export function applyProgramPhaseCap(prescription: AiPrescription, view: ProgramPhaseView): AiPrescription {
  const { phase, capWeeks, trainingWeeksDone } = view
  if (!view.aligned || phase == null || capWeeks == null || trainingWeeksDone < capWeeks || prescription.phaseAction !== 'stay') {
    return prescription
  }
  const next = NEXT_PROGRAM_PHASE[phase]
  const done = `${trainingWeeksDone} training week${trainingWeeksDone === 1 ? '' : 's'}`
  const why = phase === 'deload'
    ? `The program has done ${done} of deload — recovery is done. Start a fresh accumulation block, or build a new program to keep adapting.`
    : `The program has done ${done} of ${phase} (cap ${capWeeks}) — time to move the program to ${next}.`
  return {
    ...prescription,
    phase: next,
    phaseAction: 'transition_recommended',
    reasoning: `${why} ${prescription.reasoning}`.trim(),
  }
}

/**
 * The early trigger: the program moves before a cap when the model recommends the same move for at
 * least half of the distinct session types in the vote, and none of them recommends staying for a
 * recovery reason. One type alone never moves the program. `votes` holds one answer per session
 * type (an abstaining type is in the vote with a `stay`, or as `none`).
 */
export function programMoveTarget(votes: PhaseVote[], currentPhase: PeriodizationPhase): PeriodizationPhase | null {
  if (votes.some(v => RECOVERY_ACTIONS.has(v.phaseAction))) return null
  const counts = new Map<string, number>()
  for (const v of votes) {
    if (v.phaseAction !== 'transition_recommended' || v.phase === currentPhase) continue
    counts.set(v.phase, (counts.get(v.phase) ?? 0) + 1)
  }
  let best: string | null = null
  for (const [target, n] of counts) {
    if (n >= 2 && n * 2 >= votes.length && (best == null || n > (counts.get(best) ?? 0))) best = target
  }
  return best as PeriodizationPhase | null
}

/**
 * The set of session types whose answers decide a move: the types trained in the current week, plus
 * the type being planned now (it is about to be trained this week). Each votes with its latest model
 * answer since the phase began; a trained type with no recorded answer abstains (counts, never agrees).
 */
export function collectVotes(
  view: ProgramPhaseView,
  current: PhaseVote,
  latestAnswers: PhaseVote[],
): PhaseVote[] {
  const byType = new Map(latestAnswers.map(a => [a.programSessionId, a]))
  const votes: PhaseVote[] = [current]
  for (const id of view.trainedThisWeek) {
    if (id === current.programSessionId) continue
    votes.push(byType.get(id) ?? { programSessionId: id, phase: view.phase ?? '', phaseAction: 'none' })
  }
  return votes
}

export type SwitchOverPlan =
  | { kind: 'aligned' }
  | { kind: 'waiting'; reason: 'deload_in_progress' }
  | { kind: 'waiting'; reason: 'before_start'; startDay: string }
  | { kind: 'switch'; startDay: string; startsAt: Date }

/**
 * The signed switch-over for a program whose session types are still on their own phases: every type
 * starts accumulation week 1 on the Monday after the last type in a deload finishes it (the old floor:
 * `DELOAD_FLOOR` completed deload sessions), never before `PROGRAM_PHASE_SWITCH_EARLIEST`, with the
 * first block shortened to `SWITCH_OVER_BLOCK_WEEKS`. Until that Monday each type keeps its own phase.
 */
export function planSwitchOver(
  rows: PhaseRow[],
  completions: ProgramCompletion[],
  tz: string,
  now: Date = new Date(),
): SwitchOverPlan {
  if (isProgramAligned(rows)) return { kind: 'aligned' }
  const phased = phasedRows(rows)
  if (phased.some(r => r.phase === 'deload' && r.sessionsInPhase < DELOAD_FLOOR)) {
    return { kind: 'waiting', reason: 'deload_in_progress' }
  }

  let lastFinish: Date | null = null
  for (const r of phased) {
    if (r.phase !== 'deload') continue
    const done = completions
      .filter(c => c.programSessionId === r.programSessionId && c.completedAt.getTime() >= r.phaseStartedAt.getTime())
      .map(c => c.completedAt)
      .sort((a, b) => a.getTime() - b.getTime())
    const finish = done[DELOAD_FLOOR - 1]
    if (finish && (lastFinish == null || finish > lastFinish)) lastFinish = finish
  }

  const mondayAfterFinish = lastFinish ? shiftDateStr(trainingWeekOf(lastFinish, tz), 7) : null
  const startDay = mondayAfterFinish && mondayAfterFinish > PROGRAM_PHASE_SWITCH_EARLIEST
    ? mondayAfterFinish
    : PROGRAM_PHASE_SWITCH_EARLIEST
  if (toAestDay(now, tz) < startDay) return { kind: 'waiting', reason: 'before_start', startDay }
  return { kind: 'switch', startDay, startsAt: dateStrMidnightInTz(startDay, tz) }
}

/** What the switch-over writes on every row besides the phase and start: the short first block. */
export function switchOverPendingTransition(): PendingTransition {
  return {
    newPhase: 'intensification',
    reasoning: `Switch-over to one phase for the program: the first accumulation block runs ${SWITCH_OVER_BLOCK_WEEKS} training weeks.`,
    urgency: 'normal',
    afterTrainingWeeks: SWITCH_OVER_BLOCK_WEEKS,
  }
}

/** The repository calls the program phase needs (a subset of `WorkoutRepository`). */
export interface ProgramPhaseRepo {
  reconcileSessionsInPhase(userId: string, programId: string): Promise<void>
  listSessionPeriodizationForProgram(userId: string, programId: string): Promise<SessionPeriodization[]>
  listProgramCompletions(userId: string, programId: string, since: Date): Promise<ProgramCompletion[]>
  setProgramPhase(
    userId: string, programId: string, phase: PeriodizationPhase, startedAt: Date,
    pendingTransition: PendingTransition | null,
  ): Promise<void>
}

/**
 * Read the program's phase, running the switch-over first when it is due. Idempotent: a second call
 * (or a concurrent one) finds the rows aligned and writes nothing.
 */
export async function syncProgramPhase(
  repo: ProgramPhaseRepo,
  userId: string,
  programId: string,
  tz: string,
  now: Date = new Date(),
): Promise<ProgramPhaseView> {
  await repo.reconcileSessionsInPhase(userId, programId)
  let rows = await repo.listSessionPeriodizationForProgram(userId, programId)
  const since = earliestStart(rows)
  let completions = since ? await repo.listProgramCompletions(userId, programId, since) : []
  const plan = planSwitchOver(rows, completions, tz, now)
  if (plan.kind === 'switch') {
    await repo.setProgramPhase(userId, programId, 'accumulation', plan.startsAt, switchOverPendingTransition())
    await repo.reconcileSessionsInPhase(userId, programId)
    rows = await repo.listSessionPeriodizationForProgram(userId, programId)
    completions = await repo.listProgramCompletions(userId, programId, plan.startsAt)
  }
  return programPhaseView(rows, completions, tz, now)
}

function earliestStart(rows: PhaseRow[]): Date | null {
  const starts = phasedRows(rows).map(r => r.phaseStartedAt.getTime())
  return starts.length > 0 ? new Date(Math.min(...starts)) : null
}
