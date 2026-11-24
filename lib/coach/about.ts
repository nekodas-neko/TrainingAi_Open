import { and, eq, isNull, sql } from 'drizzle-orm'
import * as s from '@/lib/data/postgres/schema'
import type { WorkoutRepository } from '@/lib/data/repository'
import type { CoachContext } from '@trainingai/shared/coach/context'
import { chipsFor, type CoachAbout } from '@trainingai/shared/coach/chips'
import { loadLiftPreferences } from '@trainingai/shared/ai-periodization/lift-preference-read'
import { prescribedBar } from '@trainingai/shared/workout/load-rounding'
import { toAestDay, weekStartForDay } from '@trainingai/shared/date-utils'
import { loadTarget, type TargetRow } from './domains/session-exercise'
import { staticNextExercise, type StaticReads } from './domains/lift-preference'
import { ownProgramSession, ownWorkout, readExerciseContext, type LoggedExercise } from './context'
import type { Db } from './domains/types'

/**
 * The top of the Coach when it opens (#3896 steps 6 and 7, owner's pick 8b A): the context line
 * ("About" / "Cable pulldown · next 3 × 8 @ 50 kg") and the buttons under it.
 *
 * **Both are the server's, from the ownership-checked context.** Every id is checked against the
 * signed-in user before anything is read by it (`loadTarget`, `ownProgramSession`, `ownWorkout`, the
 * joins the chat and apply paths use); a foreign or unknown id is `{ ok: false }` and the route
 * answers 404. The client never sends text: the lift's name is read from its own row and its next
 * prescription from the reader the plan uses — the stored AI plan as the workout screen reads it
 * (`readExerciseContext`), or the program as written with the lift's preference applied
 * (`staticNextExercise` → `readSessionFromStoredState`, the reader the session screen and the Next workout card use). The model is not involved.
 */

