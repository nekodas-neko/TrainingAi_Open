/**
 * #3896 step 5: the Coach's `lift_preference` domain — the first writer of `exercise_preferences`.
 *
 * **What the model may say:** which lift (`targetId`, a session exercise id from the context or from
 * getProgramStructure / getExerciseContext, ownership-checked by `loadTarget` before anything reads by
 * it) and which enumerated change: a rep range (`"12-15"`, or `more_reps` / `fewer_reps`), a rest in
 * seconds, one plate lighter or heavier next time, one set more or fewer next time. A range or a rest is
 * only ever the person's own words relayed; a value outside the table's CHECKs or step 4's bounds is
 * refused with a plain message, never clamped. `from` is compared with the stored row, never written.
 *
 * **What code computes:** everything else. The range for `more_reps`, the reps, load, sets and rest of
 * the next plan (`restatePlanRow` → `applyLiftPreferenceToPlanRow` / `applyPlanSetsDelta`), the bar
 * (`prescribedBar`), and the card's numbers, read back through `normalizeStoredPrescription` as the
 * workout screen and getExerciseContext read a plan.
 *
 * **One transaction** (`transactional`): the preference row, the stored plans restated to it, and the
 * `coach_changes` record commit together or not at all. Every column written is named here from values
 * code computed; no request body reaches `.set()` or an INSERT. Every write checks its affected-row
 * count, and a row that moved under it rolls the whole change back as stale.
 *
 * **Undo** restores exactly what apply replaced: the previous row (its values, its tombstone, its
 * one-shot time to the microsecond), or a tombstone where there was no row, and each stored plan as it
 * was — or, if a plan was regenerated since, voids it so it regenerates without the undone change.
 * It refuses when the row no longer holds what this change wrote (a later change is in effect). The
 * window, "until the next workout started after the change", is the undo route's.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { DEFAULT_TZ, todayInTz } from '@trainingai/shared/date-utils'
import * as s from '@/lib/data/postgres/schema'
import { voidSessionPrescription } from '@/lib/data/postgres/slices/periodization'
import type { WorkoutRepository } from '@/lib/data/repository'
import { buildWorkoutExercises } from '@trainingai/shared/workout/session-data'
import { buildAutomaticPhaseStatus, isEarlyDeloadWeek } from '@trainingai/shared/phase-engine'
import { getScheduledSessionsPerWeek } from '@trainingai/shared/schedule-utils'
import { loadTarget, type TargetRow } from './session-exercise'
import { lockLiftWrites, withBoundedLockWait } from '../lock-wait'
import type { Consequence, Db, DomainHandler, Drift, PreviewResult } from './types'
import {
  DURATION_LABEL, LIFT_PREFERENCE_DURATION, REP_RANGE_DEFAULT, REP_RANGE_REQUESTS, liftPreferenceValueLabel,
  type PatchChange,
} from '../patch'
import {
  liftPreferenceFromRow, preferenceAppliesIn, PREFERENCE_REP_CEILING, PREFERENCE_REP_FLOOR,
  PREFERENCE_REST_MAX_SEC, PREFERENCE_REST_MIN_SEC, type LiftPreference,
} from '@trainingai/shared/ai-periodization/lift-preference'
import { restatePlanRow, repRangeForRequest } from '@trainingai/shared/ai-periodization/lift-preference-restate'
import { rewriteHeldRow, sameHoldRecord } from '@trainingai/shared/ai-periodization/checkin-plan-hold'
import { normalizeStoredPrescription } from '@trainingai/shared/ai-periodization/reconcile-prescription'
import { prescriptionDrivesLoad } from '@trainingai/shared/ai-periodization/apply-prescription'
import { isAiPrescriptionPending } from '@trainingai/shared/ai-periodization/prescription-pending'
import { sessionUnderWayCheck } from '@trainingai/shared/ai-periodization/session-under-way'
import { listUnfinishedLoggedSessions } from '@/lib/data/postgres/slices/periodization'
import { prescribedBar } from '@trainingai/shared/workout/load-rounding'
import { resolveWorkingBasisWithSource } from '@trainingai/shared/1rm'
import type { AiPrescription, PeriodizationPhase, PrescriptionStatus } from '@trainingai/shared/types/ai-periodization'

export type BasisReads = Pick<WorkoutRepository, 'getLastRealOneRmBatch' | 'getExerciseEstimates' | 'listPersonalRecords'>
/** What the static reader (`staticBaseReps`) also reads: the program, its styles and phases, the library. */
export type StaticReads = BasisReads & Pick<WorkoutRepository,
  'getActiveProgram' | 'listProgressionStyles' | 'listExerciseLibrary' | 'listProgramPhases' | 'countAllSessionsSinceStart' | 'getLastExerciseLogsBatch'>

type LiftField = 'repRange' | 'restSec' | 'nextLoadStep' | 'setsDelta'
type LiftChange = Extract<PatchChange, { field: LiftField }>

/** The value columns of a preference row, as stored. `oneShotSetAt` is Postgres's own text, so a
 *  restore writes back the exact microsecond the database stamped (step 4's consume matches it). */
export interface PrefColumns {
  repMin: number | null
  repMax: number | null
  restSec: number | null
  nextLoadStep: 'lighter' | 'heavier' | null
  setsDelta: -1 | 1 | null
  oneShotSetAt: string | null
  deletedAt: string | null
}
interface PrefRow extends PrefColumns { id: string; exerciseId: string | null; exerciseName: string; source: string }
/** What undo needs to put a row back exactly: its value columns plus the two apply also writes. */
export interface PrefSnapshot extends PrefColumns { source: string; exerciseId: string | null }

const EMPTY: PrefColumns = { repMin: null, repMax: null, restSec: null, nextLoadStep: null, setsDelta: null, oneShotSetAt: null, deletedAt: null }

