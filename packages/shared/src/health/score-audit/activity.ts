import { computeActivityScore, volumeTargetKg, ACTIVITY_MODEL } from '@trainingai/shared/health/activity-score'
import { scoreBand } from '@trainingai/shared/health/score-band'
import { moveHoursGoal } from '@trainingai/shared/health/hourly-movement'
import type { DailyGoals } from '@trainingai/shared/health/daily-goals'
import type { OuraDailyDerivedRow } from '@/lib/data/repository'
import { renormalisedContributors, contributionSum, type ContributorSpec } from './contributors'
import type { PillarAudit } from './types'

export interface ActivityAuditInput {
  date: string
  goals: DailyGoals
  goalProfile: Record<string, unknown>
  steps: number | null
  activeCalories: number | null
  /** Minutes in zone 2+ (vigorous double-counted), or null when no HR series was derivable. */
  zoneMinutes: number | null
  moveHours: number | null
  /** Whether a strength session was logged on this day — with zero zone minutes, that combination
   *  excludes the zone-minutes lane rather than scoring it 0 (Q-183). */
  strengthSessionToday?: boolean
  sessions7d: number
  volume7dKg: number
  typicalSessionVolumeKg: number
  acwr: number | null
  acwrExcludedReason: string | null
  derived: OuraDailyDerivedRow | null
}

