// The daily check's rest-or-deload decision (#3718): one pure function of plain inputs, so Home, the
// pre-workout screen and a replay over past days (`scripts/tuning/rest-signals-replay.cjs`) all
// get the same answer. `computeAiDynamicNextSession` calls it with today's inputs.
//
// Import-light on purpose (thresholds and types only): the replay bundles it, and nothing here may
// pull `ai-dynamic`'s ONNX chain (Q-221).
//
// **The three rest signals are the AI prescription prompt's rest-day rule** (`prompt.ts`), on the
// same inputs and the same cuts, so the two engines cannot disagree while both exist:
//
//   prompt: external_readiness < PROMPT_REST_DAY_READINESS_BELOW   →  'readinessVeryLow'
//   prompt: sleep_score_trend (else sleep_trend) < 0.75 AND hrv_trend < 0.75  →  'sleepAndHrvLow'
//   prompt: spo2_trend < 0.97                                       →  'spo2Low'
//
// The prompt's other clauses (illness radar elevated or fever, fever-level temperature) were already
// here as the illness and temperature arms below.
import type { IllnessFlag } from '@trainingai/shared/health/illness-radar'
import type { NextSessionRecommendation } from '@trainingai/shared/types/program'
import type { TrendReading } from '@trainingai/shared/health/sleep-trend'
import {
  REST_DAY_SLEEP_TREND_BELOW, REST_DAY_HRV_TREND_BELOW, REST_DAY_SPO2_TREND_BELOW, cutFor, readinessCutFires,
} from '@trainingai/shared/health/readiness-decision-thresholds'
import { TEMP_BASELINE_MIN_DAYS, TEMP_ALERT_THRESHOLD_C } from './deload-constants'

export type DeloadStrengthGrade = 'soft' | 'recommended' | 'strong'

/** A rest signal the daily check reads from the AI rule (#3718). */
export type RestSignalKind = NonNullable<NextSessionRecommendation['restSignals']>[number]

export const REST_SIGNAL_KINDS: readonly RestSignalKind[] = ['readinessVeryLow', 'sleepAndHrvLow', 'spo2Low']

export interface RestSignalInput {
  /** The local day being decided (`todayInTz`). A trend counts only when its newest night is this day. */
  today: string
  /** Today's readiness (`liveReadinessReadingForDay(today, …)`), or null when today has none. */
  readinessScore: number | null
  readinessModelVersion: string | null
  /** The sleep trend the AI rule reads: our sleep-score trend, else the duration trend (`restRuleSleepTrend`). */
  sleepTrend: TrendReading | null
  hrvTrend: TrendReading | null
  /** Null for a user whose devices send no blood oxygen, so the signal never fires for them. */
  spo2Trend: TrendReading | null
}

/** The prompt's sleep input: `sleep_score_trend`, or `sleep_trend` when the quality trend is not given. */
export function restRuleSleepTrend(scoreTrend: TrendReading | null, durationTrend: TrendReading | null): TrendReading | null {
  return scoreTrend ?? durationTrend
}

/** A trend that is present and whose recent nights end last night. A stale or missing one is no signal. */
function freshRatio(t: TrendReading | null, today: string): number | null {
  return t != null && t.newestDate === today && Number.isFinite(t.ratio) ? t.ratio : null
}

/** Which of the three rest signals fire today. Missing or stale input never fires one. */
export function restSignals(input: RestSignalInput): RestSignalKind[] {
  const out: RestSignalKind[] = []
  // #3824: the cut for the score's own scale, as the prompt states it (`externalReadinessScaleNote`).
  if (input.readinessScore != null && readinessCutFires('promptRestDay', input.readinessScore, input.readinessModelVersion)) {
    out.push('readinessVeryLow')
  }
  const sleep = freshRatio(input.sleepTrend, input.today)
  const hrv = freshRatio(input.hrvTrend, input.today)
  if (sleep != null && hrv != null && sleep < REST_DAY_SLEEP_TREND_BELOW && hrv < REST_DAY_HRV_TREND_BELOW) {
    out.push('sleepAndHrvLow')
  }
  const spo2 = freshRatio(input.spo2Trend, input.today)
  if (spo2 != null && spo2 < REST_DAY_SPO2_TREND_BELOW) out.push('spo2Low')
  return out
}

export interface DailyRestInput extends RestSignalInput {
  consecutiveTrainingDays: number
  temperatureDeviation: number | null
  /** Nights of temperature baseline; under `TEMP_BASELINE_MIN_DAYS` the temperature arm stays off. */
  temperatureBaselineDays: number
  /** TN-18: whether the temperature baseline is centred. Not trusted ⇒ the temperature arm stays off. */
  temperatureTrusted: boolean
  illnessFlag: IllnessFlag | null
  selfReportedSick: boolean
  energyLevel: string | null
}

export interface DailyRestDecision {
  recommended: boolean
  strength: DeloadStrengthGrade
  temperatureAlert: boolean
  /** The AI-rule signals that fired, in `REST_SIGNAL_KINDS` order, whether or not another reason also did. */
  restSignals: RestSignalKind[]
}

const GRADE: Record<DeloadStrengthGrade, number> = { soft: 0, recommended: 1, strong: 2 }
const atLeast = (a: DeloadStrengthGrade, b: DeloadStrengthGrade): DeloadStrengthGrade => GRADE[a] >= GRADE[b] ? a : b

/**
 * The grade before the rest signals, sick and energy: fever, a trusted raised temperature, the
 * illness radar, then three or more training days graded by readiness. Moved unchanged from
 * `computeDeloadStrength` in `ai-dynamic.ts` (#3718).
 */