/** A row that moved between the read and the write. Thrown inside the transaction so it rolls back. */
export class StaleLiftPreference extends Error {
  constructor(readonly drift: Drift[]) { super('stale') }
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * The user's row for this lift, tombstoned or not, by the reader's identity rule
 * (`listExercisePreferences`): the library id first, then the exact name, never a name row whose own
 * id names a different lift. `lock` takes a row lock for the transaction.
 */
async function findRow(db: Db, userId: string, name: string, libId: string | null, lock: boolean): Promise<PrefRow | null> {
  const res = await db.execute(sql`
    SELECT p.id, p.exercise_id, p.exercise_name, p.rep_min, p.rep_max, p.rest_sec, p.next_load_step, p.sets_delta,
           p.one_shot_set_at::text AS one_shot_set_at, p.deleted_at::text AS deleted_at, p.source
      FROM exercise_preferences p
     WHERE p.user_id = ${userId}
       AND ((${libId}::uuid IS NOT NULL AND p.exercise_id = ${libId}::uuid)
            OR (p.exercise_name = ${name} AND (p.exercise_id IS NULL OR ${libId}::uuid IS NULL OR p.exercise_id = ${libId}::uuid)))
     ORDER BY COALESCE(${libId}::uuid IS NOT NULL AND p.exercise_id = ${libId}::uuid, false) DESC
     LIMIT 1
     ${lock ? sql`FOR UPDATE` : sql``}
  `)
  const r = res.rows[0] as Record<string, unknown> | undefined
  return r ? rowOf(r) : null
}

/**
 * #4076: serialise writers of one lift's preference for the rest of the transaction.
 *
 * `findRow ... FOR UPDATE` locks a row that exists; for a lift with no row yet it locks nothing, so two
 * applies both read "no preference", both insert, and the second hit the *other* unique index
 * (`user_id, exercise_id`, which `ON CONFLICT ... lift_key` does not arbitrate) as a raw duplicate-key
 * error — a 500 on a double tap. The advisory lock is taken before that read, so the second apply waits
 * for the first to commit, then reads its row and is refused as stale with the card's usual refusal.
 *
 * One lock per unique key the row can collide on (the name, then the library id), always in that order,
 * so two applies that share only the library id still queue and none can wait on the other in a cycle.
 * A hash collision only makes two unrelated lifts queue; it cannot let two writers of one lift through.
 */
export async function lockLiftPreference(db: Db, userId: string, name: string, libId: string | null): Promise<void> {
  // Bounded (lib/coach/lock-wait.ts): a holder that keeps the lock for longer than a few seconds makes
  // this throw 55P03, which `applyCoachPatch` answers as "busy", not as a 500 at the statement timeout.
  await withBoundedLockWait(db, async () => {
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext('exercise_preferences:name'), hashtext(${`${userId}:${name}`}))`)
    if (libId) await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext('exercise_preferences:lib'), hashtext(${`${userId}:${libId}`}))`)
  })
}

async function rowById(db: Db, userId: string, id: string, lock: boolean): Promise<PrefRow | null> {
  const res = await db.execute(sql`
    SELECT p.id, p.exercise_id, p.exercise_name, p.rep_min, p.rep_max, p.rest_sec, p.next_load_step, p.sets_delta,
           p.one_shot_set_at::text AS one_shot_set_at, p.deleted_at::text AS deleted_at, p.source
      FROM exercise_preferences p
     WHERE p.id = ${id} AND p.user_id = ${userId}
     ${lock ? sql`FOR UPDATE` : sql``}
  `)
  const r = res.rows[0] as Record<string, unknown> | undefined
  return r ? rowOf(r) : null
}

const num = (v: unknown) => (v == null ? null : Number(v))
function rowOf(r: Record<string, unknown>): PrefRow {
  return {
    id: String(r.id),
    exerciseId: (r.exercise_id as string | null) ?? null,
    exerciseName: String(r.exercise_name),
    source: String(r.source),
    repMin: num(r.rep_min),
    repMax: num(r.rep_max),
    restSec: num(r.rest_sec),
    nextLoadStep: (r.next_load_step as PrefColumns['nextLoadStep']) ?? null,
    setsDelta: num(r.sets_delta) as PrefColumns['setsDelta'],
    oneShotSetAt: (r.one_shot_set_at as string | null) ?? null,
    deletedAt: (r.deleted_at as string | null) ?? null,
  }
}

function columnsOf(row: PrefRow | null): PrefColumns {
  if (!row) return { ...EMPTY }
  const { id: _i, exerciseId: _e, exerciseName: _n, source: _s, ...cols } = row
  return cols
}

function snapshotOf(row: PrefRow): PrefSnapshot {
  return { ...columnsOf(row), source: row.source, exerciseId: row.exerciseId }
}

/** The live values the person has now: a tombstoned row reads as none. */
function liveColumns(row: PrefRow | null): PrefColumns {
  return !row || row.deletedAt ? { ...EMPTY } : columnsOf(row)
}

const rangeText = (c: PrefColumns) => (c.repMin != null && c.repMax != null ? `${c.repMin}-${c.repMax}` : null)

function toPreference(c: PrefColumns): LiftPreference | null {
  return liftPreferenceFromRow({
    repMin: c.repMin, repMax: c.repMax, restSec: c.restSec, nextLoadStep: c.nextLoadStep, setsDelta: c.setsDelta,
    oneShotSetAt: c.oneShotSetAt ? new Date(c.oneShotSetAt) : null,
  })
}

interface Slot {
  programSessionId: string
  sessionName: string
  sessionExerciseId: string
  role: string
}

interface StoredPlan {
  programSessionId: string
  sessionName: string
  phase: PeriodizationPhase
  prescription: AiPrescription
  status: PrescriptionStatus
  periodization: NonNullable<Parameters<typeof isAiPrescriptionPending>[0]>
  /** A workout of this session type is under way (#3900 third review): its plan keeps driving the bar. */
  underWay: boolean
}

interface Context {
  target: TargetRow
  libId: string | null
  equipment: string[] | null
  bodyweight: boolean
  trainingGoal: string
  basisKg: number | null
  slots: Slot[]
  plans: StoredPlan[]
}

/** The three pool reads the bar's basis comes from (1RM history, estimates, records) for one lift. */
export interface BasisInputs {
  lastReal: Awaited<ReturnType<BasisReads['getLastRealOneRmBatch']>>
  estimates: Awaited<ReturnType<BasisReads['getExerciseEstimates']>>
  prs: Awaited<ReturnType<BasisReads['listPersonalRecords']>>
}
async function readBasisInputs(reads: BasisReads, userId: string, name: string): Promise<BasisInputs> {
  const [lastReal, estimates, prs] = await Promise.all([
    reads.getLastRealOneRmBatch(userId, [name]),
    reads.getExerciseEstimates(userId).catch(() => []),
    reads.listPersonalRecords(userId),
  ])
  return { lastReal, estimates, prs }
}
function basisKgOf(b: BasisInputs, name: string): number | null {
  return resolveWorkingBasisWithSource({
    lastNonDeload1rm: b.lastReal.get(name)?.estimated1rm,
    seedEstimate: b.estimates.find(e => e.exerciseName === name)?.estimated1rm,
    allTimePr1rm: b.prs.get(name),
  }).kg
}

/** Every fact the preview and the apply compute from, read once, owner-scoped by the target's program.
 *  `getBasis` supplies the basis reads, which go through the pool: the apply passes ones read before
 *  its transaction opened, so it never waits on a second connection while holding one. */
