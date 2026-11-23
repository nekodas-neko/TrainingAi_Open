import { isBusyError } from '@trainingai/shared/errors'
import { toAestDay, weekStartForDay, shiftDateStr, dateStrMidnightInTz } from '@trainingai/shared/date-utils'
import { DELOAD_FLOOR, type ProgramDeloadCheck } from '@trainingai/shared/ai-periodization/phase-guards'
import { servePrescriptionState, type ServedPrescriptionState } from '@trainingai/shared/ai-periodization/prescription-expiry'
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

/** Phase actions that mean "stay, for a recovery reason": a deload or a rest day. Any one of them in
 *  the current week's vote holds the program where it is. A session swap is not one: it asks to train
 *  a different session today because some of this one's muscles are sore or injured, says nothing
 *  about the program's phase, and so counts in the vote without agreeing. */
const RECOVERY_ACTIONS = new Set(['deload_recommended', 'rest_day_recommended'])

export type PhaseRow = Pick<
  SessionPeriodization,
  'programSessionId' | 'phase' | 'phaseStartedAt' | 'sessionsInPhase' | 'baselineComplete' | 'pendingTransition'
>

/** One completed session of the program (completed, not deleted, with logged sets). */
export interface ProgramCompletion {
  programSessionId: string
  completedAt: Date
}

/** One session type's model answer, as it votes. */
export interface PhaseVote {
  programSessionId: string
  phase: string
  phaseAction: string
}

/** One recorded model answer (`prescription_shadow`), with when it was given. */
export interface PhaseAnswer extends PhaseVote {
  createdAt: Date
}

/** The local Monday ("YYYY-MM-DD") of the training week an instant falls in. */
export function trainingWeekOf(at: Date, tz: string): string {
  return weekStartForDay(toAestDay(at, tz))
}

/** The local midnight that starts the training week an instant falls in. */
export function trainingWeekStartOf(at: Date, tz: string): Date {
  return dateStrMidnightInTz(trainingWeekOf(at, tz), tz)
}

/** A session type still measuring its baseline has not joined the program's phase yet. */
function isPhased(r: PhaseRow): boolean {
  return r.baselineComplete && r.phase !== 'baseline'
}

function phasedRows<T extends PhaseRow>(rows: T[]): T[] {
  return rows.filter(isPhased)
}

/** Every phased row on one phase and one start. A program with no phased row is aligned. */
export function isProgramAligned(rows: PhaseRow[]): boolean {
  const phased = phasedRows(rows)
  if (phased.length === 0) return true
  const [first] = phased
  return phased.every(r => r.phase === first.phase && r.phaseStartedAt.getTime() === first.phaseStartedAt.getTime())
}

/** The program is on one phase for good: it has made its switch-over, or it already shared one
 *  phase when the rule shipped. Such a program never runs the switch-over again. */
