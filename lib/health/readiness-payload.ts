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
import { reportServerError } from '@/lib/observability'
import type { OuraDailyDerivedPatch } from '@/lib/data/repository'
import { todayInTz, todayMidnightUtc, shiftDateStr, dateStrMidnightInTz } from '@trainingai/shared/date-utils'
import { recentDoses, withDoseContext, DOSE_EFFECT_LOOKBACK_DAYS, type RecentDose } from '@trainingai/shared/health/dose-context'
import { getCurrentPhase } from '@trainingai/shared/phase-engine'
import { ACWR_THRESHOLDS } from '@trainingai/shared/ai-periodization/acwr'
import { scoreBand } from '@trainingai/shared/health/score-band'
import { ringValueStands } from '@trainingai/shared/health/source-rank'
import { latestRestingHrRow } from '@trainingai/shared/health/latest-resting-hr'
import { sleepComponentsToContributors, SLEEP_SCORE_MODEL_VERSION } from '@trainingai/shared/health/sleep-score'
import { scoreSleepForDate, SLEEP_SCORE_HISTORY_DAYS } from '@trainingai/shared/health/sleep-score-for-date'
import { nightSessions, canonicalLatestNight } from '@trainingai/shared/health/sleep-night'
import { computeActivityScore, strengthWindowEndingAt } from '@trainingai/shared/health/activity-score'
import { scoreActivityForDay, restingHrBaseline, activityFinalisedAt, finalisedPreTaper } from '@trainingai/shared/health/activity-day'
import { staleFinishedDays } from '@trainingai/shared/health/finished-day-recheck'
import { scoreFinishedActivityDay, storeFinishedActivityDay, activityFinalGrace, ACTIVITY_FINALISE_DAYS } from '@/lib/health/activity-finalise'
import { type DailyGoals } from '@trainingai/shared/health/daily-goals'
import { resolveHrProfile } from '@trainingai/shared/health/hr-profile'
import { excludeLowWearDays, toOuraByDate, isLowWearDay } from '@trainingai/shared/health/wear-confidence'
import { computeReadinessComposite, READINESS_MODEL_VERSION, type ReadinessCompositeResult, type ContributorGap } from '@trainingai/shared/health/readiness-composite'
import { resilienceLevelToBand, observeResilienceCoverage } from '@/lib/health/stress-resilience'
import { applyIllnessSuppression, computeIllnessRadar, illnessAdvisory, type IllnessFlag, type IllnessBiomarker, type IllnessBiomarkerKey } from '@trainingai/shared/health/illness-radar'
import { isPreRekey } from '@/lib/oura/cloud-freshness'
import { scoreAvailability, metricAvailability, type ReadinessInputKey, type ScoreAvailability, type MetricAvailability } from '@/lib/health/score-availability'
import { connectedSources, CONNECTED_SOURCE_WINDOW_DAYS, type ConnectedSources } from '@trainingai/shared/health/connected-sources'
import { ouraCloudDeliveredTypes } from '@/lib/oura/cloud/config'
import { resolveReadinessNightInputs, compositeNightFields, illnessNightFields, canonicalNightsByDate, readinessSourceLabel, readinessWindowStarts } from '@/lib/health/readiness-night-inputs'

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

/** One pillar's contribution to the `oura_daily_derived` write at the end of a readiness computation. */
export interface DerivedPersist {
  day: string
  /** Names the block this patch came from, so a failed write says which pillars went down with it. */
  pillar: string
  patch: OuraDailyDerivedPatch
}

/**
 * Group the pillars' patches by day so each distinct day is one upsert instead of one per pillar
 * (RV-83).
 *
 * The three producers in `buildReadinessPayload` write `readiness_*` + `model_versions`, `sleep_*`
 * and `activity_*`, and in the normal case at least two of them address the SAME `(user_id, day)`
 * row — `latestSummary.date`, `lastSleep.date` and `todayIso` all resolve to today whenever the
 * rollup is current, which production confirms: every row of the last twelve days carries all three
 * scores.
 *
 * Merging is safe because `upsertOuraDailyDerived` writes only the keys whose value is not
 * `undefined` and the three key sets are disjoint, so the merged patch writes exactly the union with
 * every column still sourced from exactly one pillar. `model_versions` is the one column with `||`
 * merge semantics rather than COALESCE, and it is merged here the same way: since #3079 both readiness
 * and sleep stamp it, each under its own pillar key, so the union of their maps is exactly what two
 * separate `||` writes would have left.
 *
 * **That disjointness is an invariant, not an observation, which is why a collision throws.** If a
 * later pillar starts writing a key another one already writes, a silent `Object.assign` would pick
 * a winner and drop the other, and nothing would ever say so. The caller's catch turns the throw
 * into a logged failed persist — the read is served either way, and the write it drops is
 * recomputed on the next request.
 */
export function mergeDerivedPersists(entries: DerivedPersist[]): { day: string; pillars: string[]; patch: DerivedPersist['patch'] }[] {
  const byDay = new Map<string, { day: string; pillars: string[]; patch: Record<string, unknown> }>()
  for (const e of entries) {
    const group = byDay.get(e.day) ?? { day: e.day, pillars: [], patch: {} }
    const collision = (key: string) =>
      new Error(`mergeDerivedPersists: '${key}' written by both '${group.pillars.join("'/'")}' and '${e.pillar}' on ${e.day}`)
    for (const key of Object.keys(e.patch)) {
      if (key === 'modelVersions') continue
      if (key in group.patch) throw collision(key)
    }
    const { modelVersions, ...rest } = e.patch
    if (modelVersions !== undefined) {
      const merged = { ...(group.patch.modelVersions as Record<string, unknown> | undefined) }
      for (const [k, v] of Object.entries(modelVersions ?? {})) {
        if (k in merged) throw collision(`modelVersions.${k}`)
        merged[k] = v
      }
      group.patch.modelVersions = merged
    }
    Object.assign(group.patch, rest)
    group.pillars.push(e.pillar)
    byDay.set(e.day, group)
  }
  return [...byDay.values()] as { day: string; pillars: string[]; patch: DerivedPersist['patch'] }[]
}

/** Why the early-deload card is showing — the two values that tripped it, and what they had to beat. */
export interface EarlyDeloadReason {
  score: number
  acwr: number
  scoreThreshold: number
  acwrThreshold: number
}

