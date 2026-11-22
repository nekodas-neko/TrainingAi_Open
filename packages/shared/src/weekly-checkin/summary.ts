/**
 * #3890: the week in three lines, worked out by code. No model is called: a model-written summary from
 * the same numbers is the issue's listed alternative, for later.
 *
 * **Every sentence states what the logs show, never what the app did** (review, 22 Nov). The session
 * read (#3889) is in shadow: no plan reads its verdict, so "held for short rest" or "going up" would claim
 * an action that did not happen. The lines compare each main lift's last session of the week with what
 * the app asked for, set by set (`classifySet`, the read's own per-set rule):
 *
 *   1. Sessions done, and planned when the program has a schedule.
 *   2. For each main lift logged this week, its last session against the plan: beat it, met it, fell
 *      short, or went heavier than planned (short on reps only at more than the planned weight); or that
 *      it was logged and not compared, and why (a deload or baseline week, a session
 *      changed from the plan, not finished, no bar weight, too few planned sets).
 *   3. Days a short rest cost reps (a miss the rest before it excuses, by the same rule).
 *
 * The read's verdict stays available as a machine field (`shadow`), for later, and is never a sentence.
 * Pure. Lift names are the program's own; no health value is in the text.
 */
import {
  classifySets, isReadableLog, readLog, unexcusedMissAtPlan, type SessionReadLog, type SessionVerdict,
} from '../ai-periodization/session-read'

/** The shadow read's direction for a lift. A machine field: the summary never says it as fact. */
export type LiftDirection = 'up' | 'steady' | 'held' | 'down' | 'unknown'
export type LiftWhy = 'more_load' | 'more_reps' | 'short_rest' | 'heart_rate' | 'felt_hard' | 'missed_reps' | 'logging_slip' | null

/** The lift's last session of the week against the plan, from the logged sets. */
export type LastSessionAgainstPlan = 'beat' | 'met' | 'short' | 'heavier' | 'not_compared'
/** Why a logged session was not compared with the plan. */
export type NotComparedWhy = 'incomplete' | 'deload' | 'baseline' | 'override' | 'no_weight' | 'too_few_planned_sets'

/** One log of one main lift this week, with the local day of its workout. */
export interface WeekLiftLog {
  day: string
  log: SessionReadLog
}

export interface WeekLiftInput {
  exerciseName: string
  exerciseId: string | null
  /** The lift's plate step (`weightStepFor`) and the rep ceiling the read uses for it. */
  weightStepKg: number
  repCeiling: number | null
  /** The lift's logs this week in the active program, oldest first. */
  logs: readonly WeekLiftLog[]
}

export interface CheckinLiftSummary {
  exerciseName: string
  exerciseId: string | null
  /** Sessions the lift was logged in this week. */
  sessions: number
  /** Its last session against the plan; null when it was not logged this week. */
  lastSession: LastSessionAgainstPlan | null
  notComparedWhy: NotComparedWhy | null
  /**
   * Decision 9's missed rep, the one value a save acts on (`unexcusedMissAtPlan` on the lift's last
   * session of the week): null when the lift was not logged, false when that session was not compared.
   */
  missedRep: boolean | null
  /** The session read of that last session. In shadow: kept for later, never stated as something the app did. */
  shadow: { verdict: SessionVerdict; direction: LiftDirection; why: LiftWhy } | null
}

export interface CheckinSummary {
  sessionsDone: number
  /** Null when the program has no schedule to count from. */
  sessionsPlanned: number | null
  lifts: CheckinLiftSummary[]
  /** Distinct local days on which a short rest cost a main lift reps. */
  shortRestDays: number
  /** The three lines, in order. */
  lines: [string, string, string]
}

/** Why a log is not compared with the plan, or null when it is. The read's own filters, in its order. */
export function notComparedWhy(log: SessionReadLog, weightStepKg: number): NotComparedWhy | null {
  const s = log.session
  if (!s.completed) return 'incomplete'
  if (log.exerciseDeloaded || s.isEarlyDeload || s.intensityMode === 'deload' || s.phaseType === 'deload') return 'deload'
  if (s.phaseType === 'baseline') return 'baseline'
  if (s.wasOverride) return 'override'
  if (log.exerciseType === 'bodyweight' || !((log.estimated1rm ?? 0) > 0)) return 'no_weight'
  if (!isReadableLog(log)) return 'no_weight'
  if (readLog(log, weightStepKg).verdict === 'too-little-data') return 'too_few_planned_sets'
  return null
}

/**
 * The last session against the plan, set by set: a planned set short at the planned weight or lighter
 * is short; else a set short only because the person loaded more than planned (`miss-self-heavier`) is
 * heavier, which is what the logs show, not a shortfall against the plan; else any beaten is beat.
 */
export function againstPlan(log: SessionReadLog, weightStepKg: number): Exclude<LastSessionAgainstPlan, 'not_compared'> {
  const classes = classifySets(log.sets, weightStepKg).map(c => c.result.cls)
  if (classes.includes('miss')) return 'short'
  if (classes.includes('miss-self-heavier')) return 'heavier'
  return classes.includes('beat') ? 'beat' : 'met'
}

