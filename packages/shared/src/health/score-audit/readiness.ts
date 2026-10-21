import {
  computeReadinessComposite,
  rederiveReadinessFromStored,
  READINESS_MODEL,
  READINESS_WEIGHTS,
  BASELINE_MIN_NIGHTS,
} from '@trainingai/shared/health/readiness-composite'
import { scoreBand } from '@trainingai/shared/health/score-band'
import { applyIllnessSuppression, computeIllnessRadar, illnessAdvisory, storedReadinessMatches } from '@trainingai/shared/health/illness-radar'
import type { OuraDailySummaryRow, OuraDailyDerivedRow, OuraDailyRow } from '@/lib/data/repository'
import {
  resolveReadinessNightInputs, compositeNightFields, illnessNightFields,
  RING_SUMMARY_SOURCE, type NightInputSources, type NightInput, type NightInputKey,
} from '@/lib/health/readiness-night-inputs'
import { fixedWeightContributors, contributionSum, type ContributorSpec } from './contributors'
import type { PillarAudit } from './types'

export interface ReadinessAuditInput {
  date: string
  /** The summary row for `date`, and the newest one strictly before it (the pre-update baseline). */
  summary: OuraDailySummaryRow | null
  priorSummary: OuraDailySummaryRow | null
  /** Our own sleep score for the night ending on `date`. */
  sleepScore: number | null
  /** Our own PRE-taper activity score for `date` and for the day before. */
  activityScore: number | null
  prevDayActivityScore: number | null
  ouraDaily: OuraDailyRow | null
  derived: OuraDailyDerivedRow | null
  /**
   * #3077: the generic per-device values readiness v8 falls back to when the ring's summary cannot
   * score an input (Oura Cloud, Health Connect, manual). Left out, the audit sees the ring alone.
   */
  generic?: Pick<NightInputSources, 'bodyMetrics' | 'nights' | 'ouraDaily' | 'ouraCloudContributors'>
}

const r3 = (n: number | null) => (n == null ? null : Math.round(n * 1000) / 1000)
const pct = (w: number) => `${Math.round(w * 100)}%`
const BASELINE_RELATIVE_WEIGHT = READINESS_WEIGHTS.restingHeartRate + READINESS_WEIGHTS.hrvBalance
  + READINESS_WEIGHTS.temperature + READINESS_WEIGHTS.sleepBalance