async function readContext(db: Db, getBasis: () => Promise<BasisInputs>, userId: string, target: TargetRow): Promise<Context> {
  const name = target.exerciseName
  // One after another: inside the apply `db` is a single transaction connection, and pg@9 no longer
  // queues a query issued while another is running on it.
  const [lib] = await db.select({ id: s.exerciseLibrary.id, equipment: s.exerciseLibrary.equipment, exerciseType: s.exerciseLibrary.exerciseType })
    .from(s.exerciseLibrary)
    .where(target.exerciseId ? eq(s.exerciseLibrary.id, target.exerciseId) : eq(s.exerciseLibrary.name, name))
    .limit(1)
  const [program] = await db.select({ trainingGoal: s.programs.trainingGoal }).from(s.programs)
    .where(and(eq(s.programs.id, target.programId), eq(s.programs.userId, userId))).limit(1)
  // D1: the lift in every session of the program it is in, by name (the lift's identity on a slot).
  const slotRows = await db.select({
    programSessionId: s.programSessions.id,
    sessionName: s.programSessions.name,
    sessionExerciseId: s.sessionExercises.id,
    role: s.sessionExercises.exerciseRole,
  })
    .from(s.sessionExercises)
    .innerJoin(s.programSessions, eq(s.sessionExercises.sessionId, s.programSessions.id))
    .where(and(
      eq(s.programSessions.programId, target.programId),
      eq(s.sessionExercises.exerciseName, name),
      isNull(s.sessionExercises.deletedAt),
      isNull(s.programSessions.deletedAt),
    ))
  const sessionIds = [...new Set(slotRows.map(r => r.programSessionId))]
  const periodization = target.phaseMode === 'ai_dynamic' && sessionIds.length > 0
    ? await db.select().from(s.sessionPeriodization).where(and(
      eq(s.sessionPeriodization.userId, userId),
      inArray(s.sessionPeriodization.programSessionId, sessionIds),
    ))
    : []
  // One read, and only when there is a plan to describe (`sessionUnderWayCheck`: a failed read says under way).
  const underWayFor = periodization.some(p => p.prescription != null)
    ? await sessionUnderWayCheck({ listUnfinishedLoggedSessions: (u, since) => listUnfinishedLoggedSessions(db, u, since) }, userId)
    : () => false
  const plans: StoredPlan[] = periodization
    .filter(p => p.prescription != null)
    .map(p => ({
      programSessionId: p.programSessionId,
      sessionName: slotRows.find(r => r.programSessionId === p.programSessionId)!.sessionName,
      phase: p.phase as PeriodizationPhase,
      prescription: p.prescription as AiPrescription,
      status: p.prescriptionStatus as PrescriptionStatus,
      underWay: underWayFor(p.programSessionId),
      periodization: {
        prescription: p.prescription as AiPrescription,
        prescriptionExpiresAt: p.prescriptionExpiresAt,
        prescriptionStatus: p.prescriptionStatus as PrescriptionStatus,
        phase: p.phase as PeriodizationPhase,
        sessionsInPhase: p.sessionsInPhase,
      },
    }))

  // The bar's basis, by the resolver and inputs the workout screen uses. Only read when there is a
  // plan to show it on.
  let basisKg: number | null = null
  if (plans.length > 0) basisKg = basisKgOf(await getBasis(), name)

  return {
    target,
    libId: lib?.id ?? null,
    equipment: lib?.equipment ?? null,
    bodyweight: lib?.exerciseType === 'bodyweight',
    trainingGoal: program?.trainingGoal ?? 'strength',
    basisKg,
    slots: slotRows,
    plans,
  }
}

// ── The change, worked out by code ───────────────────────────────────────────

type Worked = { ok: true; next: PrefColumns; oneShot: boolean; resolved: { changeId: string; to: string }[] } | { ok: false; refusal: string }

const REFUSE_RANGE = `A rep range has to be two whole numbers from ${PREFERENCE_REP_FLOOR} to ${PREFERENCE_REP_CEILING}, low then high, like 12-15.`
const SPENT_ONE_SHOT = 'This was a one-time change and it has already been used or has expired, so there is nothing left to undo.'
const REFUSE_UNPREVIEWED = 'This change was not previewed, so the range was not worked out. Ask the Coach again.'
const REFUSE_TWICE = 'A change can set each thing once. Ask for one value for each.'
/** #3896 review: "Use the program's default" on a lift with no range of its own is refused rather
 *  than written, so a tampered client cannot create an all-empty row and a history entry for nothing. */
export const REFUSE_NOTHING_TO_CLEAR = 'This lift has no rep range of its own, so there is nothing to clear.'
const REFUSE_REST = `Rest between sets has to be from ${PREFERENCE_REST_MIN_SEC} seconds to ${PREFERENCE_REST_MAX_SEC / 60} minutes.`

/**
 * The row's values after the accepted changes. Starts from the live values (a tombstoned row starts
 * empty: its old lasting columns are not revived), changes only the fields accepted, and leaves a
 * pending one-shot alone unless a one-shot field is accepted, in which case the new one-shot replaces
 * it whole. `oneShot` says the write must stamp `one_shot_set_at = now()`.
 *
 * `mode` 'preview' works a relative request (`more_reps`) out and reports it in `resolved`, which the
 * card shows and Apply then carries; 'apply' refuses the relative word, so what is stored is only ever
 * a range the card showed (F1).
 */
export function workOutChange(current: PrefColumns, accepted: LiftChange[], nextPlanReps: number | null, mode: 'preview' | 'apply' = 'preview'): Worked {
  const next: PrefColumns = { ...current, deletedAt: null }
  const shot = accepted.filter(c => c.field === 'nextLoadStep' || c.field === 'setsDelta')
  const resolved: { changeId: string; to: string }[] = []
  if (new Set(accepted.map(c => c.field)).size !== accepted.length) return { ok: false, refusal: REFUSE_TWICE }
  for (const c of accepted) {
    if (c.field === 'repRange') {
      let range: { min: number; max: number } | null
      if (c.to === REP_RANGE_DEFAULT) {
        // The program editor's "Use the program's default" (#3896 step 7): the range is cleared, and
        // the plan goes back to the reps the program sets. Nothing to clear is refused, not written.
        if (current.repMin == null && current.repMax == null) return { ok: false, refusal: REFUSE_NOTHING_TO_CLEAR }
        next.repMin = null
        next.repMax = null
        continue
      }
      if ((REP_RANGE_REQUESTS as readonly string[]).includes(c.to)) {
        if (mode === 'apply') return { ok: false, refusal: REFUSE_UNPREVIEWED }
        const base = current.repMin ?? nextPlanReps
        if (base == null) return { ok: false, refusal: 'There is no plan yet to work the reps out from. Say the range, like 12-15.' }
        range = repRangeForRequest(base, c.to as 'more_reps' | 'fewer_reps')
        if (range) resolved.push({ changeId: c.id, to: `${range.min}-${range.max}` })
        if (!range) return { ok: false, refusal: c.to === 'more_reps' ? 'The reps are already as high as the app allows.' : 'The reps are already as low as the app allows.' }
      } else {
        const [min, max] = c.to.split('-').map(Number)
        if (!(Number.isInteger(min) && Number.isInteger(max) && min >= PREFERENCE_REP_FLOOR && min <= max && max <= PREFERENCE_REP_CEILING)) {
          return { ok: false, refusal: REFUSE_RANGE }
        }
        range = { min, max }
      }
      next.repMin = range.min
      next.repMax = range.max
    } else if (c.field === 'restSec') {
      if (!(Number.isInteger(c.to) && c.to >= PREFERENCE_REST_MIN_SEC && c.to <= PREFERENCE_REST_MAX_SEC)) {
        return { ok: false, refusal: REFUSE_REST }
      }
      next.restSec = c.to
    }
  }
  if (shot.length > 0) {
    next.nextLoadStep = (shot.find(c => c.field === 'nextLoadStep')?.to as PrefColumns['nextLoadStep']) ?? null
    next.setsDelta = (shot.find(c => c.field === 'setsDelta')?.to as PrefColumns['setsDelta']) ?? null
    next.oneShotSetAt = null // stamped by the database
  }
  return { ok: true, next, oneShot: shot.length > 0, resolved }
}