export function buildActivityAudit(input: ActivityAuditInput): PillarAudit {
  const {
    date, goals, goalProfile, steps, activeCalories, zoneMinutes, moveHours, strengthSessionToday,
    sessions7d, volume7dKg, typicalSessionVolumeKg, acwr, acwrExcludedReason, derived,
  } = input
  const zoneMinutesStructuralZero = zoneMinutes === 0 && !!strengthSessionToday

  const gaps: string[] = []
  const notes: string[] = []

  const hoursGoal = moveHours != null ? moveHoursGoal() : null
  const result = computeActivityScore({
    steps, activeCalories, zoneMinutes, moveHours, moveHoursGoal: hoursGoal, strengthSessionToday,
    sessions7d, volume7dKg, typicalSessionVolumeKg, goals, acwr,
  })
  const components = result?.components ?? null

  if (result == null) gaps.push(`Nothing scoreable for ${date}: no movement data and no training in the prior 7 days.`)
  if (steps == null) gaps.push('No step count for this day — the steps contributor (weight 18) redistributes.')
  if (activeCalories == null) gaps.push('No active-calorie reading — the active-energy contributor (weight 15) redistributes.')
  if (zoneMinutes == null) {
    gaps.push(
      'No zone-minutes: these are derived from the intraday HR series, which needs both HR rows for the day ' +
      'and a mature resting-HR baseline to build zones from. Contributor (weight 10) redistributes.',
    )
  }
  if (moveHours == null) gaps.push('No move-every-hour signal (same intraday-HR dependency). Contributor (weight 12) redistributes.')
  if (sessions7d === 0 && volume7dKg === 0) {
    gaps.push(
      'No strength sessions in the rolling 7-day window — the whole strength lane (weight 45 of 100) is ' +
      'absent, so this score is built purely from daily movement.',
    )
  }
  if (acwr == null && acwrExcludedReason) notes.push(`Over-exertion taper skipped: ${acwrExcludedReason}`)
  if (result?.taperApplied) {
    notes.push(
      `Over-exertion taper applied: goal-completion was ${result.preTaperScore}, displayed ${result.score} ` +
      `(ACWR ${acwr?.toFixed(2)} past the ${ACTIVITY_MODEL.taper.acwrStart} taper start). Readiness reads the ` +
      'PRE-taper score so acute load is not counted twice.',
    )
  }

  const volTarget = volumeTargetKg(goals)  // one formula, one place (Q-190)

  const specs: ContributorSpec[] = [
    {
      key: 'steps',
      label: 'Steps vs goal',
      input: {
        value: steps, unit: 'steps', source: 'body_metrics.steps',
        note: `Goal ${goals.stepGoal}. Linear to 100% completion, then flat.`,
      },
    },
    {
      key: 'activeEnergy',
      label: 'Active energy vs goal',
      input: {
        value: activeCalories, unit: 'kcal', source: 'body_metrics.active_calories',
        note: `Goal ${goals.activeEnergyGoal} kcal (BMR-derived).`,
      },
    },
    {
      key: 'zoneMinutes',
      label: 'Active minutes (zone 2+)',
      input: {
        value: zoneMinutes, unit: 'min', source: 'derived from oura_heartrate intraday series',
        note: `Goal ${goals.zoneMinutesGoal} min. Vigorous minutes count double (WHO convention).`,
      },
      excludedReason: zoneMinutesStructuralZero
        ? 'a strength session was logged and no zone-2+ minutes were recorded — lifting rarely holds 60% HRR, so this is not a missed cardio target and the contributor (weight 10) redistributes'
        : 'no intraday HR series or no resting-HR baseline to derive zones from',
    },
    {
      key: 'moveHours',
      label: 'Move every hour',
      input: {
        value: moveHours, unit: 'h', source: 'derived from oura_heartrate intraday series',
        note: `Goal ${hoursGoal ?? '—'} h. HR-elevation proxy — there is no hourly step data.`,
      },
      excludedReason: 'no intraday HR series or no resting-HR baseline',
    },
    {
      key: 'strengthFreq',
      label: 'Strength frequency (rolling 7d)',
      input: {
        value: sessions7d, unit: 'sessions/7d', source: 'workout_sessions',
        note: `Goal ${goals.strengthFreqGoal}/week. Ratio-based curve, saturates at the goal.`,
      },
      excludedReason: 'no strength sessions in the rolling 7-day window',
    },
    {
      key: 'strengthVolume',
      label: 'Strength volume (rolling 7d)',
      input: {
        value: Math.round(volume7dKg), unit: 'kg', source: 'workout_sessions → exercise volume',
        note: `Target ${Math.round(volTarget)} kg = session goal ${Math.round(goals.sessionVolumeGoalKg)} kg × ${goals.strengthFreqGoal} sessions.`,
      },
      excludedReason: 'no strength sessions in the rolling 7-day window',
    },
  ]

  const contributors = renormalisedContributors(specs, components, ACTIVITY_MODEL.weights)
  const storedScore = derived?.activityScore ?? null

  return {
    pillar: 'activity',
    label: 'Activity',
    score: result?.score ?? null,
    band: result ? scoreBand(result.score).label : null,
    source: result ? 'own-model (computeActivityScore, goal-anchored v2)' : 'no-data',
    model: ACTIVITY_MODEL,
    inputs: {
      steps: { value: steps, unit: 'steps', source: 'body_metrics.steps' },
      stepGoal: { value: goals.stepGoal, unit: 'steps' },
      activeCalories: { value: activeCalories, unit: 'kcal', source: 'body_metrics.active_calories' },
      activeEnergyGoal: { value: goals.activeEnergyGoal, unit: 'kcal' },
      zoneMinutes: { value: zoneMinutes, unit: 'min' },
      zoneMinutesGoal: { value: goals.zoneMinutesGoal, unit: 'min' },
      moveHours: { value: moveHours, unit: 'h' },
      moveHoursGoal: { value: hoursGoal, unit: 'h' },
      sessions7d: { value: sessions7d, unit: 'sessions' },
      strengthFreqGoal: { value: goals.strengthFreqGoal, unit: 'sessions/week' },
      sessionVolumeGoalKg: { value: goals.sessionVolumeGoalKg, unit: 'kg/session', note: 'Absolute per-session target (Q-190) — deliberately NOT the median of your own sessions.' },
      volume7dKg: { value: Math.round(volume7dKg), unit: 'kg' },
      typicalSessionVolumeKg: { value: Math.round(typicalSessionVolumeKg), unit: 'kg', note: 'Median single-session tonnage — the volume-lane denominator.' },
      acwr: { value: acwr != null ? Math.round(acwr * 100) / 100 : null, note: acwrExcludedReason ?? 'Acute:chronic workload ratio driving the over-exertion taper.' },
      preTaperScore: { value: result?.preTaperScore ?? null, note: 'Goal-completion score before the taper — this is what readiness reads.' },
      taperApplied: { value: result?.taperApplied ?? false },
      contributionSum: {
        value: contributionSum(contributors),
        note: 'Contributions rebuilt from the rounded sub-scores, summing to the PRE-taper score. '
          + 'Within 1 is expected rounding; a wider gap would mean a contributor is unaccounted for.',
      },
      goalProfile: { value: JSON.stringify(goalProfile), source: 'users profile → getDailyGoals', note: 'The profile fields the goals above were derived from.' },
    },
    contributors,
    gaps,
    stored: {
      score: storedScore,
      contributors: derived?.activityContributors ?? null,
      source: derived?.source ?? null,
    },
    storedMatchesRecompute: storedScore != null && result != null ? storedScore === result.score : null,
    notes,
  }
}
