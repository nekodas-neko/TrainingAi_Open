import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { formatInTimeZone } from 'date-fns-tz'
import { DEFAULT_TZ, toAestDay, todayInTz, todayMidnightUtc } from '@trainingai/shared/date-utils'
import { bucketize, computeBaselines, pctFromBaseline, correlationInsight, type BucketDef, type CorrelationBucket, type CorrelationStats, type WithheldReason } from '@trainingai/shared/health/correlation'
import { restAdherencePct } from '@trainingai/shared/workout/rest-adherence'
import { energyBalanceByDay, medianOf } from '@trainingai/shared/health/energy-balance'
import { sorenessVsVolumePoints } from '@trainingai/shared/health/soreness-volume'
import { nightSessions } from '@trainingai/shared/health/sleep-night'
import { minutesFromNoon } from '@trainingai/shared/health/sleep-consistency'
import { sessionEffort, type SessionRpeSource } from '@trainingai/shared/workout/derive-session-rpe'
import { isPlausibleSessionDuration } from '@trainingai/shared/health/workout-energy'

export interface TrendsResponse {
  view: string
  insight: string
  buckets: { label: string; avg: number; count: number }[]
  hasSufficientData: boolean
  series?: { date: string; sessionRpe: number; sessionLoad: number; source: SessionRpeSource }[]
  /** n / r / p behind the claim (Q-75). Absent for views with no paired series. */
  stats?: CorrelationStats
  /** Set when a sentence was deliberately withheld, and why. */
  withheld?: WithheldReason
}

const RECOVERY_BUCKETS: BucketDef[] = [
  { label: '<50',   min: 0,  max: 50  },
  { label: '50–65', min: 50, max: 65  },
  { label: '65–80', min: 65, max: 80  },
  { label: '80+',   min: 80, max: 200 },
]

const REST_ADHERENCE_BUCKETS: BucketDef[] = [
  { label: '<70%',    min: 0,   max: 70   },
  { label: '70–90%',  min: 70,  max: 90   },
  { label: '90–115%', min: 90,  max: 115  },
  { label: '115%+',   min: 115, max: 1000 },
]

const PCT_BASELINE_BUCKETS: BucketDef[] = [
  { label: '<-10%',   min: 0,  max: 90  },
  { label: '-10–0%',  min: 90, max: 100 },
  { label: '0–10%',   min: 100, max: 110 },
  { label: '10%+',    min: 110, max: 1000 },
]

const TEMP_BUCKETS: BucketDef[] = [
  { label: '<-0.2°C',  min: -10,  max: -0.2 },
  { label: '-0.2–0.2°C', min: -0.2, max: 0.2 },
  { label: '0.2°C+',   min: 0.2,  max: 10 },
]

const MEAL_TIMING_BUCKETS: BucketDef[] = [
  { label: '<1h',   min: 0,   max: 60  },
  { label: '1–2h',  min: 60,  max: 120 },
  { label: '2–3h',  min: 120, max: 180 },
  { label: '3h+',   min: 180, max: 1440 },
]

const ENERGY_BALANCE_BUCKETS: BucketDef[] = [
  { label: '<-400',   min: -100000, max: -400 },
  { label: '-400–0',  min: -400,    max: 0     },
  { label: '0–400',   min: 0,       max: 400   },
  { label: '400+',    min: 400,     max: 100000 },
]

// Bedtime buckets in MINUTES FROM NOON, never clock hours — see the coding note on the view below.
// 22:00 → 600, 23:00 → 660. The boundaries are the ones the production measurement used, so the
// shipped buckets and the evidence behind them describe the same split.
const BEDTIME_BUCKETS: BucketDef[] = [
  { label: 'before 22:00', min: 0,   max: 600  },
  { label: '22–23',        min: 600, max: 660  },
  { label: 'after 23:00',  min: 660, max: 1440 },
]

const MUSCLE_VOLUME_BUCKETS: BucketDef[] = [
  { label: '<2000kg',    min: 0,    max: 2000   },
  { label: '2–4000kg',   min: 2000, max: 4000   },
  { label: '4–6000kg',   min: 4000, max: 6000   },
  { label: '6000kg+',    min: 6000, max: 1000000 },
]

