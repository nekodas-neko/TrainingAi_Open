import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ, todayInTz, todayMidnightUtc, toAestDay, ageFromDob } from '@trainingai/shared/date-utils'
import { calculateBaseline, clampRecommendation } from '@trainingai/shared/nutrition/goal-recommendation'
import { buildGoalExplanation, suggestActivityLevel } from '@trainingai/shared/nutrition/goal-recommendation-text'
import { getCurrentPhase } from '@trainingai/shared/phase-engine'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { correctBodyFatPct } from '@trainingai/shared/health/body-fat-calibration'

// An optional source marker; the body is normally absent.
const MAX_BODY_BYTES = 4 * 1024

/**
 * RV-66 took every number away from the model; #3286 took the rest. The explanation and the one
 * activity-level judgement are rule-based (`goal-recommendation-text.ts`), so this route makes no
 * model call and a provider outage can no longer discard the baseline it had already computed.
 */

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`${userId}:goal-recommend`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  // Optional body: an absent or unreadable one keeps the default, only an oversized one is refused.
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok && read.reason === 'too_large') {
    return NextResponse.json({ error: 'Request too large' }, { status: 413 })
  }
  const body = (read.ok ? read.body : null) as { source?: string } | null
  const source = body?.source === 'scheduled' ? 'scheduled' : 'on_demand'

  const repo = await getRepository()
  const user = await repo.getUserById(userId)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const missing: string[] = []
  if (!user.heightCm) missing.push('heightCm')
  if (!user.dateOfBirth) missing.push('dateOfBirth')
  if (!user.sex) missing.push('sex')
  if (!user.activityLevel) missing.push('activityLevel')
  if (!user.fitnessGoal) missing.push('fitnessGoal')
  if (missing.length > 0) {
    return NextResponse.json({ error: 'profile_incomplete', missing }, { status: 400 })
  }

  const tz = user.timezone ?? DEFAULT_TZ
  const todayIso = todayInTz(tz)
  const windowStart = new Date(todayMidnightUtc(tz).getTime() - 14 * 86_400_000)
  const fromIso = toAestDay(windowStart, tz)

  const [bodyMetrics, workoutSessions, personalRecords, userGoals, nutritionTargets, program] = await Promise.all([
    repo.listBodyMetrics(userId, fromIso, todayIso),
    repo.getWorkoutSessionsFrom(userId, windowStart),
    repo.listRecentPersonalRecords(userId, windowStart, new Date()),
    repo.getUserGoals(userId),
    repo.getNutritionTargets(userId),
    repo.getActiveProgram(userId),
  ])

  const latestWeight = bodyMetrics.find(m => m.weightKg != null)?.weightKg
  if (latestWeight == null) {
    return NextResponse.json({ error: 'no_weight_data' }, { status: 400 })
  }

  // BF-2: correct the scale's BIA estimate against the DEXA before it reaches the calorie goal, the
  // protein dose, or `personalRmr`'s current fat-free mass. The last one is why this matters most:
  // it re-scales a measured RMR's residual onto today's lean mass, and `ffm_kg_at_test` came from
  // the DEXA — so an uncorrected scale number puts the two sides on different instruments.
  const latestBodyFatRow = bodyMetrics.find(m => m.bodyFatPct != null) ?? null
  const bodyFatCalibration = await repo.getBodyFatCalibration(userId).catch(() => null)
  const latestBodyFatPct = correctBodyFatPct(
    latestBodyFatRow?.bodyFatPct ?? null,
    latestBodyFatRow?.bodyFatSource ?? null,
    bodyFatCalibration,
  )?.pct ?? undefined

  let phaseInfo: { name: string; phaseType: string } | null = null
  if (program && program.phaseMode === 'automatic' && program.sessionsPerCycle && program.sessionsPerCycle >= 1) {
    const [phases, sessionsCount] = await Promise.all([
      repo.listProgramPhases(userId, program.id),
      repo.countSessionsSinceStart(userId, program.id),
    ])
    if (phases.length > 0) {
      const result = getCurrentPhase(phases, program.sessionsPerCycle, sessionsCount)
      phaseInfo = {
        name: result.phase.name,
        phaseType: result.phase.phaseType,
      }
    }
  }

  const ageYears = ageFromDob(user.dateOfBirth, new Date())
  if (ageYears == null) {
    return NextResponse.json({ error: 'profile_incomplete', missing: ['dateOfBirth'] }, { status: 400 })
  }

  // BF-33: a clinically measured resting rate outranks the prediction, re-scaled to today's lean
  // mass rather than trusted-then-expired. Null when no test exists, which is the ordinary case.
  const rmrTest = await repo.getLatestMeasuredRmr(userId)
  const measuredRmr = rmrTest ? { rmrKcal: rmrTest.rmrKcal, ffmKgAtTest: rmrTest.ffmKgAtTest } : null

  const baseline = calculateBaseline({
    weightKg: latestWeight,
    heightCm: user.heightCm!,
    ageYears,
    sex: user.sex!,
    activityLevel: user.activityLevel!,
    fitnessGoal: user.fitnessGoal!,
    bodyFatPct: latestBodyFatPct,
    measuredRmr,
  })

  const suggestedLevel = suggestActivityLevel(user.activityLevel!, workoutSessions.length)

  // The recommendation IS the baseline, recomputed when the sessions logged clearly outgrow the
  // stated activity level; that level reaches the numbers only through the formula.
  const clampBaseline = suggestedLevel
    ? calculateBaseline({
      weightKg: latestWeight,
      heightCm: user.heightCm!,
      ageYears,
      sex: user.sex!,
      activityLevel: suggestedLevel,
      fitnessGoal: user.fitnessGoal!,
      bodyFatPct: latestBodyFatPct,
      measuredRmr,
    })
    : baseline

  const weighIns = bodyMetrics.filter(m => m.weightKg != null).sort((a, b) => a.date.localeCompare(b.date))
  const bfReadings = bodyMetrics.filter(m => m.bodyFatPct != null).sort((a, b) => a.date.localeCompare(b.date))
  const stepsValues = bodyMetrics.filter(m => m.steps != null).map(m => m.steps!)
  const explanation = buildGoalExplanation({
    baseline: clampBaseline,
    measuredRmr: measuredRmr != null,
    fitnessGoal: user.fitnessGoal!,
    activityLevel: user.activityLevel!,
    suggestedLevel,
    workoutSessionCount: workoutSessions.length,
    weightDeltaKg: weighIns.length >= 2 ? weighIns[weighIns.length - 1].weightKg! - weighIns[0].weightKg! : null,
    bodyFatLatestPct: bfReadings.length > 0 ? bfReadings[bfReadings.length - 1].bodyFatPct! : null,
    bodyFatDeltaPp: bfReadings.length >= 2 ? bfReadings[bfReadings.length - 1].bodyFatPct! - bfReadings[0].bodyFatPct! : null,
    avgSteps: stepsValues.length > 0 ? stepsValues.reduce((a, b) => a + b, 0) / stepsValues.length : null,
    daysWithData: new Set(bodyMetrics.map(m => m.date)).size,
    personalRecordCount: personalRecords.length,
    phase: phaseInfo ? { name: phaseInfo.name, phaseType: phaseInfo.phaseType } : null,
  })

  // `clampRecommendation` stays: `CALORIE_ADJUSTMENT_BY_GOAL` subtracts 500 for `lose_weight`, and
  // on a small enough BMR that can put the baseline's own calorie figure under the `max(1200, bmr)`
  // floor. It is a no-op on a safe baseline, and says so in `dataQualityNote` when it is not.
  const clamped = clampRecommendation({
    recommendedStepsGoal: clampBaseline.stepsGoal,
    recommendedCalories: clampBaseline.calories,
    recommendedProteinG: clampBaseline.proteinG,
    recommendedCarbsG: clampBaseline.carbsG,
    recommendedFatG: clampBaseline.fatG,
    recommendedWaterMl: clampBaseline.waterMl,
    recommendedActivityLevel: suggestedLevel,
    dataQualityNote: explanation.dataQualityNote,
  }, clampBaseline, latestWeight)

  let rec: { id: string }
  try {
    rec = await repo.createGoalRecommendation(userId, {
      source,
      recommendedStepsGoal: clamped.recommendedStepsGoal,
      recommendedCalories: clamped.recommendedCalories,
      recommendedProteinG: clamped.recommendedProteinG,
      recommendedCarbsG: clamped.recommendedCarbsG,
      recommendedFatG: clamped.recommendedFatG,
      recommendedWaterMl: clamped.recommendedWaterMl,
      recommendedActivityLevel: clamped.recommendedActivityLevel,
      reasoning: explanation.reasoning,
      insights: explanation.insights,
      dataQualityNote: clamped.dataQualityNote,
    })
  } catch {
    // No row is persisted when the write fails, so report that rather than a raw 500.
    return NextResponse.json({ error: 'recommendation_failed' }, { status: 500 })
  }

  return NextResponse.json({
    id: rec.id,
    current: {
      stepsGoal: userGoals.stepsGoal,
      stepsGoalType: userGoals.stepsGoalType,
      calorieGoal: userGoals.calorieGoal ?? nutritionTargets?.calories ?? null,
      calorieGoalType: userGoals.calorieGoalType,
      waterGoalMl: userGoals.waterGoalMl,
      waterGoalType: userGoals.waterGoalType,
      proteinG: nutritionTargets?.proteinG ?? null,
      carbsG: nutritionTargets?.carbsG ?? null,
      fatG: nutritionTargets?.fatG ?? null,
      activityLevel: user.activityLevel,
    },
    recommended: {
      stepsGoal: clamped.recommendedStepsGoal,
      calories: clamped.recommendedCalories,
      proteinG: clamped.recommendedProteinG,
      carbsG: clamped.recommendedCarbsG,
      fatG: clamped.recommendedFatG,
      waterMl: clamped.recommendedWaterMl,
      activityLevel: clamped.recommendedActivityLevel,
    },
    reasoning: explanation.reasoning,
    insights: explanation.insights,
    dataQualityNote: clamped.dataQualityNote,
  })
}
