/**
 * #2984 — which value each of last night's readiness inputs comes from, chosen per input rather
 * than per row.
 *
 * The payload used to pick a whole path by row: any `oura_daily_summary` row in the 28-day window
 * sent every input down the ring path, otherwise every input went down the generic one. After the
 * 17 Oct switch to the Oura Cloud API the newest summary row was a partial Bluetooth row, so the
 * ring path ran on a row with almost nothing in it while Oura's own values for the same night sat
 * unread in `body_metrics`, `sleep_sessions` and `oura_daily`.
 *
 * The rule now (owner's rule on #2860, rules 1–4):
 * - **Per input.** Tonight's ring summary wins for an input when it is tonight's row and can score
 *   that input. Otherwise the generic value for the same night is used (Oura Cloud, Health Connect,
 *   manual), taken as the source calculated it.
 * - **Per device.** A generic value is judged against a normal built only from earlier nights of
 *   the same source, so an `oura_cloud` HRV never scores against the ring's nights. While that
 *   normal is shorter than `BASELINE_MIN_NIGHTS`, the input reads `awaiting_baseline`.
 * - **Recovery index.** The ring's hours where tonight's summary has them; otherwise Oura's own
 *   `recovery_index` contributor, because Oura sends no underlying value for it.
 * - **Never Oura's readiness, sleep or activity score.** Nothing here reads them.
 *
 * The composite and the illness radar both read the result through {@link compositeNightFields} and
 * {@link illnessNightFields}, so the two can never disagree about the same night (PS-42).
 */
import { baselineZ, type Baseline } from '@trainingai/shared/health/personal-baseline'
import { illnessZScores, type IllnessSummaryInput } from '@trainingai/shared/health/illness-radar'
import type { BaselineContributorKey, ReadinessCompositeInputs } from '@trainingai/shared/health/readiness-composite'
import { ringValueStands } from '@trainingai/shared/health/source-rank'
import { isPreRekey } from '@/lib/oura/cloud-freshness'
import { trailingBaselineZ } from '@/lib/health/score-availability'

/** The ring summary's label as an input source. */
export const RING_SUMMARY_SOURCE = 'oura_ble'

export type NightInputKey = BaselineContributorKey | 'breathing'

export interface NightInput {
  /** Tonight against this source's own normal. Null while the normal is too young to judge by. */
  z: number | null
  /** Nights in the normal `z` is judged against, counted for this source alone. */
  nights: number
  source: string
}

export type RingSummaryInput = IllnessSummaryInput & {
  date: string
  sleepDurationHours: number | null
  sleepBaseline: Baseline | null
  recoveryIndexHours: number | null
  tempDevC: number | null
}

export interface NightInputSources {
  /** The user's local today. No night is keyed after it, whatever a row's restamped date says. */
  today: string
  /** `oura_daily_summary` rows, any order. */
  summaries: readonly RingSummaryInput[]
  bodyMetrics: readonly {
    date: string
    hrvMs?: number | null
    restingHeartRate?: number | null
    hrvSource?: string | null
    restingHeartRateSource?: string | null
  }[]
  /** One canonical night per wake date. */
  nights: readonly {
    date: string
    durationHours?: number | null
    respiratoryRate?: number | null
    durationSource?: string | null
    respiratoryRateSource?: string | null
  }[]
  /** `oura_daily` rows: Oura's own temperature deviation, already relative to Oura's baseline. */
  ouraDaily: readonly { date: string; temperatureDeviation?: number | null }[]
  /** `oura_cloud_daily.readiness_contributors` per day. */
  ouraCloudContributors: readonly { date: string; readinessContributors: Record<string, number | null> | null }[]
}

export interface ReadinessNightInputs {
  /** The night the inputs are for (its wake date), or null when there is nothing to score. */
  nightDate: string | null
  /** Tonight's ring summary, when there is one for `nightDate`. */
  ringSummary: RingSummaryInput | null
  /** Only the inputs that have a value tonight. */
  inputs: Partial<Record<NightInputKey, NightInput>>
  recoveryIndex:
    | { hours: number; source: typeof RING_SUMMARY_SOURCE }
    | { contributor: number; source: 'oura_cloud' }
    | null
  /** Tonight's temperature deviation in °C for display: the ring's, else Oura's. */
  temperatureDeviation: { value: number; source: 'ble' | 'cloud' } | null
}

