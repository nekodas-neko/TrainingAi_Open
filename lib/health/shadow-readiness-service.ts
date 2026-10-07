/**
 * #2377 — the shadow readiness step: read stored history, score the #2356 pillar model, write ONE
 * table (`shadow_readiness`). Shown nowhere.
 *
 * **It is not part of the live readiness path.** `buildReadinessPayload` is untouched; the
 * readiness route calls {@link scheduleDailyShadowReadiness} after the payload is built, and that
 * call returns at once: the work runs detached, at most once an hour per user and day, and a
 * failure is reported and swallowed. It never fails, delays or changes the response.
 *
 * **It writes `shadow_readiness` and nothing else.** One caveat, stated rather than hidden: zone
 * minutes are read through `getZoneMinutesRange`, a read-through cache that stores the past days it
 * computes in `daily_zone_minutes` — the same rows any zone-minutes read writes, with the same
 * values.
 *
 * Two callers:
 * - the daily step (`computed_by = 'daily'`) for today, through the route hook;
 * - {@link replayShadowReadiness} (`computed_by = 'replay'`), which back-fills past days from stored
 *   history so the comparison starts with past days. Run it with `scripts/shadow-readiness-replay.mjs`
 *   against a local database; there is deliberately no HTTP route for it.
 */
import { getRepository } from '@/lib/data'
import type { WorkoutRepository } from '@/lib/data/repository'
import { reportServerError } from '@/lib/observability'
import { computeEnergyBalance } from '@/lib/health/energy-balance-service'
import { median } from '@trainingai/shared/stats'
import { ageFromDob,dateStrMidnightInTz, shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'
import { resolveSelfReportedSick } from '@trainingai/shared/ai-periodization/signals'
import { resolveHrProfile, hasHrSource } from '@trainingai/shared/health/hr-profile'
import { GOAL_DAILY_DELTA, KCAL_PER_KG } from '@trainingai/shared/nutrition/calorie-balance'
import { DEFAULT_WATER_GOAL_ML } from '@trainingai/shared/nutrition/goal-recommendation'
import { readinessModelVersionOf } from '@trainingai/shared/health/readiness-verdict'
import { prepareShadowHistory, assembleShadowInputs, type ShadowRawHistory } from '@trainingai/shared/health/shadow-readiness/assemble'
import { scoreShadowReadiness, type FuelParts } from '@trainingai/shared/health/shadow-readiness/score'
import { MATURITY_LOOKBACK_DAYS, BASELINE_WINDOW_DAYS } from '@trainingai/shared/health/shadow-readiness/model'
import type { ShadowReadinessRecord } from '@trainingai/shared/types/body'

type Repo = WorkoutRepository

/** History read before the first scored day: the maturity lookback, plus a 28-day ACWR window under
 *  each of the window's days, plus slack. */
const LOOKBACK_DAYS = MATURITY_LOOKBACK_DAYS + BASELINE_WINDOW_DAYS + 7
/** `oura_heartrate` is pruned at 180 days, so older zone minutes cannot be recomputed. A day the
 *  cache does not already hold is left missing rather than computed from a pruned series as zero. */
const ZONE_HR_RETENTION_DAYS = 179

/** Every day in [from, to], ascending. */
function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = shiftDateStr(d, 1)) out.push(d)
  return out
}

/** Planned weekly weight change for a goal, from the same daily offset the calorie budget uses. */
function planPaceKgPerWeek(goal: keyof typeof GOAL_DAILY_DELTA): number {
  return (GOAL_DAILY_DELTA[goal] * 7) / KCAL_PER_KG
}

/**
 * Fuel's parts and weight-vs-plan for one completed day, from the calorie budget's own service.
 * Energy and protein count only on a day the person marked fully logged (Q-387): a day abandoned
 * after lunch is indistinguishable from a light one, and scoring it would read as a deficit.
 */
