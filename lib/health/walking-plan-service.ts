import type { PrescribedRun, RunningPlan, WorkoutRepository } from '@/lib/data/repository'
import { daysBetweenDateStrs, DEFAULT_TZ, shiftDateStr, todayInTz, toAestDay, weekStartForDay } from '@trainingai/shared/date-utils'
import { resolveHrProfile } from '@trainingai/shared/health/hr-profile'
import { getDailyGoals } from '@trainingai/shared/health/daily-goals'
import { dayStepCountsByDate } from '@trainingai/shared/health/activity-steps'
import { budgetActivityLogs } from '@trainingai/shared/health/health-connect-workouts'
import { resolveSelfReportedSick } from '@trainingai/shared/ai-periodization/signals'
import { activityLogWindow, heartHealthFloorBpm } from '@trainingai/shared/running/heart-health'
import { cardioPlanKind } from '@trainingai/shared/running/cardio-goals'
import {
  activeMinutesForActivity, dayActiveMinutes,
  type ActiveMinuteBasis, type ActiveMinutesBySource, type ActivityActiveMinutes,
} from '@trainingai/shared/running/walking-minutes'
import {
  dailyMinutesShare, initialWalkingState, MINUTES_BASELINE_WEEKS, MINUTES_CEILING_PLUS, parseWalkingState,
  settleWeeks, stepBackOffers, stepsCeiling, STEPS_BASELINE_DAYS, walkingDayRationale, walkingDayVerdict, walkingWeekStatus, weeksInGrace, weeksToJudge,
  type DayExclusion, type StepBackOffer, type WalkingDayMeasure, type WalkingPlanState, type WalkingWeekRecord, type WalkingWeekStatus,
} from '@trainingai/shared/running/walking-plan'
import { readEveningBefore } from '@/lib/health/oura-budget-activities'

/**
 * Issue 3779. The server half of the walking plan: measures each day's steps and active minutes,
 * judges every week that has ended (re-judged through its two-day grace, then frozen into the
 * stored state, which is what moves the targets), and marks the plan's days done
 * itself — on the server, whenever it runs, so a walked day is done without a screen being open
 * (#3801 item 4: the heart-health completion only ever ran while the Cardio screen was mounted).
 *
 * It runs from the running-plan GET and, through `settleWalkingPlanSoon`, after the routes where a
 * day's data lands (the device sync push, Health Connect, the Oura webhook).
 *
 * State lives on the plan row (`running_plans.fitness_snapshot.walkingPlan`), so no migration. A
 * day is a `prescribed_runs` row with `run_type = 'walk'`, linked to the plan, so the existing
 * sync and history carry it; a completion is never taken back and a skipped day stays skipped.
 *
 * The rules themselves live once in `packages/shared/src/running/walking-plan.ts` and
 * `walking-minutes.ts`; this file only reads, measures and writes.
 */

/** The stored day row's run type. Not a `RunType`: nothing that prescribes runs reads it. */
export const WALK_DAY_RUN_TYPE = 'walk'
/** The snapshot key the walking state is kept under. */
export const WALKING_STATE_KEY = 'walkingPlan'
/** Weeks judged in one pass at most. A plan left idle longer moves only on its last eight weeks,
 *  which bounds the heart-rate reads one request can make. */
export const MAX_WEEKS_JUDGED_PER_PASS = 8

type Repo = WorkoutRepository

export interface MeasuredWalkingDay extends WalkingDayMeasure {
  basis: ActiveMinuteBasis | null
  bySource: ActiveMinutesBySource
  creditedId: string | null
  activities: ActivityActiveMinutes[]
}

export interface WalkingDayView {
  date: string
  runId: string | null
  status: 'pending' | 'completed' | 'skipped' | null
  excluded: DayExclusion | null
  steps: number | null
  stepsMet: boolean
  activeMinutes: number
  minutesMet: boolean
  /** The rules say the day is done (either share met, not left out). */
  done: boolean
  /** Which rule the day's minutes came from: "from heart rate", "from cadence", "from pace", "estimated". */
  basis: ActiveMinuteBasis | null
  bySource: ActiveMinutesBySource
  creditedId: string | null
  isToday: boolean
}

