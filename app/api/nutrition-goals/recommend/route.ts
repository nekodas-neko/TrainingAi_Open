import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { describePersonalRecord } from '@trainingai/shared/1rm'
import { generateObject } from 'ai'
import { aiModel, loggedGenerateObject } from '@/lib/ai/instrument'
import { z } from 'zod'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ, todayInTz, todayMidnightUtc, toAestDay, ageFromDob } from '@trainingai/shared/date-utils'
import { ACTIVITY_LEVELS } from '@trainingai/shared/types/user'
import { calculateBaseline, clampRecommendation, type BaselineResult } from '@trainingai/shared/nutrition/goal-recommendation'
import { getCurrentPhase } from '@trainingai/shared/phase-engine'
import { nightSessions } from '@trainingai/shared/health/sleep-night'
import type { BodyMetrics, SleepSession, MoodLog } from '@trainingai/shared/types'
import type { NutritionTargets } from '@trainingai/shared/types/nutrition'
import type { UserGoals } from '@/lib/data/repository'
import type { ProgramPhaseType } from '@trainingai/shared/types/program'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { correctBodyFatPct } from '@trainingai/shared/health/body-fat-calibration'

// An optional source marker; the body is normally absent.
const MAX_BODY_BYTES = 4 * 1024

const recommendationSchema = z.object({
  recommendedStepsGoal: z.number(),
  recommendedCalories: z.number(),
  recommendedProteinG: z.number(),
  recommendedCarbsG: z.number(),
  recommendedFatG: z.number(),
  recommendedWaterMl: z.number(),
  recommendedActivityLevel: z.enum(ACTIVITY_LEVELS).nullable(),
  reasoning: z.string(),
  insights: z.string(),
  dataQualityNote: z.string(),
})

interface ContextInput {
  sex: string
  ageYears: number
  heightCm: number
  weightGoalKg?: number
  activityLevel: string
  fitnessGoal: string
  latestWeight: number
  baseline: BaselineResult
  userGoals: UserGoals
  nutritionTargets: NutritionTargets | null
  bodyMetrics: BodyMetrics[]
  sleepSessions: SleepSession[]
  moodLogs: MoodLog[]
  workoutSessionCount: number
  personalRecords: { exerciseName: string; estimated1rm: number; achievedAt: Date }[]
  /** name -> exercise_type, so a bodyweight record isn't quoted as kilograms (Q-19b). */
  exerciseTypes: Record<string, string>
  programName: string | null
  phaseInfo: {
    name: string
    phaseType: ProgramPhaseType
    cycleInPhase: number
    totalPhaseCycles: number
    primaryStyleName?: string
  } | null
}