async function fuelForDay(
  repo: Repo, userId: string, tz: string, day: string,
  food: Map<string, { proteinG: number; calories: number }>,
  waterByDate: Map<string, number>,
  loggedComplete: Set<string>,
  water: { goalMl: number },
): Promise<{ fuel: FuelParts | null; weightVsPlan: number | null }> {
  const complete = loggedComplete.has(day) && (food.get(day)?.calories ?? 0) > 0
  const waterMl = waterByDate.get(day)
  const hydrationRatio = waterMl != null && water.goalMl > 0 ? waterMl / water.goalMl : null
  let energyDeviationKcal: number | null = null
  let proteinRatio: number | null = null
  let weightVsPlan: number | null = null
  try {
    const eb = await computeEnergyBalance(repo, userId, tz, day)
    if (complete && eb.balance) energyDeviationKcal = eb.balance.deviationKcal
    const target = eb.macroTargets?.scaled.proteinG ?? null
    if (complete && target != null && target > 0) proteinRatio = (food.get(day)?.proteinG ?? 0) / target
    const rate = eb.maintenance?.weightRateKgPerWeek ?? null
    if (rate != null && eb.goal) weightVsPlan = rate - planPaceKgPerWeek(eb.goal)
  } catch (err) {
    // Fuel and weight drop out for the day; the rest of the row still scores.
    reportServerError(err, { userId, url: 'shadow-readiness:fuel' })
  }
  const fuel = energyDeviationKcal == null && proteinRatio == null && hydrationRatio == null
    ? null
    : { energyDeviationKcal, proteinRatio, hydrationRatio }
  return { fuel, weightVsPlan }
}

/** Read everything the scorer needs to score every day in [from, to]. */
async function loadHistory(repo: Repo, userId: string, tz: string, from: string, to: string): Promise<{
  raw: ShadowRawHistory
  live: Map<string, { score: number | null; model: string | null }>
}> {
  const start = shiftDateStr(from, -LOOKBACK_DAYS)
  const today = todayInTz(tz)
  // Zone minutes are only needed for the weeks ending inside the scored range and the 30-day window
  // under them. Reading the whole lookback would recompute up to four months of zone seconds
  // whenever the HR profile moves, which it does most days.
  const zoneFrom = [shiftDateStr(from, -(BASELINE_WINDOW_DAYS + 8)), shiftDateStr(today, -ZONE_HR_RETENTION_DAYS)].sort()[1]
  const zoneTo = shiftDateStr(to, -1)

  const [sleepSessions, bodyMetrics, summaries, wear, derived, workouts, setHr, moods, mornings, evenings, user, goals, food, profile] = await Promise.all([
    repo.listSleepSessions(userId, start, to),
    repo.listBodyMetrics(userId, start, to),
    repo.getOuraDailySummary(userId, start, to),
    repo.getOuraDaily(userId, start, to),
    repo.getOuraDailyDerived(userId, start, to),
    repo.getWorkoutSessionsFrom(userId, dateStrMidnightInTz(start, tz)),
    repo.getSetHrStatsSince(userId, dateStrMidnightInTz(start, tz), 20_000),
    repo.listMoodLogs(userId, start, to),
    repo.listDayCheckins(userId, start, to, 'morning'),
    repo.listDayCheckins(userId, start, to, 'evening'),
    repo.getUserById(userId),
    repo.getUserGoals(userId).catch(() => null),
    repo.listFoodLogsSummary(userId, start, to).catch(() => []),
    resolveHrProfile(repo, userId, tz).catch(() => null),
  ])

  // Zone minutes only where something records HR at all (#2337): without a source, every zero
  // would be "nothing could fill it", which is missing, not a week of rest.
  let zoneSeconds: ShadowRawHistory['zoneSeconds'] = null
  if (profile && hasHrSource(profile) !== false && zoneFrom <= zoneTo) {
    const days = await repo.getZoneMinutesRange(userId, zoneFrom, zoneTo, tz, { maxHr: profile.maxHr, restingHr: profile.restingHr })
    zoneSeconds = new Map(days.map(d => [d.day, d.seconds] as const))
  }

  const unwell = new Set<string>()
  for (const m of moods) if (resolveSelfReportedSick(m.bodyState, null)) unwell.add(m.logDate)
  for (const c of mornings) if (resolveSelfReportedSick(undefined, c.illnessContext)) unwell.add(c.logDate)

  const foodByDate = new Map(food.map(f => [f.date, f]))
  const waterByDate = new Map<string, number>()
  for (const m of bodyMetrics) if (m.waterMl != null) waterByDate.set(m.date, m.waterMl)
  const loggedComplete = new Set(evenings.filter(c => c.foodLoggingCompletedAt != null).map(c => c.logDate))
  const goalMl = goals?.waterGoalMl ?? DEFAULT_WATER_GOAL_ML
  const water = { goalMl: goals?.waterGoalType === 'weekly' ? goalMl / 7 : goalMl }

  // Fuel and weight-vs-plan are read for the completed day before each scored day only: they have
  // no learned normal, and each one costs a full calorie-budget computation.
  const fuel = new Map<string, FuelParts>()
  const weightVsPlan = new Map<string, number>()
  for (const d of eachDay(from, to)) {
    const day = shiftDateStr(d, -1)
    const r = await fuelForDay(repo, userId, tz, day, foodByDate, waterByDate, loggedComplete, water)
    if (r.fuel) fuel.set(day, r.fuel)
    if (r.weightVsPlan != null) weightVsPlan.set(day, r.weightVsPlan)
  }

  const live = new Map<string, { score: number | null; model: string | null }>()
  for (const r of derived) live.set(r.day, { score: r.readinessScore, model: readinessModelVersionOf(r.modelVersions) })

  return {
    live,
    raw: {
      tz,
      ageYears: ageFromDob(user?.dateOfBirth, dateStrMidnightInTz(to, tz)),
      sleepSessions,
      bodyMetrics,
      dailySummaries: summaries,
      wear,
      derived,
      workouts: workouts.map(w => ({
        startedAt: new Date(w.startedAt),
        volumeKg: w.exercises.reduce((s, ex) => s + (ex.volume ?? 0), 0),
      })),
      setHr,
      zoneSeconds,
      unwellDates: unwell,
      fuel,
      weightVsPlan,
    },
  }
}