export function isProgramSwitched(rows: PhaseRow[]): boolean {
  return phasedRows(rows).some(r => r.pendingTransition?.programPhase === true)
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
  /** Each of those types' latest completed session this week. */
  lastTrainedThisWeek: Map<string, Date>
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
      trainedThisWeek: new Set(), lastTrainedThisWeek: new Map(), currentWeek,
    }
  }
  const { phase, phaseStartedAt, pendingTransition } = phased[0]
  const startWeek = trainingWeekOf(phaseStartedAt, tz)
  let startWeekBegunBefore = false
  const weeks = new Set<string>()
  const lastTrainedThisWeek = new Map<string, Date>()
  for (const c of completions) {
    const week = trainingWeekOf(c.completedAt, tz)
    if (c.completedAt.getTime() < phaseStartedAt.getTime()) {
      if (week === startWeek) startWeekBegunBefore = true
      continue
    }
    weeks.add(week)
    const last = lastTrainedThisWeek.get(c.programSessionId)
    if (week === currentWeek && (last == null || c.completedAt > last)) lastTrainedThisWeek.set(c.programSessionId, c.completedAt)
  }
  // The week a move lands in is a week OF the new phase only when none of its sessions came before
  // the move, so every session of a counted week is in the phase ("All sessions that week are
  // deloads"). A move on a Thursday after a Monday session starts the count at the next Monday; the
  // switch-over, which starts at a Monday's midnight, counts its first week.
  if (startWeekBegunBefore) weeks.delete(startWeek)
  const trainingWeeksDone = [...weeks].filter(w => w < currentWeek).length
  return {
    aligned,
    phase,
    phaseStartedAt,
    trainingWeeksDone,
    weekNumber: trainingWeeksDone + 1,
    capWeeks: programPhaseCapWeeks(phase, pendingTransition),
    trainedThisWeek: new Set(lastTrainedThisWeek.keys()),
    lastTrainedThisWeek,
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

/** #3876 (owner, 19 Nov): an aligned program's deload has reached its cap, so it ends by itself at
 *  the next plan, with no tap, like a type's own deload while the program waits. */
export function programDeloadFinished(view: ProgramPhaseView): boolean {
  return view.aligned && view.phase === 'deload' && view.phaseStartedAt != null
    && view.capWeeks != null && view.trainingWeeksDone >= view.capWeeks
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
 * type (an abstaining type is in the vote as `none`).
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
 * The vote, as signed: "the distinct session types trained in the current week". Each votes with
 * the model's answer for the session it trained this week, which is its latest answer given before
 * that session was completed, and since the phase began. The session being planned now is not in the
 * vote until its type has trained this week; this answer is recorded and counts once it has. A
 * trained type with no recorded answer (a rules-fallback plan writes none) counts but never agrees.
 */
export function collectVotes(view: ProgramPhaseView, answers: PhaseAnswer[]): PhaseVote[] {
  const since = view.phaseStartedAt?.getTime() ?? -Infinity
  const votes: PhaseVote[] = []
  for (const [id, trainedAt] of view.lastTrainedThisWeek) {
    let answer: PhaseAnswer | null = null
    for (const a of answers) {
      const t = a.createdAt.getTime()
      if (a.programSessionId !== id || t < since || t > trainedAt.getTime()) continue
      if (answer == null || t > answer.createdAt.getTime()) answer = a
    }
    votes.push(answer
      ? { programSessionId: id, phase: answer.phase, phaseAction: answer.phaseAction }
      : { programSessionId: id, phase: view.phase ?? '', phaseAction: 'none' })
  }
  return votes
}

/** The phase, start and scheduled move a program move writes on every row. It always carries the
 *  `programPhase` mark. A scheduled short block (the switch-over's) is kept; otherwise the next move
 *  is the standard one at the standard cap. */
export function programMoveMark(phase: PeriodizationPhase, scheduled: PendingTransition | null = null): PendingTransition {
  if (scheduled?.afterTrainingWeeks != null) {
    return {
      newPhase: scheduled.newPhase, reasoning: scheduled.reasoning, urgency: scheduled.urgency,
      afterTrainingWeeks: scheduled.afterTrainingWeeks, programPhase: true,
    }
  }
  return {
    newPhase: NEXT_PROGRAM_PHASE[phase],
    reasoning: 'The program\'s next phase: at its cap, or earlier once half of a week\'s session types agree.',
    urgency: 'normal',
    programPhase: true,
  }
}

/** Where a program on one phase is: the latest move among the rows that carry the program's mark
 *  (a row that lost it, as a per-type move does, is behind). Any phased row when none carries it. */
export interface ProgramTarget {
  phase: PeriodizationPhase
  phaseStartedAt: Date
  pendingTransition: PendingTransition
}

export function programTarget(rows: PhaseRow[]): ProgramTarget | null {
  const phased = phasedRows(rows)
  if (phased.length === 0) return null
  const marked = phased.filter(r => r.pendingTransition?.programPhase === true)
  const pool = marked.length > 0 ? marked : phased
  const latest = pool.reduce((a, b) => (b.phaseStartedAt.getTime() > a.phaseStartedAt.getTime() ? b : a))
  return {
    phase: latest.phase,
    phaseStartedAt: latest.phaseStartedAt,
    pendingTransition: programMoveMark(latest.phase, latest.pendingTransition),
  }
}

/** The waiting stamp: the program is waiting for its switch-over, which starts on `day` once known
 *  (`knownAt`: when the day was first known, #3876). */
export function switchOverWait(day: string | null, knownAt: string | null = null): PendingTransition {
  return {
    newPhase: 'accumulation',
    reasoning: day
      ? `Switch-over to one phase for the program on ${day}.`
      : 'Waiting for the switch-over to one phase for the program.',
    urgency: 'normal',
    switchOverPending: true,
    ...(day != null && { switchOverOn: day }),
    ...(day != null && knownAt != null && { switchOverKnownAt: knownAt }),
  }
}

/**
 * When the switch-over's date was first known (#3876), or null while it is not. Read from the stamp;
 * a stamp written before #3876 has the date without the instant, and is read as known from the
 * Monday of the week before the date: the week whose finished deload gave it.
 */
function switchOverKnownAt(phased: PhaseRow[], tz: string): Date | null {
  const instants = phased
    .map(r => r.pendingTransition?.switchOverKnownAt)
    .filter((v): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v)))
    .map(v => new Date(v))
  if (instants.length > 0) return instants.reduce((a, b) => (b < a ? b : a))
  const stored = phased.reduce<string | null>((d, r) => laterDay(d, r.pendingTransition?.switchOverOn), null)
  return stored != null ? dateStrMidnightInTz(shiftDateStr(stored, -7), tz) : null
}

