/**
 * Today's readiness payload — the data gathering and orchestration around
 * `computeReadinessComposite`, which is the formula and already lives in
 * `@trainingai/shared/health/readiness-composite`.
 *
 * Extracted from `app/api/readiness-score/route.ts` for Q-42. `/api/body-battery` anchors the
 * battery curve on today's readiness, but could only read it once this route had already run and
 * persisted `oura_daily_derived.readiness_score` — so the first Body Battery read of any day fell
 * back to the sleep score and showed a *provisional* anchor that later changed under the user.
 *
 * Both routes now call this. It is deliberately **not** cheap — it issues ~11 repository reads —
 * so Body Battery calls it only when today's persisted row is missing. The persist inside it means
 * that happens at most once a day; every later read on either route hits the stored row.
 */
import { getRepository } from '@/lib/data'
import { todayInTz, todayMidnightUtc, toAestDay, ageFromDob } from '@trainingai/shared/date-utils'
import { getCurrentPhase } from '@trainingai/shared/phase-engine'
import { blendActivityScore, type ActivityBlendResult } from '@/lib/activity/blend-activity'
import { computeVolumeAcwr, ACWR_THRESHOLDS } from '@trainingai/shared/ai-periodization/acwr'
import { scoreBand } from '@trainingai/shared/health/score-band'
import { computeSleepScore, sleepComponentsToContributors, sleepScoreBaselines } from '@trainingai/shared/health/sleep-score'
import { nightSessions } from '@trainingai/shared/health/sleep-night'
import { computeActivityScore } from '@trainingai/shared/health/activity-score'
import { getDailyGoals, type DailyGoals } from '@trainingai/shared/health/daily-goals'
import { hrMaxFromAge, computeHrZones } from '@trainingai/shared/health/hr-zones'
import { accumulateZoneSeconds, activeMinutesFromZoneSeconds } from '@trainingai/shared/health/zone-minutes'
import { computeMovedHours, moveHoursGoal } from '@trainingai/shared/health/hourly-movement'
import { excludeLowWearDays, toOuraByDate, isLowWearDay } from '@trainingai/shared/health/wear-confidence'
import { baselineZ } from '@trainingai/shared/health/personal-baseline'
import { computeReadinessComposite, checkinScoreFromEnergy, READINESS_MODEL_VERSION, type ReadinessCompositeResult } from '@trainingai/shared/health/readiness-composite'
import { resilienceLevelToBand } from '@/lib/health/stress-resilience'
import { computeIllnessRadar, illnessAdvisory, illnessZScores, type IllnessFlag, type IllnessBiomarker, type IllnessBiomarkerKey } from '@trainingai/shared/health/illness-radar'
import { isPreRekey } from '@/lib/oura/cloud-freshness'
import { scoreAvailability, trailingBaselineZ, type ReadinessInputKey, type ScoreAvailability } from '@/lib/health/score-availability'
import { isTemperatureBaselineCentred } from '@trainingai/shared/health/temperature-baseline-health'

/**
 * Early-deload trigger: a low readiness score *and* an elevated acute:chronic load ratio.
 *
 * The ACWR bound is deliberately **not** `ACWR_THRESHOLDS.optimalMax` (1.3). This fires while load
 * is still inside the optimal band, because it is paired with a readiness score under 45 — the
 * pair is the signal, not either number on its own. Aligning it to 1.3 would change who sees the
 * card.
 *
 * The number itself lives in `ACWR_THRESHOLDS` as `elevatedMin` (Q-306) so that the one
 * deliberate exception sits beside the boundaries it is an exception to; it is re-exported under
 * this name so the card can state the threshold it tripped instead of asserting "your readiness is
 * low" with no number, which is what the owner asked for (Q-173).
 */
export const EARLY_DELOAD_SCORE_MAX = 45
export const EARLY_DELOAD_ACWR_MIN = ACWR_THRESHOLDS.elevatedMin

/** Why the early-deload card is showing — the two values that tripped it, and what they had to beat. */
export interface EarlyDeloadReason {
  score: number
  acwr: number
  scoreThreshold: number
  acwrThreshold: number
}