/**
 * Score every day in [from, to] and return the rows, without writing. The live readiness beside
 * each row is the one stored for that day in `oura_daily_derived`, or null when none was.
 */
export async function computeShadowRows(
  userId: string, tz: string, from: string, to: string, computedBy: ShadowReadinessRecord['computedBy'],
  repoOverride?: Repo,
): Promise<ShadowReadinessRecord[]> {
  const repo = repoOverride ?? await getRepository()
  const { raw, live } = await loadHistory(repo, userId, tz, from, to)
  const prepared = prepareShadowHistory(raw)
  return eachDay(from, to).map(date => {
    const r = scoreShadowReadiness(assembleShadowInputs(prepared, date))
    const l = live.get(date)
    return {
      date,
      modelVersion: r.modelVersion,
      shadowReadiness: r.shadowReadiness,
      pillars: r.pillars,
      pillarDetail: r.pillarDetail as unknown as Record<string, unknown>,
      units: r.units as unknown as Record<string, unknown>,
      maturityStage: r.maturityStage,
      inputsThrough: r.inputsThrough,
      liveReadiness: l?.score ?? null,
      liveModelVersion: l?.score != null ? l.model : null,
      computedBy,
    }
  })
}

/** Score and store one day. A recompute of the same model version replaces only its own row. */
export async function runShadowReadinessForDate(
  userId: string, tz: string, date: string, computedBy: ShadowReadinessRecord['computedBy'] = 'daily',
): Promise<ShadowReadinessRecord> {
  const repo = await getRepository()
  const [row] = await computeShadowRows(userId, tz, date, date, computedBy, repo)
  await repo.upsertShadowReadiness(userId, row)
  return row
}

export interface ShadowReplayResult {
  rows: ShadowReadinessRecord[]
  written: number
  dryRun: boolean
}

/**
 * Back-fill past days from stored history (`computed_by = 'replay'`), so the shadow comparison
 * starts with past days, not only new ones. Dry run by default: it scores and returns the rows
 * and writes nothing until asked. Today is never replayed — it belongs to the daily step, and its
 * live score is still moving.
 */