const UNKNOWN_SOURCE = 'unknown'

function latestDate(dates: (string | null | undefined)[]): string | null {
  let best: string | null = null
  for (const d of dates) if (d && (best == null || d > best)) best = d
  return best
}

/**
 * Tonight's generic value for one input, judged against earlier nights from the same source.
 *
 * `scale` puts the value into the integer units the baseline fold works in (it rounds every
 * sample): centi-°C for a temperature deviation and rpm×10 for breathing, matching the ring
 * summary's own baselines. Without it a 0.3 °C deviation would round to zero.
 */
function genericInput(
  obs: readonly { date: string; value: number | null | undefined; source: string | null | undefined }[],
  nightDate: string,
  scale = 1,
): NightInput | null {
  const tonight = obs.find(o => o.date === nightDate && o.value != null && Number.isFinite(o.value))
  if (!tonight) return null
  const source = tonight.source ?? UNKNOWN_SOURCE
  const priors = obs
    .filter(o => o.date < nightDate && o.value != null && Number.isFinite(o.value) && (o.source ?? UNKNOWN_SOURCE) === source)
    .sort((a, b) => a.date.localeCompare(b.date))
  // `trailingBaselineZ` holds back a z until the normal has BASELINE_MIN_NIGHTS nights, so a young
  // normal never yields a fabricated extreme; the night count says why it is missing.
  const z = trailingBaselineZ([...priors.map(o => o.value! * scale), tonight.value! * scale])
  return { z, nights: priors.length, source }
}

export function resolveReadinessNightInputs(src: NightInputSources): ReadinessNightInputs {
  const summaries = [...src.summaries].sort((a, b) => a.date.localeCompare(b.date))
  const nightDate = latestDate([
    summaries.at(-1)?.date,
    ...src.nights.map(n => n.date),
    ...src.bodyMetrics.filter(m => (m.hrvMs ?? 0) > 0 || (m.restingHeartRate ?? 0) > 0).map(m => m.date),
  ].filter(d => d != null && d <= src.today))
  if (nightDate == null) return { nightDate: null, ringSummary: null, inputs: {}, recoveryIndex: null, temperatureDeviation: null }

  const latest = summaries.at(-1) ?? null
  const ring = latest?.date === nightDate ? latest : null
  const prior = ring && summaries.length > 1 ? summaries[summaries.length - 2] : null

  const inputs: ReadinessNightInputs['inputs'] = {}

  // The ring's summary, field by field: an input it can score tonight is the ring's.
  if (ring) {
    const z = illnessZScores(prior, ring)
    const sleepZ = prior?.sleepBaseline && ring.sleepDurationHours != null
      ? baselineZ(prior.sleepBaseline, Math.round(ring.sleepDurationHours * 60)) : null
    const fromRing: [NightInputKey, number | null][] = [
      ['restingHeartRate', z.rhrZ], ['hrvBalance', z.hrvZ], ['temperature', z.tempZ],
      ['sleepBalance', sleepZ], ['breathing', z.breathZ],
    ]
    for (const [key, value] of fromRing) {
      if (value != null) inputs[key] = { z: value, nights: ring.nHistory, source: RING_SUMMARY_SOURCE }
    }
  }

  // Everything the ring could not score falls back to the generic value for the same night.
  const generic: Record<NightInputKey, () => NightInput | null> = {
    restingHeartRate: () => genericInput(
      src.bodyMetrics.map(m => ({ date: m.date, value: (m.restingHeartRate ?? 0) > 0 ? m.restingHeartRate : null, source: m.restingHeartRateSource })),
      nightDate),
    hrvBalance: () => genericInput(
      src.bodyMetrics.map(m => ({ date: m.date, value: (m.hrvMs ?? 0) > 0 ? m.hrvMs : null, source: m.hrvSource })),
      nightDate),
    // Oura's deviation is already relative to Oura's own baseline, so it is judged as a deviation
    // against the person's normal of Oura deviations, never as an absolute temperature. Only the
    // Oura Cloud writes this column; a pre-re-key value belongs to the old account.
    temperature: () => genericInput(
      src.ouraDaily.filter(d => !isPreRekey(d.date)).map(d => ({ date: d.date, value: d.temperatureDeviation, source: 'oura_cloud' })),
      nightDate, 100),
    sleepBalance: () => genericInput(
      src.nights.map(n => ({ date: n.date, value: n.durationHours, source: n.durationSource })),
      nightDate, 60),
    breathing: () => genericInput(
      src.nights.map(n => ({ date: n.date, value: n.respiratoryRate, source: n.respiratoryRateSource })),
      nightDate, 10),
  }
  for (const key of Object.keys(generic) as NightInputKey[]) {
    if (inputs[key]) continue
    const value = generic[key]()
    if (value) inputs[key] = value
  }

  let recoveryIndex: ReadinessNightInputs['recoveryIndex'] = null
  if (ring?.recoveryIndexHours != null && Number.isFinite(ring.recoveryIndexHours)) {
    recoveryIndex = { hours: ring.recoveryIndexHours, source: RING_SUMMARY_SOURCE }
  } else {
    const c = src.ouraCloudContributors.find(r => r.date === nightDate)?.readinessContributors?.recovery_index
    if (typeof c === 'number' && Number.isFinite(c)) recoveryIndex = { contributor: c, source: 'oura_cloud' }
  }

  const cloudTemp = src.ouraDaily.find(d => d.date === nightDate)?.temperatureDeviation ?? null
  const temperatureDeviation: ReadinessNightInputs['temperatureDeviation'] = ring?.tempDevC != null
    ? { value: ring.tempDevC, source: 'ble' }
    : cloudTemp != null ? { value: cloudTemp, source: 'cloud' } : null

  return { nightDate, ringSummary: ring, inputs, recoveryIndex, temperatureDeviation }
}