export type CoachAboutResult = { ok: true; about: CoachAbout } | { ok: false }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayLabel = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}`
}
const kg = (v: number) => `${Math.round(v * 100) / 100} kg`

/** "3 × 8 @ 50 kg", "3 sets of 8, 6, 4 @ 50–60 kg", "3 × 12". Null with no sets. */
export function prescriptionText(sets: readonly { reps: number; weightKg: number | null }[]): string | null {
  if (sets.length === 0) return null
  const reps = sets.map(x => x.reps)
  const volume = reps.every(r => r === reps[0]) ? `${sets.length} × ${reps[0]}` : `${sets.length} sets of ${reps.join(', ')}`
  const weights = [...new Set(sets.map(x => x.weightKg).filter((w): w is number => w != null && w > 0))].sort((a, b) => a - b)
  const load = weights.length === 0 ? ''
    : weights.length === 1 ? ` @ ${kg(weights[0])}`
      : ` @ ${Math.round(weights[0] * 100) / 100}–${kg(weights.at(-1)!)}`
  return `${volume}${load}`
}

async function libraryRow(db: Db, target: TargetRow) {
  const [row] = await db.select({ exerciseType: s.exerciseLibrary.exerciseType, equipment: s.exerciseLibrary.equipment })
    .from(s.exerciseLibrary)
    .where(target.exerciseId ? eq(s.exerciseLibrary.id, target.exerciseId) : eq(s.exerciseLibrary.name, target.exerciseName))
    .limit(1)
  return row ?? null
}

/**
 * The lift's next prescription, read once for both the context line and "Why this weight?" (#3896
 * review): the stored AI plan as the workout screen reads it, or the program as written with the
 * lift's preference applied. Every number in it is code's.
 */
export type NextPlan =
  | { kind: 'none' }
  /** A deload or a test: the workout screen lightens or replaces what is stored, so no numbers. */
  | { kind: 'deload'; test: boolean }
  | {
      kind: 'plan'
      source: 'ai' | 'program'
      sets: { reps: number; pct: number; weightKg: number | null }[]
      bodyweight: boolean
      /** The 1RM the weights are a percentage of; null when none is recorded yet. */
      basisKg: number | null
      /** The AI plan's rest; the program's rest is per set and not quoted. */
      restSec: number | null
    }

export async function readNextPlan(
  db: Db, repo: StaticReads & WorkoutRepository, userId: string, target: TargetRow, tz: string, today: string,
): Promise<NextPlan> {
  if (target.phaseMode === 'ai_dynamic') {
    const [ctx, lib] = await Promise.all([readExerciseContext(db, repo, userId, target.id, tz), libraryRow(db, target)])
    const plan = ctx?.storedPlan
    if (!plan || !plan.drivesLoad) return { kind: 'none' }
    // #3896 review: on a deload the workout screen can lighten the stored plan further, so the stored
    // numbers would disagree with it.
    if (plan.deloaded) return { kind: 'deload', test: false }
    const bodyweight = lib?.exerciseType === 'bodyweight'
    const weightKg = bodyweight ? null : plan.weightKg
    return {
      kind: 'plan',
      source: 'ai',
      sets: Array.from({ length: plan.sets }, () => ({ reps: plan.reps, pct: plan.pct, weightKg })),
      bodyweight,
      // `weightKg` is `prescribedBar(basis, pct)`: null exactly when there is no basis.
      basisKg: null,
      restSec: plan.restSec,
    }
  }
  // #3890: with this week's check-in hold, so the Coach describes the bar the session screen will show.
  const next = await staticNextExercise(repo, userId, target, today,
    await loadLiftPreferences(repo, userId, [target.exerciseName], { checkinWeekStart: weekStartForDay(today) }))
  if (!next) return { kind: 'none' }
  if (next.excluded) return { kind: 'deload', test: true }
  const ex = next.exercise
  const style = ex?.progressionStyle
  if (!ex || !style || style.length === 0) return { kind: 'none' }
  const bodyweight = ex.exerciseType === 'bodyweight'
  return {
    kind: 'plan',
    source: 'program',
    sets: style.map(set => ({
      reps: set.reps,
      pct: set.pct,
      // The bar the session screen shows for a planned set (`prescribedWeight` in the app).
      weightKg: bodyweight ? null : prescribedBar(ex.estimated1rm, set.pct, ex.equipment),
    })),
    bodyweight,
    basisKg: bodyweight ? null : (ex.estimated1rm ?? null),
    restSec: null,
  }
}

/** The lift's next prescription as one line, by the readers the plan uses. */
export async function liftLine(db: Db, repo: StaticReads & WorkoutRepository, userId: string, target: TargetRow, tz: string, today: string): Promise<string> {
  const name = target.exerciseName
  const plan = await readNextPlan(db, repo, userId, target, tz, today)
  if (plan.kind === 'none') return target.phaseMode === 'ai_dynamic' ? `${name} · next plan is made when you start` : name
  if (plan.kind === 'deload') return plan.test ? `${name} · next session is a deload or a test` : `${name} · next session is a deload`
  const text = prescriptionText(plan.sets)
  return text ? `${name} · next ${text}` : name
}

const pctText = (sets: readonly { pct: number }[]) => {
  const pcts = [...new Set(sets.map(x => x.pct))].sort((a, b) => a - b)
  const r = (v: number) => Math.round(v * 10) / 10
  return pcts.length === 1 ? `${r(pcts[0])}%` : `${r(pcts[0])}–${r(pcts.at(-1)!)}%`
}

/** "planned 3 × 8 @ 50 kg, did 8, 8, 6 @ 50 kg" for one logged exercise; null with no sets. */
export function lastTimeText(log: LoggedExercise, bodyweight: boolean): string | null {
  if (log.sets.length === 0) return null
  const w = (v: number | null) => (bodyweight || v == null || v <= 0 ? null : v)
  const planned = log.sets.every(x => x.plannedReps != null)
    ? prescriptionText(log.sets.map(x => ({ reps: x.plannedReps!, weightKg: w(x.plannedWeightKg) })))
    : null
  const weights = [...new Set(log.sets.map(x => w(x.weightKg)))]
  const did = weights.length === 1
    ? `${log.sets.map(x => x.reps).join(', ')}${weights[0] != null ? ` @ ${kg(weights[0])}` : ''}`
    : log.sets.map(x => `${x.reps}${w(x.weightKg) != null ? ` @ ${kg(w(x.weightKg)!)}` : ''}`).join(', ')
  return `${planned ? `planned ${planned}, ` : ''}did ${did}`
}

/**
 * The answer to "Why this weight?" (#3896 review, the Orchestrator's call): **written by code, with
 * no model call**, from the reader the context line uses and the lift's last log. On a deload or a
 * test it gives no numbers, as the context line does. The stored AI plan keeps no reason per lift, so
 * the answer names what the weight is worked out from instead: the percentage and the 1RM it is of.
 */
export async function whyThisWeight(
  db: Db, repo: StaticReads & WorkoutRepository, userId: string, target: TargetRow, tz: string, today: string,
): Promise<string> {
  const name = target.exerciseName
  const [plan, ctx] = await Promise.all([
    readNextPlan(db, repo, userId, target, tz, today),
    readExerciseContext(db, repo, userId, target.id, tz),
  ])
  if (plan.kind === 'none') {
    return target.phaseMode === 'ai_dynamic'
      ? `${name} has no plan for next time yet. The app makes it when you start the session, and the workout screen shows the weight then.`
      : `${name} has no sets written in your program yet, so there is no weight to explain.`
  }
  if (plan.kind === 'deload') {
    return plan.test
      ? `${name}'s next session is a deload or a test, so your program sets lighter or different work for it. The workout screen shows the weight.`
      : `${name}'s next session is a deload, so the app lightens the plan when you start. The workout screen shows the weight.`
  }
  const next = prescriptionText(plan.sets)!
  const parts: string[] = []
  if (plan.bodyweight) {
    parts.push(`${name} is a bodyweight lift, so there is no weight to set. ${plan.source === 'ai' ? 'The AI plan' : 'Your program'} has it at ${next} next time.`)
  } else if (plan.source === 'ai') {
    parts.push(plan.sets[0].weightKg == null
      ? `The AI plan has ${name} at ${next} next time, at ${pctText(plan.sets)} of your 1RM. No 1RM is recorded for it yet, so there is no weight to show.`
      : `The AI plan has ${name} at ${next} next time. The weight is ${pctText(plan.sets)} of your working 1RM, rounded up to a weight you can load.`)
  } else {
    parts.push(plan.basisKg == null || plan.sets.every(x => x.weightKg == null)
      ? `Your program sets ${name} at ${next} next time. No 1RM is recorded for it yet, so there is no weight to work out.`
      : `Your program sets this weight: ${name} at ${next} next time, which is ${pctText(plan.sets)} of your estimated 1RM of ${kg(plan.basisKg)}, rounded up to a weight you can load.`)
  }
  if (plan.restSec != null) parts.push(`Rest ${plan.restSec} s between sets.`)
  const last = ctx?.recentLogs[0]
  const lastText = last ? lastTimeText(last, plan.bodyweight) : null
  if (last && lastText) parts.push(`Last time, on ${dayLabel(last.date)}${last.deloaded ? ' (a deload)' : ''}: ${lastText}.`)
  return parts.join(' ')
}

