import { formatInTimeZone } from 'date-fns-tz'
import {
  computeSleepScore,
  sleepScoreBaselines,
  SLEEP_MODEL,
  SLEEP_WEIGHTS,
  SLEEP_HRV_BASELINE_MIN_NIGHTS,
  SLEEP_HR_BASELINE_MIN_NIGHTS,
  SLEEP_SCHEDULE_MIN_NIGHTS,
  SLEEP_AWAKE_FRACTION_BASELINE_MIN_NIGHTS,
  MAIN_SLEEP_MIN_HOURS,
  sleepComponentsToContributors,
} from '@trainingai/shared/health/sleep-score'
import { scoreBand } from '@trainingai/shared/health/score-band'
import { nightSessions } from '@trainingai/shared/health/sleep-night'

import type { SleepSession } from '@trainingai/shared/types/body'
import type { OuraDailyDerivedRow } from '@/lib/data/repository'
import { renormalisedContributors, contributionSum, type ContributorSpec } from './contributors'
import type { PillarAudit } from './types'

/** Sum of every Sleep-Score weight — the denominator the audit quotes when a contributor drops out. */
const TOTAL_SLEEP_WEIGHT = Object.values(SLEEP_WEIGHTS).reduce((a, b) => a + b, 0)

/** A fractional local hour rendered as HH:MM, for the audit's habitual bed/wake note. */
function hhmm(hour: number): string {
  const h = Math.floor(hour) % 24
  const m = Math.round((hour - Math.floor(hour)) * 60)
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export interface SleepAuditInput {
  date: string
  tz: string
  /** All sessions in the history window, any order. */
  sleepSessions: SleepSession[]
  derived: OuraDailyDerivedRow | null
}

/** The night scored for a given wake day, plus every prior night (newest first) for the baseline. */
function splitNights(sessions: SleepSession[], date: string, tz: string) {
  // Nights, not sessions — a post-waking nap must never be picked as "the night" (F-1/Q-1), and a
  // night broken by a wake-up must come back as one. Shared derivation: lib/health/sleep-night.ts.
  const nights = nightSessions(sessions, tz)
  const night = nights.find(s => s.date === date) ?? null
  const prior = night
    ? nights.filter(s => s.sleepEnd.getTime() < night.sleepEnd.getTime())
    : nights.filter(s => s.date < date)
  return { night, prior }
}

export function buildSleepAudit(input: SleepAuditInput): PillarAudit {
  const { date, tz, sleepSessions, derived } = input
  const { night, prior } = splitNights(sleepSessions, date, tz)

  const gaps: string[] = []
  const notes: string[] = []

  // Personal overnight-HRV baseline — trailing mean of the PRIOR nights only, so the night being
  // scored never contributes to the bar it's judged against. Same rule the readiness route applies.
  const baselines = sleepScoreBaselines(prior, tz)
  const hrvBaselineMs = baselines.hrvBaselineMs
  const priorHrv = prior
    .filter(s => (s.durationHours ?? 0) >= MAIN_SLEEP_MIN_HOURS)
    .map(s => s.averageHrvMs).filter((v): v is number => v != null && v > 0)
  if (hrvBaselineMs == null) {
    gaps.push(
      `Overnight-HRV contributor excluded: only ${priorHrv.length} prior night(s) carry an HRV reading, ` +
      `${SLEEP_HRV_BASELINE_MIN_NIGHTS} needed. Its ${SLEEP_WEIGHTS.hrv} weight redistributes across the rest.`,
    )
  }

  const result = night ? computeSleepScore(night, tz, baselines) : null
  const components = result?.components ?? null

  if (!night) gaps.push(`No sleep session recorded with wake day ${date}.`)
  else if (!result) gaps.push('Sleep session exists but carries no duration, so nothing could be scored.')

  const midpointLocal = night
    ? formatInTimeZone(new Date((night.sleepStart.getTime() + night.sleepEnd.getTime()) / 2), tz, 'HH:mm')
    : null
  const awakeFraction = night?.awakHours != null && night.durationHours != null
    ? night.awakHours / (night.durationHours + night.awakHours)
    : null

  if (night && night.deepSleepHours == null && night.remSleepHours == null) {
    gaps.push(
      `No hypnogram for this night — the REM and Deep contributors (${SLEEP_WEIGHTS.rem + SLEEP_WEIGHTS.deep} of ` +
      `${TOTAL_SLEEP_WEIGHT} weight) are absent and their weight redistributes, which systematically shifts ` +
      'the score toward the duration term.',
    )
  }
  if (baselines.hrBaselineBpm == null) {
    gaps.push(
      `Overnight-HR contributor excluded: fewer than ${SLEEP_HR_BASELINE_MIN_NIGHTS} prior nights carry an ` +
      `average-HR reading. Its ${SLEEP_WEIGHTS.hr} weight redistributes across the rest.`,
    )
  }
  if (baselines.habitualBedHour == null || baselines.habitualWakeHour == null) {
    gaps.push(
      `Schedule contributor excluded: habitual bed/wake times need ${SLEEP_SCHEDULE_MIN_NIGHTS} prior main ` +
      `sleeps. Its ${SLEEP_WEIGHTS.schedule} weight redistributes across the rest.`,
    )
  }
  if (baselines.awakeFractionBaselineMean == null || baselines.awakeFractionBaselineSd == null) {
    gaps.push(
      `Fragmentation cap not evaluated: needs ${SLEEP_AWAKE_FRACTION_BASELINE_MIN_NIGHTS} prior main sleeps ` +
      'with an awake-time reading to build a personal baseline. This is a standalone cap, not a weighted ' +
      'contributor — no weight redistributes when it is unavailable.',
    )
  }
  if (result?.fragmentationCap) {
    const fc = result.fragmentationCap
    notes.push(
      `Awake-time fragmentation cap applied: this night's awake fraction (${fc.awakeFraction}) is ` +
      `${fc.z}sd above the personal trailing mean (${fc.baselineMean}, sd ${fc.baselineSd}), capping the ` +
      `score at ${fc.cap} — the weighted blend alone would have scored ${result.preCapScore}.`,
    )
  }

  const specs: ContributorSpec[] = [
    {
      key: 'totalSleep',
      label: 'Total sleep duration',
      input: { value: night?.durationHours ?? null, unit: 'h', source: 'sleep_sessions.duration_hours' },
    },
    {
      key: 'efficiency',
      label: 'Sleep efficiency',
      input: { value: night?.efficiency ?? null, unit: '%', source: 'sleep_sessions.efficiency' },
    },
    {
      key: 'rem',
      label: 'REM sleep',
      input: { value: night?.remSleepHours ?? null, unit: 'h', source: 'sleep_sessions.rem_sleep_hours' },
      excludedReason: 'no hypnogram for this night',
    },
    {
      key: 'deep',
      label: 'Deep sleep',
      input: { value: night?.deepSleepHours ?? null, unit: 'h', source: 'sleep_sessions.deep_sleep_hours' },
      excludedReason: 'no hypnogram for this night',
    },
    {
      key: 'latency',
      label: 'Sleep-onset latency',
      input: {
        value: night?.onsetLatencySec != null ? night.onsetLatencySec / 60 : null,
        unit: 'min',
        source: 'sleep_sessions.onset_latency_sec',
        note: 'U-curve: falling asleep instantly is penalised as a sleep-debt signal, same as a long onset.',
      },
    },
    {
      key: 'timing',
      label: 'Circadian timing',
      input: {
        value: midpointLocal,
        unit: `local time (${tz})`,
        source: 'derived from sleep_start/sleep_end',
        note: `Scored on circular distance from the ideal ${SLEEP_MODEL.idealMidpointHour}:00 midpoint.`,
      },
    },
    {
      key: 'hrv',
      label: 'Overnight HRV vs personal baseline',
      input: {
        value: night?.averageHrvMs != null && hrvBaselineMs
          ? Math.round((night.averageHrvMs / hrvBaselineMs) * 1000) / 1000
          : null,
        unit: '× baseline',
        source: 'sleep_sessions.average_hrv_ms ÷ trailing prior-night mean',
        note: hrvBaselineMs != null
          ? `Night ${night?.averageHrvMs ?? '—'} ms vs baseline ${Math.round(hrvBaselineMs)} ms from ${priorHrv.length} prior nights.`
          : `Baseline not mature (${priorHrv.length}/${SLEEP_HRV_BASELINE_MIN_NIGHTS} prior nights with HRV).`,
      },
      excludedReason: 'no mature overnight-HRV baseline, or no HRV reading this night',
    },
    {
      key: 'hr',
      label: 'Overnight HR vs personal baseline',
      input: {
        value: night?.avgHeartRate != null && baselines.hrBaselineBpm
          ? Math.round((night.avgHeartRate / baselines.hrBaselineBpm) * 1000) / 1000
          : null,
        unit: '× baseline',
        source: 'sleep_sessions.avg_heart_rate ÷ trailing prior-night mean',
        note: baselines.hrBaselineBpm != null
          ? `Night ${night?.avgHeartRate ?? '—'} bpm vs baseline ${Math.round(baselines.hrBaselineBpm)} bpm. Lower is better.`
          : `Baseline not mature (${SLEEP_HR_BASELINE_MIN_NIGHTS} prior nights with an HR reading needed).`,
      },
      excludedReason: 'no mature overnight-HR baseline, or no HR reading this night',
    },
    {
      key: 'schedule',
      label: 'Schedule vs habitual bed/wake',
      input: {
        value: night && baselines.habitualBedHour != null && baselines.habitualWakeHour != null
          ? `${hhmm(baselines.habitualBedHour)} → ${hhmm(baselines.habitualWakeHour)} habitual`
          : null,
        unit: `local time (${tz})`,
        source: 'derived from prior nights’ sleep_start/sleep_end',
        note: 'Directional: only a LATE bedtime or an EARLY wake is penalised, whichever is worse. '
          + 'An early night or a lie-in is neutral here — duration and circadian timing already price those.',
      },
      excludedReason: 'habitual bed/wake times not yet established',
    },
    {
      key: 'restfulness',
      label: 'Restfulness',
      input: {
        value: awakeFraction != null ? Math.round(awakeFraction * 1000) / 1000 : null,
        unit: 'awake fraction of the sleep window',
        source: 'derived from sleep_sessions.awake_hours + duration_hours',
        note: `Base is efficiency (${night?.efficiency ?? SLEEP_MODEL.restfulnessFallbackBase}), less an ` +
          'awake-fraction penalty. `restless_periods` is NOT scored — the column holds Oura\'s ' +
          'restlessness measure on Cloud nights and a 0–5 awakenings count on BLE nights, which no ' +
          `single curve can serve (finding Q-3). This night's raw value: ${night?.restlessPeriods ?? '—'}.`,
      },
    },
  ]

  const storedScore = derived?.sleepScore ?? null
  if (storedScore != null && result && storedScore !== result.score) {
    notes.push(
      `Stored score ${storedScore} differs from this recompute (${result.score}) — either the model changed ` +
      'since it was persisted, or richer inputs have landed for this night since.',
    )
  }

  const contributors = renormalisedContributors(specs, components, SLEEP_WEIGHTS)

  return {
    pillar: 'sleep',
    label: 'Sleep',
    // Exactly what /api/readiness-score persists for this night — same score, same contributor map.
    persist: result ? { score: result.score, contributors: sleepComponentsToContributors(result.components) } : null,
    score: result?.score ?? null,
    band: result ? scoreBand(result.score).label : null,
    source: night ? 'own-model (computeSleepScore)' : 'no-data',
    model: SLEEP_MODEL,
    inputs: {
      sessionId: { value: night?.id ?? null, source: 'sleep_sessions.id' },
      ouraId: { value: night?.ouraId ?? null, source: 'sleep_sessions.oura_id' },
      sleepStart: { value: night ? formatInTimeZone(night.sleepStart, tz, "yyyy-MM-dd HH:mm") : null, unit: `local (${tz})` },
      sleepEnd: { value: night ? formatInTimeZone(night.sleepEnd, tz, "yyyy-MM-dd HH:mm") : null, unit: `local (${tz})` },
      durationHours: { value: night?.durationHours ?? null, unit: 'h' },
      timeInBedHours: { value: night?.timeInBedHours ?? null, unit: 'h' },
      deepSleepHours: { value: night?.deepSleepHours ?? null, unit: 'h' },
      remSleepHours: { value: night?.remSleepHours ?? null, unit: 'h' },
      lightSleepHours: { value: night?.lightSleepHours ?? null, unit: 'h' },
      awakHours: { value: night?.awakHours ?? null, unit: 'h' },
      awakeFraction: { value: awakeFraction != null ? Math.round(awakeFraction * 1000) / 1000 : null },
      efficiencyPct: { value: night?.efficiency ?? null, unit: '%' },
      onsetLatencySec: { value: night?.onsetLatencySec ?? null, unit: 's' },
      restlessPeriods: { value: night?.restlessPeriods ?? null },
      averageHrvMs: { value: night?.averageHrvMs ?? null, unit: 'ms rMSSD' },
      avgHeartRate: { value: night?.avgHeartRate ?? null, unit: 'bpm' },
      lowestHeartRate: { value: night?.lowestHeartRate ?? null, unit: 'bpm' },
      respiratoryRate: { value: night?.respiratoryRate ?? null, unit: 'breaths/min' },
      hasHypnogram: { value: night?.sleepPhase5Min != null, note: '5-minute stage codes present' },
      hrvBaselineMs: {
        value: hrvBaselineMs != null ? Math.round(hrvBaselineMs * 10) / 10 : null,
        unit: 'ms rMSSD',
        source: `trailing mean of ${priorHrv.length} prior nights`,
      },
      contributionSum: {
        value: contributionSum(contributors),
        note: 'Contributions rebuilt from the rounded sub-scores. Within 1 of `preCapScore` (NOT the ' +
          'final `score` when a fragmentation cap is active — see below) is expected rounding; a wider ' +
          'gap than that would mean a contributor is unaccounted for.',
      },
      preCapScore: {
        value: result?.preCapScore ?? null,
        note: 'The weighted-blend score before the awake-time fragmentation cap. Equal to `score` unless ' +
          'the cap fired.',
      },
      awakeFractionBaselineMean: {
        value: baselines.awakeFractionBaselineMean != null ? Math.round(baselines.awakeFractionBaselineMean * 1000) / 1000 : null,
        source: `trailing mean of ${prior.filter(s => s.awakHours != null && (s.durationHours ?? 0) >= MAIN_SLEEP_MIN_HOURS).length} prior nights`,
      },
      awakeFractionBaselineSd: {
        value: baselines.awakeFractionBaselineSd != null ? Math.round(baselines.awakeFractionBaselineSd * 1000) / 1000 : null,
      },
      fragmentationCap: {
        value: result?.fragmentationCap ? result.fragmentationCap.cap : null,
        note: result?.fragmentationCap
          ? `Fired: ${result.fragmentationCap.z}sd above the personal mean.`
          : 'Not fired this night (either no mature baseline, or the night was within normal range).',
      },
      ouraCloudSleepScore: {
        value: night?.sleepScore ?? null,
        source: 'sleep_sessions.sleep_score',
        note: 'Frozen since the BLE re-key — shown for comparison only, never served as the live score.',
      },
    },
    contributors,
    gaps,
    stored: {
      score: storedScore,
      contributors: derived?.sleepContributors ?? null,
      source: derived?.source ?? null,
    },
    storedMatchesRecompute: storedScore != null && result != null ? storedScore === result.score : null,
    notes,
  }
}