export async function replayShadowReadiness(
  userId: string, from: string, to: string, opts: { tz?: string; write?: boolean } = {},
): Promise<ShadowReplayResult> {
  const repo = await getRepository()
  const user = await repo.getUserById(userId)
  if (!user) throw new Error(`replayShadowReadiness: no user ${userId}`)
  const tz = opts.tz ?? user.timezone ?? 'Australia/Brisbane'
  const lastPast = shiftDateStr(todayInTz(tz), -1)
  const end = to > lastPast ? lastPast : to
  if (from > end) return { rows: [], written: 0, dryRun: !opts.write }
  const rows = await computeShadowRows(userId, tz, from, end, 'replay', repo)
  let written = 0
  if (opts.write) {
    for (const row of rows) {
      await repo.upsertShadowReadiness(userId, row)
      written++
    }
  }
  return { rows, written, dryRun: !opts.write }
}

/** Days whose shadow and live scores differ by at least this much count as "moved" (#2356). */
export const DAYS_MOVED_THRESHOLD = 5

export interface DaysMoved {
  /** Days with both a shadow and a live score. */
  compared: number
  /** Of those, days that differ by at least {@link DAYS_MOVED_THRESHOLD}. */
  moved: number
  medianAbsDiff: number | null
  maxAbsDiff: number | null
}

/** The #2356 days-moved measure: how many days the shadow model would move, and by how much. */
export function daysMoved(rows: readonly { shadowReadiness: number | null; liveReadiness: number | null }[]): DaysMoved {
  const diffs = rows
    .filter(r => r.shadowReadiness != null && r.liveReadiness != null)
    .map(r => Math.abs(r.shadowReadiness! - r.liveReadiness!))
  return {
    compared: diffs.length,
    moved: diffs.filter(d => d >= DAYS_MOVED_THRESHOLD).length,
    medianAbsDiff: median(diffs),
    maxAbsDiff: diffs.length ? Math.max(...diffs) : null,
  }
}

// ── The daily hook───────────────────────────────────────────────────────────────────────────────

/** At most one shadow run per user per hour. The live route runs many times a day; the shadow only
 *  needs to catch the day once its inputs have arrived, and recomputing the same version replaces
 *  its own row, so a later run picks up a night that synced late. */
const DAILY_THROTTLE_MS = 60 * 60 * 1000
const lastRun = new Map<string, number>()

/** Test seam: forget the throttle. */
export function __resetShadowThrottle(): void {
  lastRun.clear()
}

/**
 * How long the daily run waits before starting. The readiness read is part of the app-open burst,
 * and the pool is deliberately small (`lib/data/postgres/client.ts`); starting a few seconds later
 * keeps the shadow's reads out of that burst rather than queueing beside it.
 */
const DAILY_START_DELAY_MS = 10_000

/**
 * Fire-and-forget: start today's shadow run for this user and return immediately. Never throws,
 * never awaits, never touches the caller's response; a failure goes to the error reporter. Returns
 * the detached promise only so a test can wait for it.
 */
export function scheduleDailyShadowReadiness(
  userId: string, tz: string, now: number = Date.now(), delayMs: number = DAILY_START_DELAY_MS,
): Promise<void> | null {
  try {
    const key = `${userId}:${todayInTz(tz)}`
    const prev = lastRun.get(key)
    if (prev != null && now - prev < DAILY_THROTTLE_MS) return null
    // Keep the map to the current window: an entry older than the throttle can never block again.
    for (const [k, at] of lastRun) if (now - at >= DAILY_THROTTLE_MS) lastRun.delete(k)
    lastRun.set(key, now)
    return new Promise<void>(resolve => setTimeout(resolve, delayMs))
      .then(() => runShadowReadinessForDate(userId, tz, todayInTz(tz), 'daily'))
      .then(() => undefined)
      .catch(err => { reportServerError(err, { userId, url: 'shadow-readiness:daily' }) })
  } catch (err) {
    reportServerError(err, { userId, url: 'shadow-readiness:daily' })
    return null
  }
}