function baseGrade(input: DailyRestInput): { recommended: boolean; strength: DeloadStrengthGrade; temperatureAlert: boolean } {
  // Fever overrides everything — the strongest "don't train hard" signal we have.
  // temperatureAlert stays tied to the temperature-deviation field (its own UI copy).
  if (input.illnessFlag === 'fever') return { recommended: true, strength: 'strong', temperatureAlert: false }
  // Only trust an elevated temperature once the baseline is mature enough to define "normal" AND
  // centred enough for the deviation to mean anything (TN-18).
  //
  // The maturity count alone was never sufficient and the owner's screenshot showed why: on
  // 2026-08-31 the stored deviation was 0.519 °C — over the 0.5 threshold, so this banner said
  // "Body temp elevated — rest or deload recommended" — while readiness scored temperature
  // **80/100** on the same night, because its baseline sd is 12x too wide. Two paths, one broken
  // baseline, opposite verdicts, same frame.
  //
  // TN-6a shipped the suspension and said it "must cover all three consumers"; it covered one, and
  // it was the readiness ladder — the path the owner does not read. This is the path behind the
  // report that started it: *"its often triggering deload days. its not trustable yet."*
  //
  // **Do NOT fix this by raising TEMP_ALERT_THRESHOLD_C.** That is the Q-504 mistake and would be
  // the fourth "the threshold is right, the input is wrong" in this pillar. The condition is
  // computed, not a TODO, so it lifts on its own once a re-derivation centres the deviations.
  const tempAlert = input.temperatureTrusted
    && input.temperatureDeviation != null && input.temperatureDeviation > TEMP_ALERT_THRESHOLD_C
    && input.temperatureBaselineDays >= TEMP_BASELINE_MIN_DAYS
  // TN-34: the derived arm is UNWIRED (owner-approved 2026-09-10, *"yes lets do all that"*).
  // `stressHighMinutes >= STRESS_HIGH_DAY_THRESHOLD_MIN` recommended a deload on **83% of the
  // owner's days** (15 of 18 recomputed; 7 of 10 on stored values since the 2026-08-31 fix). A flag
  // that fires four days in five carries no information, and the input is the number TN-33 measured
  // as carrying none: the daily scalar is 57% NIGHT buckets, night runs systematically positive
  // (+0.266 against the day's −0.405), and its correlation with readiness is +0.072 over 18 days
  // with the two halves pointing opposite ways.
  //
  // **Do NOT restore this by raising STRESS_HIGH_DAY_THRESHOLD_MIN.** That is the mistake the
  // TEMP_ALERT_THRESHOLD_C comment above warns about — it would be the fifth "the threshold is
  // right, the input is wrong" in this pillar. The threshold is a documented ~2 h judgement; the
  // input is a sleep-weighted average wearing a daytime label. Re-wire it when TN-33's level-2 test
  // passes, ideally against this user's own distribution (a percentile, not a constant).
  //
  // A `day_summary === 'very_stressful'` arm used to sit here. Oura's enum has no such value and
  // nothing writes the column it read, so it could never fire; it was removed with #3000.
  if (tempAlert || input.illnessFlag === 'elevated') {
    return { recommended: true, strength: 'recommended', temperatureAlert: tempAlert }
  }
  if (input.consecutiveTrainingDays < 3) return { recommended: false, strength: 'soft', temperatureAlert: false }
  // #3824: both grades are chosen for the score's own scale (70/50 before #3778, 76/56 after).
  const score = input.readinessScore
  if (score == null || score >= cutFor('deloadSoft', input.readinessModelVersion)) return { recommended: true, strength: 'soft', temperatureAlert: false }
  if (score >= cutFor('deloadRecommended', input.readinessModelVersion)) return { recommended: true, strength: 'recommended', temperatureAlert: false }
  return { recommended: true, strength: 'strong', temperatureAlert: false }
}

/**
 * Rest or deload today, and how strongly, with the AI-rule signals behind it.
 *
 * `withRestSignals: false` is the decision as it was before #3718 (the replay's "already suggested
 * rest for another reason"); the app never passes it.
 */
export function decideDailyRest(input: DailyRestInput, opts: { withRestSignals?: boolean } = {}): DailyRestDecision {
  const base = baseGrade(input)
  const signals = opts.withRestSignals === false ? [] : restSignals(input)
  let recommended = base.recommended
  let strength = base.strength

  // #3718: any of the AI rule's rest signals suggests rest on its own, with or without a streak. A
  // readiness under the prompt's rest cut is already the strong grade on the streak path, so it is
  // strong here too; the two trend signals are "recommended", the grade the illness radar gets.
  if (signals.length > 0) {
    const floor: DeloadStrengthGrade = signals.includes('readinessVeryLow') ? 'strong' : 'recommended'
    strength = recommended ? atLeast(strength, floor) : floor
    recommended = true
  }

  // Self-reported illness forces the strongest recommendation (owner call 2026-07-29); the lifter
  // knows before any biometric does. It never blocks training.
  if (input.selfReportedSick) {
    recommended = true
    strength = 'strong'
  }

  // Energy can push the grade up one level, or force strong.
  if (input.energyLevel === 'drained') {
    recommended = true
    strength = 'strong'
  } else if (input.energyLevel === 'low') {
    if (!recommended) {
      recommended = true
      strength = 'soft'
    } else if (strength === 'soft') {
      strength = 'recommended'
    } else if (strength === 'recommended') {
      strength = 'strong'
    }
  }

  return { recommended, strength, temperatureAlert: base.temperatureAlert, restSignals: signals }
}