export interface ReadinessScoreResponse {
  score: number
  label: 'High' | 'Moderate' | 'Low'
  components: {
    sleep: number   // 0–40 (custom signal — kept for fallback + ACWR display)
    hrv: number     // 0–30
    rhr: number     // 0–20
    load: number    // 0–10
  }
  hasSufficientData: boolean
  earlyDeloadRecommended: boolean
  /** Populated only when `earlyDeloadRecommended` — the card has nothing to explain otherwise. */
  earlyDeload: EarlyDeloadReason | null
  source: 'oura+acwr' | 'oura' | 'custom' | 'none'
  // Which readiness inputs today's score was actually computed from, and how much of the core
  // recovery picture that covers. `limited` is the UI's cue to qualify the number rather than
  // hide it — a user on Health Connect alone has no temperature signal and will never be 'full'.
  inputsAvailable: ReadinessInputKey[]
  inputsMissing: ReadinessInputKey[]
  scoreConfidence: ScoreAvailability['confidence']
  limited: boolean
  // Oura fields — null when no Oura data available
  ouraScore: number | null
  // Temperature deviation vs personal baseline (°C). BLE-derived (oura_daily_summary.temp_dev_c,
  // last rolled-up night) when available; frozen Cloud value only as an annotated fallback.
  temperatureDeviation: number | null
  temperatureDeviationSource: 'ble' | 'cloud' | null
  daySummary: string | null
  // Readiness value for display: Oura's score when present, else our own composite (null when
  // there isn't enough data to compute one). The chip/detail read this, not the Oura-only ouraScore.
  readinessDisplayScore: number | null
  sleepScore: number | null
  activityScore: number | null      // Oura activity score blended with logged training load
  activityBlend: ActivityBlendResult
  readinessContributors: Record<string, number | null> | null
  sleepContributors: Record<string, number | null> | null
  activityContributors: Record<string, number | null> | null
  // Activity Score v2 (2026-07-22) — the goal-anchored inputs/targets behind today's activity score,
  // for rendering real-unit gauges (steps/kcal/sessions vs goal) on the Activity detail screen. Null
  // when there's nothing to score at all (mirrors activityScore's null case).
  // Derived from DailyGoals rather than re-listing its fields: the hand-written copy silently
  // omitted `sessionVolumeGoalKg` when Q-190 added it, so the UI could not compute the volume
  // target it renders. Widening DailyGoals now reaches this payload automatically.
  activityGoals: (DailyGoals & { moveHoursGoal: number | null }) | null
  activitySignals: {
    steps: number | null; activeCalories: number | null
    // Zone-minutes / move-every-hour — null (not zero) when there's no intraday HR series to derive
    // them from today (e.g. no baseline resting HR yet); zero is a real "no elevated HR today" result.
    zoneMinutes: number | null; moveHours: number | null
    sessions7d: number; volume7dKg: number; typicalSessionVolumeKg: number
  } | null
  // True when the over-exertion taper (ACWR above the optimal band) pulled the displayed score
  // below the pre-taper goal-completion score.
  activityTaperApplied: boolean
  hrCurrent: number | null
  hrMin: number | null
  hrAvg: number | null
  hrMax: number | null
  vo2Max: number | null
  vascularAge: number | null
  // Day of the last Cloud row carrying vo2Max/vascularAge — always pre-re-key.
  // UI must render these "as of <cloudVitalsDate>", never as today's reading.
  cloudVitalsDate: string | null
  stressHigh: number | null
  recoveryHigh: number | null
  recommendedBedtimeStart: number | null
  recommendedBedtimeEnd: number | null
  isLowWearToday: boolean
  baselineHrv: number | null  // 28-day low-wear-excluded average, ms rMSSD
  recentHrv: number | null    // 7-day average, ms rMSSD
  restingHr: number | null          // recent (7-day) average resting HR, bpm — the Heart Rate card value
  restingHrBaseline: number | null  // 28-day low-wear-excluded average resting HR, bpm — the high/low reference
  // Own baseline-relative composite (Oura BLE Phase 5 addendum A4) — only computed
  // when Oura Cloud's readiness score isn't available and we have a daily_summary
  // row for last night. null otherwise (never fabricated).
  // Per-factor sub-scores (0-100) of the app's own readiness composite, keyed by the
  // composite's camelCase weight keys. Lets the Readiness detail show each factor's actual
  // score (not just its weight) with a tap-to-expand explanation. null when no composite.
  readinessCompositeContributors: Record<string, { score: number; provisional: boolean }> | null
  // Illness radar (Sub-plan E §5.5) — vs-baseline deviation flag; null until we have a summary.
  illnessFlag: IllnessFlag | null
  illnessScore: number | null                                           // 0-100, 0 while learning
  illnessBiomarkers: Partial<Record<IllnessBiomarkerKey, IllnessBiomarker>> | null
  illnessSuppression: number         // readiness points subtracted by the radar (0 unless elevated/fever)
  illnessAdvisory: string | null     // inline copy for the readiness surface, null when nothing to say
  // Our own derived stress-resilience (stress_resilience_2_2_1) — supersedes the frozen Oura Cloud
  // resilience string. null until enough history accrues (never fabricated).
  ownResilienceLevel: number | null                                          // 1.0-5.0
  ownResilienceBand: 'low' | 'limited' | 'adequate' | 'solid' | 'strong' | null
  ownResilienceConfidence: number | null
}

/** Exported for TN-6a's pass test: the ladder's contribution has to be measured, not read. */
export function computeBlendedScore(
  ouraScore: number,
  acwr: number | null,
  tempDev: number | null,
  /** TN-6a: false suspends the temperature ladder entirely. See `isTemperatureBaselineCentred`. */
  tempLadderTrusted: boolean,
): { score: number; source: 'oura+acwr' | 'oura' } {
  let modifier = 0
  let source: 'oura+acwr' | 'oura' = 'oura'

  if (acwr != null) {
    source = 'oura+acwr'
    if (acwr >= ACWR_THRESHOLDS.lowMax && acwr <= ACWR_THRESHOLDS.optimalMax) modifier += 3
    else if (acwr > ACWR_THRESHOLDS.optimalMax && acwr <= ACWR_THRESHOLDS.highMax) modifier -= Math.round(6 * (acwr - ACWR_THRESHOLDS.optimalMax) / 0.2)
    else if (acwr > ACWR_THRESHOLDS.highMax) modifier -= 15
    else if (acwr < 0.6) modifier -= 5
  }

  const raw    = ouraScore + modifier
  // TN-6a: the ladder is skipped outright while the baseline is uncentred, rather than the
  // thresholds being widened. Widening would hide a broken input behind a plausible firing rate and
  // permanently desensitise a real fever once the baseline converges — the same answer TN-6 and
  // Q-506 both give. Nulling the deviation here is what makes every arm below unreachable.
  const dev    = tempLadderTrusted ? tempDev : null
  const absDev = dev != null ? Math.abs(dev) : 0

  let score: number
  if (dev != null && absDev > 1.0) {
    score = Math.min(40, Math.max(0, raw))
  } else if (dev != null && absDev > 0.5) {
    score = Math.max(0, Math.min(100, raw - 20))
  } else if (dev != null && absDev > 0.3) {
    score = Math.max(0, Math.min(100, raw - 10))
  } else {
    score = Math.max(0, Math.min(100, raw))
  }

  return { score, source }
}

