import type { NextSessionRecommendation } from '@trainingai/shared/types/program'
import { cutFor } from '@trainingai/shared/health/readiness-decision-thresholds'
import { READINESS_MODEL_VERSION } from '@trainingai/shared/health/readiness-composite'

// Why the daily check (`computeAiDynamicNextSession`) suggests rest or a lighter day, in words. Both
// apps read this: the current app's banner and "Why this recommendation?" panel, and Preview's strip
// and card (#3644). Rest today is this check's call alone; the stored AI plan never makes it (#3718).

export type DeloadStrength = NonNullable<NextSessionRecommendation['deloadStrength']>

/** The fields of the daily check's answer that the words read. Preview parses only these. */
export type DeloadReasonInput = Pick<
  NextSessionRecommendation,
  'deloadOrRestRecommended' | 'deloadStrength' | 'temperatureAlert' | 'consecutiveTrainingDays'
  | 'consecutiveRestDays' | 'streakBroken'
> & {
  signals?: Partial<Pick<NonNullable<NextSessionRecommendation['signals']>,
    'ouraReadiness' | 'ouraReadinessModelVersion' | 'energyLevel' | 'temperatureDeviation'
    | 'temperatureBaselineDays' | 'temperatureAlertThresholdC'>> | null
}

export type DeloadReasonKind = 'temperature' | 'readiness' | 'streak' | 'energy'

export interface DeloadReason {
  kind: DeloadReasonKind
  text: string
}

/**
 * The plain-English list of why recovery is suggested. Each line is backed by an input the check
 * reads. There is no soreness line (#3804): sore ticks change which session is picked, not whether
 * to ease off, and the check-in pre-ticks recently trained muscles. There is no HRV or sleep-trend
 * line either (#3837): `hrvWarning` is computed after the decision and only returned, and the sleep
 * trend only shifts the session-scoring weights.
 */
export function deloadReasons(rec: DeloadReasonInput): DeloadReason[] {
  const out: DeloadReason[] = []
  const s = rec.signals

  if (rec.temperatureAlert) {
    const dev = s?.temperatureDeviation
    const threshold = s?.temperatureAlertThresholdC
    const nights = s?.temperatureBaselineDays
    const text = dev != null && threshold != null
      ? `+${dev.toFixed(1)}°C above your baseline (threshold ${threshold.toFixed(1)}°C)${nights != null ? ` — based on ${nights} nights of history.` : '.'} Often an early sign of illness, incomplete recovery, or heat/alcohol stress.`
      : 'Body temperature is above your baseline — often an early sign of illness, incomplete recovery, or heat/alcohol stress.'
    out.push({ kind: 'temperature', text })
  }
  // #3824: graded on the score's own scale, the same cut the deload decision used. A response from
  // before the version rode along is from the current server, so it is on the current scale.
  const softMin = cutFor('deloadSoft', s?.ouraReadinessModelVersion === undefined ? READINESS_MODEL_VERSION : s.ouraReadinessModelVersion)
  if (s?.ouraReadiness != null && s.ouraReadiness < softMin) {
    out.push({
      kind: 'readiness',
      text: `Readiness ${Math.round(s.ouraReadiness)} — below the ${softMin}+ range where hard training is well tolerated.`,
    })
  }
  if (rec.consecutiveTrainingDays != null && rec.consecutiveTrainingDays >= 3) {
    out.push({
      kind: 'streak',
      text: `${rec.consecutiveTrainingDays} training days in a row without a rest day — fatigue accumulates faster than it clears.`,
    })
  }
  if (s?.energyLevel === 'drained' || s?.energyLevel === 'low') {
    out.push({
      kind: 'energy',
      text: `You checked in feeling ${s.energyLevel === 'drained' ? 'drained' : 'low on energy'} this morning.`,
    })
  }
  return out
}

export const DELOAD_STRENGTH_HEADLINE: Record<DeloadStrength, string> = {
  soft: 'A light nudge to ease off — your call.',
  recommended: 'Recovery is recommended today.',
  strong: 'Strong signal to back off today.',
}

/** Whether the one-line strip over today's card shows: a raised temperature, or a suggested
 *  rest after four or more training days in a row. */
export function showsDeloadBanner(rec: DeloadReasonInput | null | undefined): boolean {
  if (!rec) return false
  return !!((rec.deloadOrRestRecommended && (rec.consecutiveTrainingDays ?? 0) >= 4) || rec.temperatureAlert)
}

/** The strip's one line. */
export function deloadBannerMessage(rec: DeloadReasonInput): string {
  const strength = rec.deloadStrength ?? 'soft'
  if (rec.temperatureAlert) return 'Body temp elevated — rest or deload recommended'
  if (rec.streakBroken) return `${rec.consecutiveRestDays ?? 0} rest days — resting today breaks your streak`
  const suffix = strength === 'soft' ? ' — consider a rest soon' : ' — rest or deload recommended today'
  return `${rec.consecutiveTrainingDays ?? 0} sessions in a row${suffix}`
}

/** The short cause under a suggested rest, beside the two choices. None for a soft nudge, and none
 *  when neither a raised temperature nor a streak is behind it: a drained or sick check-in with no
 *  streak used to read "0 sessions in a row" here. */
export function deloadCauseLine(rec: DeloadReasonInput): string | null {
  if (!rec.deloadOrRestRecommended || rec.deloadStrength === 'soft') return null
  if (rec.temperatureAlert) return 'Body temp elevated'
  return (rec.consecutiveTrainingDays ?? 0) >= 3 ? `${rec.consecutiveTrainingDays} sessions in a row` : null
}