/** `from` against the live row, field by field. The model's `from` is only ever compared. */
function driftOf(current: PrefColumns, accepted: LiftChange[]): Drift[] {
  const now: Record<LiftField, unknown> = {
    repRange: rangeText(current), restSec: current.restSec, nextLoadStep: current.nextLoadStep, setsDelta: current.setsDelta,
  }
  return accepted
    .filter(c => String(now[c.field] ?? '') !== String(c.from ?? ''))
    .map(c => ({ changeId: c.id, field: c.field, expected: String(c.from ?? '—'), actual: String(now[c.field] ?? '—') }))
}

// ── Plans ────────────────────────────────────────────────────────────────────

/** A plan a preference never applies in: a deload, or the baseline test (design §3a). */
function planExcluded(plan: Pick<StoredPlan, 'phase' | 'prescription'>): 'deload' | 'baseline' | null {
  const deload = plan.prescription.deload === true || plan.prescription.phase === 'deload'
  const baseline = plan.phase === 'baseline'
  if (preferenceAppliesIn({ deload, baseline })) return null
  return baseline ? 'baseline' : 'deload'
}

/** The plan as generation would store it with `pref`, or the same object when nothing changes. */
type RestateInputs = Pick<Context, 'slots' | 'trainingGoal' | 'bodyweight' | 'basisKg' | 'equipment'>
export function restatePlan(ctx: RestateInputs, plan: Pick<StoredPlan, 'programSessionId' | 'phase' | 'prescription'>, pref: LiftPreference | null): AiPrescription {
  if (planExcluded(plan)) return plan.prescription
  const slotIds = new Map(ctx.slots.filter(x => x.programSessionId === plan.programSessionId).map(x => [x.sessionExerciseId, x.role]))
  let changed = false
  // #3890: a row the weekly check-in's hold lowered is restated from its own load, with the hold's
  // ceiling put back over it (`rewriteHeldRow`), so the plan is still held and still knows its own load.
  const hold = plan.prescription.checkinHold
  const heldRows: NonNullable<AiPrescription['checkinHold']>['rows'] = { ...hold?.rows }
  const exercises = plan.prescription.exercises.map(ex => {
    const role = slotIds.get(ex.sessionExerciseId)
    if (!role) return ex
    const { row: out, held } = rewriteHeldRow(ex, hold, row => restatePlanRow(row, pref, {
      trainingGoal: ctx.trainingGoal, phase: plan.prescription.phase, role,
      bodyweight: ctx.bodyweight, basisKg: ctx.basisKg, equipment: ctx.equipment,
      budgetHeldRest: plan.prescription.refitBaseline?.restSec?.[ex.sessionExerciseId] != null,
    }))
    if (hold?.rows[ex.sessionExerciseId]) {
      if (held) heldRows[ex.sessionExerciseId] = held
      else delete heldRows[ex.sessionExerciseId]
    }
    if (out !== ex) changed = true
    return out
  })
  if (hold && !sameHoldRecord({ ...hold, rows: heldRows }, hold)) changed = true
  if (!changed) return plan.prescription
  const { checkinHold: _hold, ...rest } = plan.prescription
  return { ...rest, exercises, ...(hold && Object.keys(heldRows).length > 0 && { checkinHold: { ...hold, rows: heldRows } }) }
}

/** One slot's numbers as the workout screen reads them: the stored plan through the read-side
 *  normalisation, and the bar `prescribedBar` gives. */
function readRow(ctx: Context, plan: StoredPlan, prescription: AiPrescription, sessionExerciseId: string) {
  const roles = new Map(ctx.slots.filter(x => x.programSessionId === plan.programSessionId).map(x => [x.sessionExerciseId, x.role]))
  const row = normalizeStoredPrescription(prescription, plan.phase, roles).exercises.find(e => e.sessionExerciseId === sessionExerciseId)
  if (!row) return null
  return { sets: row.sets, reps: row.reps, pct: row.pct, restSec: row.restSec, weightKg: ctx.bodyweight ? null : prescribedBar(ctx.basisKg, row.pct, ctx.equipment) }
}

const kg = (v: number) => `${Math.round(v * 100) / 100} kg`
function line(r: { sets: number; reps: number; weightKg: number | null; pct: number }) {
  return `${r.sets} × ${r.reps}${r.weightKg != null ? ` @ ${kg(r.weightKg)}` : ''}`
}

// ── Preview ──────────────────────────────────────────────────────────────────