/**
 * The activity figure this payload reports, and how it was reached.
 *
 * Moved here from `lib/activity/blend-activity.ts` when that module was deleted (Q-284). `base` and
 * `final` are now always the same number and `adjustment` is always 0 — the shape survives because
 * it is this payload's published contract, not because anything still blends.
 */
export interface ActivityBlendResult {
  base: number | null
  adjustment: number
  final: number | null
  /** A gym session was logged today. */
  trained: boolean
}

export interface ReadinessScoreResponse {
  /**
   * The readiness score, or `null` when there is no recovery signal to score from (#2336).
   *
   * It used to be a number always: with no sleep, RHR or HRV the recovery components are all 0 and
   * only load contributed, so a user with no ring data got `5` and "Low", and the rest-day card told
   * them to rest fully. `null` is the same condition `readinessDisplayScore` already encoded, now on
   * the field the consumers actually read; the rest-day guidance and the check-in headers already
   * have a branch for it.
   */
  score: number | null
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
  /**
   * Q-278. Per-metric availability WITH a reason, for the three surfaces that render a score.
   *
   * `limited` above says a score was computed from less than the full picture; this says which
   * inputs were missing and — the part that was being thrown away — whether they were missing
   * because there is no data or because the personal baseline is not mature yet. Only the second
   * is fixed by waiting, so only the second can be told to a user as such.
   *
   * A metric whose score is null reports `state: 'absent'` with its own reason, which is the case
   * the surfaces already render as `—` and could not previously explain.
   *
   * **Optional, and that is the honest shape rather than a concession.** Clients seed this payload
   * synchronously from the SQLite cache (`cachedFetch` + `readCacheSync`), so a device can hold a
   * response written before this field existed and paint from it. A required field would be a claim
   * about what a client can receive that is not true. Read it as "absent means unknown", never as
   * "no metrics".
   */
  availability?: MetricAvailability[]
  /**
   * Issue 2613. Which device sources the user has connected: ring, strap, Health Connect. Definitions
   * in `@trainingai/shared/health/connected-sources` (strap means strap-sourced heart rate seen in
   * the last `CONNECTED_SOURCE_WINDOW_DAYS` days).
   *
   * **Optional, and absent means unknown.** A payload cached on the device before this field existed
   * lacks it, and so does one built while the source lookup failed. Never read absent as `false`.
   */
  connectedSources?: ConnectedSources
  // Temperature deviation vs personal baseline (°C). BLE-derived (oura_daily_summary.temp_dev_c,
  // last rolled-up night) when available; frozen Cloud value only as an annotated fallback.
  temperatureDeviation: number | null
  temperatureDeviationSource: 'ble' | 'cloud' | null
  // Readiness value for display: our own composite, null when there isn't enough data to compute
  // one. Oura's readiness is never shown in its place (scoring doc rule 5, #3000).
  readinessDisplayScore: number | null
  sleepScore: number | null
  /** OR-204: how complete today's own sleep score is. Null when there is no score. */
  sleepScoreCoverage: import('@trainingai/shared/health/sleep-score').SleepScoreCoverage | null
  activityScore: number | null      // Oura activity score blended with logged training load
  activityBlend: ActivityBlendResult
  /**
   * Always null. It carried Oura's readiness contributors; ours are `readinessCompositeContributors`.
   * Kept in the shape so a client built against it still decodes the payload (#3000).
   */
  readinessContributors: null
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
    sessions7d: number; volume7dKg: number
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
  // Day of the newest Cloud row carrying vo2Max or vascularAge. UI renders these
  // "as of <day>", never as today's reading: each metric's own day where it has one (#3077).
  cloudVitalsDate: string | null
  vo2MaxDate?: string | null
  vascularAgeDate?: string | null
  stressHigh: number | null
  recoveryHigh: number | null
  recommendedBedtimeStart: number | null
  recommendedBedtimeEnd: number | null
  isLowWearToday: boolean
  baselineHrv: number | null  // 28-day low-wear-excluded average, ms rMSSD
  recentHrv: number | null    // 7-day average, ms rMSSD
  restingHr: number | null          // recent (7-day) average resting HR, bpm — the score's input
  restingHrBaseline: number | null  // 28-day low-wear-excluded average resting HR, bpm — the high/low reference
  /**
   * The most recent single-night resting HR, bpm, and the date it was measured (TN-13).
   *
   * **Not the same thing as `restingHr`, and the difference is the entry.** Re-measured against
   * production on 2026-08-30 over **71 nights**: the nightly value moves **2.50 bpm** night to night
   * while the 7-day mean moves **0.58**, so the mean discards **77 % of the daily movement** in the
   * signal that best predicts how the owner feels (r = +0.557 against their own check-in, best of
   * nine). TN-13 recorded 2.11 / 0.33 / 84 % over 50 nights; the conclusion is unchanged and the
   * figures are restated here because a number nobody re-measures drifts.
   *
   * Bounded to the last 7 days: a resting HR from a month ago is not "last night", and presenting one
   * as if it were is worse than showing nothing. `restingHrLastNightDate` is what lets a consumer say
   * *when*, rather than implying it is today's.
   */
  restingHrLastNight: number | null
  restingHrLastNightDate: string | null
  // Own baseline-relative composite (Oura BLE Phase 5 addendum A4) — only computed
  // when Oura Cloud's readiness score isn't available and we have a daily_summary
  // row for last night. null otherwise (never fabricated).
  // Per-factor sub-scores (0-100) of the app's own readiness composite, keyed by the
  // composite's camelCase weight keys. Lets the Readiness detail show each factor's actual
  // score (not just its weight) with a tap-to-expand explanation. null when no composite.
  readinessCompositeContributors: Record<string, { score: number; provisional: boolean; gap?: ContributorGap | null; scale?: 'oura_contributor' }> | null
  // Illness radar (Sub-plan E §5.5) — vs-baseline deviation flag; null until we have a summary.
  illnessFlag: IllnessFlag | null
  illnessScore: number | null                                           // 0-100, 0 while learning
  illnessBiomarkers: Partial<Record<IllnessBiomarkerKey, IllnessBiomarker>> | null
  illnessSuppression: number         // readiness points subtracted by the radar (0 unless elevated/fever)
  illnessAdvisory: string | null     // inline copy for the readiness surface, null when nothing to say
  /** TN-46: vial-dosed administrations in the last few days, newest first. Optional because a cached
   *  payload from before it existed does not carry it. Context only: no score
   *  reads it. The advisory above names the latest when a flag is up. */
  recentDoses?: RecentDose[]
  // Our own derived stress-resilience (stress_resilience_2_2_1) — supersedes the frozen Oura Cloud
  // resilience string. null until enough history accrues (never fabricated).
  ownResilienceLevel: number | null                                          // 1.0-5.0
  ownResilienceBand: 'low' | 'limited' | 'adequate' | 'solid' | 'strong' | null
  ownResilienceConfidence: number | null
  // LA-158: the day the level above was produced. The level is the most recent one in a 7-day
  // window, NOT necessarily today's, and the tile had no way to tell the two apart — on
  // 2026-09-27 it was rendering 09-22's level as current. A surface that shows a number owes
  // the reader its date whenever the number can be days old.
  ownResilienceAsOf: string | null                                           // 'YYYY-MM-DD'
  // LA-158: what was observed when no level could be shown, so the surface can say why instead
  // of rendering nothing. Deliberately NOT a diagnosis: the payload looks at 7 days while the
  // model gates on `windowDays`, so a shortfall here is consistent with the coverage gate having
  // closed without establishing it. The numbers let the surface state what is true —
  // "N of the last M days had enough daytime coverage; the model needs K of W" — and no more.
  // `null` for the threshold fields means the resilience constants were not injected on this
  // request, which is a different thing from a threshold of zero.
  ownResilienceUnavailable: {
    daysSeen: number
    daysMeetingCoverageGate: number | null
    coverageGateMinutes: number | null
    minValidDays: number | null
    modelWindowDays: number | null
  } | null
}