const COMPOSITE_KEYS: BaselineContributorKey[] = ['restingHeartRate', 'hrvBalance', 'temperature', 'sleepBalance']

/** The night half of `computeReadinessComposite`'s input. The caller adds the day-level scores. */
export function compositeNightFields(r: ReadinessNightInputs): Pick<ReadinessCompositeInputs,
  'rhrZ' | 'hrvZ' | 'tempZ' | 'sleepBalanceZ' | 'baselineNights' | 'sources' | 'recoveryIndexHours' | 'recoveryIndexContributor'> {
  const baselineNights: NonNullable<ReadinessCompositeInputs['baselineNights']> = {}
  const sources: NonNullable<ReadinessCompositeInputs['sources']> = {}
  for (const key of COMPOSITE_KEYS) {
    const input = r.inputs[key]
    if (!input) continue
    baselineNights[key] = input.nights
    sources[key] = input.source
  }
  if (r.recoveryIndex) sources.recoveryIndex = r.recoveryIndex.source
  return {
    rhrZ: r.inputs.restingHeartRate?.z ?? null,
    hrvZ: r.inputs.hrvBalance?.z ?? null,
    tempZ: r.inputs.temperature?.z ?? null,
    sleepBalanceZ: r.inputs.sleepBalance?.z ?? null,
    baselineNights,
    sources,
    recoveryIndexHours: r.recoveryIndex && 'hours' in r.recoveryIndex ? r.recoveryIndex.hours : null,
    recoveryIndexContributor: r.recoveryIndex && 'contributor' in r.recoveryIndex ? r.recoveryIndex.contributor : null,
  }
}

/**
 * The illness radar's input: the SAME z-scores the composite reads, plus breathing. The radar has
 * one maturity gate, so it gets the youngest normal among the inputs that carry a z: a ring normal
 * still warming up keeps it `learning`, exactly as before, and a generic input only carries a z
 * once its own normal is mature.
 */