export function buildReadinessAudit(input: ReadinessAuditInput): PillarAudit {
  const { date, summary, priorSummary, sleepScore, activityScore, prevDayActivityScore, ouraDaily, derived } = input

  const gaps: string[] = []
  const notes: string[] = []

  // #3077: the same per-input, per-device choice the live score makes (`resolveReadinessNightInputs`),
  // so the audit explains today's model, not the ring-only v7 path. An audit, not a score: nothing
  // here is stored.
  const generic = input.generic ?? { bodyMetrics: [], nights: [], ouraDaily: [], ouraCloudContributors: [] }
  const night = resolveReadinessNightInputs({
    today: date,
    summaries: [priorSummary, summary].filter((r): r is NonNullable<typeof r> => r != null),
    ...generic,
  })
  const { rhrZ, hrvZ, tempZ, breathZ } = illnessNightFields(night)
  const sleepBalanceZ = night.inputs.sleepBalance?.z ?? null
  const sourceLabel = (key: NightInputKey, ringColumn: string): string => {
    const src = night.inputs[key]?.source
    return src == null || src === RING_SUMMARY_SOURCE ? ringColumn : `${src} (${night.inputs[key]!.nights} earlier nights of its own)`
  }
  // The raw reading behind an input's z: the ring's column, or the generic row the z was judged from.
  const generic$ = night.nightDate
  const rawValue = (key: NightInputKey): number | null => {
    const src = night.inputs[key]?.source
    if (src == null) return null
    if (src === RING_SUMMARY_SOURCE) {
      return key === 'restingHeartRate' ? summary?.rhrLowBpm ?? null : key === 'hrvBalance' ? summary?.hrvAvgMs ?? null
        : key === 'temperature' ? summary?.tempDevC ?? null : key === 'sleepBalance' ? summary?.sleepDurationHours ?? null : null
    }
    const m = generic.bodyMetrics.find(r => r.date === generic$)
    const n = generic.nights.find(r => r.date === generic$)
    const o = generic.ouraDaily.find(r => r.date === generic$)
    return key === 'restingHeartRate' ? m?.restingHeartRate ?? null : key === 'hrvBalance' ? m?.hrvMs ?? null
      : key === 'temperature' ? o?.temperatureDeviation ?? null : key === 'sleepBalance' ? n?.durationHours ?? null : null
  }

  const latestSummary = summary ?? priorSummary
  const genericHrvCount = generic.bodyMetrics.filter(m => (m.hrvMs ?? 0) > 0).length
  const genericRhrCount = generic.bodyMetrics.filter(m => (m.restingHeartRate ?? 0) > 0).length
  const hasGenericRecoverySignal = sleepScore != null || genericHrvCount >= 2 || genericRhrCount >= 2
  const genericHistoryDays = new Set([
    ...generic.bodyMetrics.filter(m => (m.hrvMs ?? 0) > 0 || (m.restingHeartRate ?? 0) > 0).map(m => m.date),
    ...generic.nights.map(n => n.date),
  ]).size
  // As the payload counts it: the newest summary's own count, else the generic nights before tonight.
  const nHistory = latestSummary?.nHistory ?? Math.max(0, genericHistoryDays - 1)

  const composite = (latestSummary || hasGenericRecoverySignal) ? computeReadinessComposite({
    ...compositeNightFields(night),
    previousNightScore: sleepScore,
    prevDayActivityScore,
    activityBalanceScore: activityScore,
    nHistory,
  }) : null

  const illness = composite
    ? computeIllnessRadar(illnessNightFields(night))
    : null

  if (!composite) {
    gaps.push(
      `No oura_daily_summary row for ${date} and no other recovery signal — without one there are no personal baselines, so the ` +
      'composite cannot run at all and readiness falls back to the crude sleep+HRV+RHR+load estimate.',
    )
  } else if (!night.ringSummary) {
    notes.push(
      `No ring summary row for ${date}: the inputs come from other devices, each judged against its own earlier nights ` +
      `(${(Object.entries(night.inputs) as [string, NightInput][]).map(([k, i]) => `${k}: ${i.source}`).join(', ') || 'none'}).`,
    )
  }
  if (composite && nHistory < BASELINE_MIN_NIGHTS) {
    gaps.push(
      `Baselines are still cold (${nHistory}/${BASELINE_MIN_NIGHTS} nights). All four baseline-relative ` +
      `contributors — resting HR, HRV balance, temperature, sleep balance (${pct(BASELINE_RELATIVE_WEIGHT)} of the total weight) — are ` +
      'pinned to a neutral 50, so the score is driven almost entirely by the sleep and activity terms.',
    )
  }
  if (night.recoveryIndex == null) gaps.push('No Recovery Index (needs an overnight HR series) — contributor neutral at 50.')
  if (sleepScore == null) gaps.push(`No sleep score for the previous night — its ${pct(READINESS_WEIGHTS.previousNight)} weight sits neutral at 50.`)

  if (illness && illness.readinessSuppression > 0) {
    notes.push(
      `Illness radar flagged "${illness.flag}" (score ${illness.score}) and subtracted ` +
      `${illness.readinessSuppression} points from the displayed readiness. ${illnessAdvisory(illness.flag) ?? ''}`.trim(),
    )
  }
  if (ouraDaily?.readinessScore != null) {
    notes.push(
      `Oura Cloud also reports readiness ${ouraDaily.readinessScore} for this day. Since the BLE re-key the ` +
      'Cloud value is frozen and is NOT what the app serves — it is listed here for comparison only.',
    )
  }

  const compositeScore = composite?.score ?? null
  const displayedScore = compositeScore != null && illness
    ? applyIllnessSuppression(compositeScore, illness.readinessSuppression)
    : compositeScore

  const c = composite?.contributors
  const specs = c ? ([
    {
      key: 'restingHeartRate', label: 'Resting HR vs baseline',
      input: {
        value: rawValue('restingHeartRate'), unit: 'bpm', source: sourceLabel('restingHeartRate', 'oura_daily_summary.rhr_low_bpm'),
        note: `z = ${r3(rhrZ) ?? '—'} vs the prior night's baseline; lower-is-better.`,
      },
      subScore: c.restingHeartRate.score, provisional: c.restingHeartRate.provisional,
      excludedReason: nHistory < BASELINE_MIN_NIGHTS ? `baseline cold (${nHistory}/${BASELINE_MIN_NIGHTS} nights) → neutral 50` : 'no reading → neutral 50',
    },
    {
      key: 'previousNight', label: "Previous night's sleep score",
      input: { value: sleepScore, unit: '0-100', source: 'computeSleepScore (see the Sleep pillar)' },
      subScore: c.previousNight.score, provisional: c.previousNight.provisional,
      excludedReason: 'no scoreable sleep session → neutral 50',
    },
    {
      key: 'hrvBalance', label: 'HRV vs baseline',
      input: {
        value: rawValue('hrvBalance'), unit: 'ms rMSSD', source: sourceLabel('hrvBalance', 'oura_daily_summary.hrv_avg_ms'),
        note: `z = ${r3(hrvZ) ?? '—'}; higher-is-better.`,
      },
      subScore: c.hrvBalance.score, provisional: c.hrvBalance.provisional,
      excludedReason: nHistory < BASELINE_MIN_NIGHTS ? `baseline cold (${nHistory}/${BASELINE_MIN_NIGHTS} nights) → neutral 50` : 'no reading → neutral 50',
    },
    {
      key: 'temperature', label: 'Skin temperature vs baseline',
      input: {
        value: rawValue('temperature'), unit: '°C deviation', source: sourceLabel('temperature', 'oura_daily_summary.temp_dev_c'),
        note: `z = ${r3(tempZ) ?? '—'}; closer-to-baseline-is-better (deviation either way is a fever/illness signal).`,
      },
      subScore: c.temperature.score, provisional: c.temperature.provisional,
      excludedReason: nHistory < BASELINE_MIN_NIGHTS ? `baseline cold (${nHistory}/${BASELINE_MIN_NIGHTS} nights) → neutral 50` : 'no reading → neutral 50',
    },
    {
      key: 'sleepBalance', label: 'Sleep duration vs baseline',
      input: {
        value: rawValue('sleepBalance'), unit: 'h', source: sourceLabel('sleepBalance', 'oura_daily_summary.sleep_duration_hours'),
        note: `z = ${r3(sleepBalanceZ) ?? '—'} vs the prior night's sleep baseline; higher-is-better.`,
      },
      subScore: c.sleepBalance.score, provisional: c.sleepBalance.provisional,
      excludedReason: nHistory < BASELINE_MIN_NIGHTS ? `baseline cold (${nHistory}/${BASELINE_MIN_NIGHTS} nights) → neutral 50` : 'no prior sleep baseline → neutral 50',
    },
    {
      key: 'prevDayActivity', label: "Previous day's activity",
      input: { value: prevDayActivityScore, unit: '0-100', source: 'computeActivityScore for the prior day' },
      subScore: c.prevDayActivity.score, provisional: c.prevDayActivity.provisional,
      excludedReason: 'no activity data for the prior day → neutral 50',
    },
    {
      key: 'recoveryIndex', label: 'Recovery index',
      input: {
        value: night.recoveryIndex && 'hours' in night.recoveryIndex ? night.recoveryIndex.hours : null, unit: 'h',
        source: night.recoveryIndex && 'contributor' in night.recoveryIndex
          ? `oura_cloud readiness contributor recovery_index = ${night.recoveryIndex.contributor} (no hours)`
          : 'oura_daily_summary.recovery_index_hours',
        note: `Hours from the overnight HR minimum to wake; linear to 100 at ${READINESS_MODEL.recoveryIndexOptimalHours} h. Approximation — always flagged provisional.`,
      },
      subScore: c.recoveryIndex.score, provisional: c.recoveryIndex.provisional,
      excludedReason: 'no overnight HR series → neutral 50',
    },
    {
      key: 'activityBalance', label: "Today's activity (pre-taper)",
      input: { value: activityScore, unit: '0-100', source: 'computeActivityScore pre-taper (see the Activity pillar)' },
      subScore: c.activityBalance.score, provisional: c.activityBalance.provisional,
      excludedReason: 'nothing scoreable for today → neutral 50',
    },
  ] satisfies (ContributorSpec & { subScore: number; provisional: boolean })[]) : []

  const contributors = fixedWeightContributors(specs, READINESS_WEIGHTS)
  const storedScore = derived?.readinessScore ?? null
  // #3086: a stored score is the served one (after the suppression for the flag stored beside it), or
  // on a row written before #3086 the composite itself; either is "this composite".
  const isStored = (composite: number) => storedScore != null && storedReadinessMatches(storedScore, composite, derived?.illnessFlag)

  // Q-501 — does the STORED score follow from the inputs stored beside it?
  //
  // Everything above recomputes from today's summary, so it can only say *that* a stored score
  // disagrees, never why. The two reasons need opposite responses: an input that was recomputed
  // after the fact is a data question, a model that moved is a calibration question. Contributors
  // persist their own input from 2026-08-26, which is what makes the two separable at all.
  const rederived = rederiveReadinessFromStored(derived?.readinessContributors)
  if (storedScore != null && rederived) {
    if (rederived.uncheckable.length > 0) {
      notes.push(
        `The stored contributors carry no inputs for ${rederived.uncheckable.join(', ')} — this row ` +
        'predates the inputs being persisted (Q-501), so those terms cannot be checked against the ' +
        'model that wrote them, only against today\'s summary.',
      )
    }
    if (rederived.missing.length > 0) {
      // TN-49 — this branch exists because its absence produced a false finding. A key absent from
      // the stored map used to have its WEIGHT dropped from a sum defined to total 1, so `score`
      // came out low by about `weight × 50` and the row below then announced that the score "IS
      // reproducible" while printing a number that was not the stored one. Seven production rows
      // (2026-07-16 → 07-22) were missing `checkin` and read 4–6 points low for that reason alone,
      // until #2224 took `checkin` out of the model.
      notes.push(
        `The stored contributors do not include ${rederived.missing.join(', ')} at all, so this row ` +
        'cannot be checked against its own inputs in full. The re-derivation assumes the neutral 50 ' +
        'the model itself uses for a contributor with no input, which is the closest the row ' +
        `supports — it gives ${rederived.score} against a stored ${storedScore}. Treat any ` +
        'difference here as unexplained rather than as the model having moved.',
      )
    }
    if (rederived.drifted.length > 0) {
      notes.push(
        `The stored score is NOT reproducible from its own stored inputs: ` +
        rederived.drifted.map(d => `${d.key} stored ${d.stored}, current model gives ${d.rederived}`).join('; ') +
        `. The current model rebuilds this row's inputs into ${rederived.score} against a stored ` +
        `${storedScore} — so the MODEL moved since this day was scored, not the inputs.`,
      )
    } else if (
      rederived.uncheckable.length === 0 && rederived.missing.length === 0 && !isStored(rederived.score)
    ) {
      // Every contributor reproduces and the total still does not: the WEIGHTS moved, which no
      // per-contributor check can see. Every row scored before #2224 lands here, because it was
      // weighted with the check-in's 0.10 still in the sum. Without this branch the one below would
      // call those rows reproducible and blame the difference on the inputs.
      const version = (derived?.modelVersions as { readiness?: unknown } | null)?.readiness
      notes.push(
        `Every stored contributor reproduces under the current model, but they combine to ` +
        `${rederived.score} against a stored ${storedScore}: the WEIGHTS moved since this day was ` +
        `scored (stored model ${typeof version === 'string' ? version : 'unstamped'}, current ` +
        `${READINESS_MODEL.modelVersion}), not the inputs.`,
      )
    } else if (
      rederived.uncheckable.length === 0 && rederived.missing.length === 0 &&
      compositeScore != null && !isStored(compositeScore)
    ) {
      notes.push(
        `The stored score IS reproducible from its own stored inputs (${rederived.score}), so the ` +
        `model has not moved — the ${storedScore} → ${compositeScore} difference against this ` +
        'recompute is an INPUT change: the summary this day derives from was rewritten after the ' +
        'derived row was written, and nothing recomputed the row in step.',
      )
    }
  }

  return {
    pillar: 'readiness',
    label: 'Readiness',
    // What /api/readiness-score persists: since #3086 the score shown on screen, AFTER the illness
    // suppression, with the radar's fields beside it. The backfill must write the same thing or a
    // recomputed day would silently disagree with a live-computed one.
    persist: composite && displayedScore != null ? {
      score: displayedScore, contributors: composite.contributors,
      illnessFlag: illness?.flag ?? null, illnessScore: illness?.score ?? null, illnessBiomarkers: illness?.biomarkers ?? null,
    } : null,
    score: displayedScore,
    band: displayedScore != null ? scoreBand(displayedScore).label : null,
    source: composite ? 'own-composite (computeReadinessComposite)' : 'no-data (no daily summary for this day)',
    model: READINESS_MODEL,
    inputs: {
      compositeScore: { value: compositeScore, unit: '0-100', note: 'Weighted composite before the illness suppression.' },
      illnessSuppression: { value: illness?.readinessSuppression ?? 0, unit: 'points subtracted' },
      displayedScore: { value: displayedScore, unit: '0-100' },
      nHistory: { value: nHistory, unit: 'nights', source: 'oura_daily_summary.n_history', note: `Baselines mature at ${BASELINE_MIN_NIGHTS} nights.` },
      rhrZ: { value: r3(rhrZ) }, hrvZ: { value: r3(hrvZ) }, tempZ: { value: r3(tempZ) },
      breathZ: { value: r3(breathZ), note: 'Feeds the illness radar only, not a weighted contributor.' },
      sleepBalanceZ: { value: r3(sleepBalanceZ) },
      rhrLowBpm: { value: summary?.rhrLowBpm ?? null, unit: 'bpm' },
      rhrAvgBpm: { value: summary?.rhrAvgBpm ?? null, unit: 'bpm' },
      hrvAvgMs: { value: summary?.hrvAvgMs ?? null, unit: 'ms rMSSD' },
      tempMeanC: { value: summary?.tempMeanC ?? null, unit: '°C' },
      tempDevC: { value: summary?.tempDevC ?? null, unit: '°C' },
      breathAvgRpm: { value: summary?.breathAvgRpm ?? null, unit: 'breaths/min' },
      recoveryIndexHours: { value: summary?.recoveryIndexHours ?? null, unit: 'h' },
      metAvg: { value: summary?.metAvg ?? null, unit: 'MET' },
      illnessFlag: { value: illness?.flag ?? null },
      illnessScore: { value: illness?.score ?? null, unit: '0-100' },
      illnessBiomarkers: { value: illness ? JSON.stringify(illness.biomarkers) : null },
      contributionSum: {
        value: contributionSum(contributors),
        note: 'Weights are absolute here (they sum to 1.00), so this should equal compositeScore '
          + 'before rounding.',
      },
      priorSummaryDate: { value: priorSummary?.date ?? null, note: 'The baseline state every z-score above is measured against.' },
      baselines: {
        value: summary ? JSON.stringify({
          hrv: summary.hrvBaseline, rhr: summary.rhrBaseline, temp: summary.tempBaseline,
          sleep: summary.sleepBaseline, breath: summary.breathBaseline, met: summary.metBaseline,
        }) : null,
        source: 'oura_daily_summary baseline state (prior night)',
        note: 'Raw EMA baseline state — mean/deviation/n — for each tracked signal.',
      },
      ouraCloudReadiness: {
        value: ouraDaily?.readinessScore ?? null,
        source: 'oura_daily.readiness_score',
        note: 'Frozen since the BLE re-key. Comparison only.',
      },
    },
    contributors,
    gaps,
    stored: {
      score: storedScore,
      contributors: derived?.readinessContributors ?? null,
      source: derived?.readinessSource ?? null,
      rederived,
    },
    storedMatchesRecompute: storedScore != null && compositeScore != null ? isStored(compositeScore) : null,
    notes,
  }
}