function laterDay(a: string | null | undefined, b: string | null | undefined): string | null {
  if (a == null) return b ?? null
  if (b == null) return a
  return a > b ? a : b
}

/**
 * The switch-over is for a program whose types were on their own phases when the rule shipped, and
 * runs once. The caller has already found the program unaligned and without the program's mark, so
 * it is due when it is stamped as waiting, or when any of its phased rows started before `earliest`:
 * that row is from before the rule. It does not ask that two such rows disagree. Until this code
 * ships, the per-type moves keep landing (Upper on 16 Nov, Pull on 19, Legs on 21, Lower on 25), and
 * a release late enough would leave one unmoved row and re-align the program to the latest move,
 * with no Monday start and no 3-week block. A program whose rows all started after `earliest` (two
 * baselines finishing together on a new program) is re-aligned instead.
 */
function switchOverDue(phased: PhaseRow[], tz: string, earliest: string): boolean {
  if (phased.some(r => r.pendingTransition?.switchOverPending === true)) return true
  return phased.some(r => toAestDay(r.phaseStartedAt, tz) < earliest)
}

export type SwitchOverPlan =
  /** `mark`: the program shares one phase but does not carry the mark yet (its first read). */
  | { kind: 'aligned'; mark: boolean }
  | { kind: 'realign'; target: ProgramTarget }
  /** `stamp`: the waiting stamp to write on every row, or null when they all carry it already. */
  | { kind: 'waiting'; reason: 'deload_in_progress'; stamp: PendingTransition | null }
  | { kind: 'waiting'; reason: 'before_start'; startDay: string; stamp: PendingTransition | null }
  | { kind: 'switch'; startDay: string; startsAt: Date }

/**
 * The signed switch-over for a program whose session types are still on their own phases: every type
 * starts accumulation week 1 on the Monday after the last type in a deload finishes it (the old floor:
 * `DELOAD_FLOOR` completed deload sessions), never before `earliest`, with the first block shortened
 * to `SWITCH_OVER_BLOCK_WEEKS`. Until that Monday each type keeps its own phase.
 *
 * The Monday is stored on every row (`switchOverOn`) as soon as a finished deload gives it, and read
 * back: a type that then leaves its deload (the per-type "Move to accumulation") no longer shows when
 * its deload finished, and the date must not fall back to `earliest`.
 *
 * With no Monday known and no type in a deload (no deload finished since the last one began, or the
 * release came after every type had left its deload, so no row shows the finish), the switch starts
 * on the Monday of the current week, never before `earliest`. A release on Thu 26 Nov, after Lower
 * left its deload on the 25th, starts the program on Mon 23 Nov, not backdated to 16 Nov.
 */