/**
 * The context line and buttons for a Coach opened with `ctx`. `{ ok: false }` when any id is not the
 * user's, or a lift and a session that do not belong together (the chat route refuses the same).
 */
export async function buildCoachAbout(
  db: Db,
  repo: StaticReads & WorkoutRepository,
  userId: string,
  ctx: CoachContext | undefined,
  opts: { scope: 'general' | 'nutrition'; liftPreference: boolean; tz: string; today: string },
): Promise<CoachAboutResult> {
  const [exercise, session, workout] = await Promise.all([
    ctx?.sessionExerciseId ? loadTarget(db, userId, ctx.sessionExerciseId) : Promise.resolve(undefined),
    ctx?.programSessionId ? ownProgramSession(db, userId, ctx.programSessionId) : Promise.resolve(undefined),
    ctx?.workoutId ? ownWorkout(db, userId, ctx.workoutId) : Promise.resolve(undefined),
  ])
  if (exercise === null || session === null || workout === null) return { ok: false }
  if (exercise && session && exercise.sessionId !== session.id) return { ok: false }

  const training = opts.scope !== 'nutrition'
  const lift = training && ctx?.origin === 'exercise' && !!exercise
  const chips = chipsFor({ scope: opts.scope, lift, liftPreference: opts.liftPreference })

  let line: string | null = null
  if (lift && exercise) {
    line = await liftLine(db, repo, userId, exercise, opts.tz, opts.today)
  } else if (training && ctx?.origin === 'session' && session) {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(s.sessionExercises)
      .where(and(eq(s.sessionExercises.sessionId, session.id), isNull(s.sessionExercises.deletedAt)))
    line = `${session.name} · ${row?.n ?? 0} exercise${row?.n === 1 ? '' : 's'}`
  } else if (training && ctx?.origin === 'recap' && workout) {
    line = `${workout.sessionName} · workout on ${dayLabel(toAestDay(workout.startedAt, opts.tz))}`
  }
  return { ok: true, about: { about: line ? { label: 'About', line } : null, chips } }
}

/** "Why this weight?" for a client-supplied slot id: ownership-checked by `loadTarget` before any
 *  read, null when the slot is not the user's. */
export async function whyThisWeightFor(
  db: Db, repo: StaticReads & WorkoutRepository, userId: string, sessionExerciseId: string, tz: string, today: string,
): Promise<string | null> {
  const target = await loadTarget(db, userId, sessionExerciseId)
  return target ? whyThisWeight(db, repo, userId, target, tz, today) : null
}