/** The card's measured lines, and the plans the change would rewrite. Shared by preview and apply. */
function measure(ctx: Context, before: PrefColumns, after: PrefColumns, accepted: LiftChange[], setAtForPreview: Date) {
  const consequences: Consequence[] = []
  const name = ctx.target.exerciseName
  const pref = toPreference({ ...after, oneShotSetAt: after.oneShotSetAt ?? (accepted.some(c => c.field === 'nextLoadStep' || c.field === 'setsDelta') ? setAtForPreview.toISOString() : before.oneShotSetAt) })

  const plan = ctx.plans.find(p => p.programSessionId === ctx.target.sessionId)
  if (ctx.target.phaseMode !== 'ai_dynamic') {
    consequences.push({ kind: 'info', text: `Takes effect from your next ${ctx.target.sessionName}; the app works out the weight when you open it.` })
  } else if (!plan || !plan.prescription.exercises.some(e => e.sessionExerciseId === ctx.target.id)) {
    consequences.push({ kind: 'info', text: `There is no plan for ${ctx.target.sessionName} yet. The next one is made with this change.` })
  } else {
    const excluded = planExcluded(plan)
    const was = readRow(ctx, plan, plan.prescription, ctx.target.id)!
    const storedRow = plan.prescription.exercises.find(e => e.sessionExerciseId === ctx.target.id)!
    if (excluded || storedRow.deloaded) {
      consequences.push({
        kind: 'info',
        text: `Your next ${ctx.target.sessionName} is ${excluded === 'baseline' ? 'a baseline test' : 'a deload'}, so it stays at ${line(was)}. This applies from the session after it.`,
      })
    } else {
      const now = readRow(ctx, plan, restatePlan(ctx, plan, pref), ctx.target.id)!
      const sameNumbers = now.sets === was.sets && now.reps === was.reps && now.pct === was.pct && now.restSec === was.restSec
      if (sameNumbers) {
        consequences.push({ kind: 'info', text: `This doesn't change your next ${ctx.target.sessionName}: ${name} stays at ${line(was)}.` })
        if (accepted.some(c => c.field === 'nextLoadStep') && !ctx.bodyweight) {
          consequences.push({ kind: 'warn', text: ctx.basisKg == null
            ? 'There is no 1RM for this lift yet, so a plate step has nothing to step from.'
            : 'One plate heavier would pass the top load for this lift in this phase, so it is not applied.' })
        }
        if (accepted.some(c => c.field === 'setsDelta')) {
          consequences.push({ kind: 'warn', text: 'The number of sets is already at its limit for this lift.' })
        }
      } else {
        const rest = now.restSec !== was.restSec ? `, rest ${now.restSec} s (was ${was.restSec} s)` : ''
        consequences.push({ kind: 'good', text: `Next ${ctx.target.sessionName}: ${name} ${line(now)} (was ${line(was)})${rest}.` })
      }
      const drives = prescriptionDrivesLoad(plan.prescription.phaseAction, plan.status)
        && !isAiPrescriptionPending(plan.periodization, { isAiDynamic: true, isBaselinePhase: plan.phase === 'baseline', underWay: plan.underWay }, new Date())
      if (!drives) consequences.push({ kind: 'info', text: 'That plan is still waiting to be accepted or remade; these are its numbers.' })
    }
  }
  const others = [...new Set(ctx.slots.filter(x => x.programSessionId !== ctx.target.sessionId).map(x => x.sessionName))]
  if (others.length > 0) consequences.push({ kind: 'info', text: `Also applies to ${name} in ${others.join(', ')}.` })
  for (const d of ['from_now_on', 'next_time'] as const) {
    const fields = accepted.filter(c => LIFT_PREFERENCE_DURATION[c.field] === d)
    if (fields.length === 0) continue
    consequences.push({
      kind: 'info',
      text: d === 'from_now_on'
        ? `${DURATION_LABEL[d]}: ${fields.map(c => liftPreferenceValueLabel(c.field, c.field === 'repRange' && (REP_RANGE_REQUESTS as readonly string[]).includes(c.to) ? rangeText(after) : c.to)).join(', ')}, until you change it.`
        : `${DURATION_LABEL[d]}: ${fields.map(c => liftPreferenceValueLabel(c.field, c.to)!.toLowerCase()).join(', ')}, for the next ${name} you log.`,
    })
  }
  return { consequences, pref }
}

function nextPlanReps(ctx: Context): number | null {
  const plan = ctx.plans.find(p => p.programSessionId === ctx.target.sessionId)
  return plan?.prescription.exercises.find(e => e.sessionExerciseId === ctx.target.id)?.reps ?? null
}

function liftChanges(changes: PatchChange[]): LiftChange[] {
  return changes.filter((c): c is LiftChange => ['repRange', 'restSec', 'nextLoadStep', 'setsDelta'].includes(c.field))
}

function summaryOf(name: string, after: PrefColumns, accepted: LiftChange[]): string {
  const parts = accepted.map(c => {
    const value = c.field === 'repRange' ? liftPreferenceValueLabel('repRange', rangeText(after) ?? c.to) : liftPreferenceValueLabel(c.field, c.to)
    return LIFT_PREFERENCE_DURATION[c.field] === 'next_time' ? `${value!.toLowerCase()} next time` : `${value}`
  })
  return `${name}: ${parts.join(', ')}`
}

/**
 * The reps the lift's own session prescribes for it when no stored AI plan does (a `manual` or
 * `automatic` program, or an `ai_dynamic` one with no plan yet): the first set of the style the workout
 * screen would show. It is that screen's own reader, `buildWorkoutExercises` — the program's styles and
 * phases resolved exactly as the workout-data route resolves them — so no number is made up here.
 * Null when the session prescribes none (no style), or the next session is a deload, a baseline or a
 * test, where a preference does not apply and the reps shown are not the person's working reps; the
 * caller then refuses and asks for the range.
 */
export async function staticBaseReps(reads: StaticReads, userId: string, target: TargetRow, today: string): Promise<number | null> {
  const next = await staticNextExercise(reads, userId, target, today)
  if (!next || next.excluded) return null
  const reps = next.exercise?.progressionStyle?.[0]?.reps
  return typeof reps === 'number' && Number.isInteger(reps) && reps > 0 ? reps : null
}

/**
 * The lift as the workout screen would build it from the program as written (no stored AI plan):
 * `buildWorkoutExercises` with the program's styles and phases resolved as the workout-data route
 * resolves them. With `liftPreferences` (the user's stored preferences, as that route loads them) the
 * built sets carry the preference, as the session screen shows them. `excluded` when the next session
 * is a deload, a baseline or a test. Null when the lift is not in the user's active program.
 */
export async function staticNextExercise(
  reads: StaticReads, userId: string, target: TargetRow, today: string,
  liftPreferences?: ReadonlyMap<string, LiftPreference>,
): Promise<{ exercise: ReturnType<typeof buildWorkoutExercises>[number] | null; excluded: boolean } | null> {
  const program = await reads.getActiveProgram(userId)
  if (!program || program.id !== target.programId) return null
  const programSession = program.sessions.find(x => x.id === target.sessionId)
  const ex = programSession?.exercises.find(e => e.id === target.id)
  if (!programSession || !ex) return null

  const isAutomatic = program.phaseMode === 'automatic'
  const [styles, library, allPhases, lastLogs, lastReal, estimates, prMap] = await Promise.all([
    reads.listProgressionStyles(userId),
    reads.listExerciseLibrary(),
    isAutomatic ? reads.listProgramPhases(userId, program.id) : Promise.resolve([]),
    reads.getLastExerciseLogsBatch(userId, [target.exerciseName]),
    reads.getLastRealOneRmBatch(userId, [target.exerciseName]),
    reads.getExerciseEstimates(userId).catch(() => []),
    reads.listPersonalRecords(userId),
  ])
  let currentPhase: (typeof allPhases)[number] | null = null
  let isDeloadActive = isEarlyDeloadWeek(program, today)
  if (isAutomatic && allPhases.length > 0) {
    const counts = await reads.countAllSessionsSinceStart(userId, program.id)
    const perWeek = getScheduledSessionsPerWeek(program) / Math.max(1, program.sessions.length)
    const status = buildAutomaticPhaseStatus(allPhases, counts.get(programSession.id) ?? 0, program, today, perWeek)
    currentPhase = status.phase
    isDeloadActive = isDeloadActive || status.isDeloadActive
  }
  const phaseType = currentPhase?.phaseType ?? 'normal'
  const excluded = isDeloadActive || phaseType === 'deload' || phaseType === 'baseline' || phaseType === 'testing'
  if (excluded) return { exercise: null, excluded: true }

  const [built] = buildWorkoutExercises({ ...programSession, exercises: [ex] }, {
    lastLogs,
    lastRealOneRm: lastReal,
    prMap,
    estimateMap: new Map(estimates.map(e => [e.exerciseName, e.estimated1rm])),
    styleById: new Map(styles.map(x => [x.id, x.sets])),
    styleByName: new Map(styles.map(x => [x.name, x.sets])),
    styles,
    libByName: new Map(library.map(e => [e.name.toLowerCase(), e])),
    currentPhase,
    allPhases,
    isDeloadActive: false,
    isBaselinePhase: false,
    aiDrivesLoad: false,
    aiPrescription: null,
    aiPhaseLabel: '',
    isAiDynamic: program.phaseMode === 'ai_dynamic',
    aiDeload: false,
    droppedThisCycle: new Set(),
    loggedTodayInThisSession: new Set(),
    trainingGoal: program.trainingGoal,
    ...(liftPreferences && { liftPreferences }),
  })
  return { exercise: built ?? null, excluded: false }
}

