/**
 * #3890 step 2: the weekly check-in's engine. Reads the state the Preview card and sheet need, saves the
 * answers, dismisses, resolves an offer and undoes. The routes under app/api/weekly-checkin/ are thin
 * wrappers: auth, rate limit, Zod, then one call here.
 *
 * **The model decides nothing and is not called.** The summary is written by code from the session read
 * (`packages/shared/src/weekly-checkin/summary.ts`); every answer maps to an effect by one rule
 * (`effectForAnswer`); every write is named here from values code computed. No request body reaches
 * `.set()` or an INSERT.
 *
 * **One writer per kind of change.** A lowered or stepped-up lift is the Coach's own lift-preference
 * writer (`applyCoachPatch`, domain `lift_preference`, `nextLoadStep`), stamped `source = 'checkin'`,
 * with its `coach_changes` row and its undo. A logged injury is the Coach's `injury` domain; a swap is
 * its `session_exercise` domain; a rest day is `claimRestDay` / `moveOwnedRestDay`, conditional writes to the same rows as Home's tap.
 * This module never writes `exercise_preferences`, `injuries`, `session_exercises` or `coach_changes`
 * itself.
 *
 * **Ownership.** The user is the route's session user. Every client id (a lift slot, a check-in, a lift
 * row, an alternative) is looked up scoped to that user before anything reads by it; a foreign or
 * unknown id is `not_found` with nothing written. `pain_injury_id`, `swap_change_id` and
 * `applied_change_id` are only ever set from a result the Coach writer returned for this user, and the
 * injury id is checked to be this user's row before it is stored (the foreign keys cannot say that).
 *
 * **Redo.** Saving again updates the same row. The first save's automatic effects are taken back before
 * the new answers apply, so two saves never stack two lowerings: a lowering the new answer still calls
 * for is kept as it is (no second write); one it no longer calls for is undone. A lowering or accepted
 * step up that can no longer be undone (a workout started since, or the one-off was used) is kept and
 * reported, never doubled. An accepted injury or swap is never taken back by a redo: changing that
 * answer is refused until the person undoes it (`undo_first`). After an accepted swap the swapped slot
 * is compared by the slot (the swap's `coach_changes` target), not by the lift now in it.
 *
 * **An undo is remembered.** Undo steps back one level: a lowering is taken off and Heavy's own hold
 * stays; undoing the hold clears the lift; an undone step up is an open offer again. A save with
 * the SAME answer does not re-apply what the person undid (`notApplied` reason `undone`); changing the
 * answer away and back is the explicit way to ask for it again.
 *
 * **The missed rep** that turns Heavy into a lowering is `unexcusedMissAtPlan` on the lift's last session
 * of the week (decision 9 as the Orchestrator set it, 22 Nov), computed once in `weekSummary` for both
 * GET and the save.
 *
 * **Days off** withdraw only what the check-in wrote: `days_off_written` records the dates that were not
 * already a live rest day when it applied them, and each is written with the save's `saved_at` as its
 * `updated_at`. A recorded date whose row has moved on from that stamp was changed by hand and is the
 * person's: never withdrawn, dropped from the record.
 *
 * **A shorter session** is only the saved `shorter_session_min`: a save and an undo touch no stored plan.
 * A plan generated for the applies-to week reads the budget (`generate-prescription`), and a stored plan
 * served on a date in that week is re-fitted to it where it is read (`fitStoredPlanToCheckinBudget`, the
 * same no-model duration re-fit a picked preset length uses).
 *
 * `pain_where` is user text: stored, bounded to 200 characters by Zod and the CHECK, returned to its
 * owner, and never put in a prompt or into the injury's notes here.
 */
