/**
 * #3077 — last night's temperature for the readers that decide training: the prescription's
 * `tempZ` and ai_dynamic's elevated-temperature deload.
 *
 * Both used to read only the ring's `oura_daily_summary`, which stopped when the ring moved to the
 * Oura API (17 Oct), so after the switch the prescription had no temperature and the alert's
 * baseline read 0 nights and could never fire. They now take the night readiness v8 takes, from
 * the same resolver over the same 28-day window (`resolveReadinessNightInputs`): tonight's ring
 * summary where it has one, otherwise Oura's own deviation judged against the person's earlier Oura
 * nights. On a night the ring scored, every number here is the one the ring path gave before.
 */
import type { WorkoutRepository } from '@/lib/data/repository'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { nightSessions, canonicalNightsByDate } from '@trainingai/shared/health/sleep-night'
import { isTemperatureBaselineCentred } from '@trainingai/shared/health/temperature-baseline-health'
import { nightAlgorithmVersion, rowsInNormalGroup } from '@trainingai/shared/health/per-device-normal'
import { TEMP_BASELINE_MIN_DAYS } from '@trainingai/shared/ai-periodization/deload-constants'
import { ouraTemperatureDeviations } from '@/lib/oura/cloud/readiness-signals-map'
import { resolveReadinessNightInputs, readinessWindowStarts } from '@/lib/health/readiness-night-inputs'

export interface NightTemperature {
  /** The night readiness scores (its wake date), or null when there is no night to read. */
  nightDate: string | null
  /** Tonight's temperature z against its own device's normal: readiness v8's `tempZ`. */
  z: number | null
  /** The deviation in °C: the ring's for tonight, else Oura's. */
  deviationC: number | null
  deviationSource: 'ble' | 'cloud' | null
  /**
   * Nights in the normal behind `deviationC`, counted for that device alone: the ring summary's
   * accrued `nHistory`, or the earlier post-re-key nights with a deviation from the same source under
   * the same sleep-algorithm version (#3691), as the z's normal is keyed. Never a mix, so an Oura night
   * cannot borrow the ring's month of history, nor a new algorithm version the old one's.
   */
  baselineNights: number
  /** `isTemperatureBaselineCentred` over the same device's trailing deviations, tonight included. */
  trusted: boolean
}

/**
 * Oura's nights are counted over a window long enough to reach the alert's maturity gate. The
 * resolver itself still reads 28 days, as readiness does, so its z is readiness's z. The count's own
 * sleep sessions span this window too, so each deviation's algorithm version can be looked up (#3691).
 */
const OURA_COUNT_WINDOW_DAYS = TEMP_BASELINE_MIN_DAYS * 2

export async function loadNightTemperature(
  repo: Pick<WorkoutRepository, 'getOuraDailySummary' | 'listBodyMetrics' | 'listSleepSessions' | 'getOuraDaily'>,
  userId: string,
  todayIso: string,
  tz: string,
): Promise<NightTemperature> {
  // Shifted on the local date string, so each window starts at a local midnight.
  const { from28dIso } = readinessWindowStarts(todayIso)
  const fromCountIso = shiftDateStr(todayIso, -OURA_COUNT_WINDOW_DAYS)
  const [summaries, bodyMetrics, sleepSessions, ouraLong, sleepSessionsLong] = await Promise.all([
    repo.getOuraDailySummary(userId, from28dIso, todayIso),
    repo.listBodyMetrics(userId, from28dIso, todayIso),
    repo.listSleepSessions(userId, from28dIso, todayIso),
    repo.getOuraDaily(userId, fromCountIso, todayIso),
    // A separate read, so the resolver's 28-day nights are exactly readiness's.
    repo.listSleepSessions(userId, fromCountIso, todayIso),
  ])
  // #3610: the Oura connector's deviations in the generic shape; the resolver reads only that.
  const temperatures = ouraTemperatureDeviations(ouraLong)

  // The same night assembly readiness uses, so the two agree on which night is "tonight".
  const night = resolveReadinessNightInputs({
    today: todayIso,
    summaries,
    bodyMetrics,
    nights: canonicalNightsByDate(nightSessions(sleepSessions, tz), tz),
    temperatureDeviations: temperatures.filter(t => t.date >= from28dIso),
    // Recovery index only; nothing here reads it.
    recoveryContributors: [],
  })

  const deviation = night.temperatureDeviation
  let baselineNights = 0
  let trusted = false
  if (deviation?.source === 'ble' && night.ringSummary) {
    baselineNights = night.ringSummary.nHistory
    // The 28 nights ending today, as ai_dynamic has always judged the ring's centring (TN-18).
    const from27 = shiftDateStr(todayIso, -27)
    trusted = isTemperatureBaselineCentred(summaries.filter(r => r.date >= from27).map(r => r.tempDevC))
  } else if (deviation?.source === 'cloud' && night.nightDate) {
    const nightDate = night.nightDate
    // #3691: the earlier deviations in tonight's (source, algorithm version) group, by the same rule
    // that keys the z's normal (`rowsInNormalGroup`, versions from `nightAlgorithmVersion`), so a
    // source that changes its algorithm restarts this count with its z.
    const versionOn = nightAlgorithmVersion(canonicalNightsByDate(nightSessions(sleepSessionsLong, tz), tz))
    const tonight = temperatures.find(t => t.date === nightDate)
    const upToTonight = temperatures
      .filter(t => !t.superseded && Number.isFinite(t.deviationC) && t.date <= nightDate)
      .sort((a, b) => a.date.localeCompare(b.date))
    baselineNights = rowsInNormalGroup(upToTonight, t => t.source, t => versionOn(t.date, t.source), {
      source: tonight?.source, algorithmVersion: versionOn(nightDate, tonight?.source),
    }).filter(t => t.date < nightDate).length
    // #3169 (owner, 26 Oct): the temperature deload stays off on Oura's deviation until its new
    // baseline has been checked, however many nights it has. The prescription's `tempZ` is unaffected.
    // Lift this by computing it again: `isTemperatureBaselineCentred` over the same Oura nights.
    trusted = false
  }

  return {
    nightDate: night.nightDate,
    z: night.inputs.temperature?.z ?? null,
    deviationC: deviation?.value ?? null,
    deviationSource: deviation?.source ?? null,
    baselineNights,
    trusted,
  }
}