/**
 * Exported for TN-6a's pass test: the ladder's contribution has to be measured, not read.
 * issue 2151: no production path calls this any more (its only caller was the Oura-score arm, which
 * never ran). It stays, with `temp-penalty-suspension.test.ts`, as the record of what the ladder did.
 */
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
    else if (acwr < ACWR_THRESHOLDS.veryLowMax) modifier -= 5
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

// TN-13: the latest night's resting HR, picked by max date. It lives in `packages/shared` now so the
// running plan and cardio week read it the same way (#3216). The caller passes rows already bounded
// to the last 7 days, which is what stops a stale reading being presented as last night's; low-wear
// days are deliberately NOT excluded, unlike the baseline. Re-exported for its existing test.
export { latestRestingHrRow }

export async function buildReadinessPayload(
  userId: string,
  tz: string,
  // #3206: a caller that has already read the switch day passes it (null = none) to spare the second lookup.
  knownSwitchDay?: string | null,
): Promise<ReadinessScoreResponse> {
  const repo = await getRepository()

  const todayIso    = todayInTz(tz)
  const todayMid    = todayMidnightUtc(tz)
  const { from28dIso, from7dIso } = readinessWindowStarts(todayIso)
  const from28dDate = dateStrMidnightInTz(from28dIso, tz)
  // Calendar-day arithmetic, not `todayMid + 86_400_000`: across a DST change a local day is 23 or 25 hours.
  const tomorrowMid = dateStrMidnightInTz(shiftDateStr(todayIso, 1), tz)

  // Issue 2613: a failed lookup leaves the field out (unknown), never false.
  const connectedSourcesP = (async () => {
    const [ringSamples, recent, ouraTokens] = await Promise.all([
      repo.hasOuraBleSamples(userId),
      repo.getRecentSourceFacts(userId, dateStrMidnightInTz(shiftDateStr(todayIso, -CONNECTED_SOURCE_WINDOW_DAYS), tz)),
      repo.getOuraCloudTokens(userId),
    ])
    return connectedSources({ ringSamples, ...recent, ouraCloudTypes: ouraCloudDeliveredTypes(ouraTokens) })
  })().catch(() => undefined)

  // #2182: the zone ceiling is the HR profile's — one max for the zone bar and Activity's zone minutes.
  const hrProfileP = resolveHrProfile(repo, userId, tz).catch(() => null)
  const [bodyMetrics, sleepSessions, recentSessions, ouraRows, program, todayHrRows, dailySummaries, derivedTodayRows, cloudVitals, userProfile, userGoals, doseEvents, connectedSourcesSummary, ouraCloudContributors, switchDay] = await Promise.all([
    repo.listBodyMetrics(userId, from28dIso, todayIso),
    repo.listSleepSessions(userId, from28dIso, todayIso),
    repo.getWorkoutSessionsFrom(userId, from28dDate),
    repo.getOuraDaily(userId, from28dIso, todayIso),
    repo.getActiveProgram(userId),
    repo.getHrForWindow(userId, todayMid, tomorrowMid),
    repo.getOuraDailySummary(userId, from28dIso, todayIso),
    repo.getOuraDailyDerived(userId, from7dIso, todayIso),
    repo.getLatestOuraCloudVitals(userId),
    repo.getUserById(userId),
    // Q-524: the step goal the user set, which wins over the activity-level default.
    repo.getUserGoals(userId).catch(() => null),
    // TN-46: context for a flagged day, never an input to the score. A failure costs the context only.
    (async () => repo.listDoseEvents(userId, shiftDateStr(todayIso, -DOSE_EFFECT_LOOKBACK_DAYS), todayIso))().catch(() => []),
    connectedSourcesP,
    // #2984: Oura's recovery-index contributor, the one input Oura sends no value for. A failure
    // leaves that input missing, which is what it is without the read.
    (async () => repo.getOuraCloudReadinessContributors(userId, from28dIso, todayIso))().catch(() => []),
    // #3193: a failed lookup reads as no switch, so the ring's value stands, as before the switch existed.
    (async () => knownSwitchDay !== undefined ? knownSwitchDay : repo.getOuraCloudSwitchDay(userId))().catch(() => null),
  ])

  const derivedToday = derivedTodayRows.find(r => r.day === todayIso) ?? null
  // #2998: from the day the user switched to the Oura API, today's ring row is a partial leftover, so
  // its daytime stress and recovery give way to Oura's. Display and availability only, never a score input.
  const ringStressToday = ringValueStands(todayIso, switchDay) ? derivedToday : null
  // Latest day with a produced resilience level (today may be too incomplete to resolve one yet).
  // #3206: from the switch day the ring's rows are leftovers, so none of them is offered as the level
  // (the coach does the same). Oura's level is its own word and is not mapped onto this 1-5 scale.
  const ringDerivedRows = derivedTodayRows.filter(r => ringValueStands(r.day, switchDay))
  const latestResilience = [...ringDerivedRows].reverse().find(r => r.resilienceLevel != null) ?? null
  // LA-158: when there is no level, record what was actually observed rather than leaving the
  // surface to render nothing and say nothing. Measured 2026-09-27: resilience had published
  // nothing since 09-22 and the only reason anyone knew was a query against the table.
  const resilienceUnavailable = latestResilience?.resilienceLevel != null
    ? null
    : observeResilienceCoverage(ringDerivedRows.map(r => r.daytimeStressCoverageMin))
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
  const lastSleep  = canonicalLatestNight(nights, tz)
  const sleepHours = lastSleep?.durationHours ?? null
  // Our own 0–100 Sleep Score (recovered open_health weights + contributor curves). Feeds both
  // the standalone Sleep chip (0–100) and the readiness composite's internal 0–40 sleep term.
  // Falls back to the crude duration-only estimate when there's no session to score at all.
  // Baselines come from the *prior* nights only, by the scored night's end (#2456), so the night
  // never contributes to the bar it is judged against. #3079: through `scoreSleepForDate`, the one
  // night window the re-score of a changed night uses too, so the two paths cannot disagree.
  // #3099: scored against the 28 days before the NIGHT's date, not today's. Before Oura delivers last
  // night, or when the ring was not worn, the newest night is older than today, so the days its window
  // reaches before this read's 28-day load are fetched as well. Only the Sleep Score reads them; every
  // other input keeps the window it always had.
  const scoredFrom = lastSleep ? shiftDateStr(lastSleep.date, -SLEEP_SCORE_HISTORY_DAYS) : null
  const olderSleep = scoredFrom != null && scoredFrom < from28dIso
    ? await repo.listSleepSessions(userId, scoredFrom, shiftDateStr(from28dIso, -1)).catch(() => [])
    : []
  const sleepScoreResult = lastSleep ? scoreSleepForDate([...olderSleep, ...sleepSessions], lastSleep.date, tz)?.result ?? null : null
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

  const recentRhrRows = bodyMetrics.filter(m => m.date >= from7dIso && m.restingHeartRate != null && m.restingHeartRate > 0)
  const baselineRhr   = restingHrBaseline(bodyMetrics, ouraByDate)
  const recentRhr = recentRhrRows.length
    ? recentRhrRows.reduce((s, m) => s + m.restingHeartRate!, 0) / recentRhrRows.length
    : null
  const rhrScore = baselineRhr && recentRhr
    ? Math.max(0, Math.min(20, Math.round(20 * (baselineRhr / recentRhr))))
    : 0

  // TN-13 — the latest single night, which is a different question from the 7-day mean above.
  const lastNightRhrRow = latestRestingHrRow(recentRhrRows)

  // Goal-anchored Activity score (W-B), live for the day in progress. Scored by the same function
  // that finalises a finished day (#2435), so today's ring and tomorrow's stored value can't drift.
  // Over-exertion past the ACWR optimal band tapers the *displayed* score.
  const hrProfile = await hrProfileP
  const activityToday = scoreActivityForDay({
    date: todayIso,
    tz,
    bodyMetrics,
    restingHrBaseline: baselineRhr,
    hrRows: todayHrRows,
    maxHr: hrProfile?.maxHr ?? null,
    sessions: recentSessions,
    program,
    user: userProfile,
    stepsGoal: userGoals?.stepsGoal ?? null,
  })
  const { result: activityResult, goals, load, acwr } = activityToday
  const { sessions7d, volume7dKg } = activityToday.signals
  const todayWorkoutVolumeKg = load.todayVolumeKg
  const recentDoseList = recentDoses(doseEvents, todayIso)
  const ownActivityScore = activityResult?.preTaperScore ?? null // pre-taper: today's, for availability
  const activityDisplayScore = activityResult?.score ?? null      // tapered → the card / display

  // Yesterday's own activity score — feeds the A4 composite's "Prev-Day Activity" contributor.
  const yesterdayIso = shiftDateStr(todayIso, -1)
  const yesterdayMetrics = bodyMetrics.find(m => m.date === yesterdayIso) ?? null
  // TN-77(a): yesterday's contributor gets YESTERDAY's strength window. It used to be handed
  // today's, so on a training day the "previous day" score reacted to this morning's session.
  const prevWindow = strengthWindowEndingAt(recentSessions, yesterdayIso, tz)
  const prevDayActivityScore = (yesterdayMetrics || prevWindow.sessions7d > 0) ? (computeActivityScore({
    steps: yesterdayMetrics?.steps ?? null,
    activeCalories: yesterdayMetrics?.activeCalories ?? null,
    sessions7d: prevWindow.sessions7d,
    volume7dKg: prevWindow.volume7dKg,
    goals,
  })?.preTaperScore ?? null) : null

  // #2435: readiness's activity-balance input is the previous COMPLETED day's Activity score, read
  // pre-taper so load fatigue isn't counted twice. It used to read today's partial score, so a
  // morning readiness saw a near-empty day's movement. A finished day is scored once over the whole
  // day and stamped final; yesterday is finalised here first if no read has done it yet, and any
  // older day in the look-back still holding a partial value is finalised behind the read.
  const nowDate = new Date()
  const activityStamps = new Map(derivedTodayRows.map(r => [r.day, activityFinalisedAt(r.activityContributors)]))
  const staleActivityDays = staleFinishedDays(todayIso, tz, activityStamps, ACTIVITY_FINALISE_DAYS, activityFinalGrace(nowDate))
  const maxHrOption = { maxHr: hrProfile?.maxHr ?? null }
  const reportFinalise = (day: string, stage: 'scoring' | 'storing') => (err: unknown) =>
    reportServerError(new Error(`[readiness-score] ${stage} activity for ${day} failed — read still served`, { cause: err }), { userId })
  // Yesterday with no stamp at all has no usable stored value (a pre-#2435 row is a partial day), so
  // the read waits for it. Yesterday inside its grace has a stored value: the read uses it and the
  // re-score runs behind it. Scoring and storing are separate steps, so a failed write still hands
  // readiness the value that was scored.
  let prevCompletedDayActivityScore = finalisedPreTaper(derivedTodayRows.find(r => r.day === yesterdayIso)?.activityContributors)
  let backgroundActivityDays = staleActivityDays
  if (activityStamps.get(yesterdayIso) == null) {
    backgroundActivityDays = staleActivityDays.filter(d => d !== yesterdayIso)
    const scored = await scoreFinishedActivityDay(repo, userId, tz, yesterdayIso, nowDate, maxHrOption)
      .catch(err => { reportFinalise(yesterdayIso, 'scoring')(err); return null })
    if (scored) {
      prevCompletedDayActivityScore = scored.result?.preTaperScore ?? null
      await storeFinishedActivityDay(repo, userId, yesterdayIso, scored, nowDate).catch(reportFinalise(yesterdayIso, 'storing'))
    }
  }
  if (backgroundActivityDays.length > 0) {
    // One at a time and fire-and-forget, like the training-load re-check (#2400): the read never
    // waits on it and a first visit after a week away does not open seven at once.
    void (async () => {
      for (const day of backgroundActivityDays) {
        const scored = await scoreFinishedActivityDay(repo, userId, tz, day, nowDate, maxHrOption).catch(reportFinalise(day, 'scoring'))
        if (scored) await storeFinishedActivityDay(repo, userId, day, scored, nowDate).catch(reportFinalise(day, 'storing'))
      }
    })()
  }

  // Q-284 — our own Activity Score, always. `blendActivityScore` used to adjust an Oura Cloud
  // activity score on the days one existed; it is deleted, because no such day can occur again.
  // `oura_daily.activity_score` has had no value since **2026-07-07, the BLE re-key date itself**,
  // and that table's only remaining writer is the rollup's wear-time step, which sets
  // `nonWearTimeSec` and nothing else. The entry recorded the branch as "1 day in 40" and was filed
  // as a decision on that basis; that one day was the re-key boundary, counted inclusively.
  //
  // The shape is kept rather than collapsed: it is part of this payload's contract and
  // `health-score-detail.tsx` reads it. `adjustment` is now structurally 0.
  const activityBlend: ActivityBlendResult = {
    base: activityDisplayScore,
    adjustment: 0,
    final: activityDisplayScore,
    trained: todayWorkoutVolumeKg > 0,
  }

  const loadScore = acwr != null
    ? acwr >= ACWR_THRESHOLDS.lowMax && acwr <= ACWR_THRESHOLDS.optimalMax ? 10
      : acwr > ACWR_THRESHOLDS.optimalMax ? Math.max(0, Math.round(10 * (ACWR_THRESHOLDS.highMax - acwr)))
      : Math.round(10 * acwr / ACWR_THRESHOLDS.lowMax)
    : 5

  // ── Own baseline-relative composite (Oura BLE Phase 5 addendum A2 + A4) ──────
  // z-scores compare tonight's value against the PRIOR night's baseline (the state
  // before tonight was folded in) — the same pre-update relationship
  // oura_daily_summary.temp_dev_c already captures for temperature.
  //
  // #2984: the night's inputs are chosen PER INPUT, not per row. This used to run the ring path
  // whenever any `oura_daily_summary` row sat in the window, so after the 17 Oct switch to the Oura
  // Cloud API a partial ring row held five of eight inputs at a neutral 50 while Oura's values for
  // the same night went unread. `resolveReadinessNightInputs` takes each input from tonight's ring
  // summary where it can score it, else from the generic value for the same night against a normal
  // of that device's own nights. The composite and the illness radar both read that one result, so
  // they cannot disagree about a night (PS-42).
  const latestSummary = dailySummaries.length > 0 ? dailySummaries[dailySummaries.length - 1] : null
  const night = resolveReadinessNightInputs({
    today: todayIso,
    summaries: dailySummaries,
    bodyMetrics,
    nights: canonicalNightsByDate(nights, tz),
    ouraDaily: ouraRows,
    ouraCloudContributors,
  })

  // Temp deviation for display: tonight's ring value, else Oura's own for the same night.
  const temperatureDeviation = night.temperatureDeviation?.value ?? null
  const temperatureDeviationSource: 'ble' | 'cloud' | null = night.temperatureDeviation?.source ?? null

  // Cloud-only daily products (day summary, bedtime window) are only emitted when the backing
  // row post-dates the re-key. Structurally always-null today (the wear-time writer is the only
  // live oura_daily writer) — this makes the invariant explicit and survives any future manual
  // Cloud re-sync. Stress/recovery are NOT gated here: 10c coalesces live derived values over
  // Cloud below, and only the Cloud fallback is gated.
  const cloudDailyLive = ouraToday != null && !isPreRekey(ouraToday.date)

  // Generic-source fallback (Q-43): a user without a ring has no oura_daily_summary. Health Connect
  // and manual logs supply HRV, resting HR and sleep duration in the generic tables — enough for the
  // SAME composite, with the contributors it has no input for falling back to its own neutral. The
  // per-input choice above now covers both cases; this only decides whether there is anything to
  // score at all, exactly as before.
  const genericHrvCount = bodyMetrics.filter(m => m.hrvMs != null && m.hrvMs > 0).length
  const genericRhrCount = bodyMetrics.filter(m => m.restingHeartRate != null && m.restingHeartRate > 0).length
  const hasGenericRecoverySignal = sleepScore100 != null || genericHrvCount >= 2 || genericRhrCount >= 2
  // Days carrying any recovery signal at all — the night count for an input with no per-device count.
  const genericHistoryDays = new Set([
    ...bodyMetrics.filter(m => (m.hrvMs != null && m.hrvMs > 0) || (m.restingHeartRate != null && m.restingHeartRate > 0)).map(m => m.date),
    ...nights.map(n => n.date),
  ]).size
  const nHistory = latestSummary?.nHistory ?? Math.max(0, genericHistoryDays - 1)

  const ownComposite: ReadinessCompositeResult | null = (latestSummary || hasGenericRecoverySignal)
    ? computeReadinessComposite({
        ...compositeNightFields(night),
        previousNightScore: sleepScore100,
        prevDayActivityScore,
        activityBalanceScore: prevCompletedDayActivityScore,
        nHistory,
      })
    : null

  // Illness radar (Sub-plan E §5.5) — a rule-based vs-baseline deviation flag over the same
  // temp/RHR/HRV z-scores. Surfaced as a bounded readiness suppression + advisory, never a new
  // weighted contributor (those biomarkers are already composite contributors — that would
  // double-count). Stays "learning" until the baseline is mature, so a cold user is never flagged.
  //
  // PS-42 / #2984: the radar runs whenever the composite does, on the SAME per-input z-scores
  // (`illnessNightFields`), and renormalizes over whichever signals are present. Its maturity gate is
  // the youngest normal among the inputs carrying a z, so an input on a fresh device's normal can
  // never flag before that normal has `BASELINE_MIN_NIGHTS` nights.
  const illness = ownComposite ? computeIllnessRadar(illnessNightFields(night)) : null

  // ── Score + source ──────────────────────────────────────────────────────────

  let score: number
  let source: ReadinessScoreResponse['source']

  // issue 2151: there used to be a first arm here that blended Oura's own readiness score with ACWR
  // and the temperature ladder. `oura_daily.readiness_score` has been NULL since the 2026-07-07
  // re-key (the Cloud integration is gone), so it never ran; only these arms do.
  if (ownComposite) {
    score  = ownComposite.score
    source = 'custom'
  } else {
    score  = sleepComponent + hrvScore + rhrScore + loadScore
    source = bodyMetrics.length > 0 ? 'custom' : 'none'
  }

  // Illness overrides an otherwise-OK readiness: subtract the bounded suppression (0 unless the
  // radar is elevated/fever) from the displayed score before banding and the deload check.
  if (illness) score = applyIllnessSuppression(score, illness.readinessSuppression)

  const label: ReadinessScoreResponse['label'] = scoreBand(score).label

  // Readiness for the chip/detail: our composite — but only when we
  // actually have a recovery signal (an HRV or RHR baseline, or the A4 daily_summary composite).
  // Without one the composite is just sleep+load and would mislead, so leave it null and let
  // the chip hide itself.
  const readinessDisplayScore = (baselineHrv != null || baselineRhr != null || ownComposite != null) ? score : null

  const hasSufficientData = sleepHours != null && (baselineHrv != null || baselineRhr != null || ownComposite != null)

  // Early deload — the periodization modes the app drives, and not already in deload.
  //
  // TN-64(b), owner-approved 2026-09-24. This used to read `=== 'automatic'` alone, which made the
  // one automatic protective action in the app unreachable: measured 2026-09-25, the owner's two
  // `automatic` programs are his OLDEST and both inactive, while the active one is `ai_dynamic`.
  // So this was not "a gate that rarely fires" — it was dead for every session logged since he
  // moved across, 118 of them, none an early deload.
  //
  // `manual` stays out deliberately. What he approved was extending the recommender to the mode
  // the app itself periodizes; under `manual` he drives the phases, so the app proposing one is a
  // different question and is not this entry's to answer.
  //
  // The thresholds are NOT touched here (EARLY_DELOAD_SCORE_MAX / EARLY_DELOAD_ACWR_MIN). Moving
  // them in the same change would make it impossible to tell whether a prompt appeared because the
  // gate opened or because the bar dropped — and a threshold is Tuning's proposal, not this one's.
  // LA-138, answered 2026-09-27 and closed: `ai_dynamic` gets NO in-deload suppression, on
  // purpose. `inDeloadPhase` below can only ever be false for it — `listProgramPhases` resolves
  // through `programs.phase_set_id` and that mode has none (it periodizes dynamically, which is
  // the point of the mode; do NOT populate `program_phases` for it). The active program also has
  // `started_at` NULL, so the ternary below short-circuits before the phases are even fetched —
  // two independent reasons, where the entry named one.
  //
  // **Do not "fix" this by consulting `ai-dynamic.ts`'s deload signal.** That is
  // `deloadOrRestRecommended` — a RECOMMENDATION to deload, not a state of being in one.
  // Suppressing this warning on it would silence the prompt exactly when two independent systems
  // agree a deload is due, which is backwards. The honest "already deloading" signal for this
  // mode is a stored prescription with `phaseAction === 'deload'` under `prescriptionDrivesLoad`,
  // and that is SESSION-scoped while this gate is program-scoped — it would have to guess which
  // session it meant.
  //
  // What settles it is the asymmetry plus the count. A false suppression hides a health warning;
  // a false prompt costs one confirmation tap, since every early deload needs the owner's yes.
  // And there is nothing to suppress. Measured in production 2026-09-27: of the 119 logged
  // workout sessions, `is_early_deload` is false on every one — the 3 that carry a deload
  // `phase_type` are scheduled phase deloads off the two `automatic` programs, which is the
  // path that already has suppression. Revisit if an early deload ever actually fires.
  let earlyDeloadRecommended = false
  let earlyDeload: EarlyDeloadReason | null = null
  if (program?.phaseMode === 'automatic' || program?.phaseMode === 'ai_dynamic') {
    const phaseList = program.startedAt ? await repo.listProgramPhases(userId, program.id) : []
    let inDeloadPhase = false
    if (phaseList.length > 0 && program.sessionsPerCycle && program.startedAt) {
      const sessionsCount = await repo.countSessionsSinceStart(userId, program.id)
      const { phase } = getCurrentPhase(phaseList, program.sessionsPerCycle, sessionsCount)
      inDeloadPhase = phase.phaseType === 'deload'
    }
    // issue 2151: early deload is gated on the HRV baseline alone. Oura's readiness score used to be
    // a second way in, but it is permanently null, so it never opened this gate.
    if (!inDeloadPhase && baselineHrv != null && acwr != null) {
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

  // RV-83 — the three persists below used to be three separately-awaited upserts on a read path,
  // two of them usually to the same row. They collect here and drain as one statement per distinct
  // day; see `mergeDerivedPersists` for why merging them is safe by construction.
  const derivedPersists: DerivedPersist[] = []

  // Persist our own composite readiness in completed form for later analysis (compute-and-persist).
  // The composite already blends every signal (RHR / HRV / temperature / sleep balance / previous
  // night's sleep score / prev-day activity / recovery index / activity balance), so we record it
  // whole, as served — the stored value can't diverge from what the user sees. #3086: "as served"
  // means AFTER the illness radar's suppression. It used to store `ownComposite.score`, the number
  // before it, so on a day the radar read `elevated` or `fever` every reader of the stored value
  // (trends, the day timeline and log, the verdict, training stress, the coach) saw a readiness
  // higher than the one shown. The radar's flag, score and biomarkers are stored beside it (#3077's
  // first item), so a suppressed day stays explainable without a new column: the composite before
  // the radar is the stored score plus `READINESS_SUPPRESSION[illness_flag]` (unless clamped at 0),
  // and the contributors are the composite's own, unchanged. The
  // route still computes live for display (read-first is perf-gated and not adopted). Writes only the
  // readiness_* columns (COALESCE upsert) — never the shared source/model_versions, which the upsert
  // replaces wholesale and would clobber body_comp/illness provenance on the same row. Best-effort:
  // a persist failure must never fail the read.
  // The generic branch keys on today rather than a rollup's wake day (it has no rollup) — that is
  // the day the trend surfaces read, and it is what stops a Health Connect user's readiness trend
  // from being empty every day (Q-43). It only ever back-fills forward: days before this shipped
  // stay null, since nothing recorded them at the time.
  //
  // #3079: and only when that night is TODAY's. Until Oura delivers last night (under the Oura API
  // that is after the Oura app syncs, often mid-morning) the newest night is yesterday's, so this
  // used to write yesterday's row with a score built from today's activity, load and illness inputs,
  // replacing the readiness that day had actually shown, every morning. A finished day's readiness
  // is what it said that morning; a read of today before the night lands writes no readiness, and the
  // first read after it does. Today's `nightDate` never exceeds `todayIso` (the resolver caps it).
  if (ownComposite && night.nightDate === todayIso) {
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
    // #2984: keyed on the night the inputs are for, which #3079 now requires to be today.
    derivedPersists.push({ day: todayIso, pillar: 'readiness', patch: {
      // `score`, not `ownComposite.score`: on this branch it is the composite less the radar's
      // suppression, the number `readinessDisplayScore` serves (#3086).
      readinessScore: score,
      readinessContributors: ownComposite.contributors,
      // The radar ran on the same night inputs (`illnessNightFields`), whenever the composite did.
      // Until #3086 only the ring's rollup stored these, so after the switch to the Oura API the
      // stored flag stopped (#3077). `learning` is stored too, as the rollup did.
      illnessFlag: illness?.flag,
      illnessScore: illness?.score,
      illnessBiomarkers: illness?.biomarkers,
      // Both labels are our own composite and AI surfaces read both (`liveReadinessByDay`, #2992).
      // Where each input came from is on the contributors (`source`); the Health Connect recompute
      // reads that, not this label, to decide which days to clear.
      readinessSource: readinessSourceLabel(night, latestSummary != null, switchDay),
      modelVersions: { readiness: READINESS_MODEL_VERSION },
      // TN-64(a): the OTHER half of the early-deload gate. The score has always been stored and
      // the ACWR never was, so "the gate never opened" could not be told apart from "the gate was
      // never reached" — and no change to that condition can be validated until both halves are on
      // the record. Written from the same computed value the gate reads, on the same row and the
      // same day key, so the two can never disagree about what today's inputs were.
      //
      // Rides this persist rather than getting its own: it is a readiness-read-path value, and
      // `mergeDerivedPersists` collapses same-day entries into one statement — a second push here
      // would be a second pillar name for one number nobody computes separately.
      acwr,
    } })
  }

  // Persist our own sleep score + contributor breakdown (S6 — data-efficiency review §1.3).
  // Same compute-and-persist posture as the readiness block above; the Sleep detail's
  // contributor bars stop depending on the frozen Cloud JSONB. Separate gate/day key: it needs
  // only a scored session (not the A4 summary), and lastSleep.date is the actual wake day of the
  // scored night (latestSummary.date can lag it before the rollup runs). Writes only the sleep_*
  // columns — never the shared source/model_versions (same clobber hazard as the readiness
  // persist). COALESCE means a later recompute with richer inputs overwrites with the better value.
  // Best-effort: a persist failure must never fail the read.
  //
  // #3079: and only for TODAY's night. Before Oura delivers last night the newest night is
  // yesterday's, and every read rewrote yesterday's stored score. A finished day's night is scored
  // when it changes instead (`rescore-nights.ts`), never by a read of a later day.
  if (sleepScoreResult && lastSleep && lastSleep.date === todayIso) {
    derivedPersists.push({ day: lastSleep.date, pillar: 'sleep', patch: {
      sleepScore: sleepScoreResult.score,
      sleepContributors: ownSleepContributors,
      // #3079: which model scored it, so a change of model or of what makes the night is a readable
      // step in the history. Its own key in the shared map; the upsert merges it with `||`.
      modelVersions: { sleep: SLEEP_SCORE_MODEL_VERSION },
    } })
  }

  // The Activity score is NOT persisted here (#2435). Q-7 stored it on every read keyed on today,
  // so each day's stored score was its in-progress value at the last app open (moveHours 0, 7, 0 on
  // three consecutive days). Today's value is live-only; a day is stored once it has ended, by
  // `scoreFinishedActivityDay` and `storeFinishedActivityDay` above, with the same contributor breakdown Q-526 added.

  // Best-effort exactly as before: a persist failure must never fail the read, and each day's group
  // is independent of the others. The log names the pillars in the group rather than a single
  // pillar, because one merged statement that fails takes all of them with it and the line has to
  // say which.
  //
  // Sequential rather than `Promise.all`: measured on local Postgres at 2.38 ms for the old three
  // sequential upserts, 1.17 ms for `Promise.all`, and 0.66 ms for one merged statement. The entry
  // proposed `Promise.all` and it is a real 2x, but it spends three pool connections to get it on a
  // pool CLAUDE.md keeps deliberately small, and merging beats it by 1.79x on one. In the normal
  // case this loop runs once.
  //
  // The outer catch is what keeps the merge itself inside the best-effort contract:
  // `mergeDerivedPersists` REFUSES a key claimed by two pillars, and that refusal must be a lost
  // write and a loud log line, never a failed read.
  try {
    for (const group of mergeDerivedPersists(derivedPersists)) {
      try {
        await repo.upsertOuraDailyDerived(userId, group.day, group.patch)
      } catch (err) {
        console.error(`[readiness-score] derived persist failed for ${group.day} (${group.pillars.join('+')}) — read still served:`, err)
      }
    }
  } catch (err) {
    console.error('[readiness-score] derived persist merge refused (read still served):', err)
  }

  const availability: ScoreAvailability = scoreAvailability({
    sleep: sleepScore100 != null,
    // #2984: an input with a value tonight is available, whichever device's normal it is judged on.
    hrv: baselineHrv != null || night.inputs.hrvBalance != null,
    restingHeartRate: baselineRhr != null || night.inputs.restingHeartRate != null,
    temperature: temperatureDeviation != null || night.inputs.temperature != null,
    activity: ownActivityScore != null,
  })

  return {
    // `score` is what a reader shows and acts on, so it is the display score: null without a recovery
    // signal. The local `score` above stays a number because the early-deload gate and the band label
    // read it, and the gate is itself closed without a recovery baseline. The load component stays in
    // `components` below, so the breakdown still shows what did contribute.
    score: readinessDisplayScore, label,
    components: { sleep: sleepComponent, hrv: hrvScore, rhr: rhrScore, load: loadScore },
    hasSufficientData,
    earlyDeloadRecommended,
    earlyDeload,
    source,
    inputsAvailable: availability.available,
    inputsMissing:   availability.missing,
    scoreConfidence: availability.confidence,
    limited:         availability.limited,
    // Q-278. Readiness carries its contributors, so its reasons are real; sleep and activity have no
    // contributor breakdown of their own, so they can only report present/absent honestly — which is
    // still more than the surfaces had.
    availability: [
      // Keyed on the DISPLAY score: derived from the raw one it read `present` for a score of 5 built
      // from load alone, and the chip showed a dash with no reason (#2336).
      metricAvailability('readiness', readinessDisplayScore, ownComposite?.contributors ?? {}),
      metricAvailability('sleep', sleepScore100),
      metricAvailability('activity', ownActivityScore),
      // #2423. The two lowest-coverage pillars. Present/absent only, like sleep and activity: neither
      // has contributors, and inventing some so they could say `awaiting_baseline` would be a claim
      // nothing computes. Stress is present when today's high-stress minutes were derived (0 is a
      // real reading), or from the switch day Oura sent them; resilience when any recent day published a level.
      metricAvailability('daytimeStress', ringValueStands(todayIso, switchDay)
        ? derivedToday?.stressHighMinutes ?? null
        : (cloudDailyLive ? ouraToday.stressHigh ?? null : null)),
      metricAvailability('resilience', latestResilience?.resilienceLevel ?? null),
    ],
    ...(connectedSourcesSummary ? { connectedSources: connectedSourcesSummary } : {}),
    temperatureDeviation,
    temperatureDeviationSource,
    readinessDisplayScore,
    // Ours only: computeSleepScore(lastSleep). Oura's sleep score is never ours, so a night we
    // could not score shows no score rather than Oura's (scoring doc rule 5, #3000).
    sleepScore:              sleepScore100,
    sleepScoreCoverage:      sleepScoreResult?.coverage ?? null,
    activityScore:           activityBlend.final,
    activityBlend,
    readinessContributors:   null,
    readinessCompositeContributors: ownComposite?.contributors ?? null,
    // Ours only, never Oura's contributors (#3000). The activity components power the Activity
    // detail screen's contributor chart and "how to improve" guide.
    sleepContributors:       ownSleepContributors,
    activityContributors:    activityResult?.components ?? null,
    activityGoals:           activityResult ? { ...goals, moveHoursGoal: activityToday.signals.moveHoursGoal } : null,
    activitySignals:         activityResult
      ? {
          steps: activityToday.signals.steps, activeCalories: activityToday.signals.activeCalories,
          zoneMinutes: activityToday.signals.zoneMinutes, moveHours: activityToday.signals.moveHours,
          sessions7d, volume7dKg,
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
    vo2MaxDate:              cloudVitals?.vo2MaxDate                ?? null,
    vascularAgeDate:         cloudVitals?.vascularAgeDate           ?? null,
    // Derived-when-available (fresh, written by the body-battery read today), else the frozen
    // Cloud seconds ONLY when that row post-dates the re-key. Derived is minutes → convert;
    // response stays seconds (S5). 10c's derived-first coalesce is preserved; item 21 gates
    // only the Cloud fallback.
    stressHigh:              ringStressToday?.stressHighMinutes   != null ? ringStressToday.stressHighMinutes   * 60 : (cloudDailyLive ? ouraToday.stressHigh   ?? null : null),
    recoveryHigh:            ringStressToday?.recoveryHighMinutes != null ? ringStressToday.recoveryHighMinutes * 60 : (cloudDailyLive ? ouraToday.recoveryHigh ?? null : null),
    recommendedBedtimeStart: cloudDailyLive ? ouraToday.recommendedBedtimeStart ?? null : null,
    recommendedBedtimeEnd:   cloudDailyLive ? ouraToday.recommendedBedtimeEnd   ?? null : null,
    isLowWearToday:          isLowWearDay(ouraToday?.nonWearTimeSec),
    baselineHrv,
    recentHrv,
    restingHr:                recentRhr != null ? Math.round(recentRhr) : (baselineRhr != null ? Math.round(baselineRhr) : null),
    restingHrBaseline:        baselineRhr != null ? Math.round(baselineRhr) : null,
    restingHrLastNight:       lastNightRhrRow != null ? Math.round(lastNightRhrRow.restingHeartRate!) : null,
    restingHrLastNightDate:   lastNightRhrRow?.date ?? null,
    illnessFlag:              illness?.flag                          ?? null,
    illnessScore:             illness?.score                         ?? null,
    illnessBiomarkers:        illness?.biomarkers                    ?? null,
    illnessSuppression:       illness?.readinessSuppression          ?? 0,
    illnessAdvisory:          illness ? withDoseContext(illnessAdvisory(illness.flag), recentDoseList) : null,
    recentDoses:              recentDoseList,
    ownResilienceLevel:       latestResilience?.resilienceLevel ?? null,
    ownResilienceBand:        latestResilience?.resilienceLevel != null ? resilienceLevelToBand(latestResilience.resilienceLevel) : null,
    ownResilienceConfidence:  latestResilience?.resilienceConfidence ?? null,
    ownResilienceAsOf:        latestResilience?.day ?? null,
    ownResilienceUnavailable: resilienceUnavailable,
  } satisfies ReadinessScoreResponse
}