import { and, desc, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import * as s from '@/lib/data/postgres/schema'
import type { getDb } from '@/lib/data/postgres/client'
import type { WorkoutRepository } from '@/lib/data/repository'
import {
  checkinOwnedRestDays, completedWorkoutDays, getCheckinById, getCheckinByWeek, listCheckinLifts, listProgramLifts,
  claimRestDay, moveOwnedRestDay,
  type CheckinLiftRow, type CheckinRow, type ProgramLift,
} from '@/lib/data/postgres/slices/weekly-checkin'
import { applyCoachPatch, undoCoachChange } from '@/lib/coach/apply'
import { lockLiftWrites } from '@/lib/coach/lock-wait'
import { isBoundedLockTimeout, isDeadlock } from '@/lib/api/route-errors'
import { reportServerError } from '@/lib/observability'
import type { CoachPatch } from '@/lib/coach/patch'
import { dateStrMidnightInTz, daysBetweenDateStrs, shiftDateStr } from '@trainingai/shared/date-utils'
import { checkinDue, checkinWeekStart, localClock, plannedWeekOf, type CheckinDueWhy } from '@trainingai/shared/weekly-checkin/due'
import {
  CHECKIN_HOLD_LIVE, daysOffDates, effectForAnswer, type CheckinAnswer, type CheckinEffect,
} from '@trainingai/shared/weekly-checkin/effects'
import { summarizeWeek, type WeekLiftLog } from '@trainingai/shared/weekly-checkin/summary'
import type {
  CheckinOffer, CheckinState, CheckinStateLift, CheckinView, SaveOutcome, SwapAlternative,
} from '@trainingai/shared/weekly-checkin/responses'
import { weightStepFor } from '@trainingai/shared/workout/load-rounding'
import { goalRange } from '@trainingai/shared/ai-periodization/goal-ranges'
import { checkinHoldBar, preferredRepBand } from '@trainingai/shared/ai-periodization/lift-preference'
import { loadLiftPreferences } from '@trainingai/shared/ai-periodization/lift-preference-read'
import { injurySafeAlternatives } from '@trainingai/shared/workout/injury-substitution'
import { listExercisePreferences } from '@/lib/data/postgres/slices/exercise-preferences'

type Db = ReturnType<typeof getDb>

/** How many library alternatives a swap offer lists (the Coach's tool lists 8). */
export const SWAP_ALTERNATIVES_LIMIT = 8

export class CheckinRefusal extends Error {
  constructor(readonly status: 400 | 404 | 409, readonly code: string, message: string) { super(message) }
}
const notFound = () => new CheckinRefusal(404, 'not_found', 'Not found')
/** The check-in's existing "try again" refusal (409), for a save that timed out waiting for a lock (#4080). */
const CHECKIN_BUSY = () => new CheckinRefusal(409, 'stale', 'Another change is still saving; nothing was saved. Try again in a moment.')

/**
 * #4082: one transaction for a check-in write that can touch a lift's preference or a stored plan (a save, an
 * offer, an undo). It takes the person's lift-write lock before anything else, so the lifts it applies one
 * after another cannot be met in a cycle by a Coach apply or undo on a sibling lift: that writer waits for
 * the lock, holding nothing, and goes on after the commit.
 *
 * Backstop: a deadlock (40P01) or a lock wait past the bound (55P03) anywhere in the transaction is answered
 * with the existing "busy, try again" refusal, reported once, and nothing was saved, because one transaction
 * wraps every write. (A `busy` an apply inside it returned is already reported by `applyCoachPatch`, and
 * reaches here as the refusal, not as a database error.)
 */
async function liftTransaction(ctx: EngineCtx, run: (tx: Db) => Promise<void>): Promise<void> {
  try {
    await ctx.db.transaction(async txRaw => {
      const tx = txRaw as unknown as Db
      await lockLiftWrites(tx, ctx.userId)
      await run(tx)
    })
  } catch (err) {
    if (isDeadlock(err) || isBoundedLockTimeout(err)) {
      reportServerError(err, { userId: ctx.userId, url: '/api/weekly-checkin' })
      throw CHECKIN_BUSY()
    }
    throw err
  }
}

export interface EngineCtx {
  db: Db
  repo: WorkoutRepository
  userId: string
  tz: string
  now?: Date
}

// ── Lift identity ────────────────────────────────────────────────────────────────────────────

interface LiftId { exerciseId: string | null; exerciseName: string }
/** The migration's rule: ids match when both carry one; otherwise the names must match and neither
 *  id may name a different lift. */
export function sameLift(a: LiftId, b: LiftId): boolean {
  if (a.exerciseId && b.exerciseId) return a.exerciseId === b.exerciseId
  return a.exerciseName === b.exerciseName
}
const changeMarker = (checkinId: string, what: string) => `weekly-checkin:${checkinId}:${what}`

/** Main lifts, one per lift (the first slot of a lift that is in several sessions). */
function uniqueLifts(slots: ProgramLift[]): ProgramLift[] {
  const out: ProgramLift[] = []
  for (const slot of slots) if (!out.some(l => sameLift(l, slot))) out.push(slot)
  return out
}

// ── The state ─────────────────────────────────────────────────────────────────────────────────

interface Review {
  weekStart: string
  due: boolean
  why: CheckinDueWhy | null
  row: CheckinRow | null
}

const resolved = (row: CheckinRow | null) => row != null && (row.status === 'saved' || row.status === 'dismissed')

/** Which week is under review now, and whether its card is due. Reads only. */
async function reviewWeek(ctx: EngineCtx, program: NonNullable<Awaited<ReturnType<WorkoutRepository['getActiveProgram']>>>): Promise<Review | null> {
  const now = ctx.now ?? new Date()
  const thisWeek = checkinWeekStart(now, ctx.tz)
  const lastWeek = shiftDateStr(thisWeek, -7)
  const [thisRow, lastRow, doneDays] = await Promise.all([
    getCheckinByWeek(ctx.db, ctx.userId, thisWeek),
    getCheckinByWeek(ctx.db, ctx.userId, lastWeek),
    // Up to now: a workout row dated later (a clock-skewed device) has not happened yet.
    completedWorkoutDays(ctx.db, ctx.userId, program.id, dateStrMidnightInTz(thisWeek, ctx.tz), new Date(Math.min(now.getTime(), dateStrMidnightInTz(shiftDateStr(thisWeek, 7), ctx.tz).getTime()) + 1), ctx.tz),
  ])
  const planned = plannedWeekOf(program)
  const due = checkinDue({
    now, tz: ctx.tz,
    thisWeek: { plannedSessions: planned.count, plannedWeekdays: planned.weekdays, doneDays },
    thisWeekResolved: resolved(thisRow),
    lastWeekResolved: resolved(lastRow),
  })
  if (due.weekStart) return { weekStart: due.weekStart, due: true, why: due.why, row: due.weekStart === thisWeek ? thisRow : lastRow }
  // Not due: still show an answered card for its undo, this week's, or last week's on the Monday after.
  if (thisRow) return { weekStart: thisWeek, due: false, why: null, row: thisRow }
  const { today } = localClock(now, ctx.tz)
  if (lastRow && today === thisWeek) return { weekStart: lastWeek, due: false, why: null, row: lastRow }
  return null
}

/** The week's summary and its main lifts, from the logs through the session read. Reads only. */
async function weekSummary(ctx: EngineCtx, program: NonNullable<Awaited<ReturnType<WorkoutRepository['getActiveProgram']>>>, weekStart: string) {
  const from = dateStrMidnightInTz(weekStart, ctx.tz)
  const to = dateStrMidnightInTz(shiftDateStr(weekStart, 7), ctx.tz)
  const slots = await listProgramLifts(ctx.db, ctx.userId, { primaryOnly: true })
  const lifts = uniqueLifts(slots)
  const names = lifts.map(l => l.exerciseName)
  const [doneDays, logs, equipment, prefs] = await Promise.all([
    completedWorkoutDays(ctx.db, ctx.userId, program.id, from, to, ctx.tz),
    names.length > 0 ? ctx.repo.getSessionReadLogs(ctx.userId, from, to) : Promise.resolve([]),
    names.length > 0 ? ctx.repo.getExerciseEquipment(names) : Promise.resolve({} as Record<string, string[]>),
    loadLiftPreferences(ctx.repo, ctx.userId, names),
  ])
  const band = goalRange(program.trainingGoal, 'primary')
  const perLift = lifts.map(lift => ({
    exerciseName: lift.exerciseName,
    exerciseId: lift.exerciseId,
    weightStepKg: weightStepFor(equipment?.[lift.exerciseName]),
    repCeiling: preferredRepBand(prefs.get(lift.exerciseName), band).repMax ?? null,
    // Every log of the lift this week in this program, read or not: the summary says which were not
    // compared and why, and the missed rep is the LAST one's (decision 9 as the Orchestrator set it).
    logs: (logs ?? [])
      .filter(log => log.exerciseName === lift.exerciseName && log.loggedAt >= program.createdAt)
      .sort((a, b) => a.loggedAt.getTime() - b.loggedAt.getTime())
      .map((log): WeekLiftLog => ({ day: localClock(log.loggedAt, ctx.tz).today, log })),
  }))
  const summary = summarizeWeek({ sessionsDone: doneDays.length, sessionsPlanned: plannedWeekOf(program).count, lifts: perLift })
  // The same value the save acts on: a save recomputes this list and reads `missedRep` from it.
  const stateLifts: CheckinStateLift[] = lifts.map((l, i) => ({
    sessionExerciseId: l.sessionExerciseId, exerciseName: l.exerciseName, exerciseId: l.exerciseId,
    missedRep: summary.lifts[i].missedRep, lastSession: summary.lifts[i].lastSession,
  }))
  return { summary, lifts: stateLifts, slots }
}

async function libraryMuscles(ctx: EngineCtx, lift: LiftId, fallback: string[]) {
  const library = await ctx.repo.listExerciseLibrary()
  const entry = library.find(e => (lift.exerciseId ? e.id === lift.exerciseId : false)) ?? library.find(e => e.name === lift.exerciseName)
  const main = entry ? entry.muscles.filter(m => m.role === 'main').map(m => m.muscle) : []
  return { library, entry, mainMuscles: main.length > 0 ? main : fallback }
}

/** The library alternatives for the same muscles, by the Coach's swap matcher (injury-aware). */
async function swapAlternatives(ctx: EngineCtx, lift: LiftId): Promise<SwapAlternative[]> {
  const slot = (await listProgramLifts(ctx.db, ctx.userId)).find(l => sameLift(l, lift))
  const [{ library, mainMuscles }, injuries] = await Promise.all([
    libraryMuscles(ctx, lift, slot?.muscleGroups ?? []),
    ctx.repo.listInjuries(ctx.userId),
  ])
  return injurySafeAlternatives(
    { name: lift.exerciseName, mainMuscles },
    injuries.filter(i => !i.resolvedDate).map(i => i.muscleName),
    library,
    SWAP_ALTERNATIVES_LIMIT,
  ).map(e => ({ exerciseId: e.id, name: e.name, equipment: e.equipment, mainMuscles: e.muscles.filter(m => m.role === 'main').map(m => m.muscle) }))
}

async function painMuscles(ctx: EngineCtx, lift: LiftId): Promise<string[]> {
  const slot = (await listProgramLifts(ctx.db, ctx.userId)).find(l => sameLift(l, lift))
  const { mainMuscles } = await libraryMuscles(ctx, lift, slot?.muscleGroups ?? [])
  return [...new Set(mainMuscles)]
}

/**
 * #3890: of a saved check-in's held and lowered lifts, those the plan's hold can actually cap in the
 * applies-to week: the one per-lift reader's answer for that week (`loadLiftPreferences`, the read the
 * plan uses) gives the lift a last bar, and the hold's own test (`checkinHoldBar`) takes it as a loaded
 * lift. A lift never logged, whose last log was a deload, or that is bodyweight is not capped. Read only
 * here, for the check-in's own view, and only when some lift is held or lowered.
 */
async function liftsTheHoldCaps(
  ctx: EngineCtx, appliesWeekStart: string, lifts: readonly { exerciseName: string; effect: CheckinEffect }[],
): Promise<Set<string>> {
  const names = [...new Set(lifts.filter(l => l.effect === 'held' || l.effect === 'lowered_one_step').map(l => l.exerciseName))]
  const out = new Set<string>()
  if (names.length === 0) return out
  const [prefs, types] = await Promise.all([
    loadLiftPreferences(ctx.repo, ctx.userId, names, { checkinWeekStart: appliesWeekStart }),
    ctx.repo.getExerciseTypes(names).catch(() => null),
  ])
  for (const name of names) {
    // A failed type read claims nothing: the card says "noted" rather than "held" it cannot vouch for.
    if (types && checkinHoldBar(prefs.get(name), { bodyweight: types[name] === 'bodyweight' }) != null) out.add(name)
  }
  return out
}

async function viewOf(ctx: EngineCtx, row: CheckinRow): Promise<CheckinView> {
  const lifts = await listCheckinLifts(ctx.db, ctx.userId, row.id)
  const offers: CheckinOffer[] = []
  if (row.status === 'saved') {
    for (const l of lifts) {
      if (l.effect === 'offered_step_up' && l.offerStatus) {
        offers.push({ kind: 'step_up', liftId: l.id, exerciseName: l.exerciseName, status: l.offerStatus, changeId: l.appliedChangeId })
      }
    }
    if (row.painExerciseName && row.painOfferStatus) {
      const lift = { exerciseId: row.painExerciseId, exerciseName: row.painExerciseName }
      offers.push({
        kind: 'pain', exerciseName: row.painExerciseName, where: row.painWhere, status: row.painOfferStatus, injuryId: row.painInjuryId,
        muscles: row.painOfferStatus === 'open' ? await painMuscles(ctx, lift) : [],
      })
    }
    if (row.swapExerciseName && row.swapOfferStatus) {
      const lift = { exerciseId: row.swapExerciseId, exerciseName: row.swapExerciseName }
      offers.push({
        kind: 'swap', exerciseName: row.swapExerciseName, status: row.swapOfferStatus, changeId: row.swapChangeId,
        alternatives: row.swapOfferStatus === 'open' ? await swapAlternatives(ctx, lift) : [],
      })
    }
  }
  const capped = row.status === 'saved' ? await liftsTheHoldCaps(ctx, row.appliesWeekStart, lifts) : new Set<string>()
  return {
    id: row.id,
    weekStart: row.weekStart,
    appliesWeekStart: row.appliesWeekStart,
    status: row.status,
    savedAt: row.savedAt?.toISOString() ?? null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    // Annotated, so a field returned here that the shared shape lacks is a compile error.
    lifts: lifts.map((l): CheckinView['lifts'][number] => ({
      liftId: l.id, exerciseName: l.exerciseName, exerciseId: l.exerciseId, answer: l.answer, missedRep: l.missedRep,
      effect: l.effect, offerStatus: l.offerStatus, appliedChangeId: l.appliedChangeId,
      holdLive: l.effect === 'held' ? CHECKIN_HOLD_LIVE && capped.has(l.exerciseName) : null,
      capped: l.effect === 'held' || l.effect === 'lowered_one_step' ? CHECKIN_HOLD_LIVE && capped.has(l.exerciseName) : null,
    })),
    daysOff: row.daysOffWeekdays ?? null,
    daysOffWritten: row.daysOffWritten ?? null,
    shorterSessionMin: row.shorterSessionMin ?? null,
    pain: row.painRaised === false ? false
      : row.painRaised === true && row.painExerciseName ? { exerciseName: row.painExerciseName, exerciseId: row.painExerciseId, where: row.painWhere }
      : null,
    swap: row.swapExerciseName ? { exerciseName: row.swapExerciseName, exerciseId: row.swapExerciseId } : null,
    offers,
  }
}

/**
 * The card's state. When the card is due and no row exists yet, the `offered` row is created here: the
 * migration's `offered_at` is "when the card was first offered (the row is created then)". Idempotent.
 */
export async function readCheckinState(ctx: EngineCtx): Promise<CheckinState> {
  const empty: CheckinState = { due: false, why: null, weekStart: null, summary: null, lifts: [], checkin: null }
  const program = await ctx.repo.getActiveProgram(ctx.userId)
  if (!program) return empty
  const review = await reviewWeek(ctx, program)
  if (!review) return empty
  let row = review.row
  if (!row && review.due) {
    await ctx.db.insert(s.weeklyCheckins)
      .values({ userId: ctx.userId, weekStart: review.weekStart, appliesWeekStart: shiftDateStr(review.weekStart, 7) })
      .onConflictDoNothing()
    row = await getCheckinByWeek(ctx.db, ctx.userId, review.weekStart)
  }
  const { summary, lifts } = await weekSummary(ctx, program, review.weekStart)
  return {
    due: review.due && row?.status === 'offered',
    why: review.due && row?.status === 'offered' ? review.why : null,
    weekStart: review.weekStart,
    summary,
    lifts,
    checkin: row ? await viewOf(ctx, row) : null,
  }
}

// ── Coach writer calls ────────────────────────────────────────────────────────────────────────

/** A workout started after the change: it has shaped a session, so it is kept (the Coach undo route's window). */
async function trainedSince(db: Db, userId: string, changeId: string): Promise<boolean> {
  const [rec] = await db.select({ appliedAt: s.coachChanges.appliedAt }).from(s.coachChanges)
    .where(and(eq(s.coachChanges.id, changeId), eq(s.coachChanges.userId, userId))).limit(1)
  if (!rec) return false
  const [w] = await db.select({ id: s.workoutSessions.id }).from(s.workoutSessions)
    .where(and(eq(s.workoutSessions.userId, userId), gt(s.workoutSessions.startedAt, rec.appliedAt))).limit(1)
  return w != null
}

/** Whether this user's change is still in effect (exists and not undone). */
async function changeLive(db: Db, userId: string, changeId: string | null): Promise<boolean> {
  if (!changeId) return false
  const [rec] = await db.select({ id: s.coachChanges.id }).from(s.coachChanges)
    .where(and(eq(s.coachChanges.id, changeId), eq(s.coachChanges.userId, userId), isNull(s.coachChanges.undoneAt))).limit(1)
  return rec != null
}

/** Undo one of this user's changes, inside the caller's transaction. False when it cannot be undone. */
async function tryUndo(db: Db, userId: string, changeId: string): Promise<{ ok: true } | { ok: false; detail: string }> {
  if (!(await changeLive(db, userId, changeId))) return { ok: true } // already undone elsewhere (the Coach's history)
  if (await trainedSince(db, userId, changeId)) return { ok: false, detail: "You've trained since this change, so it stays." }
  const res = await undoCoachChange(db, userId, changeId)
  if (res.ok) return { ok: true }
  return { ok: false, detail: res.reason === 'invalid' ? res.detail : 'This change is no longer the one in effect.' }
}

/**
 * One plate lighter or heavier next time for a lift, through the Coach's lift-preference writer. The
 * `from` is the stored one-off as it is now, so the writer's own stale check runs. Returns the change id,
 * `already` when the lift already carries that step (nothing to write), or a refusal.
 */
async function applyLoadStep(
  db: Db, ctx: EngineCtx, lift: LiftId, slotId: string, step: 'lighter' | 'heavier', marker: string, today: string,
): Promise<{ ok: true; changeId: string | null } | { ok: false; detail: string }> {
  const current = (await listExercisePreferences(db, ctx.userId, [lift.exerciseName])).get(lift.exerciseName)?.nextLoadStep ?? null
  if (current === step) return { ok: true, changeId: null }
  const patch = coachPatch('lift_preference', slotId, [
    { id: marker, field: 'nextLoadStep', from: current === 'lighter' || current === 'heavier' ? current : null, to: step },
  ])
  const res = await applyCoachPatch(db, ctx.userId, patch, [marker], today, ctx.tz, { source: 'checkin' })
  if (res.ok) return { ok: true, changeId: res.changeId }
  // #4080: timed out waiting for the lift's lock. Unlike a refusal, this is not an answer about the lift,
  // so the save does not carry on without it ("held", recorded as not applied): it fails whole and the
  // caller's transaction rolls back every write of it. Reported by `applyCoachPatch`.
  if (res.reason === 'busy') throw CHECKIN_BUSY()
  return { ok: false, detail: res.reason === 'invalid' ? res.detail : res.reason === 'stale' ? 'The lift changed while saving.' : 'Not found' }
}

/** A Coach patch the check-in hands to the Coach's own writer. Built here rather than as object literals
 *  so `domain` reads as the Coach patch domain it is, not a sync-mutation domain (`mutation-schema.test.ts`
 *  scans for those literals). */
function coachPatch(domain: CoachPatch['domain'], targetId: string | null, changes: CoachPatch['changes']): CoachPatch {
  return { domain, targetId, changes }
}

/** The first live slot of a lift in the active program, by identity. */
async function slotFor(db: Db, userId: string, lift: LiftId): Promise<ProgramLift | null> {
  return (await listProgramLifts(db, userId)).find(l => sameLift(l, lift)) ?? null
}

// ── Save ──────────────────────────────────────────────────────────────────────────────────────

export interface SaveInput {
  weekStart: string
  lifts: { sessionExerciseId: string; answer: CheckinAnswer }[]
  /** null: not answered; false: nothing hurt; a lift and where. */
  pain: null | false | { sessionExerciseId: string; where: string | null }
  swap: null | { sessionExerciseId: string }
  daysOff: number[] | null
  shorterSessionMin: number | null
}

export async function saveCheckin(ctx: EngineCtx, input: SaveInput): Promise<SaveOutcome> {
  const program = await ctx.repo.getActiveProgram(ctx.userId)
  if (!program) throw new CheckinRefusal(409, 'not_open', 'There is no week to review')
  const review = await reviewWeek(ctx, program)
  if (!review || review.weekStart !== input.weekStart || (!review.due && !review.row)) {
    throw new CheckinRefusal(409, 'not_open', 'That week is not open for a check-in')
  }

  // Every client id resolved against this user's active program before anything is written. `missedRep`
  // is read from the same list GET returns (`weekSummary`), so the save acts on the value the card showed.
  const { lifts: mainLifts, slots: mainSlots } = await weekSummary(ctx, program, review.weekStart)
  const answered = input.lifts.map(a => {
    const slot = mainSlots.find(l => l.sessionExerciseId === a.sessionExerciseId)
    if (!slot) throw notFound()
    const main = mainLifts.find(l => sameLift(l, slot))!
    return { lift: main, slot, answer: a.answer }
  })
  for (let i = 0; i < answered.length; i++) {
    if (answered.slice(i + 1).some(o => sameLift(o.lift, answered[i].lift))) throw new CheckinRefusal(400, 'duplicate_lift', 'A lift is answered twice')
  }
  const resolveSlot = async (id: string) => {
    const [slot] = await listProgramLifts(ctx.db, ctx.userId, { sessionExerciseId: id })
    if (!slot) throw notFound()
    return slot
  }
  const painSlot = input.pain ? await resolveSlot(input.pain.sessionExerciseId) : null
  const swapSlot = input.swap ? await resolveSlot(input.swap.sessionExerciseId) : null

  const now = ctx.now ?? new Date()
  const { today } = localClock(now, ctx.tz)
  const kept: SaveOutcome['kept'] = []
  const notApplied: SaveOutcome['notApplied'] = []

  await liftTransaction(ctx, async tx => {
    await tx.insert(s.weeklyCheckins)
      .values({ userId: ctx.userId, weekStart: input.weekStart, appliesWeekStart: shiftDateStr(input.weekStart, 7) })
      .onConflictDoNothing()
    const row = await getCheckinByWeek(tx, ctx.userId, input.weekStart, true)
    if (!row) throw new CheckinRefusal(409, 'not_open', 'That week is not open for a check-in')
    const wasSaved = row.status === 'saved'
    const stamp = new Date()

    // An accepted swap changed one slot: that slot now holds the new lift. A redo that names the same slot
    // is the same pick, so the slot (the change's target, this user's) is compared, not the lift in it.
    const rowSwapLift: LiftId | null = row.swapExerciseName ? { exerciseId: row.swapExerciseId, exerciseName: row.swapExerciseName } : null
    const swappedSlotId = row.swapOfferStatus === 'accepted' && row.swapChangeId
      ? await changeTarget(tx, ctx.userId, row.swapChangeId) : null
    const isSwappedSlot = (slotId: string) => swappedSlotId != null && slotId === swappedSlotId
    const rowPainLift: LiftId | null = row.painExerciseName ? { exerciseId: row.painExerciseId, exerciseName: row.painExerciseName } : null
    const samePain = painSlot != null && rowPainLift != null && (sameLift(painSlot, rowPainLift)
      || (isSwappedSlot(painSlot.sessionExerciseId) && rowSwapLift != null && sameLift(rowSwapLift, rowPainLift)))
    const sameSwap = swapSlot != null && rowSwapLift != null && (sameLift(swapSlot, rowSwapLift) || isSwappedSlot(swapSlot.sessionExerciseId))

    // An accepted injury or swap stays until it is undone: a redo may not silently replace it.
    if (row.painOfferStatus === 'accepted' && rowPainLift && !samePain) {
      throw new CheckinRefusal(409, 'undo_first', 'Undo the logged injury before changing that answer')
    }
    if (row.swapOfferStatus === 'accepted' && rowSwapLift && !sameSwap) {
      throw new CheckinRefusal(409, 'undo_first', 'Undo the swap before changing that answer')
    }

    // ── Lift rows ──
    const previous = await listCheckinLifts(tx, ctx.userId, row.id, true)
    const touched = new Set<string>()
    for (const a of answered) {
      // The swapped slot answers for the lift that was in it, when that lift is no longer a main lift of
      // the program anywhere else: its row, its stored missed rep and its applied change carry on.
      const viaSwap = isSwappedSlot(a.slot.sessionExerciseId) && rowSwapLift != null && !mainLifts.some(l => sameLift(l, rowSwapLift))
      const identity: LiftId = viaSwap ? rowSwapLift! : a.lift
      const prev = previous.find(p => sameLift(p, identity)) ?? null
      if (prev) touched.add(prev.id)
      const missedRep = viaSwap ? (prev?.missedRep ?? null) : a.lift.missedRep
      let effect: CheckinEffect = effectForAnswer(a.answer, missedRep)
      let offerStatus: 'open' | 'accepted' | 'declined' | null = effect === 'offered_step_up' ? 'open' : null
      let appliedChangeId: string | null = null
      const sameAnswer = prev != null && !prev.deletedAt && prev.answer === a.answer
      const marker = changeMarker(row.id, `lift:${a.lift.sessionExerciseId}`)

      const prevLive = prev && !prev.deletedAt && (await changeLive(tx, ctx.userId, prev.appliedChangeId))
      if (prev && prevLive) {
        const stillWanted = (prev.effect === 'lowered_one_step' && effect === 'lowered_one_step')
          || (prev.effect === 'offered_step_up' && prev.offerStatus === 'accepted' && effect === 'offered_step_up')
        if (stillWanted) {
          appliedChangeId = prev.appliedChangeId
          offerStatus = prev.effect === 'offered_step_up' ? 'accepted' : null
        } else {
          const undone = await tryUndo(tx, ctx.userId, prev.appliedChangeId!)
          if (!undone.ok) {
            // It stays, and the row says so: the app did this, and a second step is not added on top.
            kept.push({ exerciseName: identity.exerciseName, detail: undone.detail })
            effect = prev.effect
            offerStatus = prev.offerStatus
            appliedChangeId = prev.appliedChangeId
          }
        }
      } else if (sameAnswer && prev.effect === 'offered_step_up' && prev.offerStatus === 'declined' && effect === 'offered_step_up') {
        offerStatus = 'declined'
      } else if (sameAnswer && prev.answer === 'heavy' && prev.effect === 'none') {
        // The person undid this answer's hold: the same answer again does not bring it back.
        effect = 'none'
      } else if (sameAnswer && effect === 'lowered_one_step' && (prev.effect === 'held' || prev.effect === 'lowered_one_step')
        && prev.missedRep === true && (await undoneLoadSteps(tx, ctx.userId, row.id, identity, 'lighter')) > 0) {
        // The person undid this check-in's lowering, here (which leaves the lift held, `undoCheckinEffect`)
        // or from the Coach's history (which leaves the row pointing at an undone change). Saving the same
        // answer again on the same logs must not lower it again behind their back. A redo's own undo
        // happens only when the answer or the missed rep changed, so it never matches here.
        effect = 'held'
        notApplied.push({ exerciseName: identity.exerciseName, reason: 'undone', detail: 'You undid this lowering, so saving again does not redo it. Change the answer and back to ask for it again.' })
      }

      if (effect === 'lowered_one_step' && appliedChangeId == null) {
        if (viaSwap) {
          notApplied.push({ exerciseName: identity.exerciseName, reason: 'swapped', detail: 'That slot now holds the swapped-in lift, so nothing was lowered.' })
          effect = 'held'
        } else {
          const step = await applyLoadStep(tx, ctx, a.lift, a.slot.sessionExerciseId, 'lighter', marker, today)
          if (step.ok) {
            appliedChangeId = step.changeId
          } else {
            notApplied.push({ exerciseName: identity.exerciseName, reason: 'refused', detail: step.detail })
            effect = 'held'
          }
        }
      }
      const id = await upsertLiftRow(tx, ctx.userId, row.id, prev?.id ?? null, identity, a.answer, missedRep, effect, offerStatus, appliedChangeId)
      touched.add(id)
    }
    // Lifts the redo no longer answers: their change taken back, then the row tombstoned.
    for (const prev of previous) {
      if (touched.has(prev.id) || prev.deletedAt) continue
      if (await changeLive(tx, ctx.userId, prev.appliedChangeId)) {
        const undone = await tryUndo(tx, ctx.userId, prev.appliedChangeId!)
        if (!undone.ok) { kept.push({ exerciseName: prev.exerciseName, detail: undone.detail }); continue }
      }
      const res = await tx.update(s.weeklyCheckinExercises)
        .set({ deletedAt: new Date(), updatedAt: new Date(), appliedChangeId: null, effect: 'none', offerStatus: null })
        .where(and(eq(s.weeklyCheckinExercises.id, prev.id), eq(s.weeklyCheckinExercises.userId, ctx.userId)))
        .returning({ id: s.weeklyCheckinExercises.id })
      if (res.length !== 1) throw new Error('weekly check-in lift tombstone wrote no row')
    }

    // ── Days off (A1). Only the dates the check-in itself made rest days are ever withdrawn: a date that
    // was already a live rest day when the answer applied is the person's, and is neither written nor
    // recorded. A recorded date the person changed by hand since (un-rested, or un-rested and re-rested:
    // its `updated_at` is no longer the check-in's stamp) is theirs now, and is dropped from the record
    // and left alone. Today and earlier are never touched (`daysOffDates`). ──
    const applies = row.appliesWeekStart
    const recorded = wasSaved ? (row.daysOffWritten ?? []) : []
    const owned = await checkinOwnedRestDays(tx, ctx.userId, recorded, row.savedAt)
    const after = new Set(daysOffDates(applies, input.daysOff ?? [], today))
    const written: string[] = []
    // Every write below is conditional and atomic, and only what it actually wrote is recorded: a tap the
    // person makes at the same moment as this save is theirs, whichever side of these statements it lands.
    for (const d of recorded) {
      if (!owned.has(d)) continue
      if (daysBetweenDateStrs(today, d) <= 0) { written.push(d); continue }
      // Still asked for: re-stamped to this save, so it stays recognisably the check-in's.
      const moved = await moveOwnedRestDay(tx, ctx.userId, d, row.savedAt!, after.has(d), stamp)
      if (moved && after.has(d)) written.push(d)
    }
    for (const d of [...after].filter(d => !recorded.includes(d))) {
      if (await claimRestDay(tx, ctx.userId, d, stamp)) written.push(d)
    }

    // ── Pain and swap: offers, never applied here. The same pick keeps its row's lift and status. ──
    const painLift = painSlot ? (samePain ? rowPainLift! : { exerciseName: painSlot.exerciseName, exerciseId: painSlot.exerciseId }) : null
    const painKeep = samePain && row.painOfferStatus != null && row.painOfferStatus !== 'open'
    const swapLift = swapSlot ? (sameSwap ? rowSwapLift! : { exerciseName: swapSlot.exerciseName, exerciseId: swapSlot.exerciseId }) : null
    const swapKeep = sameSwap && row.swapOfferStatus != null && row.swapOfferStatus !== 'open'

    const saved = await tx.update(s.weeklyCheckins)
      .set({
        status: 'saved',
        // The stamp the rest days above were written with: what makes them recognisably the check-in's.
        savedAt: stamp,
        dismissedAt: null,
        daysOffWeekdays: input.daysOff == null ? null : [...new Set(input.daysOff)].sort((x, y) => x - y),
        daysOffWritten: written.length > 0 ? [...written].sort() : null,
        shorterSessionMin: input.shorterSessionMin,
        painRaised: input.pain === null ? null : input.pain !== false,
        painExerciseName: painLift?.exerciseName ?? null,
        painExerciseId: painLift?.exerciseId ?? null,
        painWhere: input.pain ? input.pain.where : null,
        painOfferStatus: painLift ? (painKeep ? row.painOfferStatus : 'open') : null,
        painInjuryId: painKeep ? row.painInjuryId : null,
        swapExerciseName: swapLift?.exerciseName ?? null,
        swapExerciseId: swapLift?.exerciseId ?? null,
        swapOfferStatus: swapLift ? (swapKeep ? row.swapOfferStatus : 'open') : null,
        swapChangeId: swapKeep ? row.swapChangeId : null,
        updatedAt: new Date(),
      })
      .where(and(eq(s.weeklyCheckins.id, row.id), eq(s.weeklyCheckins.userId, ctx.userId)))
      .returning({ id: s.weeklyCheckins.id })
    if (saved.length !== 1) throw new Error('weekly check-in save wrote no row')
  })

  return { state: await readCheckinState(ctx), kept, notApplied }
}

/** Insert or update one lift row. Returns its id. Every column named; values from code. */
async function upsertLiftRow(
  tx: Db, userId: string, checkinId: string, rowId: string | null, lift: LiftId, answer: CheckinAnswer,
  missedRep: boolean | null, effect: CheckinEffect, offerStatus: 'open' | 'accepted' | 'declined' | null, appliedChangeId: string | null,
): Promise<string> {
  if (rowId) {
    const res = await tx.update(s.weeklyCheckinExercises)
      .set({
        exerciseName: lift.exerciseName, exerciseId: lift.exerciseId, answer, missedRep, effect, offerStatus, appliedChangeId,
        deletedAt: null, updatedAt: new Date(),
      })
      .where(and(eq(s.weeklyCheckinExercises.id, rowId), eq(s.weeklyCheckinExercises.userId, userId), eq(s.weeklyCheckinExercises.checkinId, checkinId)))
      .returning({ id: s.weeklyCheckinExercises.id })
    if (res.length !== 1) throw new Error('weekly check-in lift update wrote no row')
    return res[0].id
  }
  const res = await tx.insert(s.weeklyCheckinExercises)
    .values({ userId, checkinId, exerciseName: lift.exerciseName, exerciseId: lift.exerciseId, answer, missedRep, effect, offerStatus, appliedChangeId })
    .returning({ id: s.weeklyCheckinExercises.id })
  if (res.length !== 1) throw new Error('weekly check-in lift insert wrote no row')
  return res[0].id
}

// ── Dismiss ───────────────────────────────────────────────────────────────────────────────────

/** "Later": the card goes away for this week. It can still be saved after; a saved card cannot be dismissed. */
export async function dismissCheckin(ctx: EngineCtx, weekStart: string): Promise<CheckinState> {
  const program = await ctx.repo.getActiveProgram(ctx.userId)
  const review = program ? await reviewWeek(ctx, program) : null
  if (!review || review.weekStart !== weekStart || (!review.due && !review.row)) {
    throw new CheckinRefusal(409, 'not_open', 'That week is not open for a check-in')
  }
  await ctx.db.transaction(async txRaw => {
    const tx = txRaw as unknown as Db
    await tx.insert(s.weeklyCheckins)
      .values({ userId: ctx.userId, weekStart, appliesWeekStart: shiftDateStr(weekStart, 7) })
      .onConflictDoNothing()
    const row = await getCheckinByWeek(tx, ctx.userId, weekStart, true)
    if (!row) throw new CheckinRefusal(409, 'not_open', 'That week is not open for a check-in')
    if (row.status === 'saved') throw new CheckinRefusal(409, 'already_saved', 'This check-in is already saved')
    if (row.status === 'dismissed') return
    const res = await tx.update(s.weeklyCheckins)
      .set({ status: 'dismissed', dismissedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(s.weeklyCheckins.id, row.id), eq(s.weeklyCheckins.userId, ctx.userId), eq(s.weeklyCheckins.status, 'offered')))
      .returning({ id: s.weeklyCheckins.id })
    if (res.length !== 1) throw new CheckinRefusal(409, 'stale', 'The check-in changed; try again')
  })
  return readCheckinState(ctx)
}

// ── Offers ────────────────────────────────────────────────────────────────────────────────────

export type OfferInput =
  | { kind: 'step_up'; liftId: string }
  | { kind: 'pain'; muscleName?: string; severity?: 'mild' | 'moderate' | 'severe' }
  | { kind: 'swap'; toExerciseId?: string }

/** A saved check-in of this user's, locked. */
async function savedCheckin(tx: Db, userId: string, checkinId: string): Promise<CheckinRow> {
  const row = await getCheckinById(tx, userId, checkinId, true)
  if (!row) throw notFound()
  if (row.status !== 'saved') throw new CheckinRefusal(409, 'not_saved', 'Save the check-in first')
  return row
}

async function liftRowOf(tx: Db, userId: string, checkinId: string, liftId: string): Promise<CheckinLiftRow> {
  const [lift] = await tx.select().from(s.weeklyCheckinExercises)
    .where(and(
      eq(s.weeklyCheckinExercises.id, liftId), eq(s.weeklyCheckinExercises.userId, userId),
      eq(s.weeklyCheckinExercises.checkinId, checkinId), isNull(s.weeklyCheckinExercises.deletedAt),
    ))
    .limit(1)
    .for('update')
  if (!lift) throw notFound()
  return lift
}

export async function resolveOffer(
  ctx: EngineCtx, checkinId: string, offer: OfferInput, decision: 'accept' | 'decline',
): Promise<CheckinState> {
  const { today } = localClock(ctx.now ?? new Date(), ctx.tz)
  // Read through the pool before the transaction holds a connection.
  const pre = await getCheckinById(ctx.db, ctx.userId, checkinId)
  if (!pre) throw notFound()
  const painChoices = offer.kind === 'pain' && decision === 'accept' && pre.painExerciseName
    ? await painMuscles(ctx, { exerciseId: pre.painExerciseId, exerciseName: pre.painExerciseName }) : []
  const swapChoices = offer.kind === 'swap' && decision === 'accept' && pre.swapExerciseName
    ? await swapAlternatives(ctx, { exerciseId: pre.swapExerciseId, exerciseName: pre.swapExerciseName }) : []

  await liftTransaction(ctx, async tx => {
    const row = await savedCheckin(tx, ctx.userId, checkinId)

    if (offer.kind === 'step_up') {
      const lift = await liftRowOf(tx, ctx.userId, row.id, offer.liftId)
      if (lift.effect !== 'offered_step_up' || lift.offerStatus !== 'open') throw new CheckinRefusal(409, 'not_open', 'That offer is not open')
      let changeId: string | null = null
      if (decision === 'accept') {
        const slot = await slotFor(tx, ctx.userId, lift)
        if (!slot) throw new CheckinRefusal(409, 'lift_gone', 'That lift is no longer in your program')
        const step = await applyLoadStep(tx, ctx, lift, slot.sessionExerciseId, 'heavier', changeMarker(row.id, `lift:${slot.sessionExerciseId}`), today)
        if (!step.ok) throw new CheckinRefusal(409, 'refused', step.detail)
        changeId = step.changeId
      }
      const res = await tx.update(s.weeklyCheckinExercises)
        .set({ offerStatus: decision === 'accept' ? 'accepted' : 'declined', appliedChangeId: changeId, updatedAt: new Date() })
        .where(and(eq(s.weeklyCheckinExercises.id, lift.id), eq(s.weeklyCheckinExercises.userId, ctx.userId)))
        .returning({ id: s.weeklyCheckinExercises.id })
      if (res.length !== 1) throw new Error('weekly check-in offer wrote no row')
      return
    }

    if (offer.kind === 'pain') {
      if (!row.painExerciseName || row.painOfferStatus !== 'open') throw new CheckinRefusal(409, 'not_open', 'That offer is not open')
      let injuryId: string | null = null
      if (decision === 'accept') {
        const muscle = offer.muscleName ?? painChoices[0]
        if (!muscle || !painChoices.includes(muscle)) throw new CheckinRefusal(400, 'muscle', 'Pick one of the muscles that lift trains')
        const marker = changeMarker(row.id, 'pain')
        const patch = coachPatch('injury', null, [
          { id: marker, field: 'muscleName', from: null, to: muscle },
          ...(offer.severity ? [{ id: `${marker}:severity`, field: 'severity' as const, from: null, to: offer.severity }] : []),
        ])
        const res = await applyCoachPatch(tx, ctx.userId, patch, patch.changes.map(c => c.id), today, ctx.tz)
        if (!res.ok) throw res.reason === 'busy' ? CHECKIN_BUSY() : new CheckinRefusal(409, 'refused', res.reason === 'invalid' ? res.detail : 'Could not log the injury')
        // The injury the Coach writer logged or updated, checked to be this user's before it is stored.
        const [owned] = await tx.select({ id: s.injuries.id }).from(s.injuries)
          .innerJoin(s.coachChanges, eq(s.coachChanges.targetId, s.injuries.id))
          .where(and(eq(s.coachChanges.id, res.changeId), eq(s.coachChanges.userId, ctx.userId), eq(s.injuries.userId, ctx.userId)))
          .limit(1)
        if (!owned) throw new Error('weekly check-in: the logged injury is not the user\'s')
        injuryId = owned.id
      }
      const res = await tx.update(s.weeklyCheckins)
        .set({ painOfferStatus: decision === 'accept' ? 'accepted' : 'declined', painInjuryId: injuryId, updatedAt: new Date() })
        .where(and(eq(s.weeklyCheckins.id, row.id), eq(s.weeklyCheckins.userId, ctx.userId)))
        .returning({ id: s.weeklyCheckins.id })
      if (res.length !== 1) throw new Error('weekly check-in offer wrote no row')
      return
    }

    // swap
    if (!row.swapExerciseName || row.swapOfferStatus !== 'open') throw new CheckinRefusal(409, 'not_open', 'That offer is not open')
    let changeId: string | null = null
    if (decision === 'accept') {
      const alt = swapChoices.find(a => a.exerciseId === offer.toExerciseId)
      if (!alt) throw new CheckinRefusal(400, 'alternative', 'Pick one of the offered alternatives')
      const slot = await slotFor(tx, ctx.userId, { exerciseId: row.swapExerciseId, exerciseName: row.swapExerciseName })
      if (!slot) throw new CheckinRefusal(409, 'lift_gone', 'That lift is no longer in your program')
      const marker = changeMarker(row.id, 'swap')
      const patch = coachPatch('session_exercise', slot.sessionExerciseId, [
        { id: marker, field: 'exerciseName', from: slot.exerciseName, to: alt.name },
      ])
      const res = await applyCoachPatch(tx, ctx.userId, patch, [marker], today, ctx.tz)
      if (!res.ok) throw res.reason === 'busy' ? CHECKIN_BUSY() : new CheckinRefusal(409, 'refused', res.reason === 'invalid' ? res.detail : 'Could not swap the lift')
      changeId = res.changeId
    }
    const res = await tx.update(s.weeklyCheckins)
      .set({ swapOfferStatus: decision === 'accept' ? 'accepted' : 'declined', swapChangeId: changeId, updatedAt: new Date() })
      .where(and(eq(s.weeklyCheckins.id, row.id), eq(s.weeklyCheckins.userId, ctx.userId)))
      .returning({ id: s.weeklyCheckins.id })
    if (res.length !== 1) throw new Error('weekly check-in offer wrote no row')
  })
  return readCheckinState(ctx)
}

// ── Undo ──────────────────────────────────────────────────────────────────────────────────────

export type UndoTarget =
  | { kind: 'lift'; liftId: string }
  | { kind: 'pain' }
  | { kind: 'swap' }
  | { kind: 'days_off' }
  | { kind: 'shorter_session' }

/**
 * Undo one automatic effect or accepted offer, restoring what it changed. The Coach's own undo restores a
 * preference, an injury or a swap; a hold, the days off and the shorter session are the check-in's own.
 * An answer stays answered: an undone step up or pain or swap goes back to an open offer.
 */
export async function undoCheckinEffect(ctx: EngineCtx, checkinId: string, target: UndoTarget): Promise<CheckinState> {
  const { today } = localClock(ctx.now ?? new Date(), ctx.tz)
  await liftTransaction(ctx, async tx => {
    const row = await savedCheckin(tx, ctx.userId, checkinId)
    const undoChange = async (changeId: string | null) => {
      if (!changeId) return
      const res = await tryUndo(tx, ctx.userId, changeId)
      if (!res.ok) throw new CheckinRefusal(409, 'cannot_undo', res.detail)
    }
    const updateRow = async (set: Partial<typeof s.weeklyCheckins.$inferInsert>) => {
      const res = await tx.update(s.weeklyCheckins).set({ ...set, updatedAt: new Date() })
        .where(and(eq(s.weeklyCheckins.id, row.id), eq(s.weeklyCheckins.userId, ctx.userId)))
        .returning({ id: s.weeklyCheckins.id })
      if (res.length !== 1) throw new Error('weekly check-in undo wrote no row')
    }

    switch (target.kind) {
      case 'lift': {
        const lift = await liftRowOf(tx, ctx.userId, row.id, target.liftId)
        const acceptedStepUp = lift.effect === 'offered_step_up' && lift.offerStatus === 'accepted'
        if (lift.effect !== 'held' && lift.effect !== 'lowered_one_step' && !acceptedStepUp) {
          throw new CheckinRefusal(409, 'nothing_to_undo', 'Nothing to undo for that lift')
        }
        await undoChange(lift.appliedChangeId)
        // One step back per undo: a lowering is taken off and the Heavy answer's own hold stays,
        // so a later save with the same answer neither lowers again nor drops the hold the person kept;
        // undoing the hold clears the lift. An undone step up is an open offer again (a tap re-applies it).
        const res = await tx.update(s.weeklyCheckinExercises)
          .set(acceptedStepUp
            ? { offerStatus: 'open', appliedChangeId: null, updatedAt: new Date() }
            : lift.effect === 'lowered_one_step'
              ? { effect: 'held', offerStatus: null, appliedChangeId: null, updatedAt: new Date() }
              : { effect: 'none', offerStatus: null, appliedChangeId: null, updatedAt: new Date() })
          .where(and(eq(s.weeklyCheckinExercises.id, lift.id), eq(s.weeklyCheckinExercises.userId, ctx.userId)))
          .returning({ id: s.weeklyCheckinExercises.id })
        if (res.length !== 1) throw new Error('weekly check-in undo wrote no row')
        return
      }
      case 'pain': {
        if (row.painOfferStatus !== 'accepted') throw new CheckinRefusal(409, 'nothing_to_undo', 'Nothing to undo')
        await undoChange(await markedChange(tx, ctx.userId, changeMarker(row.id, 'pain')))
        await updateRow({ painOfferStatus: 'open', painInjuryId: null })
        return
      }
      case 'swap': {
        if (row.swapOfferStatus !== 'accepted') throw new CheckinRefusal(409, 'nothing_to_undo', 'Nothing to undo')
        await undoChange(row.swapChangeId ?? (await markedChange(tx, ctx.userId, changeMarker(row.id, 'swap'))))
        await updateRow({ swapOfferStatus: 'open', swapChangeId: null })
        return
      }
      case 'days_off': {
        if (!row.daysOffWeekdays || row.daysOffWeekdays.length === 0) throw new CheckinRefusal(409, 'nothing_to_undo', 'Nothing to undo')
        // Only the dates the check-in itself wrote, and only while they are still its own (A1): a rest day
        // the person set, before or since, stays. Today and earlier are left as they are, and stay recorded.
        const recorded = row.daysOffWritten ?? []
        const owned = await checkinOwnedRestDays(tx, ctx.userId, recorded, row.savedAt)
        const kept: string[] = []
        for (const d of recorded) {
          if (!owned.has(d)) continue
          if (daysBetweenDateStrs(today, d) <= 0) { kept.push(d); continue }
          await moveOwnedRestDay(tx, ctx.userId, d, row.savedAt!, false, new Date())
        }
        await updateRow({ daysOffWeekdays: [], daysOffWritten: kept.length > 0 ? kept : null })
        return
      }
      case 'shorter_session': {
        if (row.shorterSessionMin == null) throw new CheckinRefusal(409, 'nothing_to_undo', 'Nothing to undo')
        // No stored plan is touched: the next read in the applies-to week serves it at its own length.
        await updateRow({ shorterSessionMin: null })
        return
      }
    }
  })
  return readCheckinState(ctx)
}

/** The slot (target) of one of this user's Coach changes: for an accepted swap, the slot it changed. */
async function changeTarget(tx: Db, userId: string, changeId: string): Promise<string | null> {
  const [rec] = await tx.select({ targetId: s.coachChanges.targetId }).from(s.coachChanges)
    .where(and(eq(s.coachChanges.id, changeId), eq(s.coachChanges.userId, userId))).limit(1)
  return rec?.targetId ?? null
}

/**
 * How many of this check-in's load steps (`lighter` or `heavier`) for a lift are undone: the changes this
 * user's check-in wrote under the lift's markers (`weekly-checkin:<checkinId>:lift:<slot>`, any slot of
 * the lift in the active program), found in `coach_changes` scoped to the user.
 */
async function undoneLoadSteps(tx: Db, userId: string, checkinId: string, lift: LiftId, step: 'lighter' | 'heavier'): Promise<number> {
  const markers = (await listProgramLifts(tx, userId)).filter(l => sameLift(l, lift)).map(l => changeMarker(checkinId, `lift:${l.sessionExerciseId}`))
  if (markers.length === 0) return 0
  const rows = await tx.select({ id: s.coachChanges.id }).from(s.coachChanges)
    .where(and(
      eq(s.coachChanges.userId, userId), isNotNull(s.coachChanges.undoneAt),
      inArray(sql<string>`${s.coachChanges.patch}->'changes'->0->>'id'`, markers),
      sql`${s.coachChanges.patch}->'changes'->0->>'to' = ${step}`,
    ))
  return rows.length
}

/** The newest live change this user's check-in wrote under `marker` (the change id it gave the writer). */
async function markedChange(tx: Db, userId: string, marker: string): Promise<string | null> {
  const [rec] = await tx.select({ id: s.coachChanges.id }).from(s.coachChanges)
    .where(and(
      eq(s.coachChanges.userId, userId), isNull(s.coachChanges.undoneAt),
      sql`${s.coachChanges.patch}->'changes'->0->>'id' = ${marker}`,
    ))
    .orderBy(desc(s.coachChanges.appliedAt))
    .limit(1)
  return rec?.id ?? null
}