export function planSwitchOver(
  rows: PhaseRow[],
  completions: ProgramCompletion[],
  tz: string,
  now: Date = new Date(),
  earliest: string = PROGRAM_PHASE_SWITCH_EARLIEST,
): SwitchOverPlan {
  const phased = phasedRows(rows)
  if (isProgramAligned(rows)) return { kind: 'aligned', mark: phased.length > 0 && !isProgramSwitched(rows) }
  if (isProgramSwitched(rows) || !switchOverDue(phased, tz, earliest)) {
    return { kind: 'realign', target: programTarget(phased)! }
  }

  // #3876: once the date is known, a type that enters or restarts a deload after it neither holds the
  // switch-over nor moves the date later. Production restarted a finished deload on 18 Nov and the
  // switch, due on the 23rd, would have waited for two more sessions of it. A deload already under
  // way when the date became known still counts, as the signed rule says.
  const knownAt = switchOverKnownAt(phased, tz)
  const counting = phased.filter(r => r.phase === 'deload' && (knownAt == null || r.phaseStartedAt.getTime() < knownAt.getTime()))
  let lastFinish: Date | null = null
  for (const r of counting) {
    const done = completions
      .filter(c => c.programSessionId === r.programSessionId && c.completedAt.getTime() >= r.phaseStartedAt.getTime())
      .map(c => c.completedAt)
      .sort((a, b) => a.getTime() - b.getTime())
    const finish = done[DELOAD_FLOOR - 1]
    if (finish && (lastFinish == null || finish > lastFinish)) lastFinish = finish
  }
  const stored = phased.reduce<string | null>((d, r) => laterDay(d, r.pendingTransition?.switchOverOn), null)
  const knownDay = laterDay(stored, lastFinish ? shiftDateStr(trainingWeekOf(lastFinish, tz), 7) : null)
  const knownAtIso = knownDay == null ? null : (knownAt ?? now).toISOString()
  const wait = switchOverWait(knownDay, knownAtIso)
  const stamp = phased.every(r => r.pendingTransition?.switchOverPending === true
    && (r.pendingTransition.switchOverOn ?? null) === knownDay
    && (knownDay == null || r.pendingTransition.switchOverKnownAt === knownAtIso))
    ? null
    : wait

  if (counting.some(r => r.sessionsInPhase < DELOAD_FLOOR)) {
    return { kind: 'waiting', reason: 'deload_in_progress', stamp }
  }
  const startDay = laterDay(knownDay ?? trainingWeekOf(now, tz), earliest)!
  if (toAestDay(now, tz) < startDay) return { kind: 'waiting', reason: 'before_start', startDay, stamp }
  return { kind: 'switch', startDay, startsAt: dateStrMidnightInTz(startDay, tz) }
}

/** What the switch-over writes on every row besides the phase and start: the short first block,
 *  and the program's mark, so it never runs again. */
export function switchOverPendingTransition(): PendingTransition {
  return {
    newPhase: 'intensification',
    reasoning: `Switch-over to one phase for the program: the first accumulation block runs ${SWITCH_OVER_BLOCK_WEEKS} training weeks.`,
    urgency: 'normal',
    afterTrainingWeeks: SWITCH_OVER_BLOCK_WEEKS,
    programPhase: true,
  }
}

/**
 * The phase a session type takes when its baseline completes, from the rows of the program's other
 * types: the program's phase and start when it has one (so it joins the program where it is); a
 * fresh accumulation from `now`, marked as the program's, when it is the first; and accumulation from
 * `now` while the program waits for its switch-over, which then moves it with the rest.
 */
export function joiningPhaseFor(siblings: PhaseRow[], now: Date): {
  phase: PeriodizationPhase; phaseStartedAt: Date; pendingTransition: PendingTransition | null
} {
  const phased = phasedRows(siblings)
  if (phased.length === 0) return { phase: 'accumulation', phaseStartedAt: now, pendingTransition: programMoveMark('accumulation') }
  if (isProgramAligned(phased)) {
    const [first] = phased
    return { phase: first.phase, phaseStartedAt: first.phaseStartedAt, pendingTransition: first.pendingTransition }
  }
  if (isProgramSwitched(phased)) return programTarget(phased)!
  const wait = phased.find(r => r.pendingTransition?.switchOverPending === true)?.pendingTransition ?? null
  return { phase: 'accumulation', phaseStartedAt: now, pendingTransition: wait }
}

/** A program move only writes when the program is where the caller saw it. `phase` + `phaseStartedAt`:
 *  every phased row still holds them. `'switch-over'`: the program has not switched yet. */
export type ProgramMoveExpectation = { phase: PeriodizationPhase; phaseStartedAt: Date } | 'switch-over'

export interface ProgramMoveOptions {
  /** Session types whose plans are voided even when they hold a one-day deload. */
  voidAll?: string[]
  expect?: ProgramMoveExpectation
}

/** Worked out from the rows read under the program's row lock, never from an earlier read: a move
 *  landing between that read and the lock is then not undone, and a waiting stamp written after the
 *  switch-over cannot overwrite the switch's mark and 3-week block. */
