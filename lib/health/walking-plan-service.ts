import type { PrescribedRun, RunningPlan, WorkoutRepository } from '@/lib/data/repository'
import { daysBetweenDateStrs, DEFAULT_TZ, shiftDateStr, todayInTz, toAestDay, weekStartForDay } from '@trainingai/shared/date-utils'
import { resolveHrProfile } from '@trainingai/shared/health/hr-profile'
import { getDailyGoals } from '@trainingai/shared/health/daily-goals'
import { dayStepCountsByDate } from '@trainingai/shared/health/activity-steps'
import { budgetActivityLogs, HEALTH_CONNECT_SOURCE } from '@trainingai/shared/health/health-connect-workouts'
import { resolveSelfReportedSick } from '@trainingai/shared/ai-periodization/signals'
import { activityLogWindow, heartHealthFloorBpm } from '@trainingai/shared/running/heart-health'
import { cardioPlanKind } from '@trainingai/shared/running/cardio-goals'
import {
  activeMinutesForActivity, dayActiveMinutes,
  type ActiveMinuteBasis, type ActiveMinutesBySource, type ActivityActiveMinutes,
} from '@trainingai/shared/running/walking-minutes'
import {
  dailyMinutesShare, initialWalkingState, judgeWeek, MINUTES_BASELINE_WEEKS, MINUTES_CEILING_PLUS, parseWalkingState,
  stepBackOffers, stepsCeiling, STEPS_BASELINE_DAYS, walkingDayRationale, walkingDayVerdict, weeksToJudge,
  type DayExclusion, type StepBackOffer, type WalkingDayMeasure, type WalkingPlanState, type WalkingWeekRecord,
} from '@trainingai/shared/running/walking-plan'
import { readEveningBefore } from '@/lib/health/oura-budget-activities'

/**
 * Issue 3779. The server half of the walking plan: measures each day's steps and active minutes,
 * judges every week that has ended (which moves the targets), and marks the plan's days done
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

  // #3646, as the heart-health service: a Health Connect copy of an in-app log is the same workout,
  // so it is measured once.
  const eveningBefore = logs.some((l) => l.externalSource === HEALTH_CONNECT_SOURCE)
    ? await readEveningBefore(repo, userId, from)
    : []
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

// One settle per user at a time: two at once could both create the same day's row.
const inFlight = new Map<string, Promise<unknown>>()

function serialized<T>(userId: string, run: () => Promise<T>): Promise<T> {
  const prev = inFlight.get(userId) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(run)
  inFlight.set(userId, next)
  return next.finally(() => { if (inFlight.get(userId) === next) inFlight.delete(userId) })
}

/**
 * Bring the active walking plan up to date and return what a screen shows. Null when the user has
 * no active walking plan. Writes: the plan's state when a week was judged (or on its first run),
 * a pending day row for each day of this and last week that has none, and `completed` on each
 * pending day the rules say is done.
 */
export function settleWalkingPlan(
  repo: Repo, userId: string, tz: string, opts: { plan?: RunningPlan | null } = {},
): Promise<WalkingPlanView | null> {
  return serialized(userId, () => settle(repo, userId, tz, opts))
}