function toBucketResponse(buckets: CorrelationBucket[]) {
  return buckets.map(b => ({ label: b.label, avg: b.avg, count: b.count }))
}

// Per-exercise estimated-1RM baseline (mean, ≥3 sessions) built once from the
// whole window's workout sessions — shared by rest-adherence and recovery-vs-strength.
function buildExercise1rmBaseline(workoutSessions: Awaited<ReturnType<Awaited<ReturnType<typeof getRepository>>['getWorkoutSessionsFrom']>>): Map<string, number> {
  const values = new Map<string, number[]>()
  for (const ws of workoutSessions) {
    for (const ex of ws.exercises) {
      if (ex.estimated1rm != null && ex.estimated1rm > 0) {
        const vals = values.get(ex.exerciseName) ?? []
        vals.push(ex.estimated1rm)
        values.set(ex.exerciseName, vals)
      }
    }
  }
  return computeBaselines(values, 3)
}

function sessionMean1RmPct(ws: { exercises: { exerciseName: string; estimated1rm?: number }[] }, baseline: Map<string, number>): number | null {
  const pcts: number[] = []
  for (const ex of ws.exercises) {
    const base = baseline.get(ex.exerciseName)
    if (base == null || ex.estimated1rm == null || ex.estimated1rm <= 0) continue
    pcts.push(pctFromBaseline(ex.estimated1rm, base))
  }
  if (pcts.length === 0) return null
  return pcts.reduce((a, v) => a + v, 0) / pcts.length
}