/** The reps a relative request is worked out from: the person's own range, else the next plan's reps,
 *  else what the session prescribes (`staticBaseReps`). Read only when a request needs it. */
async function baseRepsFor(
  ctx: Context, current: PrefColumns, accepted: LiftChange[], getReads: () => Promise<StaticReads>, userId: string, today: string,
): Promise<number | null> {
  const asks = accepted.some(c => c.field === 'repRange' && (REP_RANGE_REQUESTS as readonly string[]).includes(c.to))
  if (!asks || current.repMin != null) return null
  return nextPlanReps(ctx) ?? await staticBaseReps(await getReads(), userId, ctx.target, today)
}

// ── A one-shot that was used up or expired (#4007) ───────────────────────────

/**
 * Takes a spent one-off's record off the lift's rows in a stored plan: `loadStep`, `setsDelta` and
 * `oneShotSetAt`, for a row whose `oneShotSetAt` is the spent one (to the 2 ms the consume allows). A
 * lasting `repRange` / `restSec` in the record stays; a record left empty is removed. Nothing else on
 * the row is read or written, so its sets, reps, rest, load and `deloaded` flag are exactly as stored.
 * This is the fallback for what `restatePlanRow` cannot do (a deloaded row, a plan whose session no
 * longer has the lift) and it re-costs nothing. Returns the same object when nothing matched.
 */
export function stripSpentOneShotRecord(prescription: AiPrescription, exerciseName: string, spentMs: number): AiPrescription {
  let changed = false
  const exercises = prescription.exercises.map(ex => {
    const rec = ex.liftPreference
    if (ex.name !== exerciseName || rec?.oneShotSetAt == null || Math.abs(new Date(rec.oneShotSetAt).getTime() - spentMs) >= 2) return ex
    changed = true
    const { loadStep: _l, setsDelta: _d, oneShotSetAt: _t, ...lasting } = rec
    const { liftPreference: _old, ...row } = ex
    return Object.keys(lasting).length > 0 ? { ...row, liftPreference: lasting } : row
  })
  return changed ? { ...prescription, exercises } : prescription
}

/**
 * A lift's one-shot ("lighter next time", ±1 set) is stamped on every stored plan of the lift (D1).
 * When it is used up — a log of one session consumed it — or expires, the other sessions' stored plans
 * still carry the step, and the person would train it a second time. This restates every stored plan
 * of the user whose row for this lift records exactly that `oneShotSetAt` (to the 2 ms the consume
 * itself allows) to the lift's preference as it now is, through the same `restatePlanRow` the Coach's
 * apply uses. No model call. A plan that changed since it was read is left for its own regeneration.
 *
 * Returns how many plans it rewrote. Owner-scoped throughout: plans by `user_id`, the program's
 * sessions by the program's owner.
 */
export async function restateSpentOneShot(
  db: Db, reads: BasisReads, userId: string, exerciseName: string, spentAt: Date,
): Promise<number> {
  const rows = await db.select().from(s.sessionPeriodization).where(eq(s.sessionPeriodization.userId, userId))
  const spentMs = spentAt.getTime()
  const carries = (p: (typeof rows)[number]) => {
    const ex = (p.prescription as AiPrescription | null)?.exercises
    return Array.isArray(ex) && ex.some(e => e.name === exerciseName && e.liftPreference?.oneShotSetAt != null
      && Math.abs(new Date(e.liftPreference.oneShotSetAt).getTime() - spentMs) < 2)
  }
  const plans = rows.filter(p => p.prescription != null && carries(p))
  if (plans.length === 0) return 0

  const [lib] = await db.select({ id: s.exerciseLibrary.id, equipment: s.exerciseLibrary.equipment, exerciseType: s.exerciseLibrary.exerciseType })
    .from(s.exerciseLibrary).where(eq(s.exerciseLibrary.name, exerciseName)).limit(1)
  const row = await findRow(db, userId, exerciseName, lib?.id ?? null, false)
  const pref = toPreference(liveColumns(row))
  const basisKg = basisKgOf(await readBasisInputs(reads, userId, exerciseName), exerciseName)

  let rewritten = 0
  for (const p of plans) {
    // The slots of this plan's session, and the training goal of the program it belongs to — only a
    // program this user owns.
    const slotRows = await db.select({ id: s.sessionExercises.id, role: s.sessionExercises.exerciseRole, goal: s.programs.trainingGoal })
      .from(s.sessionExercises)
      .innerJoin(s.programSessions, eq(s.sessionExercises.sessionId, s.programSessions.id))
      .innerJoin(s.programs, eq(s.programSessions.programId, s.programs.id))
      .where(and(
        eq(s.programSessions.id, p.programSessionId),
        eq(s.programs.userId, userId),
        eq(s.sessionExercises.exerciseName, exerciseName),
        isNull(s.sessionExercises.deletedAt),
      ))
    const prescription = p.prescription as AiPrescription
    // A full restate re-costs the row, which needs its slot, and skips a deloaded row. When it cannot
    // run, or leaves the spent record behind, the marker is taken off directly (below), so a stale stamp
    // is cleared on this call and never found again.
    const restated = slotRows.length === 0 ? prescription : restatePlan({
      slots: slotRows.map(r => ({ programSessionId: p.programSessionId, sessionName: '', sessionExerciseId: r.id, role: r.role })),
      trainingGoal: slotRows[0].goal, bodyweight: lib?.exerciseType === 'bodyweight', basisKg, equipment: lib?.equipment ?? null,
    }, { programSessionId: p.programSessionId, phase: p.phase as PeriodizationPhase, prescription }, pref)
    const next = stripSpentOneShotRecord(restated, exerciseName, spentMs)
    if (next === prescription) continue
    const res = await db.update(s.sessionPeriodization)
      .set({ prescription: next as unknown as Record<string, unknown>, updatedAt: new Date() })
      .where(and(
        eq(s.sessionPeriodization.userId, userId),
        eq(s.sessionPeriodization.programSessionId, p.programSessionId),
        sql`${s.sessionPeriodization.prescription} = ${JSON.stringify(prescription)}::jsonb`,
      ))
      .returning({ id: s.sessionPeriodization.id })
    rewritten += res.length
  }
  return rewritten
}

