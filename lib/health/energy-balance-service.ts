// Server-side assembly for "calories in vs calories out". The API route and the AI coach tool
// both call this — a second copy would be a second answer to "how much should I eat today", and
// the coach contradicting the widget is worse than either being slightly wrong.

import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { shiftDateStr, ageFromDob } from '@trainingai/shared/date-utils'
import { computeActiveEnergy, SEDENTARY_MULTIPLIER } from '@trainingai/shared/health/daily-energy'
import { type Sex } from '@trainingai/shared/health/workout-energy'
import { mifflinStJeorBmr } from '@trainingai/shared/nutrition/goal-recommendation'
import { cunninghamBmr } from '@trainingai/shared/health/body-composition'
import {
  computeCalorieBalance, targetFromMaintenance, GOAL_DAILY_DELTA,
} from '@trainingai/shared/nutrition/calorie-balance'
import {
  resolveMaintenance, maintenanceGapMessage, MAX_WINDOW_DAYS, type MaintenanceDay,
} from '@trainingai/shared/nutrition/adaptive-tdee'
import type { FitnessGoal } from '@trainingai/shared/types/user'
import type { WorkoutRepository } from '@/lib/data/repository'

export interface EnergyBalanceResult {
  date: string
  balance: {
    intakeKcal: number
    expenditureKcal: number
    restingBaseKcal: number
    activeKcal: number
    netKcal: number
    targetNetKcal: number
    deviationKcal: number
    remainingKcal: number
    projectedWeeklyKg: number
    zone: string
    zoneLabel: string
    zoneColor: string
  } | null
  maintenance: {
    kcal: number
    source: 'calibrated' | 'formula'
    confidence: 'low' | 'medium' | 'high' | null
    daysLogged: number
    daysInWindow: number
    weightRateKgPerWeek: number | null
    gapMessage: string | null
  } | null
  target: {
    recommendedKcal: number | null
    currentKcal: number | null
    driftsFromRecommendation: boolean
  }
  activeBreakdown: { workoutKcal: number; activityKcal: number; stepsKcal: number }
  goal: FitnessGoal | null
  missingProfileFields: string[]
}

/** UTC instant of local midnight for a `YYYY-MM-DD` day in `tz`. */
function localMidnightUtc(date: string, tz: string): Date {
  const zoned = toZonedTime(new Date(`${date}T12:00:00Z`), tz)
  zoned.setHours(0, 0, 0, 0)
  return fromZonedTime(zoned, tz)
}