/** The shadow read's verdict in machine words (formerly the summary's line 2; now a field only). */
export function directionOf(read: ReturnType<typeof readLog> | null): { direction: LiftDirection; why: LiftWhy } {
  if (!read || read.verdict === 'too-little-data') return { direction: 'unknown', why: null }
  switch (read.verdict) {
    case 'progress-load': return { direction: 'up', why: 'more_load' }
    case 'progress-reps': return { direction: 'up', why: 'more_reps' }
    case 'reduce': return { direction: 'down', why: 'missed_reps' }
    case 'hold-rest-more': return { direction: 'held', why: 'short_rest' }
    case 'hold-recovery': return { direction: 'held', why: 'heart_rate' }
    case 'hold':
      if (read.easierWithMiss) return { direction: 'held', why: 'logging_slip' }
      if (read.band === 'small') return { direction: 'held', why: 'missed_reps' }
      if (read.effort === 1) return { direction: 'held', why: 'felt_hard' }
      return read.nextLoad === 'hold' ? { direction: 'held', why: null } : { direction: 'steady', why: null }
  }
}

/** One lift's week. */
export function summarizeLift(l: WeekLiftInput): CheckinLiftSummary & { shortRestDays: string[] } {
  const base = { exerciseName: l.exerciseName, exerciseId: l.exerciseId, sessions: l.logs.length }
  const shortRestDays = l.logs
    .filter(({ log }) => notComparedWhy(log, l.weightStepKg) == null && readLog(log, l.weightStepKg, l.repCeiling).restShort)
    .map(({ day }) => day)
  const last = l.logs[l.logs.length - 1]
  if (!last) return { ...base, lastSession: null, notComparedWhy: null, missedRep: null, shadow: null, shortRestDays }
  const why = notComparedWhy(last.log, l.weightStepKg)
  if (why) return { ...base, lastSession: 'not_compared', notComparedWhy: why, missedRep: false, shadow: null, shortRestDays }
  const read = readLog(last.log, l.weightStepKg, l.repCeiling)
  return {
    ...base,
    lastSession: againstPlan(last.log, l.weightStepKg),
    notComparedWhy: null,
    missedRep: unexcusedMissAtPlan(last.log.sets, l.weightStepKg, last.log.session.wasOverride),
    shadow: { verdict: read.verdict, ...directionOf(read) },
    shortRestDays,
  }
}

const AGAINST_PLAN_TEXT: Record<Exclude<LastSessionAgainstPlan, 'not_compared'>, string> = {
  beat: 'beat the plan',
  met: 'met the plan',
  short: 'fell short of the plan',
  heavier: 'went heavier than planned',
}
const NOT_COMPARED_TEXT: Record<NotComparedWhy, string> = {
  incomplete: 'not finished',
  deload: 'deload',
  baseline: 'baseline week',
  override: 'changed from the plan',
  no_weight: 'no bar weight to compare',
  too_few_planned_sets: 'too few planned sets',
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Line 1. Never "4 of 3"; with no schedule, no planned count. */
export function sessionsLine(done: number, planned: number | null): string {
  if (planned == null || planned <= 0) return `${plural(done, 'session', 'sessions')} done.`
  if (done > planned) return `${plural(done, 'session', 'sessions')} done, ${planned} planned.`
  return `${done} of ${plural(planned, 'planned session', 'planned sessions')} done.`
}

export function summarizeWeek(input: {
  sessionsDone: number
  sessionsPlanned: number | null
  lifts: readonly WeekLiftInput[]
}): CheckinSummary {
  const days = new Set<string>()
  const lifts: CheckinLiftSummary[] = input.lifts.map(l => {
    const { shortRestDays, ...lift } = summarizeLift(l)
    for (const d of shortRestDays) days.add(d)
    return lift
  })

  const compared = lifts.filter(l => l.lastSession && l.lastSession !== 'not_compared')
  const notCompared = lifts.filter(l => l.lastSession === 'not_compared')
  const parts: string[] = []
  if (compared.length > 0) {
    parts.push(`Last session: ${compared.map(l => `${l.exerciseName} ${AGAINST_PLAN_TEXT[l.lastSession as keyof typeof AGAINST_PLAN_TEXT]}`).join(', ')}.`)
  }
  if (notCompared.length > 0) {
    const byWhy = new Map<NotComparedWhy, string[]>()
    for (const l of notCompared) byWhy.set(l.notComparedWhy!, [...(byWhy.get(l.notComparedWhy!) ?? []), l.exerciseName])
    parts.push(`Logged, not compared this week: ${[...byWhy].map(([why, names]) => `${names.join(', ')} (${NOT_COMPARED_TEXT[why]})`).join('; ')}.`)
  }
  const liftsLine = parts.length > 0 ? parts.join(' ') : 'No main lift logged this week.'

  const shortRestDays = days.size
  const anyCompared = input.lifts.some(l => l.logs.some(({ log }) => notComparedWhy(log, l.weightStepKg) == null))
  const restLine = shortRestDays > 0
    ? `Short rest cost reps on ${plural(shortRestDays, 'day', 'days')}.`
    : anyCompared ? 'Short rest cost no reps.' : 'No set compared for rest this week.'

  return {
    sessionsDone: input.sessionsDone,
    sessionsPlanned: input.sessionsPlanned != null && input.sessionsPlanned > 0 ? input.sessionsPlanned : null,
    lifts,
    shortRestDays,
    lines: [sessionsLine(input.sessionsDone, input.sessionsPlanned), liftsLine, restLine],
  }
}