// ── The handler ──────────────────────────────────────────────────────────────

/** What `prepare` reads before the apply's transaction: the lift it read for, and its basis inputs. */
interface PreparedBasis { exerciseName: string; basis: BasisInputs }

export interface LiftPreferenceBefore {
  /** The preference row this change wrote; also the `coach_changes.target_id`. */
  preferenceId: string
  /** The row before (its columns, tombstone included, and the `source` and `exercise_id` apply also
   *  writes), or null when there was no row. */
  before: PrefSnapshot | null
  /** The row as this change left it: undo refuses unless the row still holds exactly this. */
  after: PrefColumns
  /** Each stored plan the change rewrote, before and after. */
  plans: { programSessionId: string; before: AiPrescription; after: AiPrescription }[]
}

const cols = (c: PrefColumns) => ({
  repMin: c.repMin, repMax: c.repMax, restSec: c.restSec, nextLoadStep: c.nextLoadStep, setsDelta: c.setsDelta,
})
const same = (a: PrefColumns, b: PrefColumns) =>
  JSON.stringify(cols(a)) === JSON.stringify(cols(b)) && a.oneShotSetAt === b.oneShotSetAt && (a.deletedAt == null) === (b.deletedAt == null)

/** Who a preference row says wrote it (`exercise_preferences.source`): the Coach, or #3890's weekly
 *  check-in, which applies its "Heavy plus a miss" and an accepted "Light" through this same writer. */
export type LiftPreferenceSource = 'coach' | 'checkin'