export type DecidePending = (lockedRows: PhaseRow[]) => PendingTransition | null
export type DecideTarget = (lockedRows: PhaseRow[]) => ProgramTarget | null

/** The program's first-read mark, when the locked rows still share one phase without it. */
export function firstReadMark(rows: PhaseRow[]): PendingTransition | null {
  const phased = phasedRows(rows)
  if (phased.length === 0 || !isProgramAligned(rows) || isProgramSwitched(rows)) return null
  return programMoveMark(phased[0].phase, phased[0].pendingTransition)
}

/** The waiting stamp, when the locked rows still wait for the switch-over and lack it. */
export function waitingStampFor(completions: ProgramCompletion[], tz: string, now: Date): DecidePending {
  return rows => {
    const plan = planSwitchOver(rows, completions, tz, now)
    return plan.kind === 'waiting' ? plan.stamp : null
  }
}

/** The re-align target, when the locked rows still call for a re-align. */
export function realignTargetFor(completions: ProgramCompletion[], tz: string, now: Date): DecideTarget {
  return rows => {
    const plan = planSwitchOver(rows, completions, tz, now)
    if (plan.kind === 'realign') return plan.target
    // Aligned but some row lacks the mark (a move in between wrote it on all): nothing to do.
    return null
  }
}

/** The repository calls the program phase needs (a subset of `WorkoutRepository`). */
export interface ProgramPhaseRepo {
  reconcileSessionsInPhase(userId: string, programId: string): Promise<void>
  listSessionPeriodizationForProgram(userId: string, programId: string): Promise<SessionPeriodization[]>
  listProgramCompletions(userId: string, programId: string, since: Date): Promise<ProgramCompletion[]>
  /** Resolves false when the expectation no longer held and nothing was written. */
  setProgramPhase(
    userId: string, programId: string, phase: PeriodizationPhase, startedAt: Date,
    pendingTransition: PendingTransition | null, opts?: ProgramMoveOptions,
  ): Promise<boolean | void>
  /** Under the program's row lock, writes `decide(lockedRows)` on every phased row, leaving phase,
   *  start and plans alone; writes nothing when it returns null. */
  setProgramPendingTransition(userId: string, programId: string, decide: DecidePending): Promise<void>
  /** Under the program's row lock, puts every phased row on `decide(lockedRows)` (nothing when
   *  null); only rows that differed lose their plans. */
  realignProgramPhase(userId: string, programId: string, decide: DecideTarget): Promise<void>
  voidSessionPrescription(userId: string, programSessionId: string): Promise<void>
}

/** While a program waits for its switch-over, an unanswered per-type move offer from before the
 *  rule (Upper's overdue move, Pull's realisation) is no longer a move the program will make: the
 *  signed switch-over puts every type in accumulation instead. Only a type in a deload keeps its own
 *  way out, so its offer stays. */
export function staleTypeMoveOffer(r: Pick<SessionPeriodization, 'phase' | 'prescription' | 'prescriptionStatus'>): boolean {
  return r.phase !== 'deload' && r.prescriptionStatus === 'pending' && r.prescription?.phaseAction === 'transition_recommended'
}