export async function computeEnergyBalance(
  repo: WorkoutRepository,
  userId: string,
  tz: string,
  date: string,
): Promise<EnergyBalanceResult> {
  // MAX_WINDOW_DAYS of COMPLETED days ending yesterday — `date` is excluded from the calibration
  // (see windowDays below), so the window starts one day further back than the span it covers.
  const windowStart = shiftDateStr(date, -MAX_WINDOW_DAYS)

  // The whole window is fetched, not just the requested day: a calibrated maintenance needs the
  // window's average movement to separate resting burn from habitual movement (see below).
  const [metrics, foodSummary, activityLogs, workouts, targets, userGoals, profile, dayCheckins] = await Promise.all([
    repo.listBodyMetrics(userId, windowStart, date).catch(() => []),
    repo.listFoodLogsSummary(userId, windowStart, date).catch(() => []),
    repo.listActivityLogs(userId, windowStart, date).catch(() => []),
    repo.getWorkoutSessionsFrom(userId, localMidnightUtc(windowStart, tz)).catch(() => []),
    repo.getNutritionTargets(userId).catch(() => null),
    repo.getUserGoals(userId).catch(() => null),
    repo.getUserById(userId).catch(() => null),
    // Q-387: which days the user marked "I have finished logging". Only those may enter the
    // maintenance mean — a day abandoned after lunch is indistinguishable from a completed light
    // one, and counting it dragged the estimate 86 kcal lower per partial day.
    repo.listDayCheckins(userId, windowStart, date, 'evening').catch(() => []),
  ])

  const intakeByDate = new Map(foodSummary.map(r => [r.date, r.calories]))
  const loggingCompleteByDate = new Set(
    dayCheckins.filter(c => c.foodLoggingCompletedAt != null).map(c => c.logDate),
  )
  const metricByDate = new Map(metrics.map(m => [m.date, m]))

  const byDateDesc = (a: { date: string }, b: { date: string }) => b.date.localeCompare(a.date)
  // Last known weight, however old — a stale weight still beats having no BMR at all.
  const latestWeightKg = metrics.filter(m => m.weightKg != null).sort(byDateDesc)[0]?.weightKg ?? null
  const latestBodyFatPct = metrics.filter(m => m.bodyFatPct != null).sort(byDateDesc)[0]?.bodyFatPct ?? null

  const heightCm = profile?.heightCm ?? null
  const ageYears = ageFromDob(profile?.dateOfBirth ?? null, new Date())
  const sex: Sex | null = profile?.sex === 'male' || profile?.sex === 'female' ? profile.sex : null
  const goal = (profile?.fitnessGoal ?? null) as FitnessGoal | null

  const energyProfile = { ageYears, weightKg: latestWeightKg, sex }
  const activeEnergyFor = (day: string) => {
    const start = localMidnightUtc(day, tz)
    const end = new Date(start.getTime() + 86_400_000)
    return computeActiveEnergy({
      profile: energyProfile,
      strengthSessions: workouts
        .filter(ws => ws.completedAt != null && ws.startedAt >= start && ws.startedAt < end)
        .map(ws => ({ durationMin: (ws.completedAt!.getTime() - ws.startedAt.getTime()) / 60000 })),
      activities: activityLogs
        .filter(a => a.date === day)
        .map(a => ({ activityType: a.activityType, durationMin: a.durationMin ?? null, distanceKm: a.distanceKm ?? null })),
      pedometerSteps: metricByDate.get(day)?.steps ?? null,
    })
  }
  const activeEnergy = activeEnergyFor(date)
  const activeBreakdown = {
    workoutKcal: activeEnergy.workoutKcal,
    activityKcal: activeEnergy.activityKcal,
    stepsKcal: activeEnergy.stepsKcal,
  }

  const intakeKcal = Math.round(intakeByDate.get(date) ?? 0)
  const goalDeltaKcal = goal ? GOAL_DAILY_DELTA[goal] : 0

  const missingProfileFields = [
    latestWeightKg == null ? 'weight' : null,
    heightCm == null ? 'height' : null,
    ageYears == null ? 'date of birth' : null,
    sex == null ? 'sex' : null,
  ].filter((f): f is string => f != null)

  if (missingProfileFields.length > 0) {
    return {
      date, balance: null, maintenance: null,
      target: { recommendedKcal: null, currentKcal: targets?.calories ?? null, driftsFromRecommendation: false },
      activeBreakdown, goal, missingProfileFields,
    }
  }

  // Katch-McArdle when body fat is known (it beats Mifflin away from average composition),
  // Mifflin-St Jeor otherwise — matching calculateBaseline's choice.
  const bmr = latestBodyFatPct != null
    ? cunninghamBmr(latestWeightKg! * (1 - latestBodyFatPct / 100))
    : mifflinStJeorBmr(latestWeightKg!, heightCm!, ageYears!, sex!)
  // Sedentary base only — measured movement is added explicitly, so a higher activity multiplier
  // here would double-count it. See daily-energy.ts.
  const formulaBaseline = Math.round(bmr * SEDENTARY_MULTIPLIER)

  // Every COMPLETED day in the window, so unlogged days read as gaps rather than zero-calorie
  // days. `date` itself is deliberately excluded: a day in progress has only part of its food
  // logged, so including it drags the mean intake down and the calibration would report a lower
  // maintenance every morning, recovering each evening. Same partial-day trap as the Oura
  // `wornHours` mistake — a running total must never be compared against completed-day values.
  const windowDays: MaintenanceDay[] = []
  for (let d = windowStart; d < date; d = shiftDateStr(d, 1)) {
    windowDays.push({
      date: d,
      intakeKcal: intakeByDate.get(d) ?? null,
      loggingComplete: loggingCompleteByDate.has(d),
      weightKg: metricByDate.get(d)?.weightKg ?? null,
    })
  }

  const { maintenanceKcal, source, estimate } = resolveMaintenance(windowDays, formulaBaseline)

  // A calibrated maintenance measures TOTAL expenditure, so it already contains however much the
  // user habitually moves. Expenditure is "resting base + today's measured movement", so habitual
  // movement has to come out of the base first — otherwise a typical day reads as a surplus purely
  // from being counted twice. Averaged over every window day (including zero-movement ones),
  // because the calibration averages over those days too.
  const avgActiveKcal = source === 'calibrated' && windowDays.length > 0
    ? windowDays.reduce((sum, d) => sum + activeEnergyFor(d.date).total, 0) / windowDays.length
    : 0

  // Resting burn can never fall below BMR, whatever the arithmetic says.
  const restingBaseKcal = source === 'calibrated'
    ? Math.max(Math.round(bmr), Math.round(maintenanceKcal - avgActiveKcal))
    : formulaBaseline

  const balance = computeCalorieBalance({
    restingBaseKcal, activeKcal: activeEnergy.total, intakeKcal, goalDeltaKcal,
  })

  const recommendedKcal = targetFromMaintenance(maintenanceKcal, goalDeltaKcal)
  const currentKcal = targets?.calories ?? userGoals?.calorieGoal ?? null

  return {
    date,
    balance: { ...balance, intakeKcal, restingBaseKcal, activeKcal: activeEnergy.total },
    maintenance: {
      kcal: maintenanceKcal,
      source,
      confidence: estimate.confidence,
      daysLogged: estimate.daysLogged,
      daysInWindow: estimate.daysInWindow,
      weightRateKgPerWeek: estimate.weightRateKgPerWeek,
      gapMessage: source === 'formula' ? maintenanceGapMessage(estimate) : null,
    },
    target: {
      recommendedKcal,
      currentKcal,
      driftsFromRecommendation: currentKcal != null && Math.abs(currentKcal - recommendedKcal) > 100,
    },
    activeBreakdown,
    goal,
    missingProfileFields: [],
  }
}
