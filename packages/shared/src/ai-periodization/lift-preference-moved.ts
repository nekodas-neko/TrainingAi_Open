/**
 * #4007: a lift's preference, or the weekly check-in's hold on it, moved while a plan was being generated.
 *
 * Generation reads a session's lift preferences at its start, calls the model (seconds), and then stores a
 * plan built from what it read. A change made meanwhile (the Coach, the rep-range editor, a check-in save
 * or undo) restates the STORED plan at once, and the generator's store then replaced it with a plan built
 * from the old preferences. The store now re-reads the preferences inside the per-user lift-write lock
 * (`storePrescriptionForCurrentPreferences`, `lib/data/postgres/slices/periodization.ts`) and, when they are
 * not the ones the plan was built from, the plan is restated here and stored in the same transaction. No lock is
 * held across the model call, and no model call is repeated.
 *
 * The restate is the one the stored plan would have had had the change landed just after the store:
 *   - a lift whose rep range, rest or one-off moved goes through `restatePlan`, the function the Coach's
 *     apply restates stored plans with (`lift-preference-restate.ts`);
 *   - a lift whose check-in hold moved (saved, or undone) goes through `holdStoredPrescription`, the function
 *     a stored plan is held, or given its own load back, with where it is served (`checkin-plan-hold.ts`).
 * A lift the plan's session does not contain is never read, and a lift whose preferences did not move is left
 * exactly as generation made it.
 *
 * Pure: the repository reads (the lifts' current preferences and bases) are the caller's.
 */
import type { AiPrescription, PeriodizationPhase } from '../types/ai-periodization'
import type { LiftPreference } from './lift-preference'
import { restatePlan } from './lift-preference-restate'
import { holdStoredPrescription, type HoldRowCtx } from './checkin-plan-hold'

/**
 * What a plan was built from, for the lifts named: each lift's rep range, rest, one-off and whether the
 * check-in holds it for the week. Not the hold's bar: that is read from the person's logs, which no
 * preference writer touches. Two stamps are equal exactly when no preference of these lifts moved.
 */
export function liftPreferencesStamp(prefs: ReadonlyMap<string, LiftPreference>, names: readonly string[]): string {
  return JSON.stringify([...new Set(names)].sort().map(name => {
    const p = prefs.get(name)
    return [
      name,
      p?.repRange ? [p.repRange.min, p.repRange.max] : null,
      p?.restSec ?? null,
      p?.oneShot ? [p.oneShot.loadStep, p.oneShot.setsDelta, p.oneShot.setAt.getTime()] : null,
      p?.checkinHold?.weekStart ?? null,
    ]
  }))
}

/** The lasting and one-off parts of a preference, as the Coach's restate takes them (no hold). */
function lastingOf(pref: LiftPreference | undefined): LiftPreference | null {
  if (!pref || (!pref.repRange && pref.restSec == null && !pref.oneShot)) return null
  return { repRange: pref.repRange, restSec: pref.restSec, oneShot: pref.oneShot }
}

const stampOf = (pref: LiftPreference | undefined, name: string) =>
  liftPreferencesStamp(new Map(pref ? [[name, lastingOf(pref) ?? { repRange: null, restSec: null, oneShot: null }]] : []), [name])

export interface MovedPreferencesCtx {
  programSessionId: string
  /** The session's phase (the row's, as the Coach's restate reads it). */
  phase: PeriodizationPhase
  trainingGoal: string
  /** The local Monday of the week the plan was made in (the hold's week). */
  weekStart: string
  /** The session's lifts, by plan row. */
  lifts: readonly { sessionExerciseId: string; name: string; role: string; equipment: string[] | null | undefined; bodyweight: boolean }[]
  /** The preferences the plan was built from, and the ones in force now (both with the hold, as `loadLiftPreferences` reads). */
  built: ReadonlyMap<string, LiftPreference>
  current: ReadonlyMap<string, LiftPreference>
  /** The working basis of a lift, by the resolver the workout screen uses. */
  basisKg: (name: string) => number | null
}

/** The names of the session's lifts whose rep range, rest or one-off differ between `built` and `current`. */
export function liftsWithMovedPreference(ctx: Pick<MovedPreferencesCtx, 'lifts' | 'built' | 'current'>): string[] {
  const names = [...new Set(ctx.lifts.map(l => l.name))]
  return names.filter(n => stampOf(ctx.built.get(n), n) !== stampOf(ctx.current.get(n), n))
}

/** The names of the session's lifts the check-in holds now but did not (or the other way round). */
export function liftsWithMovedHold(ctx: Pick<MovedPreferencesCtx, 'lifts' | 'built' | 'current'>): string[] {
  const names = [...new Set(ctx.lifts.map(l => l.name))]
  return names.filter(n => (ctx.built.get(n)?.checkinHold?.weekStart ?? null) !== (ctx.current.get(n)?.checkinHold?.weekStart ?? null))
}

/**
 * `prescription` (the plan as generation made it from `built`) restated for `current`. Returns the same
 * object when no lift of the session moved.
 */
export function restateForMovedPreferences(prescription: AiPrescription, ctx: MovedPreferencesCtx): AiPrescription {
  let plan = prescription
  for (const name of liftsWithMovedPreference(ctx)) {
    const slots = ctx.lifts.filter(l => l.name === name)
    plan = restatePlan(
      {
        slots: slots.map(l => ({ programSessionId: ctx.programSessionId, sessionExerciseId: l.sessionExerciseId, role: l.role })),
        trainingGoal: ctx.trainingGoal, bodyweight: slots[0].bodyweight, basisKg: ctx.basisKg(name), equipment: slots[0].equipment ?? null,
      },
      { programSessionId: ctx.programSessionId, phase: ctx.phase, prescription: plan },
      lastingOf(ctx.current.get(name)),
    )
  }
  if (liftsWithMovedHold(ctx).length > 0) {
    // The conditions `holdStoredPlanUnderCheckin` serves a stored plan under: not in a deload or a baseline,
    // and only a lift the check-in holds for this week with a bar to hold it to.
    const applies = ctx.phase !== 'deload' && ctx.phase !== 'baseline' && !plan.deload
    const byName = new Map(ctx.lifts.map(l => [l.name, l]))
    plan = holdStoredPrescription(plan, ctx.weekStart, (ex): HoldRowCtx | undefined => {
      const preference = ctx.current.get(ex.name)
      const lift = byName.get(ex.name)
      if (!applies || !lift || preference?.checkinHold?.weekStart !== ctx.weekStart || preference.checkinHold.barKg == null) return undefined
      return { preference, basisKg: ctx.basisKg(ex.name), equipment: lift.equipment, bodyweight: lift.bodyweight }
    })
  }
  return plan
}