/**
 * Read the program's phase, first doing what the rows call for: marking a program that already shares
 * one phase, stamping (and dating) a program that waits for its switch-over, running the switch-over
 * when it is due, or re-aligning a program on one phase whose rows have come to disagree. Idempotent:
 * a second call finds the rows as the first left them and writes nothing.
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
  let completions = await completionsFor(repo, userId, programId, rows, tz)
  const plan = planSwitchOver(rows, completions, tz, now)
  // #4082 review: these program writes queue behind a person's check-in or Coach apply for a bounded time
  // (`BusyError` past it, nothing written). A read must not fail for that: the sync is a repair that every
  // read retries, so a busy write is skipped and the view below is built from the rows as they are.
  const whenFree = async (write: () => Promise<unknown>) => {
    try { await write() } catch (err) { if (!isBusyError(err)) throw err }
  }
  // Every write below re-decides from the rows it locks (`DecidePending`, `DecideTarget`, the
  // switch's `expect`); this read only says which write to try.
  if (plan.kind === 'aligned' && plan.mark) {
    await whenFree(() => repo.setProgramPendingTransition(userId, programId, firstReadMark))
    rows = await repo.listSessionPeriodizationForProgram(userId, programId)
  }
  if (plan.kind === 'waiting') {
    if (plan.stamp) await whenFree(() => repo.setProgramPendingTransition(userId, programId, waitingStampFor(completions, tz, now)))
    for (const r of phasedRows(rows).filter(staleTypeMoveOffer)) await repo.voidSessionPrescription(userId, r.programSessionId)
  }
  if (plan.kind === 'realign' || plan.kind === 'switch') {
    if (plan.kind === 'realign') await whenFree(() => repo.realignProgramPhase(userId, programId, realignTargetFor(completions, tz, now)))
    else await whenFree(() => repo.setProgramPhase(userId, programId, 'accumulation', plan.startsAt, switchOverPendingTransition(), { expect: 'switch-over' }))
    await repo.reconcileSessionsInPhase(userId, programId)
    rows = await repo.listSessionPeriodizationForProgram(userId, programId)
    completions = await completionsFor(repo, userId, programId, rows, tz)
  }
  return programPhaseView(rows, completions, tz, now)
}

/**
 * #3876: the program's side of `deloadEndDue`, for a read that serves a stored plan. Read-only: it
 * neither reconciles nor stamps, so a poll can call it (generation runs `syncProgramPhase`, which
 * does both, before it decides the exit). Only a type in a deload needs it; any other returns null
 * without a query.
 */
export async function readProgramDeloadCheck(
  repo: Pick<ProgramPhaseRepo, 'listSessionPeriodizationForProgram' | 'listProgramCompletions'>,
  userId: string,
  programId: string,
  state: { phase: string } | null | undefined,
  tz: string,
  now: Date = new Date(),
): Promise<ProgramDeloadCheck | null> {
  if (state?.phase !== 'deload') return null
  const rows = await repo.listSessionPeriodizationForProgram(userId, programId)
  if (!isProgramAligned(rows)) return { aligned: false, deloadFinished: false, trainingWeeksDone: 0 }
  return programDeloadCheckOf(programPhaseView(rows, await completionsFor(repo, userId, programId, rows, tz), tz, now))
}

/**
 * #3907: one stored state as every route that serves or acts on a stored plan must see it
 * (`servePrescriptionState`): an aged-out plan, or one whose deload has ended, comes back as `null`
 * with `prescriptionAgedOut`. On an `ai_dynamic` program an aligned program's cap decides the deload
 * (`readProgramDeloadCheck`); with no such program, or a failed read, the type's own count does.
 */
export async function serveStoredPrescription<T extends Pick<SessionPeriodization, 'prescriptionStatus' | 'prescriptionExpiresAt'>
  & Partial<Pick<SessionPeriodization, 'prescription' | 'phase' | 'sessionsInPhase'>>>(
  repo: Pick<ProgramPhaseRepo, 'listSessionPeriodizationForProgram' | 'listProgramCompletions'>,
  userId: string,
  program: { id: string; phaseMode: string } | null | undefined,
  state: T,
  tz: string,
  now: Date = new Date(),
): Promise<ServedPrescriptionState<T>> {
  const programDeload = program?.phaseMode === 'ai_dynamic' && state.phase != null
    ? await readProgramDeloadCheck(repo, userId, program.id, { phase: state.phase }, tz, now).catch(() => null)
    : null
  return servePrescriptionState(state, now, programDeload)
}

/** `deloadEndDue`'s program side from a view already read (`syncProgramPhase` returns one). */
export function programDeloadCheckOf(view: ProgramPhaseView): ProgramDeloadCheck {
  return { aligned: view.aligned, deloadFinished: programDeloadFinished(view), trainingWeeksDone: view.trainingWeeksDone }
}

/** The program's completions from the start of the training week its earliest phase began in: the
 *  sessions before a move in its own week decide whether that week counts. */
async function completionsFor(
  repo: Pick<ProgramPhaseRepo, 'listProgramCompletions'>, userId: string, programId: string, rows: PhaseRow[], tz: string,
): Promise<ProgramCompletion[]> {
  const starts = phasedRows(rows).map(r => r.phaseStartedAt.getTime())
  if (starts.length === 0) return []
  return repo.listProgramCompletions(userId, programId, trainingWeekStartOf(new Date(Math.min(...starts)), tz))
}