async function settle(repo: Repo, userId: string, tz: string, opts: { plan?: RunningPlan | null }): Promise<WalkingPlanView | null> {
  const plan = opts.plan !== undefined ? opts.plan : await repo.getActiveRunningPlan(userId)
  if (!plan || !plan.isActive || cardioPlanKind(plan) !== 'walking') return null

  const today = todayInTz(tz)
  const [user, goals, profile] = await Promise.all([
    repo.getUserById(userId).catch(() => null),
    repo.getUserGoals(userId).catch(() => null),
    resolveHrProfile(repo, userId, tz),
  ])
  const ownStepsGoal = goals?.stepsGoal != null && goals.stepsGoal > 0 ? goals.stepsGoal : null
  const fallbackStepGoal = getDailyGoals({ activityLevel: user?.activityLevel ?? null, stepsGoal: null }).stepGoal
  const floorBpm = heartHealthFloorBpm({ maxHr: profile.maxHr, restingHr: profile.restingHr })

  const snapshot = (plan.fitnessSnapshot && typeof plan.fitnessSnapshot === 'object' ? plan.fitnessSnapshot : {}) as Record<string, unknown>
  const startDate = walkingPlanStartDate(plan, tz)
  let state = parseWalkingState(snapshot[WALKING_STATE_KEY])
  let changed = false
  if (!state) {
    state = await initialState(repo, userId, tz, startDate, floorBpm, ownStepsGoal, fallbackStepGoal)
    changed = true
  }

  let pending = weeksToJudge(state, today)
  if (pending.length > MAX_WEEKS_JUDGED_PER_PASS) {
    pending = pending.slice(-MAX_WEEKS_JUDGED_PER_PASS)
    state = { ...state, nextWeekToJudge: pending[0] }
    changed = true
  }

  // One measurement covers the weeks to judge and the days to complete (this week and last).
  const currentWeek = weekStartForDay(today)
  const completeFrom = [state.startDate, shiftDateStr(currentWeek, -7)].sort().at(-1)!
  const measureFrom = pending.length > 0 && pending[0] < completeFrom ? pending[0] : completeFrom
  const days = await measureWalkingDays(repo, userId, tz, measureFrom, today, floorBpm)

  for (const w of pending) {
    // Days before the plan began are not the plan's: they count as having no reading.
    const weekDays = [...days.values()].filter((d) => d.date >= state!.startDate)
    state = judgeWeek(state, w, weekDays, { ownStepsGoal })
    changed = true
  }
  if (changed) {
    await repo.updateRunningPlanSnapshot(userId, plan.id, { ...snapshot, [WALKING_STATE_KEY]: state })
  }

  const finalState = state
  const levelsFor = (date: string) => {
    const rec = finalState.weeks.find((r) => r.weekStart === weekStartForDay(date))
    return rec
      ? { stepsTarget: rec.stepsTarget, minutesTarget: rec.minutesTarget }
      : { stepsTarget: finalState.stepsTarget, minutesTarget: finalState.minutesTarget }
  }

  const rows = (await repo.getPrescribedRuns(userId, completeFrom, today)).filter((r) => r.planId === plan.id)
  const rowByDate = new Map<string, PrescribedRun>(rows.map((r) => [r.date, r]))
  const views: WalkingDayView[] = []
  for (const date of completeFrom <= today ? datesBetween(completeFrom, today) : []) {
    const d = days.get(date)!
    const levels = levelsFor(date)
    const verdict = walkingDayVerdict(d, levels)
    let row = rowByDate.get(date) ?? null
    if (!row && d.excluded == null) {
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
      row = (await repo.updatePrescribedRun(userId, row.id, {
        status: 'completed', activityLogId: verdict.minutesMet ? d.creditedId : null, completedAs: 'walk',
      })) ?? row
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
    },
    history: finalState.weeks,
    stepBackOffers: stepBackOffers(finalState),
  }
}

// After data lands: at most one settle per user a minute, never awaited by the write it follows.
const SOON_MIN_INTERVAL_MS = 60_000
const lastSoon = new Map<string, number>()

/**
 * Fire-and-forget settle for the ingest routes, so a walked day is marked done when its steps,
 * activity or heart rate arrive. Never throws and never delays the response; the timezone is the
 * user's own when not given. A user without a walking plan costs one plan read.
 */
export function settleWalkingPlanSoon(repo: Repo, userId: string, tz?: string | null, now: number = Date.now()): void {
  const last = lastSoon.get(userId)
  if (last != null && now - last < SOON_MIN_INTERVAL_MS) return
  lastSoon.set(userId, now)
  void (async () => {
    const plan = await repo.getActiveRunningPlan(userId)
    if (!plan || cardioPlanKind(plan) !== 'walking') return
    const zone = tz ?? (await repo.getUserById(userId).catch(() => null))?.timezone ?? DEFAULT_TZ
    await settleWalkingPlan(repo, userId, zone, { plan })
  })().catch((err) => {
    console.warn(`[walking-plan] settle after ingest failed: ${err instanceof Error ? err.message : 'unknown'}`)
  })
}

/** Test hook: forget the per-user throttle. */
export function resetWalkingSettleThrottle(): void {
  lastSoon.clear()
}