export async function buildReadinessPayload(userId: string, tz: string): Promise<ReadinessScoreResponse> {
  const repo = await getRepository()

  const todayIso    = todayInTz(tz)
  const todayMid    = todayMidnightUtc(tz)
  const from28dDate = new Date(todayMid.getTime() - 28 * 86_400_000)
  const from28dIso  = toAestDay(from28dDate, tz)
  const from7dIso   = toAestDay(new Date(todayMid.getTime() - 7 * 86_400_000), tz)

  const [bodyMetrics, sleepSessions, recentSessions, ouraRows, program, todayHrRows, dailySummaries, derivedTodayRows, cloudVitals, todayMood, userProfile] = await Promise.all([
    repo.listBodyMetrics(userId, from28dIso, todayIso),
    repo.listSleepSessions(userId, from28dIso, todayIso),
    repo.getWorkoutSessionsFrom(userId, from28dDate),
    repo.getOuraDaily(userId, from28dIso, todayIso),
    repo.getActiveProgram(userId),
    repo.getHrForWindow(userId, todayMid, new Date(todayMid.getTime() + 86_400_000)),
    repo.getOuraDailySummary(userId, from28dIso, todayIso),
    repo.getOuraDailyDerived(userId, from7dIso, todayIso),
    repo.getLatestOuraCloudVitals(userId),
    repo.getMoodLog(userId, todayIso),
    repo.getUserById(userId),
  ])

  const derivedToday = derivedTodayRows.find(r => r.day === todayIso) ?? null
  // Latest day with a produced resilience level (today may be too incomplete to resolve one yet).
  const latestResilience = [...derivedTodayRows].reverse().find(r => r.resilienceLevel != null) ?? null
  const ouraToday = ouraRows.find(r => r.date === todayIso) ?? null
  const ouraByDate = toOuraByDate(ouraRows)

  // ── HR stats for today ──────────────────────────────────────────────────────
  const hrCurrent = todayHrRows.length > 0 ? todayHrRows[todayHrRows.length - 1].bpm : null
  const hrMin     = todayHrRows.length > 0 ? Math.min(...todayHrRows.map(r => r.bpm)) : null
  const hrMax     = todayHrRows.length > 0 ? Math.max(...todayHrRows.map(r => r.bpm)) : null
  const hrAvg     = todayHrRows.length > 0
    ? Math.round(todayHrRows.reduce((s, r) => s + r.bpm, 0) / todayHrRows.length)
    : null

  // ── Custom signals (always computed — used as fallback + for ACWR/earlyDeload) ──

  // "Last night" = the most recent NIGHT, not the most recent session. Sorting by sleepEnd and taking
  // the first scored a post-waking nap instead of the night (F-1/Q-1) — a 20-minute nap once produced
  // a Sleep Score of 5 against a 7.86 h night. `nightSessions` classifies by circadian position and
  // reassembles fragmented nights, so a wake-up in the middle no longer splits one night into two.
  const nights = nightSessions(sleepSessions, tz)
  const lastSleep  = nights[nights.length - 1]
  const sleepHours = lastSleep?.durationHours ?? null
  // Personal baselines for the Sleep Score's opt-in contributors (overnight HRV, overnight HR, and
  // habitual bed/wake times), derived from the *prior* nights only so the night being scored never
  // contributes to the bar it is judged against. One shared derivation — see sleepScoreBaselines.
  const sleepBaselines = sleepScoreBaselines(nights.slice(0, -1), tz)
  // Our own 0–100 Sleep Score (recovered open_health weights + contributor curves). Feeds both
  // the standalone Sleep chip (0–100) and the readiness composite's internal 0–40 sleep term.
  // Falls back to the crude duration-only estimate when there's no session to score at all.
  const sleepScoreResult = lastSleep ? computeSleepScore(lastSleep, tz, sleepBaselines) : null
  const sleepScore100 = sleepScoreResult?.score ?? null
  const ownSleepContributors = sleepScoreResult ? sleepComponentsToContributors(sleepScoreResult.components) : null
  const sleepComponent = sleepScore100 != null
    ? Math.round((sleepScore100 / 100) * 40)
    : sleepHours != null ? Math.min(40, Math.round((sleepHours / 8) * 40)) : 0

  const hrvRows       = excludeLowWearDays(bodyMetrics.filter(m => m.hrvMs != null && m.hrvMs > 0), ouraByDate)
  const recentHrvRows = bodyMetrics.filter(m => m.date >= from7dIso && m.hrvMs != null && m.hrvMs > 0)
  const baselineHrv   = hrvRows.length >= 5
    ? hrvRows.reduce((s, m) => s + m.hrvMs!, 0) / hrvRows.length
    : null
  const recentHrv = recentHrvRows.length
    ? recentHrvRows.reduce((s, m) => s + m.hrvMs!, 0) / recentHrvRows.length
    : null
  const hrvScore = baselineHrv && recentHrv
    ? Math.max(0, Math.min(30, Math.round(30 * (recentHrv / baselineHrv))))
    : 0

  const rhrRows       = excludeLowWearDays(bodyMetrics.filter(m => m.restingHeartRate != null && m.restingHeartRate > 0), ouraByDate)
  const recentRhrRows = bodyMetrics.filter(m => m.date >= from7dIso && m.restingHeartRate != null && m.restingHeartRate > 0)
  const baselineRhr   = rhrRows.length >= 5
    ? rhrRows.reduce((s, m) => s + m.restingHeartRate!, 0) / rhrRows.length
    : null
  const recentRhr = recentRhrRows.length
    ? recentRhrRows.reduce((s, m) => s + m.restingHeartRate!, 0) / recentRhrRows.length
    : null
  const rhrScore = baselineRhr && recentRhr
    ? Math.max(0, Math.min(20, Math.round(20 * (baselineRhr / recentRhr))))
    : 0

  const load = computeVolumeAcwr(
    recentSessions.map(ws => ({ startedAt: ws.startedAt, volumeKg: ws.exercises.reduce((s2, ex) => s2 + (ex.volume ?? 0), 0) })),
    todayMid,
  )
  const todayWorkoutVolumeKg = load.todayVolumeKg
  const typicalSessionVolumeKg = load.typicalSessionVolumeKg

  // Skip ACWR for the first 28 days of a new program — chronic load baseline not yet valid.
  // Resolved here (ahead of the activity score) so the over-exertion taper can read it.
  const programAgeMs = program?.startedAt
    ? todayMid.getTime() - new Date(program.startedAt).getTime()
    : Infinity
  const acwr = programAgeMs >= 28 * 86_400_000 ? load.acwr : null

  // Goal-anchored Activity score (W-B) — scored against the user's personalised daily goals
  // (single source: getDailyGoals) rather than their own trailing average. Two lanes: today's
  // movement (steps/active-energy vs goals) + a rolling 7-day strength lane (so a rest day still
  // scores off recent training). Over-exertion past the ACWR optimal band tapers the *displayed*
  // score; readiness reads the PRE-taper goal-completion so load-fatigue isn't double-counted.
  const latestWeightKg = [...bodyMetrics].reverse().find(m => m.weightKg != null && m.weightKg > 0)?.weightKg ?? null
  const ageYears = ageFromDob(userProfile?.dateOfBirth, todayMid)
  const goals = getDailyGoals({
    weightKg: latestWeightKg,
    heightCm: userProfile?.heightCm ?? null,
    ageYears,
    sex: userProfile?.sex ?? null,
    activityLevel: userProfile?.activityLevel ?? null,
  })
  // Rolling 7-day strength window (inclusive of today).
  const sessions7dRows = recentSessions.filter(ws => new Date(ws.startedAt).getTime() >= todayMid.getTime() - 7 * 86_400_000)
  const sessions7d = sessions7dRows.length
  const strengthSessionToday = recentSessions.some(ws => new Date(ws.startedAt).getTime() >= todayMid.getTime())
  const volume7dKg = sessions7dRows.reduce((s, ws) => s + ws.exercises.reduce((s2, ex) => s2 + (ex.volume ?? 0), 0), 0)
  const todayMetrics = bodyMetrics.find(m => m.date === todayIso) ?? null

  // Zone-minutes + move-every-hour, from the SAME intraday HR series already fetched above for
  // hrCurrent/hrMin/hrMax/hrAvg (todayHrRows) — this doesn't need any new data pipeline, only a
  // resting-HR + max-HR profile to derive zones from (same Karvonen basis Body Battery already uses).
  let zoneMinutesToday: number | null = null
  let movedHoursToday: number | null = null
  if (baselineRhr != null && todayHrRows.length > 0) {
    const maxHr = hrMaxFromAge(ageYears)
    const zones = computeHrZones({ maxHr, restingHr: baselineRhr })
    zoneMinutesToday = activeMinutesFromZoneSeconds(
      accumulateZoneSeconds(todayHrRows.map(r => ({ timestamp: r.timestamp.getTime(), bpm: r.bpm })), zones),
    )
    movedHoursToday = computeMovedHours({ hrRows: todayHrRows, maxHr, restingHr: baselineRhr, tz, dateIso: todayIso })
  }

  const activityResult = computeActivityScore({
    steps: todayMetrics?.steps ?? null,
    activeCalories: todayMetrics?.activeCalories ?? null,
    zoneMinutes: zoneMinutesToday,
    moveHours: movedHoursToday,
    moveHoursGoal: movedHoursToday != null ? moveHoursGoal() : null,
    strengthSessionToday,
    sessions7d,
    volume7dKg,
    typicalSessionVolumeKg,
    goals,
    acwr,
  })
  const ownActivityScore = activityResult?.preTaperScore ?? null // pre-taper → readiness composite (no double-count)
  const activityDisplayScore = activityResult?.score ?? null      // tapered → the card / display

  // Yesterday's own activity score — feeds the A4 composite's "Prev-Day Activity" contributor.
  const yesterdayIso = toAestDay(new Date(todayMid.getTime() - 86_400_000), tz)
  const yesterdayMetrics = bodyMetrics.find(m => m.date === yesterdayIso) ?? null
  const prevDayActivityScore = (yesterdayMetrics || sessions7d > 0) ? (computeActivityScore({
    steps: yesterdayMetrics?.steps ?? null,
    activeCalories: yesterdayMetrics?.activeCalories ?? null,
    sessions7d,
    volume7dKg,
    typicalSessionVolumeKg,
    goals,
  })?.preTaperScore ?? null) : null

  // Oura's blend only ever *adjusts* its own base score — on days without an Oura activity row,
  // pass our own base straight through instead (it already folds in training credit, so calling
  // blendActivityScore on top would double-count logged volume).
  const activityBlend: ActivityBlendResult = ouraToday?.activityScore != null
    ? blendActivityScore({
        ouraActivityScore: ouraToday.activityScore,
        trainingVolumeContrib: (ouraToday.activityContributors?.training_volume as number | null | undefined) ?? null,
        todayWorkoutVolumeKg,
        typicalSessionVolumeKg,
      })
    : { base: activityDisplayScore, adjustment: 0, final: activityDisplayScore, trained: todayWorkoutVolumeKg > 0 }

  const loadScore = acwr != null
    ? acwr >= ACWR_THRESHOLDS.lowMax && acwr <= ACWR_THRESHOLDS.optimalMax ? 10
      : acwr > ACWR_THRESHOLDS.optimalMax ? Math.max(0, Math.round(10 * (ACWR_THRESHOLDS.highMax - acwr)))
      : Math.round(10 * acwr / ACWR_THRESHOLDS.lowMax)
    : 5

  // ── Own baseline-relative composite (Oura BLE Phase 5 addendum A2 + A4) ──────
  // z-scores compare tonight's value against the PRIOR night's baseline (the state
  // before tonight was folded in) — the same pre-update relationship
  // oura_daily_summary.temp_dev_c already captures for temperature.
  const latestSummary = dailySummaries.length > 0 ? dailySummaries[dailySummaries.length - 1] : null
  const priorSummary = dailySummaries.length > 1 ? dailySummaries[dailySummaries.length - 2] : null

  // Temp deviation, BLE-first: the rollup already persists last night's deviation vs the
  // prior night's baseline (daily-summary.ts → oura_daily_summary.temp_dev_c). The Cloud
  // field froze at the re-key — it survives only as an explicitly-tagged fallback.
  // TN-6a. The 28-day summary window is already loaded above, so the suspension condition costs
  // one pass over it — no extra query, and it re-evaluates on every request, which is what lets it
  // clear itself the moment a Redecode re-derivation centres the stored deviations.
  const tempLadderTrusted = isTemperatureBaselineCentred(dailySummaries.map(d => d.tempDevC))

  const bleTempDevC = latestSummary?.tempDevC ?? null
  const cloudTempDevC = ouraToday?.temperatureDeviation ?? null
  const temperatureDeviation = bleTempDevC ?? cloudTempDevC
  const temperatureDeviationSource: 'ble' | 'cloud' | null =
    bleTempDevC != null ? 'ble' : cloudTempDevC != null ? 'cloud' : null

  // Cloud-only daily products (day summary, bedtime window) are only emitted when the backing
  // row post-dates the re-key. Structurally always-null today (the wear-time writer is the only
  // live oura_daily writer) — this makes the invariant explicit and survives any future manual
  // Cloud re-sync. Stress/recovery are NOT gated here: 10c coalesces live derived values over
  // Cloud below, and only the Cloud fallback is gated.
  const cloudDailyLive = ouraToday != null && !isPreRekey(ouraToday.date)

  // Baseline-z scores shared by the readiness composite and the illness radar — tonight's value
  // vs the PRIOR night's baseline (the pre-update relationship). Same helper the rollup uses to
  // persist illness, so the live and stored values can't diverge.
  const { rhrZ, hrvZ, tempZ, breathZ } = latestSummary
    ? illnessZScores(priorSummary, latestSummary)
    : { rhrZ: null, hrvZ: null, tempZ: null, breathZ: null }
  // Morning check-in (mood/energy) → 0-100 for the readiness composite. Null when not logged today
  // → the composite treats it as neutral 50 (so a perfect 100 needs a logged good check-in, but
  // skipping it doesn't tank readiness).
  const checkinScore = checkinScoreFromEnergy(todayMood?.energyLevel)

  // Generic-source fallback (Q-43): a user without a ring has no oura_daily_summary, so the
  // composite above never ran and every readiness surface rendered blank. Health Connect and
  // manual logs do supply HRV, resting HR and sleep duration in the generic tables — enough for
  // the SAME composite, with the contributors it has no input for falling back to the composite's
  // own neutral. Baselines are folded from the 28-day window with the same updateBaseline the
  // ring's rollup uses, so the two paths score on one scale. Temperature and the recovery index
  // have no generic source and stay null rather than being approximated.
  const asc = <T extends { date: string }>(rows: T[]) => [...rows].sort((a, b) => a.date.localeCompare(b.date))
  const genericHrvSeries = asc(bodyMetrics.filter(m => m.hrvMs != null && m.hrvMs > 0)).map(m => m.hrvMs!)
  const genericRhrSeries = asc(bodyMetrics.filter(m => m.restingHeartRate != null && m.restingHeartRate > 0)).map(m => m.restingHeartRate!)
  const genericSleepMinSeries = nights.filter(n => n.durationHours != null).map(n => n.durationHours! * 60)
  // Days carrying any recovery signal at all — the generic stand-in for the rollup's night count.
  // The composite gates its baseline-relative contributors on this reaching BASELINE_MIN_NIGHTS,
  // so a cold user gets a neutral, explicitly-limited score instead of a confident wrong one.
  const genericHistoryDays = new Set([
    ...bodyMetrics.filter(m => (m.hrvMs != null && m.hrvMs > 0) || (m.restingHeartRate != null && m.restingHeartRate > 0)).map(m => m.date),
    ...nights.map(n => n.date),
  ]).size
  const hasGenericRecoverySignal =
    sleepScore100 != null || genericHrvSeries.length >= 2 || genericRhrSeries.length >= 2

  const genericComposite: ReadinessCompositeResult | null = (!latestSummary && hasGenericRecoverySignal)
    ? computeReadinessComposite({
        rhrZ: trailingBaselineZ(genericRhrSeries),
        hrvZ: trailingBaselineZ(genericHrvSeries),
        tempZ: null,
        sleepBalanceZ: trailingBaselineZ(genericSleepMinSeries),
        previousNightScore: sleepScore100,
        prevDayActivityScore,
        activityBalanceScore: ownActivityScore,
        checkinScore,
        nHistory: Math.max(0, genericHistoryDays - 1),
      })
    : null

  const ownComposite: ReadinessCompositeResult | null = latestSummary ? computeReadinessComposite({
    rhrZ,
    hrvZ,
    tempZ,
    sleepBalanceZ: priorSummary?.sleepBaseline && latestSummary.sleepDurationHours != null
      ? baselineZ(priorSummary.sleepBaseline, Math.round(latestSummary.sleepDurationHours * 60)) : null,
    previousNightScore: sleepScore100,
    prevDayActivityScore,
    activityBalanceScore: ownActivityScore,
    checkinScore,
    nHistory: latestSummary.nHistory,
    recoveryIndexHours: latestSummary.recoveryIndexHours,
  }) : genericComposite

  // Illness radar (Sub-plan E §5.5) — a rule-based vs-baseline deviation flag over the same
  // temp/RHR/HRV z-scores. Surfaced as a bounded readiness suppression + advisory, never a new
  // weighted contributor (those biomarkers are already composite contributors — that would
  // double-count). Stays "learning" until the baseline is mature, so a cold user is never flagged.
  const illness = latestSummary
    ? computeIllnessRadar({ tempZ, rhrZ, hrvZ, breathZ, nHistory: latestSummary.nHistory })
    : null

  // ── Score + source ──────────────────────────────────────────────────────────

  let score: number
  let source: ReadinessScoreResponse['source']

  if (ouraToday?.readinessScore != null) {
    const blended = computeBlendedScore(
      ouraToday.readinessScore,
      acwr,
      ouraToday.temperatureDeviation ?? null,
      tempLadderTrusted,
    )
    score  = blended.score
    source = blended.source
  } else if (ownComposite) {
    score  = ownComposite.score
    source = 'custom'
  } else {
    score  = sleepComponent + hrvScore + rhrScore + loadScore
    source = bodyMetrics.length > 0 ? 'custom' : 'none'
  }

  // Illness overrides an otherwise-OK readiness: subtract the bounded suppression (0 unless the
  // radar is elevated/fever) from the displayed score before banding and the deload check.
  if (illness && illness.readinessSuppression > 0) {
    score = Math.max(0, score - illness.readinessSuppression)
  }

  const label: ReadinessScoreResponse['label'] = scoreBand(score).label

  // Readiness for the chip/detail: Oura's when present, else our composite — but only when we
  // actually have a recovery signal (an HRV or RHR baseline, or the A4 daily_summary composite).
  // Without one the composite is just sleep+load and would mislead, so leave it null and let
  // the chip hide itself.
  const readinessDisplayScore = ouraToday?.readinessScore != null
    ? score
    : (baselineHrv != null || baselineRhr != null || ownComposite != null) ? score : null

  const hasSufficientData = ouraToday?.readinessScore != null ||
    (sleepHours != null && (baselineHrv != null || baselineRhr != null || ownComposite != null))

  // Early deload — only for automatic periodization, not already in deload
  let earlyDeloadRecommended = false
  let earlyDeload: EarlyDeloadReason | null = null
  if (program?.phaseMode === 'automatic') {
    const phaseList = program.startedAt ? await repo.listProgramPhases(userId, program.id) : []
    let inDeloadPhase = false
    if (phaseList.length > 0 && program.sessionsPerCycle && program.startedAt) {
      const sessionsCount = await repo.countSessionsSinceStart(userId, program.id)
      const { phase } = getCurrentPhase(phaseList, program.sessionsPerCycle, sessionsCount)
      inDeloadPhase = phase.phaseType === 'deload'
    }
    if (!inDeloadPhase && (baselineHrv != null || ouraToday?.readinessScore != null) && acwr != null) {
      earlyDeloadRecommended = score < EARLY_DELOAD_SCORE_MAX && acwr > EARLY_DELOAD_ACWR_MIN
      if (earlyDeloadRecommended) {
        earlyDeload = {
          score,
          acwr,
          scoreThreshold: EARLY_DELOAD_SCORE_MAX,
          acwrThreshold: EARLY_DELOAD_ACWR_MIN,
        }
      }
    }
  }

  // Persist our own composite readiness in completed form for later analysis (compute-and-persist).
  // The composite already blends every signal (RHR / HRV / temperature / sleep balance / previous
  // night's sleep score / prev-day activity / recovery index / activity balance), so we record it
  // whole, exactly as computed here — the stored value can't diverge from what the user sees. The
  // route still computes live for display (read-first is perf-gated and not adopted). Writes only the
  // readiness_* columns (COALESCE upsert) — never the shared source/model_versions, which the upsert
  // replaces wholesale and would clobber body_comp/illness provenance on the same row. Best-effort:
  // a persist failure must never fail the read.
  // The generic branch keys on today rather than a rollup's wake day (it has no rollup) — that is
  // the day the trend surfaces read, and it is what stops a Health Connect user's readiness trend
  // from being empty every day (Q-43). It only ever back-fills forward: days before this shipped
  // stay null, since nothing recorded them at the time.
  if (ownComposite && (latestSummary || genericComposite)) {
    try {
      // `model_versions` is one shared JSONB across every pillar on this row, and the upsert writes a
      // provided column wholesale — so it is MERGED with what is already stored rather than replaced.
      // Writing `{ readiness: ... }` alone would drop bodyBattery's stamp and any other pillar's.
      //
      // Stamped from 2026-08-18 (Q-273): without it, the range calibration that shipped the same day
      // leaves an unmarked step in the readiness trend where old and new model scores meet, and no
      // later correlation can tell an input change from a model change. Sleep shipped without one and
      // has exactly that problem.
      // Writes only its own key: `upsertOuraDailyDerived` merges `model_versions` with `||` inside
      // the statement, so this no longer has to read the row and spread it back. That read-merge was
      // a two-statement race against any other pillar stamping the same day, and it read a value
      // that could already be stale (Q-273).
      await repo.upsertOuraDailyDerived(userId, latestSummary?.date ?? todayIso, {
        readinessScore: ownComposite.score,
        readinessContributors: ownComposite.contributors,
        readinessSource: latestSummary ? 'ble-derived' : 'generic-derived',
        modelVersions: { readiness: READINESS_MODEL_VERSION },
      })
    } catch (err) {
      console.error('[readiness-score] readiness persist failed (read still served):', err)
    }
  }

  // Persist our own sleep score + contributor breakdown (S6 — data-efficiency review §1.3).
  // Same compute-and-persist posture as the readiness block above; the Sleep detail's
  // contributor bars stop depending on the frozen Cloud JSONB. Separate gate/day key: it needs
  // only a scored session (not the A4 summary), and lastSleep.date is the actual wake day of the
  // scored night (latestSummary.date can lag it before the rollup runs). Writes only the sleep_*
  // columns — never the shared source/model_versions (same clobber hazard as the readiness
  // persist). COALESCE means a later recompute with richer inputs overwrites with the better value.
  // Best-effort: a persist failure must never fail the read.
  if (sleepScoreResult && lastSleep) {
    try {
      await repo.upsertOuraDailyDerived(userId, lastSleep.date, {
        sleepScore: sleepScoreResult.score,
        sleepContributors: ownSleepContributors,
      })
    } catch (err) {
      console.error('[readiness-score] sleep-score persist failed (read still served):', err)
    }
  }

  // Persist the Activity Score (Q-7). It was computed here on every call and then discarded, while
  // /api/health/trends fell back to oura_daily.activity_score — NULL every day since the 2026-07-07
  // re-key, because the Cloud stopped scoring. So Activity Score v2 shipped with zero history.
  //
  // Written server-side rather than left for the device: the value is already computed here, and
  // oura_daily_derived.activity_score is a COALESCE column, so the on-device rollup's own push (when
  // that lands — Phase-1 Task 5 → Phase-2 Task A2) fills or overwrites the same field without
  // conflict. Persisting now costs no future device work and stops discarding a number we compute.
  //
  // Same posture as the two blocks above: today's date key (matching how the trends route reads it),
  // only the activity_* columns — never the shared source/model_versions, which the upsert replaces
  // wholesale — and best-effort, so a persist failure never fails the read.
  if (activityBlend.final != null) {
    try {
      await repo.upsertOuraDailyDerived(userId, todayIso, {
        activityScore: Math.round(activityBlend.final),
        activityContributors: {
          base: activityBlend.base,
          adjustment: activityBlend.adjustment,
          trained: activityBlend.trained ? 1 : 0,
        },
      })
    } catch (err) {
      console.error('[readiness-score] activity-score persist failed (read still served):', err)
    }
  }

  // An Oura readiness score is a whole-picture number by construction, so it reports as full
  // regardless of which of our own inputs happen to be present today.
  const availability: ScoreAvailability = ouraToday?.readinessScore != null
    ? { available: ['sleep', 'hrv', 'restingHeartRate', 'temperature', 'activity', 'checkin'], missing: [], confidence: 'full', limited: false }
    : scoreAvailability({
        sleep: sleepScore100 != null,
        hrv: baselineHrv != null || hrvZ != null,
        restingHeartRate: baselineRhr != null || rhrZ != null,
        temperature: temperatureDeviation != null || tempZ != null,
        activity: ownActivityScore != null,
        checkin: checkinScore != null,
      })

  return {
    score, label,
    components: { sleep: sleepComponent, hrv: hrvScore, rhr: rhrScore, load: loadScore },
    hasSufficientData,
    earlyDeloadRecommended,
    earlyDeload,
    source,
    inputsAvailable: availability.available,
    inputsMissing:   availability.missing,
    scoreConfidence: availability.confidence,
    limited:         availability.limited,
    ouraScore:               ouraToday?.readinessScore             ?? null,
    temperatureDeviation,
    temperatureDeviationSource,
    daySummary:              cloudDailyLive ? ouraToday.daySummary ?? null : null,
    readinessDisplayScore,
    // Prefer our own freshly-computed sleep score over the Oura Cloud value: since the BLE
    // re-key the Cloud score is frozen (it reads e.g. 31 next to a real 7h45m / 90%-efficiency
    // night), whereas sleepScore100 comes from computeSleepScore(lastSleep) off the same fresh
    // BLE sleep session. Matches the derived-first order the /api/health/trends route already uses.
    sleepScore:              sleepScore100 ?? ouraToday?.sleepScore ?? null,
    activityScore:           activityBlend.final,
    activityBlend,
    readinessContributors:   ouraToday?.readinessContributors       ?? null,
    readinessCompositeContributors: ownComposite?.contributors ?? null,
    sleepContributors:       ouraToday?.sleepContributors ?? ownSleepContributors,
    // Prefer our own goal-anchored components over the frozen Oura contributors (same precedence
    // as sleepContributors above) — this is what powers the Activity detail screen's contributor
    // chart + "how to improve" guide, which was silently empty while Oura's field stayed null.
    activityContributors:    ouraToday?.activityContributors ?? activityResult?.components ?? null,
    activityGoals:           activityResult ? { ...goals, moveHoursGoal: movedHoursToday != null ? moveHoursGoal() : null } : null,
    activitySignals:         activityResult
      ? {
          steps: todayMetrics?.steps ?? null, activeCalories: todayMetrics?.activeCalories ?? null,
          zoneMinutes: zoneMinutesToday, moveHours: movedHoursToday,
          sessions7d, volume7dKg, typicalSessionVolumeKg,
        }
      : null,
    activityTaperApplied:    activityResult?.taperApplied ?? false,
    hrCurrent,
    hrMin,
    hrAvg,
    hrMax,
    vo2Max:                  cloudVitals?.vo2Max                    ?? null,
    vascularAge:             cloudVitals?.vascularAge               ?? null,
    cloudVitalsDate:         cloudVitals?.date                      ?? null,
    // Derived-when-available (fresh, written by the body-battery read today), else the frozen
    // Cloud seconds ONLY when that row post-dates the re-key. Derived is minutes → convert;
    // response stays seconds (S5). 10c's derived-first coalesce is preserved; item 21 gates
    // only the Cloud fallback.
    stressHigh:              derivedToday?.stressHighMinutes   != null ? derivedToday.stressHighMinutes   * 60 : (cloudDailyLive ? ouraToday.stressHigh   ?? null : null),
    recoveryHigh:            derivedToday?.recoveryHighMinutes != null ? derivedToday.recoveryHighMinutes * 60 : (cloudDailyLive ? ouraToday.recoveryHigh ?? null : null),
    recommendedBedtimeStart: cloudDailyLive ? ouraToday.recommendedBedtimeStart ?? null : null,
    recommendedBedtimeEnd:   cloudDailyLive ? ouraToday.recommendedBedtimeEnd   ?? null : null,
    isLowWearToday:          isLowWearDay(ouraToday?.nonWearTimeSec),
    baselineHrv,
    recentHrv,
    restingHr:                recentRhr != null ? Math.round(recentRhr) : (baselineRhr != null ? Math.round(baselineRhr) : null),
    restingHrBaseline:        baselineRhr != null ? Math.round(baselineRhr) : null,
    illnessFlag:              illness?.flag                          ?? null,
    illnessScore:             illness?.score                         ?? null,
    illnessBiomarkers:        illness?.biomarkers                    ?? null,
    illnessSuppression:       illness?.readinessSuppression          ?? 0,
    illnessAdvisory:          illness ? illnessAdvisory(illness.flag) : null,
    ownResilienceLevel:       latestResilience?.resilienceLevel ?? null,
    ownResilienceBand:        latestResilience?.resilienceLevel != null ? resilienceLevelToBand(latestResilience.resilienceLevel) : null,
    ownResilienceConfidence:  latestResilience?.resilienceConfidence ?? null,
  } satisfies ReadinessScoreResponse
}
