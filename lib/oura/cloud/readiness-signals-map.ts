// #3610: the Oura Cloud connector's mapping from its stored readiness fields to the generic shapes
// readiness reads (`@trainingai/shared/health/readiness-signals`). Scoring never reads these field
// names; a Fitbit or Health Connect adapter would write its own mapping beside its own connector.
//
// Every value is taken as Oura calculated it (owner, 2026-10-18, #2860) and labelled with the
// connector's source, so the normals it joins are Oura's own.
import type {
  DailyTemperatureDeviation, DailyWear, DaytimeHighRecovery, DaytimeHighStress, OvernightRecoveryHours, RecoveryContributor,
} from '@trainingai/shared/health/readiness-signals'
import { OURA_CLOUD_CONNECTOR } from '@trainingai/shared/health/source-connectors'
import { isPreRekey } from '@/lib/oura/cloud-freshness'

const SOURCE = OURA_CLOUD_CONNECTOR.healthSource

/** `oura_daily.temperature_deviation` (°C from Oura's own baseline), per day. A row from before the
 *  account was re-keyed belongs to the old account: it is marked superseded. */
export function ouraTemperatureDeviations(
  rows: readonly { date: string; temperatureDeviation?: number | null }[],
): DailyTemperatureDeviation[] {
  return rows.flatMap(r => r.temperatureDeviation == null ? [] : [{
    date: r.date, deviationC: r.temperatureDeviation, source: SOURCE, superseded: isPreRekey(r.date),
  }])
}

/** `oura_daily.stress_high`, which Oura sends in seconds, as minutes per day. */
export function ouraDaytimeHighStress(rows: readonly { date: string; stressHigh?: number | null }[]): DaytimeHighStress[] {
  return rows.flatMap(r => r.stressHigh == null ? [] : [{ date: r.date, minutes: r.stressHigh / 60, source: SOURCE }])
}

/** `oura_daily.recovery_high`, which Oura sends in seconds, as minutes per day (#3616). */
export function ouraDaytimeHighRecovery(rows: readonly { date: string; recoveryHigh?: number | null }[]): DaytimeHighRecovery[] {
  return rows.flatMap(r => r.recoveryHigh == null ? [] : [{ date: r.date, minutes: r.recoveryHigh / 60, source: SOURCE }])
}

/** The `recovery_index` readiness contributor (0–100) of `oura_cloud_daily.readiness_contributors`. */
export function ouraRecoveryContributors(
  rows: readonly { date: string; readinessContributors: Record<string, number | null> | null }[],
): RecoveryContributor[] {
  return rows.flatMap(r => {
    const v = r.readinessContributors?.recovery_index
    return typeof v === 'number' ? [{ date: r.date, score: v, source: SOURCE, provenance: `${OURA_CLOUD_CONNECTOR.id} readiness contributor recovery_index` }] : []
  })
}

/** Our recovery-index hours from the 5-minute heart-rate series of each night's main Oura sleep period. */
export function ouraOvernightRecoveryHours(rows: readonly { date: string; hours: number }[]): OvernightRecoveryHours[] {
  return rows.map(r => ({
    date: r.date, hours: r.hours, source: SOURCE,
    provenance: `oura_cloud_sleep_periods.heart_rate (our hours from ${OURA_CLOUD_CONNECTOR.label}'s 5-minute series)`,
  }))
}

/**
 * `oura_daily.non_wear_time_sec`, per day (#3668). A day with no wear time stored has no row. Before
 * the switch the ring's own rollup wrote the column; either way it is the Oura ring's wear, and the
 * low-wear rule judges the day, not the source, so one label serves.
 */
export function ouraDailyWear(rows: readonly { date: string; nonWearTimeSec?: number | null }[]): DailyWear[] {
  return rows.flatMap(r => r.nonWearTimeSec == null ? [] : [{ date: r.date, nonWearSec: r.nonWearTimeSec, source: SOURCE }])
}
