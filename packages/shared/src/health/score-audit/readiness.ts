import {
  computeReadinessComposite,
  checkinScoreFromEnergy,
  rederiveReadinessFromStored,
  READINESS_MODEL,
  READINESS_WEIGHTS,
  BASELINE_MIN_NIGHTS,
} from '@trainingai/shared/health/readiness-composite'
import { baselineZ } from '@trainingai/shared/health/personal-baseline'
import { scoreBand } from '@trainingai/shared/health/score-band'
import { computeIllnessRadar, illnessZScores, illnessAdvisory } from '@trainingai/shared/health/illness-radar'
import type { OuraDailySummaryRow, OuraDailyDerivedRow, OuraDailyRow } from '@/lib/data/repository'
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
  /** The morning check-in's energy level, if logged. */
  checkinEnergy: string | null
  ouraDaily: OuraDailyRow | null
  derived: OuraDailyDerivedRow | null
}

const r3 = (n: number | null) => (n == null ? null : Math.round(n * 1000) / 1000)

export function buildReadinessAudit(input: ReadinessAuditInput): PillarAudit {
  const { date, summary, priorSummary, sleepScore, activityScore, prevDayActivityScore, checkinEnergy, ouraDaily, derived } = input

  const gaps: string[] = []
  const notes: string[] = []

  const { rhrZ, hrvZ, tempZ, breathZ } = summary
    ? illnessZScores(priorSummary, summary)
    : { rhrZ: null, hrvZ: null, tempZ: null, breathZ: null }

  const sleepBalanceZ = priorSummary?.sleepBaseline && summary?.sleepDurationHours != null
    ? baselineZ(priorSummary.sleepBaseline, Math.round(summary.sleepDurationHours * 60))
    : null

  const checkinScore = checkinScoreFromEnergy(checkinEnergy)
  const nHistory = summary?.nHistory ?? 0

  const composite = summary ? computeReadinessComposite({
    rhrZ, hrvZ, tempZ, sleepBalanceZ,
    previousNightScore: sleepScore,
    prevDayActivityScore,
    activityBalanceScore: activityScore,
    checkinScore,
    nHistory,
    recoveryIndexHours: summary.recoveryIndexHours,
  }) : null

  const illness = summary
    ? computeIllnessRadar({ tempZ, rhrZ, hrvZ, breathZ, nHistory })
    : null

  if (!summary) {
    gaps.push(
      `No oura_daily_summary row for ${date} — without it there are no personal baselines, so the ` +
      'composite cannot run at all and readiness falls back to the crude sleep+HRV+RHR+load estimate.',
    )
  } else if (nHistory < BASELINE_MIN_NIGHTS) {
    gaps.push(
      `Baselines are still cold (${nHistory}/${BASELINE_MIN_NIGHTS} nights). All four baseline-relative ` +
      'contributors — resting HR, HRV balance, temperature, sleep balance (50% of the total weight) — are ' +
      'pinned to a neutral 50, so the score is driven almost entirely by the sleep/activity/check-in terms.',
    )
  }
  if (checkinScore == null) {
    gaps.push(
      'No morning check-in logged — the check-in contributor (weight 0.10) sits at a neutral 50, which ' +
      'caps the attainable readiness at 95 even on a perfect day.',
    )
  }
  if (summary?.recoveryIndexHours == null) gaps.push('No Recovery Index (needs an overnight HR series) — contributor neutral at 50.')
  if (sleepScore == null) gaps.push('No sleep score for the previous night — its 0.16 weight sits neutral at 50.')

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
    ? Math.max(0, compositeScore - illness.readinessSuppression)
    : compositeScore

  const c = composite?.contributors
  const specs = c ? ([
    {
      key: 'restingHeartRate', label: 'Resting HR vs baseline',
      input: {
        value: summary?.rhrLowBpm ?? null, unit: 'bpm', source: 'oura_daily_summary.rhr_low_bpm',
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
        value: summary?.hrvAvgMs ?? null, unit: 'ms rMSSD', source: 'oura_daily_summary.hrv_avg_ms',
        note: `z = ${r3(hrvZ) ?? '—'}; higher-is-better.`,
      },
      subScore: c.hrvBalance.score, provisional: c.hrvBalance.provisional,
      excludedReason: nHistory < BASELINE_MIN_NIGHTS ? `baseline cold (${nHistory}/${BASELINE_MIN_NIGHTS} nights) → neutral 50` : 'no reading → neutral 50',
    },
    {
      key: 'temperature', label: 'Skin temperature vs baseline',
      input: {
        value: summary?.tempDevC ?? null, unit: '°C deviation', source: 'oura_daily_summary.temp_dev_c',
        note: `z = ${r3(tempZ) ?? '—'}; closer-to-baseline-is-better (deviation either way is a fever/illness signal).`,
      },
      subScore: c.temperature.score, provisional: c.temperature.provisional,
      excludedReason: nHistory < BASELINE_MIN_NIGHTS ? `baseline cold (${nHistory}/${BASELINE_MIN_NIGHTS} nights) → neutral 50` : 'no reading → neutral 50',
    },
    {
      key: 'sleepBalance', label: 'Sleep duration vs baseline',
      input: {
        value: summary?.sleepDurationHours ?? null, unit: 'h', source: 'oura_daily_summary.sleep_duration_hours',
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
        value: summary?.recoveryIndexHours ?? null, unit: 'h', source: 'oura_daily_summary.recovery_index_hours',
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
    {
      key: 'checkin', label: 'Morning check-in',
      input: {
        value: checkinEnergy, source: 'mood_logs.energy_level',
        note: `Mapped via ${JSON.stringify(READINESS_MODEL.checkinEnergyScore)}.`,
      },
      subScore: c.checkin.score, provisional: c.checkin.provisional,
      excludedReason: 'no check-in logged → neutral 50',
    },
  ] satisfies (ContributorSpec & { subScore: number; provisional: boolean })[]) : []

  const contributors = fixedWeightContributors(specs, READINESS_WEIGHTS)
  const storedScore = derived?.readinessScore ?? null

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
    if (rederived.drifted.length > 0) {
      notes.push(
        `The stored score is NOT reproducible from its own stored inputs: ` +
        rederived.drifted.map(d => `${d.key} stored ${d.stored}, current model gives ${d.rederived}`).join('; ') +
        `. The current model rebuilds this row's inputs into ${rederived.score} against a stored ` +
        `${storedScore} — so the MODEL moved since this day was scored, not the inputs.`,
      )
    } else if (rederived.uncheckable.length === 0 && storedScore !== compositeScore && compositeScore != null) {
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
    // What /api/readiness-score persists is `ownComposite.score` — the composite BEFORE the illness
    // suppression, not the score shown on screen. The backfill must write the same thing or a
    // recomputed day would silently disagree with a live-computed one.
    persist: composite ? { score: composite.score, contributors: composite.contributors } : null,
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
    storedMatchesRecompute: storedScore != null && compositeScore != null ? storedScore === compositeScore : null,
    notes,
  }
}
