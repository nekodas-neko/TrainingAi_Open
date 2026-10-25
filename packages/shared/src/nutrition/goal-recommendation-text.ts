// The goal recommendation's explanation, written from the numbers rather than asked for (#3286).
//
// `/api/nutrition-goals/recommend` used to call a model for two things: one category (does the
// stated activity level still match how often the user trains?) and the prose explaining a baseline
// that `calculateBaseline` had already computed. RV-66 took every number away from the model; this
// takes the rest. Nothing here states a figure the baseline did not produce, and there is no trend
// claim the inputs cannot support: the old prompt's sleep-versus-mood pattern hunting is gone,
// because a pattern from a handful of paired days is exactly what a template should not assert.

import type { ActivityLevel, FitnessGoal } from '../types/user'
import type { BaselineResult } from './goal-recommendation'

/** Days of history the recommendation reads. The route and the rule below share it. */
export const RECOMMENDATION_WINDOW_DAYS = 14

/** Sessions a week at which "sedentary" or "light" no longer describes how the user trains. */
export const ACTIVE_SESSIONS_PER_WEEK = 4

/**
 * The one judgement the model made: a different activity level, or null to keep the stated one.
 * Only ever an upgrade, and only on a clear mismatch (the old prompt's own example: 4+ sessions a
 * week while set to sedentary or light). It moves to `moderate`, not past it: the level reaches only
 * the water and steps goals, and one step is the smallest change that stops contradicting the log.
 */
export function suggestActivityLevel(
  current: ActivityLevel,
  sessionsInWindow: number,
  windowDays: number = RECOMMENDATION_WINDOW_DAYS,
): ActivityLevel | null {
  const perWeek = sessionsInWindow / (windowDays / 7)
  if (perWeek >= ACTIVE_SESSIONS_PER_WEEK && (current === 'sedentary' || current === 'light')) return 'moderate'
  return null
}

export interface GoalExplanationInput {
  baseline: BaselineResult
  /** Whether a clinically measured resting rate fed the baseline. */
  measuredRmr: boolean
  fitnessGoal: FitnessGoal
  /** The level the user stated. */
  activityLevel: ActivityLevel
  /** The level `suggestActivityLevel` returned, if any. */
  suggestedLevel: ActivityLevel | null
  workoutSessionCount: number
  weightDeltaKg: number | null
  bodyFatLatestPct: number | null
  bodyFatDeltaPp: number | null
  avgSteps: number | null
  daysWithData: number
  personalRecordCount: number
  /** The active program's phase, when there is one. */
  phase: { name: string; phaseType: string } | null
}

export interface GoalExplanation {
  reasoning: string
  insights: string
  dataQualityNote: string
}

const GOAL_LABEL: Record<FitnessGoal, string> = {
  lose_weight: 'losing weight',
  maintain: 'maintaining weight',
  build_muscle: 'building muscle',
  recomp: 'body recomposition',
}

const LEVEL_LABEL: Record<ActivityLevel, string> = {
  sedentary: 'sedentary', light: 'lightly active', moderate: 'moderately active', active: 'active', extra_active: 'extra active',
}

const n0 = (n: number) => Math.round(n).toLocaleString('en-US')
const signed = (n: number, digits = 1) => `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`

export function buildGoalExplanation(i: GoalExplanationInput): GoalExplanation {
  const b = i.baseline

  const method = i.measuredRmr
    ? 'your measured resting rate, re-scaled to your current lean mass'
    : b.leanMassKg != null
      ? `the Katch-McArdle formula on ${b.leanMassKg} kg of lean mass`
      : 'the Mifflin-St Jeor formula'
  const reasoning: string[] = [
    `Your targets start from ${method}: a resting rate of ${n0(b.bmr)} kcal and a daily burn of ${n0(b.tdee)} kcal (resting rate x 1.2, with real movement counted separately rather than scaled in).`,
    `For ${GOAL_LABEL[i.fitnessGoal]} that gives ${n0(b.calories)} kcal, ${n0(b.proteinG)} g protein, ${n0(b.carbsG)} g carbs and ${n0(b.fatG)} g fat, plus ${n0(b.waterMl)} ml of water and ${n0(b.stepsGoal)} steps.`,
  ]

  if (i.weightDeltaKg != null) {
    let trend = `Over the last ${RECOMMENDATION_WINDOW_DAYS} days your weight changed ${signed(i.weightDeltaKg)} kg`
    if (i.bodyFatLatestPct != null) {
      trend += i.bodyFatDeltaPp != null
        ? ` and body fat is ${i.bodyFatLatestPct.toFixed(1)}% (${signed(i.bodyFatDeltaPp)} pp)`
        : ` and body fat is ${i.bodyFatLatestPct.toFixed(1)}%`
    }
    reasoning.push(`${trend}.`)
  }

  if (i.suggestedLevel) {
    const perWeek = i.workoutSessionCount / (RECOMMENDATION_WINDOW_DAYS / 7)
    reasoning.push(
      `You logged ${i.workoutSessionCount} sessions in ${RECOMMENDATION_WINDOW_DAYS} days (about ${perWeek.toFixed(1)} a week), which fits ${LEVEL_LABEL[i.suggestedLevel]} better than ${LEVEL_LABEL[i.activityLevel]}, so the water and steps goals use ${LEVEL_LABEL[i.suggestedLevel]}.`,
    )
  }

  if (i.phase && (i.phase.phaseType === 'deload' || i.phase.phaseType === 'testing')) {
    reasoning.push(`The ${i.phase.name} phase is a ${i.phase.phaseType} phase, so lower training output in this window is expected and does not change the targets.`)
  }

  const insights: string[] = [
    `${i.workoutSessionCount} workout session${i.workoutSessionCount === 1 ? '' : 's'} in the last ${RECOMMENDATION_WINDOW_DAYS} days.`,
  ]
  if (i.avgSteps != null) insights.push(`Average daily steps: ${n0(i.avgSteps)}.`)
  if (i.personalRecordCount > 0) {
    insights.push(`${i.personalRecordCount} new personal record${i.personalRecordCount === 1 ? '' : 's'} in this window.`)
  }

  const dataQualityNote = i.daysWithData < 3
    ? `Only ${i.daysWithData} of the last ${RECOMMENDATION_WINDOW_DAYS} days have logged body metrics, so the trend above is thin.`
    : ''

  return { reasoning: reasoning.join(' '), insights: insights.join(' '), dataQualityNote }
}