function buildContext(c: ContextInput, tz: string): string {
  const weighIns = c.bodyMetrics.filter(m => m.weightKg != null).sort((a, b) => a.date.localeCompare(b.date))
  const weightDelta = weighIns.length >= 2
    ? weighIns[weighIns.length - 1].weightKg! - weighIns[0].weightKg!
    : null

  const stepsValues = c.bodyMetrics.filter(m => m.steps != null).map(m => m.steps!)
  const avgSteps = stepsValues.length > 0
    ? Math.round(stepsValues.reduce((a, b) => a + b, 0) / stepsValues.length)
    : null

  const rhrValues = c.bodyMetrics.filter(m => m.restingHeartRate != null).map(m => m.restingHeartRate!)
  const avgRhr = rhrValues.length > 0
    ? Math.round(rhrValues.reduce((a, b) => a + b, 0) / rhrValues.length)
    : null

  const hrvValues = c.bodyMetrics.filter(m => m.hrvMs != null).map(m => m.hrvMs!)
  const avgHrv = hrvValues.length > 0
    ? Math.round(hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length)
    : null

  const daysWithData = new Set(c.bodyMetrics.map(m => m.date)).size

  // Nights, not rows (Q-76) — keying a Map by date lets a same-day nap overwrite the real night, so
  // the model gets told "0.1 h sleep" beside a normal energy rating and learns nothing true.
  const sleepByDate = new Map(nightSessions(c.sleepSessions, tz).map(sess => [sess.date, sess]))
  const sleepMoodPairs = c.moodLogs
    .filter(m => sleepByDate.get(m.logDate)?.durationHours != null)
    .map(m => `${m.logDate}: ${sleepByDate.get(m.logDate)!.durationHours!.toFixed(1)}h sleep, energy=${m.energyLevel}, sleep quality=${m.sleepQuality}`)

  const bfReadings = c.bodyMetrics.filter(m => m.bodyFatPct != null).sort((a, b) => a.date.localeCompare(b.date))
  const latestBf = bfReadings.length > 0 ? bfReadings[bfReadings.length - 1].bodyFatPct! : null
  const bfDelta = bfReadings.length >= 2 ? latestBf! - bfReadings[0].bodyFatPct! : null

  const prLines = c.personalRecords.map(pr =>
    `${describePersonalRecord(pr.exerciseName, pr.estimated1rm, c.exerciseTypes[pr.exerciseName])} on ${toAestDay(pr.achievedAt, tz)}`)

  const programLine = c.programName == null
    ? 'No active training program.'
    : `Active program: "${c.programName}"${c.phaseInfo ? `, currently in phase "${c.phaseInfo.name}" (type: ${c.phaseInfo.phaseType}, cycle ${c.phaseInfo.cycleInPhase}/${c.phaseInfo.totalPhaseCycles}${c.phaseInfo.primaryStyleName ? `, progression style: ${c.phaseInfo.primaryStyleName}` : ''})` : ''}.`

  const lines: (string | null)[] = [
    `Profile: sex=${c.sex}, age=${c.ageYears}, height=${c.heightCm}cm, current weight=${c.latestWeight}kg${c.weightGoalKg ? `, goal weight=${c.weightGoalKg}kg` : ''}.`,
    `Current activity level: ${c.activityLevel}. Fitness goal: ${c.fitnessGoal}.`,
    programLine,
    // LB-50. The activity level used to be named inside this parenthesis, which read as though the
    // TDEE had been computed FOR it. It was not, and has not been since Q-401 deleted
    // `ACTIVITY_MULTIPLIERS`: `calculateBaseline` computes `tdee = bmr * SEDENTARY_MULTIPLIER`
    // unconditionally, so a self-report cannot double-count against the measured movement the model
    // is given separately below. The level still reaches `waterMl` and `stepsGoal`, and nothing
    // else. Telling the model the baseline was activity-scaled invites it to adjust for a
    // multiplier that is not in the number.
    c.baseline.leanMassKg != null
      ? `Baseline (Katch-McArdle, lean mass ${c.baseline.leanMassKg}kg): BMR ${c.baseline.bmr} kcal, TDEE ${c.baseline.tdee} kcal, baseline calorie target ${c.baseline.calories} kcal, protein ${c.baseline.proteinG}g (dosed per kg lean mass), carbs ${c.baseline.carbsG}g, fat ${c.baseline.fatG}g, water ${c.baseline.waterMl}ml, steps goal ${c.baseline.stepsGoal}.`
      : `Baseline (Mifflin-St Jeor): BMR ${c.baseline.bmr} kcal, TDEE ${c.baseline.tdee} kcal, baseline calorie target ${c.baseline.calories} kcal, protein ${c.baseline.proteinG}g, carbs ${c.baseline.carbsG}g, fat ${c.baseline.fatG}g, water ${c.baseline.waterMl}ml, steps goal ${c.baseline.stepsGoal}.`,
    // Said plainly rather than left for the model to infer from the absence above: it is told the
    // activity level on its own line, and it is told the measured steps and active calories, so
    // without this it could still assume the TDEE embeds one of them.
    `The TDEE above is BMR x 1.2 (sedentary) and is NOT scaled by the stated activity level — real movement is given separately as steps and active calories. Do not add an activity multiplier to it; the activity level affects only the water and steps goals.`,
    `Current goals: steps ${c.userGoals.stepsGoal ?? 'unset'} (${c.userGoals.stepsGoalType ?? 'daily'}), calories ${c.userGoals.calorieGoal ?? 'unset'} (${c.userGoals.calorieGoalType ?? 'daily'}), water ${c.userGoals.waterGoalMl ?? 'unset'}ml (${c.userGoals.waterGoalType ?? 'daily'}).`,
    `Current nutrition targets: ${c.nutritionTargets ? `${c.nutritionTargets.calories ?? '—'} kcal, protein ${c.nutritionTargets.proteinG ?? '—'}g, carbs ${c.nutritionTargets.carbsG ?? '—'}g, fat ${c.nutritionTargets.fatG ?? '—'}g` : 'none set'}.`,
    `14-day data completeness: ${daysWithData}/14 days with logged body metrics.`,
    weightDelta != null ? `Weight change over the last 14 days: ${weightDelta >= 0 ? '+' : ''}${weightDelta.toFixed(1)}kg.` : 'Not enough weigh-ins to compute a weight trend.',
    latestBf != null
      ? `Body fat: latest ${latestBf.toFixed(1)}%${bfDelta != null ? ` (change over last 14 days: ${bfDelta >= 0 ? '+' : ''}${bfDelta.toFixed(1)}pp)` : ''}.`
      : 'No body fat % logged.',
    avgSteps != null ? `Average daily steps: ${avgSteps}.` : 'No step data logged.',
    avgRhr != null ? `Average resting heart rate: ${avgRhr} bpm.` : null,
    avgHrv != null ? `Average HRV: ${avgHrv} ms.` : null,
    `Workout sessions in the last 14 days: ${c.workoutSessionCount}.`,
    sleepMoodPairs.length > 0 ? `Sleep/mood data points:\n${sleepMoodPairs.join('\n')}` : 'No paired sleep+mood data in this window.',
    prLines.length > 0 ? `Personal records achieved in this window:\n${prLines.join('\n')}` : 'No new personal records in this window.',
  ]

  return lines.filter((l): l is string => l != null).join('\n')
}

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

  const [bodyMetrics, sleepSessions, moodLogs, workoutSessions, personalRecords, userGoals, nutritionTargets, program] = await Promise.all([
    repo.listBodyMetrics(userId, fromIso, todayIso),
    repo.listSleepSessions(userId, fromIso, todayIso),
    repo.listMoodLogs(userId, fromIso, todayIso),
    repo.getWorkoutSessionsFrom(userId, windowStart),
    repo.listRecentPersonalRecords(userId, windowStart, new Date()),
    repo.getUserGoals(userId),
    repo.getNutritionTargets(userId),
    repo.getActiveProgram(userId),
  ])
  const exerciseTypes = await repo
    .getExerciseTypes(personalRecords.map(pr => pr.exerciseName))
    .catch(() => ({} as Record<string, string>))

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

  let phaseInfo: ContextInput['phaseInfo'] = null
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
        cycleInPhase: result.cycleInPhase,
        totalPhaseCycles: result.totalPhaseCycles,
        primaryStyleName: result.phase.primaryStyleName,
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

  const context = buildContext({
    sex: user.sex!,
    ageYears,
    heightCm: user.heightCm!,
    weightGoalKg: user.weightGoalKg,
    activityLevel: user.activityLevel!,
    fitnessGoal: user.fitnessGoal!,
    latestWeight,
    baseline,
    userGoals,
    nutritionTargets,
    bodyMetrics,
    sleepSessions,
    moodLogs,
    workoutSessionCount: workoutSessions.length,
    personalRecords,
    exerciseTypes,
    programName: program?.name ?? null,
    phaseInfo,
  }, tz)

  let ai: z.infer<typeof recommendationSchema>
  let clamped: ReturnType<typeof clampRecommendation>
  let rec: { id: string }
  try {
    // F7: route the retry policy through the shared helper (maxRetries: 0 on the SDK
    // call) like every other AI route — one place for backoff + reportServerError,
    // instead of the SDK's default retry that also skips observability.
    const result = await loggedGenerateObject(
      { section: 'nutrition-goals-recommend', userId, fingerprint: context },
      () => generateObject({
      model: aiModel(),
      schema: recommendationSchema,
      maxRetries: 0,
      prompt: `You are a sports nutrition and training coach. Based on the data below, recommend DAILY targets for steps, calories, protein, carbs, fat, and water.

${context}

Instructions:
- Stay close to the baseline numbers; only deviate meaningfully when the trend data justifies it, and explain why in "reasoning".
- Only suggest a different "recommendedActivityLevel" if the logged workout frequency clearly doesn't match the current activity level (e.g. 4+ sessions/week while set to "sedentary" or "light"). Otherwise set it to null. If you do suggest a change, base all the other numbers on the new activity level's TDEE, not the current one.
- "insights": look for sleep-duration vs mood/energy patterns and mention any personal records achieved in this window. If body fat % data is available, factor it alongside the weight trend (e.g. weight stable but body fat dropping suggests recomposition). If there's too little data (fewer than 3 days logged), say so explicitly instead of guessing — do not fabricate trends.
- If the active program is currently in a "deload" or "testing" phase, expect reduced training volume, intensity, and possibly step counts — do not interpret this as a declining trend or sign of reduced effort.
- Program phase can inform your numeric suggestions within reason: e.g. a "peak" or high-volume phase may justify a modest increase to calories/protein/steps over baseline, while a "deload" phase may justify holding steady or a slight reduction. Mention this reasoning explicitly when it influences a number.
- "dataQualityNote": briefly note if the recommendation is baseline-only due to sparse data, otherwise return an empty string.
- All step/calorie/water values must be DAILY figures, not weekly.`,
    }))
    ai = result.object

    let clampBaseline = baseline
    if (ai.recommendedActivityLevel && ai.recommendedActivityLevel !== user.activityLevel) {
      clampBaseline = calculateBaseline({
        weightKg: latestWeight,
        heightCm: user.heightCm!,
        ageYears,
        sex: user.sex!,
        activityLevel: ai.recommendedActivityLevel,
        fitnessGoal: user.fitnessGoal!,
        bodyFatPct: latestBodyFatPct,
        measuredRmr,
      })
    }

    clamped = clampRecommendation(ai, clampBaseline, latestWeight)

    rec = await repo.createGoalRecommendation(userId, {
      source,
      recommendedStepsGoal: clamped.recommendedStepsGoal,
      recommendedCalories: clamped.recommendedCalories,
      recommendedProteinG: clamped.recommendedProteinG,
      recommendedCarbsG: clamped.recommendedCarbsG,
      recommendedFatG: clamped.recommendedFatG,
      recommendedWaterMl: clamped.recommendedWaterMl,
      recommendedActivityLevel: clamped.recommendedActivityLevel,
      reasoning: ai.reasoning,
      insights: ai.insights,
      dataQualityNote: clamped.dataQualityNote,
    })
  } catch {
    // Covers NoObjectGeneratedError (Gemini output failed schema validation) and any
    // DB error from createGoalRecommendation — no row is persisted and the rate-limit
    // slot is still consumed, so report failure clearly rather than throwing a raw 500.
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
    reasoning: ai.reasoning,
    insights: ai.insights,
    dataQualityNote: clamped.dataQualityNote,
  })
}