export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:health-trends`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const url = new URL(req.url)
  const view = url.searchParams.get('view')
  const metric = url.searchParams.get('metric') as 'hrv' | 'rhr' | 'temp' | null

  const repo = await getRepository()
  const tz = session.user?.timezone ?? DEFAULT_TZ
  const todayIso    = todayInTz(tz)
  const todayMid    = todayMidnightUtc(tz)
  const from90dDate = new Date(todayMid.getTime() - 90 * 86_400_000)
  const from90dIso  = formatInTimeZone(from90dDate, tz, 'yyyy-MM-dd')
  const from28dIso  = formatInTimeZone(new Date(todayMid.getTime() - 28 * 86_400_000), tz, 'yyyy-MM-dd')
  // Day index for the confounder control (Q-75). Overnight HRV correlates with the calendar at
  // r = 0.79 in this user's data, so anything else drifting with date correlates with HRV for free
  // — every pair here is a candidate, not just the HRV ones.
  const dayIndex = (dateIso: string) => Math.round((Date.parse(dateIso) - Date.parse(from90dIso)) / 86_400_000)

  let result: TrendsResponse

  if (view === 'subjective-recovery') {
    const [checkins, ouraDaily, derivedDaily] = await Promise.all([
      repo.listDayCheckins(userId, from90dIso, todayIso, 'morning'),
      repo.getOuraDaily(userId, from90dIso, todayIso),
      repo.getOuraDailyDerived(userId, from90dIso, todayIso),
    ])
    // Derived-first, matching /api/health/trends. Cloud readiness is null for anyone not on Oura
    // Cloud (and frozen for the owner since the BLE re-key), which left this correlation empty.
    const readinessByDate = new Map(ouraDaily.map(d => [d.date, d.readinessScore ?? null]))
    for (const d of derivedDaily) if (d.readinessScore != null) readinessByDate.set(d.day, d.readinessScore)
    const paired = checkins
      .filter(c => c.perceivedRecovery != null && readinessByDate.get(c.logDate) != null)
      .map(c => ({ x: readinessByDate.get(c.logDate)!, y: c.perceivedRecovery!, d: dayIndex(c.logDate) }))
    const points = paired.map(({ x, y }) => ({ x, y }))
    const buckets = bucketize(points, RECOVERY_BUCKETS)
    const { insight, hasSufficientData, stats, withheld } = correlationInsight(
      buckets,
      (best, worst) => `You feel most recovered (perceived recovery ${worst.avg}/5) after ${worst.label} readiness nights, vs ${best.avg}/5 after ${best.label} nights.`,
      undefined, undefined,
      { points, control: paired.map(pt => pt.d) },
    )
    result = { view, insight, buckets: toBucketResponse(buckets), hasSufficientData, stats, withheld }

  } else if (view === 'session-rpe') {
    const workoutSessions = await repo.getWorkoutSessionsFrom(userId, from90dDate)
    // Q-420. The sessions are already hydrated with their exercise and set logs, so deriving costs
    // nothing here — no extra query, and no stored column that could drift from the sets it came
    // from. A self-reported rating always wins; `source` travels with the point because the two are
    // different instruments on different scales (see `sessionEffort`), and a chart that draws them
    // as one line should at least be able to say which is which.
    const series = workoutSessions
      .filter(ws => ws.completedAt != null)
      .map(ws => {
        const effort = sessionEffort(ws.sessionRpe, ws.exercises.flatMap(e => e.sets.map(set => set.rpe)))
        if (!effort) return null
        const durationMin = (ws.completedAt!.getTime() - ws.startedAt.getTime()) / 60_000
        // LA-21, owner-decided: a session left running is culled from statistics rather than clamped.
        // `sessionLoad` is `rpe × durationMin`, so one 14-hour row is a 10× point in a series that
        // feeds the acute:chronic ratio — and a ratio distorted upward reads as "you are training far
        // too hard", which is the direction that would change someone's programme.
        if (!isPlausibleSessionDuration(durationMin)) return null
        return {
          date: toAestDay(ws.startedAt, tz),
          sessionRpe: effort.rpe,
          sessionLoad: Math.round(effort.rpe * durationMin),
          source: effort.source,
        }
      })
      .filter((p): p is NonNullable<typeof p> => p != null)
      .sort((a, b) => a.date.localeCompare(b.date))
    const hasSufficientData = series.length >= 3
    const derived = series.filter(p => p.source === 'derived').length
    const insight = hasSufficientData
      ? `${series.length} sessions rated so far${derived > 0 ? ` (${derived} from set ratings)` : ''} — average effort ${(series.reduce((a, s) => a + s.sessionRpe, 0) / series.length).toFixed(1)}/10.`
      : 'Not enough rated sessions yet.'
    result = { view, insight, buckets: [], hasSufficientData, series }

  } else if (view === 'rest-adherence') {
    const [workoutSessions, styles] = await Promise.all([
      repo.getWorkoutSessionsFrom(userId, from90dDate),
      repo.listProgressionStyles(userId),
    ])
    const restSecByStyleSet = new Map<string, number>()
    for (const style of styles) {
      for (const s of style.sets) restSecByStyleSet.set(`${style.id}:${s.setNumber}`, s.restSec)
    }
    const baseline = buildExercise1rmBaseline(workoutSessions)
    const points: { x: number; y: number }[] = []
    const control: number[] = []
    for (const ws of workoutSessions) {
      const restSets = ws.exercises.flatMap(ex => ex.sets.map(set => ({
        actualRestSec: set.restTimeSec ?? null,
        prescribedRestSec: ex.styleId ? restSecByStyleSet.get(`${ex.styleId}:${set.setNumber}`) ?? null : null,
      })))
      const adherence = restAdherencePct(restSets)
      const meanPct = sessionMean1RmPct(ws, baseline)
      if (adherence == null || meanPct == null) continue
      points.push({ x: adherence, y: meanPct })
      control.push(dayIndex(toAestDay(ws.startedAt, tz)))
    }
    const buckets = bucketize(points, REST_ADHERENCE_BUCKETS)
    const { insight, hasSufficientData, stats, withheld } = correlationInsight(
      buckets,
      (best, worst) => `Sessions with ${best.label} rest adherence average ${best.avg >= 0 ? '+' : ''}${best.avg}% vs baseline, vs ${worst.avg >= 0 ? '+' : ''}${worst.avg}% at ${worst.label}.`,
      undefined, undefined,
      { points, control },
    )
    result = { view, insight, buckets: toBucketResponse(buckets), hasSufficientData, stats, withheld }

  } else if (view === 'hrv-volume') {
    // Measured over production before it was built: overnight HRV → same-day tonnage r|t = +0.495,
    // p = 0.006, n = 30. Split at the median (48 ms), 4,376 kg mean tonnage below vs 5,799 kg above
    // — a 33 % difference. Night RHR points the same way (r = −0.491) but does not clear the trend
    // control (p|t = 0.079), so it is not offered as a metric here.
    //
    // Deliberately separate from `recovery-vs-strength`, which scores the same HRV against mean
    // 1RM-percent. Volume is where the response actually shows, and it is the stronger signal.
    //
    // Observation only. n = 30 does not survive Bonferroni across the ~60 pairs the review tested,
    // so nothing here feeds the prescription engine — re-measure at n ≥ 60 before automating on it.
    const [workoutSessions, bodyMetrics] = await Promise.all([
      repo.getWorkoutSessionsFrom(userId, from90dDate),
      repo.listBodyMetrics(userId, from90dIso, todayIso),
    ])
    // Percent-of-baseline, matching the sibling HRV view: a raw-ms bucket boundary is meaningless to
    // anyone but the user it was tuned on, and r is unchanged by the rescale.
    const hrvByDate = new Map(bodyMetrics.filter(m => m.hrvMs != null).map(m => [m.date, m.hrvMs!]))
    const hrvWindow = bodyMetrics.filter(m => m.date >= from28dIso && m.hrvMs != null).map(m => m.hrvMs!)
    const hrvBaseline = hrvWindow.length >= 5
      ? hrvWindow.reduce((a, v) => a + v, 0) / hrvWindow.length
      : null

    // One point per DAY, not per session — "same-day tonnage" is the day's total, and two sessions
    // on one date share the single overnight HRV reading that precedes them.
    const tonnesByDate = new Map<string, number>()
    for (const ws of workoutSessions) {
      const date = toAestDay(ws.startedAt, tz)
      const kg = ws.exercises.reduce((sum, ex) => sum + (ex.volume ?? 0), 0)
      if (kg <= 0) continue
      tonnesByDate.set(date, (tonnesByDate.get(date) ?? 0) + kg / 1000)
    }

    const points: { x: number; y: number }[] = []
    const control: number[] = []
    if (hrvBaseline != null) {
      for (const [date, tonnes] of tonnesByDate) {
        const hrv = hrvByDate.get(date)
        if (hrv == null) continue
        points.push({ x: (hrv / hrvBaseline) * 100, y: parseFloat(tonnes.toFixed(2)) })
        control.push(dayIndex(date))
      }
    }
    const buckets = bucketize(points, PCT_BASELINE_BUCKETS)
    const { insight, hasSufficientData, stats, withheld } = correlationInsight(
      buckets,
      (best, worst) => `You lift ${best.avg} t on days your overnight HRV is ${best.label} baseline, vs ${worst.avg} t at ${worst.label}.`,
      undefined,
      { insufficient: 'Log workouts on days the ring recorded your sleep to unlock this.' },
      { points, control },
    )
    result = { view, insight, buckets: toBucketResponse(buckets), hasSufficientData, stats, withheld }

  } else if (view === 'recovery-vs-strength') {
    const [workoutSessions, bodyMetrics, ouraDaily] = await Promise.all([
      repo.getWorkoutSessionsFrom(userId, from90dDate),
      repo.listBodyMetrics(userId, from90dIso, todayIso),
      repo.getOuraDaily(userId, from90dIso, todayIso),
    ])
    const baseline = buildExercise1rmBaseline(workoutSessions)

    const points: { x: number; y: number }[] = []
    const control: number[] = []
    let buckets: CorrelationBucket[]
    let insight: string
    let hasSufficientData: boolean
    let stats: CorrelationStats | undefined
    let withheld: WithheldReason | undefined

    if (metric === 'temp') {
      const tempByDate = new Map(ouraDaily.map(d => [d.date, d.temperatureDeviation ?? null]))
      for (const ws of workoutSessions) {
        const date = toAestDay(ws.startedAt, tz)
        const temp = tempByDate.get(date)
        const meanPct = sessionMean1RmPct(ws, baseline)
        if (temp == null || meanPct == null) continue
        points.push({ x: temp, y: meanPct })
        control.push(dayIndex(date))
      }
      buckets = bucketize(points, TEMP_BUCKETS)
      ;({ insight, hasSufficientData, stats, withheld } = correlationInsight(
        buckets,
        (best, worst) => `Lifts average ${best.avg >= 0 ? '+' : ''}${best.avg}% at ${best.label} body temperature vs ${worst.avg >= 0 ? '+' : ''}${worst.avg}% at ${worst.label}.`,
        undefined, undefined,
        { points, control },
      ))
    } else {
      const field = metric === 'rhr' ? 'restingHeartRate' : 'hrvMs'
      const valueByDate = new Map(bodyMetrics.map(m => [m.date, m[field] ?? null]))
      const baselineWindow = bodyMetrics.filter(m => m.date >= from28dIso && m[field] != null).map(m => m[field] as number)
      const metricBaseline = baselineWindow.length >= 5
        ? baselineWindow.reduce((a, v) => a + v, 0) / baselineWindow.length
        : null
      if (metricBaseline != null) {
        for (const ws of workoutSessions) {
          const date = toAestDay(ws.startedAt, tz)
          const value = valueByDate.get(date)
          const meanPct = sessionMean1RmPct(ws, baseline)
          if (value == null || meanPct == null) continue
          points.push({ x: (value / metricBaseline) * 100, y: meanPct })
          control.push(dayIndex(date))
        }
      }
      buckets = bucketize(points, PCT_BASELINE_BUCKETS)
      const metricLabel = metric === 'rhr' ? 'RHR' : 'HRV'
      ;({ insight, hasSufficientData, stats, withheld } = correlationInsight(
        buckets,
        (best, worst) => `Lifts average ${best.avg >= 0 ? '+' : ''}${best.avg}% when ${metricLabel} is ${best.label} baseline vs ${worst.avg >= 0 ? '+' : ''}${worst.avg}% at ${worst.label}.`,
        undefined, undefined,
        { points, control },
      ))
    }
    result = { view, insight, buckets: toBucketResponse(buckets), hasSufficientData, stats, withheld }

  } else if (view === 'meal-timing') {
    const [mealTimes, sleepSessions] = await Promise.all([
      repo.listLatestMealTimes(userId, from90dIso, todayIso),
      repo.listSleepSessions(userId, from90dIso, todayIso),
    ])
    const mealByDate = new Map(mealTimes.map(m => [m.date, new Date(m.latestLoggedAt)]))
    const points: { x: number; y: number }[] = []
    const control: number[] = []
    // Nights, not rows (Q-76) — an evening nap's `sleepStart` sits minutes after dinner and carries
    // its own efficiency, which is the single strongest way to manufacture a "late meal ruins your
    // sleep" gradient out of nothing.
    for (const sleep of nightSessions(sleepSessions, tz)) {
      if (sleep.efficiency == null) continue
      const prevDate = toAestDay(new Date(sleep.sleepStart.getTime() - 86_400_000), tz)
      const candidates = [mealByDate.get(sleep.date), mealByDate.get(prevDate)].filter((d): d is Date => d != null)
      const lastMeal = candidates
        .filter(d => d.getTime() <= sleep.sleepStart.getTime())
        .sort((a, b) => b.getTime() - a.getTime())[0]
      if (!lastMeal) continue
      const minutesBefore = (sleep.sleepStart.getTime() - lastMeal.getTime()) / 60_000
      if (minutesBefore > 12 * 60) continue
      points.push({ x: minutesBefore, y: sleep.efficiency })
      control.push(dayIndex(sleep.date))
    }
    const buckets = bucketize(points, MEAL_TIMING_BUCKETS)
    const { insight, hasSufficientData, stats, withheld } = correlationInsight(
      buckets,
      (best, worst) => `Sleep efficiency averages ${best.avg}% when your last meal is ${best.label} before bed, vs ${worst.avg}% at ${worst.label}.`,
      undefined, undefined,
      { points, control },
    )
    result = { view, insight, buckets: toBucketResponse(buckets), hasSufficientData, stats, withheld }

  } else if (view === 'bedtime-sleep') {
    // Measured over production before it was built: bedtime → sleep duration is the strongest
    // relationship in the whole dataset (r|t = −0.534, p < 0.001, n = 52), a slope of −0.70 h of
    // sleep per hour later to bed, and the wake time does not compensate. It is also the only
    // finding here that survives Bonferroni across the ~60 pairs that were tested.
    //
    // ⚠ x MUST be minutes-from-noon, never a clock hour. Bedtimes wrap at midnight, so a raw hour
    // puts 00:30 (0.5) below 22:30 (22.5) and inverts the whole scale — that coding yields r = +0.75
    // against efficiency and reads as "later bedtime → better sleep", the opposite of the truth, at
    // high apparent significance. `minutesFromNoon` exists precisely for this.
    const sleepSessions = await repo.listSleepSessions(userId, from90dIso, todayIso)
    const points: { x: number; y: number }[] = []
    const control: number[] = []
    for (const night of nightSessions(sleepSessions, tz)) {
      if (night.durationHours == null) continue
      points.push({ x: minutesFromNoon(night.sleepStart.toISOString(), tz), y: night.durationHours })
      control.push(dayIndex(night.date))
    }
    const buckets = bucketize(points, BEDTIME_BUCKETS)
    const { insight, hasSufficientData, stats, withheld } = correlationInsight(
      buckets,
      (best, worst) => `You sleep ${best.avg} h on nights you're in bed ${best.label}, vs ${worst.avg} h ${worst.label}.`,
      undefined,
      { insufficient: 'Not enough nights recorded yet to compare bedtimes.' },
      { points, control },
    )
    result = { view, insight, buckets: toBucketResponse(buckets), hasSufficientData, stats, withheld }

  } else if (view === 'energy-balance') {
    const [workoutSessions, bodyMetrics] = await Promise.all([
      repo.getWorkoutSessionsFrom(userId, from90dDate),
      repo.listBodyMetrics(userId, from90dIso, todayIso),
    ])
    const baseline = buildExercise1rmBaseline(workoutSessions)
    const balanceByDate = energyBalanceByDay(bodyMetrics)
    const median = medianOf([...balanceByDate.values()])

    const points: { x: number; y: number }[] = []
    const control: number[] = []
    if (median != null) {
      for (const ws of workoutSessions) {
        const date = toAestDay(ws.startedAt, tz)
        const balance = balanceByDate.get(date)
        const meanPct = sessionMean1RmPct(ws, baseline)
        if (balance == null || meanPct == null) continue
        points.push({ x: balance - median, y: meanPct })
        control.push(dayIndex(date))
      }
    }
    const buckets = bucketize(points, ENERGY_BALANCE_BUCKETS)
    const { insight, hasSufficientData, stats, withheld } = correlationInsight(
      buckets,
      (best, worst) => `Your lifts average ${best.avg >= 0 ? '+' : ''}${best.avg}% vs baseline on days you eat ${best.label} kcal vs your usual, compared with ${worst.avg >= 0 ? '+' : ''}${worst.avg}% at ${worst.label}.`,
      undefined,
      { insufficient: 'Log food and workouts on the same days to unlock this.' },
      { points, control },
    )
    result = { view, insight, buckets: toBucketResponse(buckets), hasSufficientData, stats, withheld }

  } else if (view === 'soreness-volume') {
    const [workoutSessions, checkins] = await Promise.all([
      repo.getWorkoutSessionsFrom(userId, from90dDate),
      repo.listDayCheckins(userId, from90dIso, todayIso, 'morning'),
    ])
    const points = sorenessVsVolumePoints(workoutSessions, checkins, tz)
    const buckets = bucketize(points, MUSCLE_VOLUME_BUCKETS)
    const { insight, hasSufficientData, stats, withheld } = correlationInsight(
      buckets,
      (best, worst) => `Muscles you train with ${best.label} are sore next morning ${best.avg}% of the time, vs ${worst.avg}% at ${worst.label}.`,
      undefined,
      { insufficient: 'Log workouts and morning check-ins to unlock this.' },
      // No control: sorenessVsVolumePoints returns bare pairs with no date attached, so the
      // calendar confounder cannot be tested for this view yet. Significance still applies.
      { points },
    )
    result = { view, insight, buckets: toBucketResponse(buckets), hasSufficientData, stats, withheld }

  } else {
    return NextResponse.json({ error: 'Invalid view' }, { status: 400 })
  }

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