export function liftPreferenceHandler(
  getReads: () => Promise<StaticReads>, today: string = todayInTz(DEFAULT_TZ), source: LiftPreferenceSource = 'coach',
): DomainHandler {
  return {
    transactional: true,

    async preview(db, userId, patch): Promise<PreviewResult> {
      const target = patch.targetId ? await loadTarget(db, userId, patch.targetId) : null
      if (!target) return { consequences: [], drift: [], target: null }
      const accepted = liftChanges(patch.changes)
      const ctx = await readContext(db, async () => readBasisInputs(await getReads(), userId, target.exerciseName), userId, target)
      const row = await findRow(db, userId, target.exerciseName, ctx.libId, false)
      const current = liveColumns(row)
      const drift = driftOf(current, accepted)
      const worked = workOutChange(current, accepted, await baseRepsFor(ctx, current, accepted, getReads, userId, today))
      const label = { id: target.id, label: `${target.exerciseName} (${target.sessionName})` }
      if (!worked.ok) {
        return { consequences: [{ kind: 'warn', text: worked.refusal }], drift, target: label, refusal: worked.refusal }
      }
      const { consequences } = measure(ctx, current, worked.next, accepted, new Date())
      return { consequences, drift, target: label, ...(worked.resolved.length > 0 && { resolved: worked.resolved }) }
    },

    // Runs before the transaction opens (`applyInTransaction`): the basis reads go through the pool, and
    // a transaction holds one connection, so they must not be awaited inside it.
    async prepare(db, userId, patch) {
      if (!patch.targetId) return null
      const target = await loadTarget(db, userId, patch.targetId)
      if (!target) return null
      const prepared: PreparedBasis = { exerciseName: target.exerciseName, basis: await readBasisInputs(await getReads(), userId, target.exerciseName) }
      return prepared
    },

    async apply(db, userId, patch, accepted, prepared) {
      if (!patch.targetId) return { ok: false, reason: 'not_found' }
      // #4082: before any read or write, so every writer of a person's lifts and stored plans meets the
      // same lock first (see `lockLiftWrites`). The reads below then see what the last writer committed.
      await lockLiftWrites(db, userId)
      const target = await loadTarget(db, userId, patch.targetId)
      if (!target) return { ok: false, reason: 'not_found' }
      const changes = liftChanges(accepted)
      if (changes.length !== accepted.length) return { ok: false, reason: 'invalid', detail: 'Those fields do not belong to that domain' }
      // The whole patch, not only the accepted part: a patch that names a field twice is not a change
      // the card could have described.
      const named = liftChanges(patch.changes)
      if (new Set(named.map(c => c.field)).size !== named.length) return { ok: false, reason: 'invalid', detail: REFUSE_TWICE }
      // The basis was read before the transaction. If the lift under the id is not the one it was read
      // for (renamed in between), refuse as stale rather than read through the pool in here. The `from`
      // check below stays inside the transaction, on the row it locks.
      const before = prepared as PreparedBasis | null | undefined
      const getBasis = async (): Promise<BasisInputs> => {
        if (before === undefined) return readBasisInputs(await getReads(), userId, target.exerciseName) // not run by applyInTransaction
        if (before?.exerciseName !== target.exerciseName) {
          throw new StaleLiftPreference([{ changeId: changes[0].id, field: 'lift', expected: before?.exerciseName ?? 'the lift as read', actual: 'a lift that changed while applying' }])
        }
        return before.basis
      }
      const ctx = await readContext(db, getBasis, userId, target)

      // Before the read: a lift with no row has nothing for FOR UPDATE to lock (#4076).
      await lockLiftPreference(db, userId, target.exerciseName, ctx.libId)
      const row = await findRow(db, userId, target.exerciseName, ctx.libId, true)
      const current = liveColumns(row)
      const drift = driftOf(current, changes)
      if (drift.length > 0) return { ok: false, reason: 'stale', drift }
      const worked = workOutChange(current, changes, nextPlanReps(ctx), 'apply')
      if (!worked.ok) return { ok: false, reason: 'invalid', detail: worked.refusal }
      const n = worked.next

      // Every column named; every value computed above. A tombstoned row is revived with its old
      // lasting columns and one-shot already dropped (`liveColumns` started it empty).
      const stamp = worked.oneShot ? sql`now()` : n.oneShotSetAt == null ? sql`NULL` : sql`${n.oneShotSetAt}::timestamptz`
      const written = row
        ? await db.execute(sql`
            UPDATE exercise_preferences
               SET rep_min = ${n.repMin}, rep_max = ${n.repMax}, rest_sec = ${n.restSec},
                   next_load_step = ${n.nextLoadStep}, sets_delta = ${n.setsDelta}, one_shot_set_at = ${stamp},
                   exercise_id = COALESCE(exercise_id, ${ctx.libId}::uuid),
                   source = ${source}, deleted_at = NULL, updated_at = now()
             WHERE id = ${row.id} AND user_id = ${userId}
         RETURNING id, one_shot_set_at::text AS one_shot_set_at`)
        : await db.execute(sql`
            INSERT INTO exercise_preferences
                   (user_id, exercise_id, exercise_name, rep_min, rep_max, rest_sec, next_load_step, sets_delta, one_shot_set_at, source)
            VALUES (${userId}, ${ctx.libId}::uuid, ${target.exerciseName}, ${n.repMin}, ${n.repMax}, ${n.restSec},
                    ${n.nextLoadStep}, ${n.setsDelta}, ${stamp}, ${source})
            ON CONFLICT ON CONSTRAINT exercise_preferences_lift_key DO NOTHING
         RETURNING id, one_shot_set_at::text AS one_shot_set_at`)
      // Inserted by someone else between the read and this write: the "before" this change would
      // record is no longer true, so nothing is written and the user asks again.
      if (written.rows.length !== 1) throw new StaleLiftPreference([{ changeId: changes[0].id, field: changes[0].field, expected: 'no preference', actual: 'a preference was just saved' }])
      const w = written.rows[0] as { id: string; one_shot_set_at: string | null }
      const after: PrefColumns = { ...n, oneShotSetAt: w.one_shot_set_at, deletedAt: null }

      // The stored plans, restated to the new preference with the database's own one-shot time.
      const pref = toPreference(after)
      const plans: LiftPreferenceBefore['plans'] = []
      for (const plan of ctx.plans) {
        const next = restatePlan(ctx, plan, pref)
        if (next === plan.prescription) continue
        const res = await db.update(s.sessionPeriodization)
          .set({ prescription: next as unknown as Record<string, unknown>, updatedAt: new Date() })
          .where(and(
            eq(s.sessionPeriodization.userId, userId),
            eq(s.sessionPeriodization.programSessionId, plan.programSessionId),
            sql`${s.sessionPeriodization.prescription} = ${JSON.stringify(plan.prescription)}::jsonb`,
          ))
          .returning({ id: s.sessionPeriodization.id })
        if (res.length !== 1) throw new StaleLiftPreference([{ changeId: changes[0].id, field: 'plan', expected: 'the plan as read', actual: 'a plan that changed while applying' }])
        plans.push({ programSessionId: plan.programSessionId, before: plan.prescription, after: next })
      }

      const beforeState: LiftPreferenceBefore = { preferenceId: w.id, before: row ? snapshotOf(row) : null, after, plans }
      return { ok: true, summary: summaryOf(target.exerciseName, after, changes), beforeState: beforeState as unknown as Record<string, unknown>, targetId: w.id }
    },

    async undo(db, userId, targetId, beforeState) {
      const state = beforeState as unknown as LiftPreferenceBefore
      if (!state?.after || state.preferenceId !== targetId) return { ok: false, reason: 'invalid', detail: 'This change can no longer be undone' }
      // #4082: the same first lock as apply. Undo used to take the preference row and then the plan rows
      // with no advisory lock, which a check-in applying a sibling lift could meet in a cycle.
      await lockLiftWrites(db, userId)
      // Bounded like apply's own row lock: a preference row held past the wait is `busy`, not a wait that
      // runs into the pool's 15 s statement timeout (#4082 review).
      const row = await withBoundedLockWait(db, () => rowById(db, userId, targetId, true))
      if (!row) return { ok: false, reason: 'not_found' }
      if (!same(columnsOf(row), state.after)) {
        // The change's one-shot was used up (a log consumed it) or expired, and nothing else moved: that
        // is not "a later change", and there is nothing left of it to put back.
        const introducedOneShot = state.after.oneShotSetAt != null && state.before?.oneShotSetAt !== state.after.oneShotSetAt
        if (introducedOneShot && same(columnsOf(row), { ...state.after, nextLoadStep: null, setsDelta: null, oneShotSetAt: null })) {
          return { ok: false, reason: 'invalid', detail: SPENT_ONE_SHOT }
        }
        return { ok: false, reason: 'stale', drift: [{ changeId: 'row', field: 'preference', expected: 'this change', actual: 'a later change' }] }
      }
      const b = state.before
      const res = b
        ? await db.execute(sql`
            UPDATE exercise_preferences
               SET rep_min = ${b.repMin}, rep_max = ${b.repMax}, rest_sec = ${b.restSec},
                   next_load_step = ${b.nextLoadStep}, sets_delta = ${b.setsDelta},
                   one_shot_set_at = ${b.oneShotSetAt}::timestamptz, deleted_at = ${b.deletedAt}::timestamptz,
                   source = COALESCE(${b.source ?? null}, source),
                   exercise_id = CASE WHEN ${'exerciseId' in b} THEN ${b.exerciseId ?? null}::uuid ELSE exercise_id END,
                   updated_at = now()
             WHERE id = ${targetId} AND user_id = ${userId}
         RETURNING id`)
        // There was no row: leave a tombstone, so a device that has not synced sees the delete.
        : await db.execute(sql`
            UPDATE exercise_preferences
               SET rep_min = NULL, rep_max = NULL, rest_sec = NULL, next_load_step = NULL, sets_delta = NULL,
                   one_shot_set_at = NULL, deleted_at = now(), updated_at = now()
             WHERE id = ${targetId} AND user_id = ${userId}
         RETURNING id`)
      if (res.rows.length !== 1) throw new StaleLiftPreference([])

      for (const p of state.plans ?? []) {
        const restored = await db.update(s.sessionPeriodization)
          .set({ prescription: p.before as unknown as Record<string, unknown>, updatedAt: new Date() })
          .where(and(
            eq(s.sessionPeriodization.userId, userId),
            eq(s.sessionPeriodization.programSessionId, p.programSessionId),
            sql`${s.sessionPeriodization.prescription} = ${JSON.stringify(p.after)}::jsonb`,
          ))
          .returning({ id: s.sessionPeriodization.id })
        // Remade since (a refit, or a new plan made with the change): it can't be put back as it was,
        // and it carries the change being undone, so it is voided and regenerates without it.
        if (restored.length === 0) await voidSessionPrescription(db, userId, p.programSessionId)
      }
      return { ok: true }
    },

    // The undo check is the row against the snapshot apply took (`undo` above), which also covers a
    // `more_reps` change whose `to` is not a stored value. Nothing here for the shared field check.
    async currentState(db, userId, targetId) {
      return (await rowById(db, userId, targetId, false)) ? {} : null
    },
  }
}
