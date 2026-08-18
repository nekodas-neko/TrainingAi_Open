export type RestDayBand = 'recovered' | 'partial' | 'rest'

export interface RestDayGuidanceInput {
  readinessScore: number | null
  soreMuscles: string[]
  sleepScore: number | null
  consecutiveRestDays: number | null | undefined
}

export interface RestDayGuidance {
  band: RestDayBand
  title: string
  body: string
  suggestions: string[]
  lowConfidence: boolean
}

// Re-anchored 60 -> 42 on 2026-08-17, alongside the Sleep Score recalibration in
// `sleep-score.ts` (SCORE_CALIBRATION). This threshold is NOT an independent judgement about what
// counts as a poor night — it was tuned against the old, compressed score, where it fired on
// 4 of the owner's 65 nights (6%). Recalibration widened the scale without changing how often the
// owner actually sleeps badly, so leaving it at 60 would have fired on 17 of 65 (26%) and made the
// guidance nag about sleep three times as often for no physiological reason. 42 restores 5/65 (8%).
//
// The rule this encodes, for the next person who moves a score's range: a threshold written on the
// display scale is calibrated to that scale's distribution. Re-anchor every one of them in the same
// PR as the recalibration, preserving the firing RATE, or the range change silently ships a
// behaviour change nobody asked for.
const LOW_SLEEP_SCORE = 42
const MANY_CONSECUTIVE_REST_DAYS = 3

export function restDayGuidance({
  readinessScore, soreMuscles, sleepScore, consecutiveRestDays,
}: RestDayGuidanceInput): RestDayGuidance {
  if (readinessScore == null) {
    return {
      band: 'partial',
      title: 'Partial recovery',
      body: 'No readiness data yet today — take it easy and listen to your body.',
      suggestions: ['Easy walk', 'Light mobility work'],
      lowConfidence: true,
    }
  }

  const hasSoreness = soreMuscles.length > 0

  if (readinessScore >= 75 && !hasSoreness) {
    return {
      band: 'recovered',
      title: 'Recovered',
      body: 'Your body is ready — an optional light session can help without digging into recovery.',
      suggestions: ['Zone-2 cardio (30–45 min)', 'Mobility work'],
      lowConfidence: false,
    }
  }

  if (readinessScore < 60) {
    const suggestions = ['Prioritize sleep tonight']
    if (sleepScore != null && sleepScore < LOW_SLEEP_SCORE) {
      suggestions.push("Last night's sleep score was low — an earlier bedtime will help more than training today")
    }
    return {
      band: 'rest',
      title: 'Rest fully',
      body: 'Readiness is low — prioritize recovery today rather than adding more load.',
      suggestions,
      lowConfidence: false,
    }
  }

  // 60-74, or >=75 with localized soreness.
  const suggestions = ['Easy walk', hasSoreness ? `Light mobility work for ${soreMuscles.join(', ')}` : 'Light mobility work']
  if (consecutiveRestDays != null && consecutiveRestDays >= MANY_CONSECUTIVE_REST_DAYS) {
    suggestions.push("You've had several rest days in a row — a short walk today can help maintain momentum")
  }
  return {
    band: 'partial',
    title: 'Partial recovery',
    body: hasSoreness
      ? `Some soreness in ${soreMuscles.join(', ')} — ease in rather than pushing through it.`
      : "Readiness is moderate — an easy session is fine, but don't push intensity.",
    suggestions,
    lowConfidence: false,
  }
}