export function illnessNightFields(r: ReadinessNightInputs): {
  rhrZ: number | null; hrvZ: number | null; tempZ: number | null; breathZ: number | null; nHistory: number
} {
  const withZ = Object.values(r.inputs).filter((i): i is NightInput => i?.z != null)
  return {
    rhrZ: r.inputs.restingHeartRate?.z ?? null,
    hrvZ: r.inputs.hrvBalance?.z ?? null,
    tempZ: r.inputs.temperature?.z ?? null,
    breathZ: r.inputs.breathing?.z ?? null,
    nHistory: withZ.length ? Math.min(...withZ.map(i => i.nights)) : 0,
  }
}

/** One night's resting HR and HRV as the vitals overlays show them, each labelled by its source. */
export interface NightVital {
  date: string
  restingHr: number | null
  hrvMs: number | null
  restingHrSource: string | null
  hrvSource: string | null
  /** The ring's stored baseline for that night. Null from the switch day: the Oura API sends none. */
  restingHrBaseline: { meanX8: number } | null
  hrvBaseline: { meanX8: number } | null
}

export interface NightVitalsSources {
  /** `oura_daily_summary` rows (the ring's own rollup). */
  summaries: readonly {
    date: string
    rhrLowBpm: number | null
    hrvAvgMs: number | null
    rhrBaseline?: { meanX8: number } | null
    hrvBaseline?: { meanX8: number } | null
  }[]
  /** The same generic rows readiness reads (`hrvSource` / `restingHeartRateSource` say which device). */
  bodyMetrics: readonly {
    date: string
    hrvMs?: number | null
    restingHeartRate?: number | null
    hrvSource?: string | null
    restingHeartRateSource?: string | null
  }[]
  switchDay: string | null
  from: string
  to: string
}

/**
 * Resting HR and HRV per night for the overlays (dose vitals, heart response). Before the switch to
 * the Oura API the ring summary stands, exactly as before. From the switch day the ring's rows are
 * partial leftovers (`ringValueStands`), so the night comes from the same generic values readiness
 * v8 scores (`resolveReadinessNightInputs`), labelled by the device that measured it.
 */
export function nightVitals(src: NightVitalsSources): NightVital[] {
  const out: NightVital[] = []
  for (const s of src.summaries) {
    if (s.date < src.from || s.date > src.to || !ringValueStands(s.date, src.switchDay)) continue
    out.push({
      date: s.date, restingHr: s.rhrLowBpm, hrvMs: s.hrvAvgMs,
      restingHrSource: s.rhrLowBpm != null ? RING_SUMMARY_SOURCE : null,
      hrvSource: s.hrvAvgMs != null ? RING_SUMMARY_SOURCE : null,
      restingHrBaseline: s.rhrBaseline ?? null, hrvBaseline: s.hrvBaseline ?? null,
    })
  }
  for (const m of src.bodyMetrics) {
    if (m.date < src.from || m.date > src.to || ringValueStands(m.date, src.switchDay)) continue
    const rhr = (m.restingHeartRate ?? 0) > 0 ? m.restingHeartRate! : null
    const hrv = (m.hrvMs ?? 0) > 0 ? m.hrvMs! : null
    if (rhr == null && hrv == null) continue
    out.push({
      date: m.date, restingHr: rhr, hrvMs: hrv,
      restingHrSource: rhr != null ? m.restingHeartRateSource ?? UNKNOWN_SOURCE : null,
      hrvSource: hrv != null ? m.hrvSource ?? UNKNOWN_SOURCE : null,
      restingHrBaseline: null, hrvBaseline: null,
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * The `readiness_source` label stored beside a score: what actually fed it. Before the switch to the
 * Oura API the ring's summary row is the source whenever one exists. From the switch day the row is a
 * partial leftover (`ringValueStands`), so the label is the ring's only if one of the night's inputs
 * really came from it; otherwise the score was built from Oura's and the generic values.
 */
export function readinessSourceLabel(
  night: ReadinessNightInputs,
  hasSummaryRow: boolean,
  switchDay: string | null | undefined,
): 'ble-derived' | 'generic-derived' {
  if (night.nightDate != null && !ringValueStands(night.nightDate, switchDay)) {
    return Object.values(night.inputs).some(i => i?.source === RING_SUMMARY_SOURCE) ? 'ble-derived' : 'generic-derived'
  }
  return hasSummaryRow ? 'ble-derived' : 'generic-derived'
}