/** The `walking` block of the running-plan payload: what a screen reads. */
export interface WalkingPlanView {
  kind: 'walking'
  targets: {
    stepsPerDay: number
    activeMinutesPerWeek: number
    /** One-seventh of the week's minutes: the day's share, and the length of the day's walk. */
    activeMinutesPerDay: number
    stepsCeiling: number
    minutesCeiling: number
    heartHealthPlus: boolean
  }
  start: WalkingPlanState['startLevels'] & { date: string }
  week: {
    from: string
    to: string
    stepsToday: number | null
    activeMinutes: number
    /** The rule that counted the most of the week's minutes. */
    activeMinutesBasis: ActiveMinuteBasis | null
    stepDaysMet: number
    daysDone: number
    days: WalkingDayView[]
    /** Rule B (#3779): where the week stands. Null when the plan has no counted day this week. */
    status: WalkingWeekStatus | null
  }
  /** Judged weeks, oldest first (the last twelve). */
  history: WalkingWeekRecord[]
  stepBackOffers: StepBackOffer[]
}

function datesBetween(from: string, to: string): string[] {
  const n = daysBetweenDateStrs(from, to)
  const out: string[] = []
  for (let i = 0; i <= n; i++) out.push(shiftDateStr(from, i))
  return out
}

/** Every local day in [from, to] with its steps, active minutes and whether it is left out. */
export async function measureWalkingDays(
  repo: Repo, userId: string, tz: string, from: string, to: string, floorBpm: number,
): Promise<Map<string, MeasuredWalkingDay>> {
  const [metrics, logs, restDays, checkins, moods] = await Promise.all([
    repo.listBodyMetrics(userId, from, to),
    repo.listActivityLogs(userId, from, to),
    repo.listRestDays(userId, from, to).catch(() => [] as string[]),
    repo.listDayCheckins(userId, from, to, 'morning').catch(() => []),
    repo.listMoodLogs(userId, from, to).catch(() => []),
  ])
  const steps = dayStepCountsByDate(metrics, logs)

  const rest = new Set(restDays.map((d) => d.replace(/\//g, '-')))
  const sick = new Set<string>()
  for (const c of checkins) if (resolveSelfReportedSick(undefined, c.illnessContext)) sick.add(c.logDate.replace(/\//g, '-'))
  for (const m of moods) if (resolveSelfReportedSick(m.bodyState, null)) sick.add(m.logDate.replace(/\//g, '-'))

  // #3646, as the heart-health service: a copy of an in-app log imported from another source is the
  // same workout, so it is measured once (`budgetActivityLogs` decides which logs are copies). The
  // evening before is always read rather than only when some log names a given source: one more
  // query a pass, and no source id in this file.
  const eveningBefore = await readEveningBefore(repo, userId, from)
  const counted = budgetActivityLogs(logs, [], tz, eveningBefore)
  const measured = await Promise.all(counted.map(async (l): Promise<[string, ActivityActiveMinutes]> => {
    const window = activityLogWindow(l, tz)
    const rows = window ? await repo.getHrForWindow(userId, window.from, window.to).catch(() => []) : []
    const readings = rows.map((r) => ({
      timestamp: (r.timestamp instanceof Date ? r.timestamp : new Date(r.timestamp)).getTime(),
      bpm: r.bpm,
    }))
    return [l.date, activeMinutesForActivity({
      id: l.id,
      activityType: l.activityType,
      durationMin: l.durationMin ?? null,
      distanceKm: l.distanceKm ?? null,
      cadenceSpm: l.cadenceSpm ?? null,
      cadenceSeries: l.cadenceSeries ?? null,
      window: window ? { fromMs: window.from.getTime(), toMs: window.to.getTime() } : null,
    }, readings, floorBpm)]
  }))
  const byDate = new Map<string, ActivityActiveMinutes[]>()
  for (const [date, a] of measured) byDate.set(date, [...(byDate.get(date) ?? []), a])

  const out = new Map<string, MeasuredWalkingDay>()
  for (const date of datesBetween(from, to)) {
    const excluded: DayExclusion | null = rest.has(date) ? 'rest' : sick.has(date) ? 'sick' : null
    const activities = byDate.get(date) ?? []
    const day = dayActiveMinutes(activities)
    out.set(date, {
      date,
      steps: steps.get(date) ?? null,
      activeMinutes: day.minutes,
      excluded,
      basis: day.basis,
      bySource: day.bySource,
      creditedId: day.creditedId,
      activities,
    })
  }
  return out
}

/** The plan's first local day: the day it was created, in the user's timezone. */
export function walkingPlanStartDate(plan: Pick<RunningPlan, 'createdAt'>, tz: string): string {
  return toAestDay(plan.createdAt instanceof Date ? plan.createdAt : new Date(plan.createdAt), tz)
}

/** The starting state, from the 28 days and the 4 full weeks before the plan began. */
async function initialState(
  repo: Repo, userId: string, tz: string, startDate: string, floorBpm: number,
  ownStepsGoal: number | null, fallbackStepGoal: number,
): Promise<WalkingPlanState> {
  const firstMonday = weekStartForDay(startDate)
  const from = shiftDateStr(firstMonday, -7 * MINUTES_BASELINE_WEEKS)
  const to = shiftDateStr(startDate, -1)
  const days = from <= to ? await measureWalkingDays(repo, userId, tz, from, to, floorBpm) : new Map<string, MeasuredWalkingDay>()
  const stepsFrom = shiftDateStr(startDate, -STEPS_BASELINE_DAYS)
  const recentDailySteps: number[] = []
  for (const d of days.values()) {
    if (d.date >= stepsFrom && d.excluded == null && d.steps != null) recentDailySteps.push(d.steps)
  }
  const recentWeeklyMinutes: number[] = []
  for (let w = 0; w < MINUTES_BASELINE_WEEKS; w++) {
    const weekFrom = shiftDateStr(from, 7 * w)
    let sum = 0
    for (let i = 0; i < 7; i++) {
      const d = days.get(shiftDateStr(weekFrom, i))
      if (d && d.excluded == null) sum += d.activeMinutes
    }
    recentWeeklyMinutes.push(sum)
  }
  return initialWalkingState({ startDate, ownStepsGoal, recentDailySteps, recentWeeklyMinutes, fallbackStepGoal })
}

// One settle per user at a time in this process: two at once could both create the same day's row,
// or one could write the state another had just changed. Across processes the state write is a
// compare-and-set on the plan's `updated_at` (`writeSnapshot`).
const inFlight = new Map<string, Promise<unknown>>()

function serialized<T>(userId: string, run: () => Promise<T>): Promise<T> {
  const prev = inFlight.get(userId) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(run)
  inFlight.set(userId, next)
  return next.finally(() => { if (inFlight.get(userId) === next) inFlight.delete(userId) })
}

function snapshotOf(plan: RunningPlan): Record<string, unknown> {
  return (plan.fitnessSnapshot && typeof plan.fitnessSnapshot === 'object' ? plan.fitnessSnapshot : {}) as Record<string, unknown>
}

function updatedAtOf(plan: RunningPlan): Date {
  return plan.updatedAt instanceof Date ? plan.updatedAt : new Date(plan.updatedAt)
}

async function readWalkingPlan(repo: Repo, userId: string): Promise<RunningPlan | null> {
  const plan = await repo.getActiveRunningPlan(userId)
  return plan && plan.isActive && cardioPlanKind(plan) === 'walking' ? plan : null
}

/**
 * Write the walking state onto the plan only if the row is unchanged since `plan` was read. On a
 * conflict, re-read and rebuild once (`rebuild` gets the fresh plan; null from it means nothing to
 * write). Returns the plan as written, or null when it was not (no plan, or a second conflict).
 */
async function writeSnapshot(
  repo: Repo, userId: string, plan: RunningPlan, state: WalkingPlanState,
  rebuild: (fresh: RunningPlan) => Promise<WalkingPlanState | null>,
): Promise<RunningPlan | null> {
  let current = plan
  let next: WalkingPlanState | null = state
  for (let attempt = 0; attempt < 2 && next; attempt++) {
    const written = await repo.updateRunningPlanSnapshot(
      userId, current.id, { ...snapshotOf(current), [WALKING_STATE_KEY]: next }, { ifUpdatedAt: updatedAtOf(current) },
    )
    if (written) return written
    if (attempt === 1) break
    const fresh = await readWalkingPlan(repo, userId)
    if (!fresh || fresh.id !== current.id) return null
    current = fresh
    next = await rebuild(fresh)
  }
  return null
}

/**
 * Bring the active walking plan up to date and return what a screen shows. Null when the user has
 * no active walking plan. The plan is always read inside the per-user lock, so a settle queued
 * behind another never writes from a stale copy. Writes: the stored (frozen) state when a week
 * passed its grace (or on its first run), a pending day row for each day of this and last week that
 * has none and was never deleted, and `completed` on each pending day the rules say is done.
 */
export function settleWalkingPlan(repo: Repo, userId: string, tz: string): Promise<WalkingPlanView | null> {
  return serialized(userId, () => settle(repo, userId, tz))
}

export type WalkingChoiceResult =
  | { ok: true; walking: WalkingPlanView | null }
  | { ok: false; reason: 'no_plan' | 'not_on_offer' | 'conflict' }

/**
 * Apply one of the person's choices (`choose` returns the new state, or null when it is not on
 * offer) to the settled state, inside the same lock as every settle, with the same compare-and-set.
 */
export function applyWalkingChoice(
  repo: Repo, userId: string, tz: string, choose: (state: WalkingPlanState) => WalkingPlanState | null,
): Promise<WalkingChoiceResult> {
  return serialized(userId, async (): Promise<WalkingChoiceResult> => {
    // Settle first, so the choice applies to the state with every frozen week judged.
    await settle(repo, userId, tz)
    const plan = await readWalkingPlan(repo, userId)
    const state = plan ? parseWalkingState(snapshotOf(plan)[WALKING_STATE_KEY]) : null
    if (!plan || !state) return { ok: false, reason: 'no_plan' }
    const next = choose(state)
    if (!next) return { ok: false, reason: 'not_on_offer' }
    let refused = false
    const written = await writeSnapshot(repo, userId, plan, next, async (fresh) => {
      const freshState = parseWalkingState(snapshotOf(fresh)[WALKING_STATE_KEY])
      const again = freshState ? choose(freshState) : null
      if (!again) refused = true
      return again
    })
    if (!written) return { ok: false, reason: refused ? 'not_on_offer' : 'conflict' }
    return { ok: true, walking: await settle(repo, userId, tz) }
  })
}

interface SettleContext {
  today: string
  ownStepsGoal: number | null
  fallbackStepGoal: number
  floorBpm: number
}

/** The frozen state to store and the current one to show, for one read of the plan. */
async function judgeOnPlan(
  repo: Repo, userId: string, tz: string, plan: RunningPlan, ctx: SettleContext,
): Promise<{ frozen: WalkingPlanState; current: WalkingPlanState; changed: boolean; days: Map<string, MeasuredWalkingDay>; completeFrom: string }> {
  const startDate = walkingPlanStartDate(plan, tz)
  let state = parseWalkingState(snapshotOf(plan)[WALKING_STATE_KEY])
  let changed = false
  if (!state) {
    state = await initialState(repo, userId, tz, startDate, ctx.floorBpm, ctx.ownStepsGoal, ctx.fallbackStepGoal)
    changed = true
  }

  const pending = weeksToJudge(state, ctx.today)
  if (pending.length > MAX_WEEKS_JUDGED_PER_PASS) {
    state = { ...state, nextWeekToJudge: pending[pending.length - MAX_WEEKS_JUDGED_PER_PASS] }
    changed = true
  }

  // One measurement covers the weeks to judge, the week in its grace, and the days to complete.
  const currentWeek = weekStartForDay(ctx.today)
  const completeFrom = [state.startDate, shiftDateStr(currentWeek, -7)].sort().at(-1)!
  const toJudge = [...weeksToJudge(state, ctx.today), ...weeksInGrace(state, ctx.today)]
  const measureFrom = toJudge.length > 0 && toJudge[0] < completeFrom ? toJudge[0] : completeFrom
  const days = await measureWalkingDays(repo, userId, tz, measureFrom, ctx.today, ctx.floorBpm)

  // Days before the plan began are not the plan's: they count as having no reading.
  const planStart = state.startDate
  const planDays = [...days.values()].filter((d) => d.date >= planStart)
  const settled = settleWeeks(state, planDays, ctx.today, { ownStepsGoal: ctx.ownStepsGoal })
  return { frozen: settled.frozen, current: settled.current, changed: changed || settled.judged.length > 0, days, completeFrom }
}

async function settle(repo: Repo, userId: string, tz: string): Promise<WalkingPlanView | null> {
  const plan = await readWalkingPlan(repo, userId)
  if (!plan) return null

  const today = todayInTz(tz)
  const [user, goals, profile] = await Promise.all([
    repo.getUserById(userId).catch(() => null),
    repo.getUserGoals(userId).catch(() => null),
    resolveHrProfile(repo, userId, tz),
  ])
  const ownStepsGoal = goals?.stepsGoal != null && goals.stepsGoal > 0 ? goals.stepsGoal : null
  const ctx: SettleContext = {
    today,
    ownStepsGoal,
    fallbackStepGoal: getDailyGoals({ activityLevel: user?.activityLevel ?? null, stepsGoal: null }).stepGoal,
    floorBpm: heartHealthFloorBpm({ maxHr: profile.maxHr, restingHr: profile.restingHr }),
  }
  const floorBpm = ctx.floorBpm

  let judged = await judgeOnPlan(repo, userId, tz, plan, ctx)
  if (judged.changed) {
    const written = await writeSnapshot(repo, userId, plan, judged.frozen, async (fresh) => {
      judged = await judgeOnPlan(repo, userId, tz, fresh, ctx)
      return judged.changed ? judged.frozen : null
    })
    // Not written (the plan went, or changed twice under us): show what was judged; the next
    // settle stores it.
    if (!written) console.warn('[walking-plan] state not stored this pass (plan changed or gone)')
  }
  const { current: finalState, days, completeFrom } = judged
  const currentWeek = weekStartForDay(today)

  const levelsFor = (date: string) => {
    const rec = finalState.weeks.find((r) => r.weekStart === weekStartForDay(date))
    return rec
      ? { stepsTarget: rec.stepsTarget, minutesTarget: rec.minutesTarget }
      : { stepsTarget: finalState.stepsTarget, minutesTarget: finalState.minutesTarget }
  }

  // Tombstones are read too: a day the person deleted is never recreated.
  const allRows = (await repo.getPrescribedRuns(userId, completeFrom, today, { includeDeleted: true })).filter((r) => r.planId === plan.id)
  const deletedDates = new Set(allRows.filter((r) => r.deletedAt != null).map((r) => r.date))
  const rowByDate = new Map<string, PrescribedRun>(allRows.filter((r) => r.deletedAt == null).map((r) => [r.date, r]))
  const views: WalkingDayView[] = []
  for (const date of completeFrom <= today ? datesBetween(completeFrom, today) : []) {
    const d = days.get(date)!
    const levels = levelsFor(date)
    const verdict = walkingDayVerdict(d, levels)
    let row = rowByDate.get(date) ?? null
    if (!row && d.excluded == null && !deletedDates.has(date)) {
      const share = dailyMinutesShare(levels.minutesTarget)
      row = await repo.upsertPrescribedRun(userId, {
        id: crypto.randomUUID(), planId: plan.id, date, runType: WALK_DAY_RUN_TYPE,
        durationMin: share, distanceKm: null,
        targetHrLow: floorBpm, targetHrHigh: null, targetZoneIds: [],
        rationale: walkingDayRationale(share, levels.stepsTarget),
        gateAction: 'proceed', status: 'pending', activityLogId: null,
      })
    }
    if (row && row.status === 'pending' && verdict.done) {
      // Only over a live pending row: a skip or delete since the read is never overwritten.
      const completed = await repo.updatePrescribedRun(userId, row.id, {
        status: 'completed', activityLogId: verdict.minutesMet ? d.creditedId : null, completedAs: 'walk',
      }, { onlyIfPending: true })
      if (completed) row = completed
    }
    if (date >= currentWeek) {
      views.push({
        date,
        runId: row?.id ?? null,
        status: row?.status ?? null,
        excluded: d.excluded,
        steps: d.steps,
        stepsMet: verdict.stepsMet,
        activeMinutes: d.excluded == null ? d.activeMinutes : 0,
        minutesMet: verdict.minutesMet,
        done: verdict.done || row?.status === 'completed',
        basis: d.basis,
        bySource: d.bySource,
        creditedId: d.creditedId,
        isToday: date === today,
      })
    }
  }

  const counted = views.filter((v) => v.excluded == null)
  const weekBySource = counted.reduce<ActiveMinutesBySource>((s, v) => ({
    heartRate: s.heartRate + v.bySource.heartRate,
    cadence: s.cadence + v.bySource.cadence,
    speed: s.speed + v.bySource.speed,
    estimated: s.estimated + v.bySource.estimated,
  }), { heartRate: 0, cadence: 0, speed: 0, estimated: 0 })
  const basisOrder: [ActiveMinuteBasis, number][] = [
    ['heart_rate', weekBySource.heartRate], ['cadence', weekBySource.cadence],
    ['speed', weekBySource.speed], ['estimated', weekBySource.estimated],
  ]
  const top = basisOrder.reduce<[ActiveMinuteBasis, number] | null>((best, cur) => cur[1] > 0 && (!best || cur[1] > best[1]) ? cur : best, null)

  return {
    kind: 'walking',
    targets: {
      stepsPerDay: finalState.stepsTarget,
      activeMinutesPerWeek: finalState.minutesTarget,
      activeMinutesPerDay: dailyMinutesShare(finalState.minutesTarget),
      stepsCeiling: stepsCeiling(ownStepsGoal),
      minutesCeiling: finalState.minutesCeiling,
      heartHealthPlus: finalState.minutesCeiling === MINUTES_CEILING_PLUS,
    },
    start: { ...finalState.startLevels, date: finalState.startDate },
    week: {
      from: currentWeek,
      to: today,
      stepsToday: days.get(today)?.steps ?? null,
      activeMinutes: counted.reduce((s, v) => s + v.activeMinutes, 0),
      activeMinutesBasis: top?.[0] ?? null,
      stepDaysMet: counted.filter((v) => v.stepsMet).length,
      daysDone: views.filter((v) => v.done).length,
      days: views,
      status: walkingWeekStatus({
        weekStart: currentWeek, today, startDate: finalState.startDate,
        minutesTarget: finalState.minutesTarget, days: views,
      }),
    },
    history: finalState.weeks,
    // Offered from the frozen state: a step back follows two settled weeks, never a provisional one,
    // so what is offered is exactly what `applyWalkingChoice` can apply.
    stepBackOffers: stepBackOffers(judged.frozen),
  }
}

// After data lands: at most one settle per user a minute, never awaited by the write it follows.
// Trailing: a call inside the window is not dropped but runs once when the window closes, so the
// last data of a burst (the Oura webhook's heart-rate catch-up after its activity) is always seen.
const SOON_MIN_INTERVAL_MS = 60_000
const lastSoon = new Map<string, number>()
const trailing = new Map<string, { timer: ReturnType<typeof setTimeout>; tz: string | null | undefined }>()

function runSoon(repo: Repo, userId: string, tz: string | null | undefined): void {
  void (async () => {
    const plan = await readWalkingPlan(repo, userId)
    if (!plan) return
    const zone = tz ?? (await repo.getUserById(userId).catch(() => null))?.timezone ?? DEFAULT_TZ
    await settleWalkingPlan(repo, userId, zone)
  })().catch((err) => {
    console.warn(`[walking-plan] settle after ingest failed: ${err instanceof Error ? err.message : 'unknown'}`)
  })
}

/**
 * Fire-and-forget settle for the ingest routes, so a walked day is marked done when its steps,
 * activity or heart rate arrive. Never throws and never delays the response; the timezone is the
 * user's own when not given. A user without a walking plan costs one plan read. The first call
 * runs at once; calls within the next minute fold into one run at the end of that minute.
 */
export function settleWalkingPlanSoon(repo: Repo, userId: string, tz?: string | null, now: number = Date.now()): void {
  const last = lastSoon.get(userId)
  if (last != null && now - last < SOON_MIN_INTERVAL_MS) {
    const queued = trailing.get(userId)
    if (queued) { queued.tz = tz ?? queued.tz; return }
    const entry = {
      tz,
      timer: setTimeout(() => {
        trailing.delete(userId)
        lastSoon.set(userId, Date.now())
        runSoon(repo, userId, entry.tz)
      }, Math.max(0, SOON_MIN_INTERVAL_MS - (now - last))),
    }
    // Never hold a server process open for a settle.
    if (typeof entry.timer === 'object' && entry.timer && 'unref' in entry.timer) entry.timer.unref()
    trailing.set(userId, entry)
    return
  }
  lastSoon.set(userId, now)
  runSoon(repo, userId, tz)
}

/** Test hook: forget the per-user throttle and any queued trailing settle. */
export function resetWalkingSettleThrottle(): void {
  lastSoon.clear()
  for (const { timer } of trailing.values()) clearTimeout(timer)
  trailing.clear()
}
