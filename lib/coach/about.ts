import { and, eq, isNull, sql } from 'drizzle-orm'
import * as s from '@/lib/data/postgres/schema'
import type { WorkoutRepository } from '@/lib/data/repository'
import type { CoachContext } from '@trainingai/shared/coach/context'
import { chipsFor, type CoachAbout } from '@trainingai/shared/coach/chips'
import { loadLiftPreferences } from '@trainingai/shared/ai-periodization/lift-preference-read'
import { prescribedBar } from '@trainingai/shared/workout/load-rounding'
import { toAestDay } from '@trainingai/shared/date-utils'
import { loadTarget, type TargetRow } from './domains/session-exercise'
import { staticNextExercise, type StaticReads } from './domains/lift-preference'
import { ownProgramSession, ownWorkout, readExerciseContext } from './context'
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
 * (`staticNextExercise` → `buildWorkoutExercises`). The model is not involved.
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

/** The lift's next prescription as one line, by the readers the plan uses. */
export async function liftLine(db: Db, repo: StaticReads & WorkoutRepository, userId: string, target: TargetRow, tz: string, today: string): Promise<string> {
  const name = target.exerciseName
  if (target.phaseMode === 'ai_dynamic') {
    const [ctx, lib] = await Promise.all([readExerciseContext(db, repo, userId, target.id, tz), libraryRow(db, target)])
    const plan = ctx?.storedPlan
    if (!plan || !plan.drivesLoad) return `${name} · next plan is made when you start`
    const weightKg = lib?.exerciseType === 'bodyweight' ? null : plan.weightKg
    const text = prescriptionText(Array.from({ length: plan.sets }, () => ({ reps: plan.reps, weightKg })))
    return text ? `${name} · next ${text}${plan.deloaded ? ' (deload)' : ''}` : name
  }
  const next = await staticNextExercise(repo, userId, target, today, await loadLiftPreferences(repo, userId, [name]))
  if (!next) return name
  if (next.excluded) return `${name} · next session is a deload or a test`
  const ex = next.exercise
  const style = ex?.progressionStyle
  if (!ex || !style || style.length === 0) return name
  const weighted = ex.exerciseType !== 'bodyweight'
  const text = prescriptionText(style.map(set => ({
    reps: set.reps,
    // The bar the session screen shows for a planned set (`prescribedWeight` in the app).
    weightKg: weighted ? prescribedBar(ex.estimated1rm, set.pct, ex.equipment) : null,
  })))
  return text ? `${name} · next ${text}` : name
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
