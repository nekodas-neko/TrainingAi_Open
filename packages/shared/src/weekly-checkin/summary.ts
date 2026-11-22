/**
 * #3890: the week in three lines, worked out by code. Every number comes from the logs through the
 * session read (`readSession`, #3889), and the text is written here from those numbers. No model is
 * called: a model-written summary from the same numbers is the issue's listed alternative, for later.
 *
 *   1. Sessions done against planned.
 *   2. For each main lift, what its latest session read says: going up, steady, holding (and why) or
 *      coming down.
 *   3. Days the weight held for short rest (`hold-rest-more`).
 *
 * Pure. Lift names are the program's own; no health value is in the text.
 */
import type { SessionRead } from '../ai-periodization/session-read'

export type LiftDirection = 'up' | 'steady' | 'held' | 'down' | 'unknown'
export type LiftWhy = 'more_load' | 'more_reps' | 'short_rest' | 'heart_rate' | 'felt_hard' | 'missed_reps' | 'logging_slip' | null

/** One read of one main lift this week, with the local day of the workout it judged. */
export interface WeekLiftRead {
  day: string
  read: SessionRead
}

export interface WeekLiftInput {
  exerciseName: string
  exerciseId: string | null
  /** Oldest first. */
  reads: readonly WeekLiftRead[]
}

export interface CheckinLiftSummary {
  exerciseName: string
  exerciseId: string | null
  /** Readable sessions of the lift this week. */
  sessions: number
  direction: LiftDirection
  why: LiftWhy
  /** A set short of its planned reps this week (decision 9's "missed rep"); null with no readable session. */
  missedRep: boolean | null
}

export interface CheckinSummary {
  sessionsDone: number
  sessionsPlanned: number
  lifts: CheckinLiftSummary[]
  /** Distinct local days a main lift's read held the weight for short rest. */
  shortRestDays: number
  /** The three lines, in order. */
  lines: [string, string, string]
}

/** A set short of its planned reps, excluding a set the lifter chose to lift heavier than planned. */
export function readHasMissedRep(read: SessionRead): boolean {
  return read.sets.some(s => s.cls === 'miss' && s.missReps > 0)
}

/** Whether a missed rep was seen in the week's reads of a lift: null when none could be read. */
export function missedRepInWeek(reads: readonly WeekLiftRead[]): boolean | null {
  const judged = reads.filter(r => r.read.sets.length > 0)
  if (judged.length === 0) return null
  return judged.some(r => readHasMissedRep(r.read))
}

export function directionOf(read: SessionRead | null): { direction: LiftDirection; why: LiftWhy } {
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

const WHY_TEXT: Record<Exclude<LiftWhy, null>, string> = {
  more_load: 'more weight',
  more_reps: 'more reps',
  short_rest: 'short rest',
  heart_rate: 'heart rate slow to settle',
  felt_hard: 'felt hard',
  missed_reps: 'a rep short',
  logging_slip: 'likely a logging slip',
}

function nameList(lifts: CheckinLiftSummary[], withWhy: boolean): string {
  return lifts.map(l => (withWhy && l.why ? `${l.exerciseName} (${WHY_TEXT[l.why]})` : l.exerciseName)).join(', ')
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function summarizeWeek(input: {
  sessionsDone: number
  sessionsPlanned: number
  lifts: readonly WeekLiftInput[]
}): CheckinSummary {
  const shortRestDayset = new Set<string>()
  const lifts: CheckinLiftSummary[] = input.lifts.map(l => {
    const latest = [...l.reads].reverse().find(r => r.read.verdict !== 'too-little-data') ?? l.reads[l.reads.length - 1] ?? null
    for (const r of l.reads) if (r.read.verdict === 'hold-rest-more') shortRestDayset.add(r.day)
    return {
      exerciseName: l.exerciseName,
      exerciseId: l.exerciseId,
      sessions: l.reads.length,
      ...directionOf(latest?.read ?? null),
      missedRep: missedRepInWeek(l.reads),
    }
  })

  const sessionsLine = input.sessionsPlanned > 0
    ? `${input.sessionsDone} of ${plural(input.sessionsPlanned, 'planned session', 'planned sessions')} done.`
    : `${plural(input.sessionsDone, 'session', 'sessions')} done.`

  const group = (d: LiftDirection) => lifts.filter(l => l.direction === d)
  const parts: string[] = []
  const up = group('up'); const steady = group('steady'); const held = group('held'); const down = group('down')
  if (up.length) parts.push(`Going up: ${nameList(up, true)}.`)
  if (steady.length) parts.push(`On plan: ${nameList(steady, false)}.`)
  if (held.length) parts.push(`Holding: ${nameList(held, true)}.`)
  if (down.length) parts.push(`Coming down: ${nameList(down, true)}.`)
  const liftsLine = parts.length > 0 ? parts.join(' ') : 'No main lift logged this week.'

  const shortRestDays = shortRestDayset.size
  const restLine = shortRestDays > 0
    ? `Weight held for short rest on ${plural(shortRestDays, 'day', 'days')}.`
    : 'No day held for short rest.'

  return {
    sessionsDone: input.sessionsDone,
    sessionsPlanned: input.sessionsPlanned,
    lifts,
    shortRestDays,
    lines: [sessionsLine, liftsLine, restLine],
  }
}
