/**
 * #2377 — turn stored history into the shadow scorer's unit inputs. **Pure**: the service fetches,
 * this shapes, `score.ts` scores.
 *
 * Every metric is computed by the module that already owns it — the night (`sleep-night`), the
 * mid-sleep clock (`sleep-consistency`), ACWR (`acwr`), WHO minutes (`zone-minutes`), HRR60 and the
 * nightly HRV/RHR inputs (the input layer), low wear (`wear-confidence`), "unwell"
 * (`resolveSelfReportedSick`). Nothing here is a second implementation of a scored metric.
 *
 * **Settled days (owner, 2026-08-26).** For readiness day `D`, night units read the night keyed to
 * `D` (it ended on the morning of `D`); every daytime unit reads `D − 1` or earlier. Nothing dated
 * `D` reaches a daytime unit, and the scorer refuses one that tries.
 */
import { median } from '@trainingai/shared/stats'
import { dateStrMidnightInTz, shiftDateStr, toAestDay } from '@trainingai/shared/date-utils'
import { acwrBaselineDaysRemaining, computeVolumeAcwr, type ProgramAgeInput } from '@trainingai/shared/ai-periodization/acwr'
import { activeMinutesFromZoneSeconds } from '@trainingai/shared/health/zone-minutes'
import { minutesFromNoon } from '@trainingai/shared/health/sleep-consistency'
import { nightSessions, canonicalNightForDate, type AggregatableSleep } from '@trainingai/shared/health/sleep-night'
import { isLowWearDay } from '@trainingai/shared/health/wear-confidence'
import { ringValueStands } from '@trainingai/shared/health/source-rank'
import { hrr60Candidates, nightlyCandidates } from '@trainingai/shared/inputs/adapters'
import { resolveSlots, type InputName } from '@trainingai/shared/inputs/cascade'
import { stepsFloorForAge, type ShadowUnitId } from './model'
import { scoreFuel, type FuelParts, type ShadowContext, type ShadowScoreInput, type UnitInput, type UnitObservation } from './score'

/** What the service reads, for a range of readiness days plus their lookback. */
export interface ShadowRawHistory {
  tz: string
  ageYears: number | null
  /** #2984: `durationSource`/`respiratoryRateSource` name the device, so each normal is per device. */
  sleepSessions: readonly (AggregatableSleep & { date: string; durationSource?: string | null; respiratoryRateSource?: string | null })[]
  bodyMetrics: readonly {
    date: string
    hrvMs?: number | null
    restingHeartRate?: number | null
    steps?: number | null
    spo2Pct?: number | null
    /** #2984: the device behind `hrvMs` / `restingHeartRate` (`source_map`). */
    hrvSource?: string | null
    restingHeartRateSource?: string | null
    /** #2825: the device behind `steps` / `spo2Pct` (`source_map`). */
    stepsSource?: string | null
    spo2Source?: string | null
  }[]
  dailySummaries: readonly { date: string; recoveryIndexHours: number | null; tempDevC: number | null; breathAvgRpm: number | null }[]
  /** `oura_daily` rows: wear time for low-wear exclusion, Oura's own temperature deviation (#2984)
   *  and its `stress_high` in seconds (#2985). */
  wear: readonly { date: string; nonWearTimeSec?: number | null; temperatureDeviation?: number | null; stressHigh?: number | null }[]
  derived: readonly { day: string; stressHighMinutes: number | null }[]
  /** `oura_cloud_daily.readiness_contributors` per day: Oura's `recovery_index` stands in for the ring's
   *  hours on a night the ring's summary has none (#3001), as the live composite takes it (rule 4). */
  ouraCloudContributors?: readonly { date: string; readinessContributors: Record<string, number | null> | null }[]
  /** The local day the user switched to the Oura API (`getOuraCloudSwitchDay`), or null. */
  ouraCloudFrom?: string | null
  /** Strength sessions with their total volume. */
  workouts: readonly { startedAt: Date; volumeKg: number }[]
  /** The active program, for the ACWR baselining rule (OR-210). Null = no program to judge. */
  program: ProgramAgeInput | null
  /** Per-set HR rows (`set_hr_stats`), for HRR60. */
  setHr: readonly { setLogId: string; hrr1Bpm: number | null; source: string | null; loggedAt: Date | null }[]
  /** Zone seconds per completed day, or null when nothing records this person's heart rate. */
  zoneSeconds: ReadonlyMap<string, readonly [number, number, number, number, number]> | null
  /** Days the person flagged themselves unwell. */
  unwellDates: ReadonlySet<string>
  /** Fuel's parts per completed day, for the days the service computed them. */
  fuel: ReadonlyMap<string, FuelParts>
  /** Weight trend minus the goal's planned pace (kg/week), per completed day computed. */
  weightVsPlan: ReadonlyMap<string, number>
  context?: ShadowContext
}

/** Series built once per history and reused for every day scored from it (the replay scores many). */
export interface PreparedShadowHistory {
  raw: ShadowRawHistory
  series: Partial<Record<ShadowUnitId, UnitObservation[]>>
  excluded: Map<string, 'low_wear' | 'unwell'>
}

/**
 * Deep + REM as a percentage of total sleep, or null when the night has no staging. Null, never 0:
 * a manual night or a Health Connect night without stages stores no stage hours (or zeros), and
 * scoring that as "0 % deep and REM" would punish a night nothing measured (edge case #12).
 */
export function deepRemSharePct(n: Pick<AggregatableSleep, 'deepSleepHours' | 'remSleepHours' | 'durationHours'>): number | null {
  const { deepSleepHours: deep, remSleepHours: rem, durationHours: total } = n
  if (deep == null || rem == null || total == null || !(total > 0)) return null
  if (!(deep >= 0) || !(rem >= 0) || deep + rem <= 0) return null
  const pct = ((deep + rem) / total) * 100
  return pct > 100 ? null : pct
}

/** The ring summary's label. Kept as the table name it has always carried, so the ring's existing
 *  normals do not restart; only a different device's values get a different label. */
const RING_SUMMARY_SRC = 'oura_daily_summary'

/** The smallest change worth reading in Oura's 0–100 recovery-index contributor (#3001): 5 points,
 *  against the 0.25 hours the unit uses for the ring's value. */
const RECOVERY_CONTRIBUTOR_MIN_CHANGE = 5

function obs(date: string, value: number | null | undefined, source: string, rung: UnitObservation['rung'] = null): UnitObservation | null {
  return value == null || !Number.isFinite(value) ? null : { date, value, source, rung }
}

function compact<T>(xs: (T | null)[]): T[] {
  return xs.filter((x): x is T => x != null)
}

/** A nightly input through the input cascade, so plausibility and provenance are the layer's. */
function nightlySeries(
  rows: ShadowRawHistory['bodyMetrics'],
  field: 'hrvMs' | 'restingHeartRate',
  input: InputName,
  route: 'night_hrv' | 'night_rhr',
  wearByDate: Map<string, { nonWearTimeSec?: number | null }>,
): UnitObservation[] {
  // #2984: each value carries its device, so the scorer's per-source normal (edge case #11) splits
  // an `oura_cloud` night from the ring's. A row from before provenance keeps the table label.
  const sourceField = field === 'hrvMs' ? 'hrvSource' : 'restingHeartRateSource'
  const cands = nightlyCandidates(rows.map(r => ({ date: r.date, value: r[field] ?? null, source: r[sourceField] ?? null })), route, wearByDate, 'body_metrics')
  const out: UnitObservation[] = []
  for (const r of resolveSlots(input, cands).values()) {
    if (r.missing) continue
    out.push({ date: String(r.slot), value: r.value, source: r.provenance.source, rung: r.provenance.rung })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

export function prepareShadowHistory(raw: ShadowRawHistory): PreparedShadowHistory {
  const { tz } = raw
  const wearByDate = new Map(raw.wear.map(w => [w.date, w]))

  // Sleep: one canonical night per wake date — the longest main sleep of the date, on any clock
  // (edge case #13; `canonicalNightForDate`).
  const nights = nightSessions([...raw.sleepSessions], tz)
  const nightByDate = new Map<string, (typeof nights)[number]>()
  for (const d of new Set(nights.map(n => n.date))) {
    const n = canonicalNightForDate(nights, d, tz)
    if (n) nightByDate.set(d, n)
  }
  const nightList = [...nightByDate.entries()].sort(([a], [b]) => a.localeCompare(b))
  // #2984: a night is labelled by the device that measured it, so a switch of device restarts the
  // sleep normals instead of mixing two devices' nights. A night from before provenance keeps the
  // table label.
  const sleepSrc = (n: { durationSource?: string | null }) => n.durationSource ?? 'sleep_sessions'

  const duration = compact(nightList.map(([d, n]) => obs(d, n.durationHours, sleepSrc(n))))
  const durationByDate = new Map(duration.map(o => [o.date, o.value]))
  const balance = compact(nightList.map(([d, n]) => {
    const week = Array.from({ length: 7 }, (_, i) => durationByDate.get(shiftDateStr(d, -i))).filter((v): v is number => v != null)
    return week.length >= 4 ? obs(d, week.reduce((a, b) => a + b, 0) / week.length, sleepSrc(n)) : null
  }))

  // HRR60: one value per training day, the median of that day's sets with enough HR around them.
  const hrrByDay = new Map<string, { values: number[]; source: string }>()
  const setById = new Map(raw.setHr.map(s => [s.setLogId, s]))
  for (const c of hrr60Candidates(raw.setHr)) {
    const at = setById.get(String(c.slot))?.loggedAt
    if (!at) continue
    const day = toAestDay(at, tz)
    const e = hrrByDay.get(day) ?? { values: [], source: c.source }
    e.values.push(c.value)
    hrrByDay.set(day, e)
  }

  // ACWR as of the end of each day that has sessions within 28 days of it.
  const sessions = [...raw.workouts].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
  const loadDays = new Set<string>()
  for (const s of sessions) for (let i = 0; i < 28; i++) loadDays.add(shiftDateStr(toAestDay(s.startedAt, tz), i))
  const trainingLoad = compact([...loadDays].sort().map(d => {
    // The same framing as the live callers (issue 2194): `asOf` is the START of the scored day, the
    // window runs from 28 local days before it to the day's end. Passing the day's END as `asOf`
    // made the acute window today's-end minus 7 days, which a 7-day window inclusive of today
    // would shrink to six.
    const dayMid = dateStrMidnightInTz(d, tz)
    const end = dateStrMidnightInTz(shiftDateStr(d, 1), tz)
    const start = dateStrMidnightInTz(shiftDateStr(d, -28), tz).getTime()
    // OR-210: for the first 28 days of a program the chronic window still holds the previous
    // routine, so the ratio is withheld — the same rule every ACWR consumer applies. The program is
    // the one active now (no history of programs is stored), so a replayed day before it began is
    // withheld too.
    if (acwrBaselineDaysRemaining(raw.program, end) > 0) return null
    const window = sessions.filter(s => s.startedAt.getTime() >= start && s.startedAt.getTime() < end.getTime())
    return obs(d, computeVolumeAcwr(window, dayMid, { tz }).acwr, 'workout_sessions')
  }))

  // WHO minutes for the week ending each day; every one of the seven days must have been computed.
  const zoneWeek: UnitObservation[] = []
  if (raw.zoneSeconds) {
    for (const d of [...raw.zoneSeconds.keys()].sort()) {
      const days = Array.from({ length: 7 }, (_, i) => raw.zoneSeconds!.get(shiftDateStr(d, -i)))
      if (days.some(x => x == null)) continue
      zoneWeek.push({ date: d, value: days.reduce((sum, z) => sum + activeMinutesFromZoneSeconds([...z!]), 0), source: 'hr_zones', rung: 'provided' })
    }
  }

  const summaries = [...raw.dailySummaries].sort((a, b) => a.date.localeCompare(b.date))
  const metrics = [...raw.bodyMetrics].sort((a, b) => a.date.localeCompare(b.date))

  // #2984, per input: the ring summary's value where it has one for the night, else Oura's own value
  // for the same night (taken as Oura calculated it), labelled with its device so it learns its own
  // normal. Oura's temperature is a deviation from Oura's baseline, so it is scored the same way the
  // ring's deviation is: steady, against the person's normal of that device's deviations.
  const summaryByDate = new Map(summaries.map(s => [s.date, s]))
  const perInput = (ring: (date: string) => number | null | undefined, fallback: Map<string, UnitObservation>) => {
    const dates = [...new Set([...summaryByDate.keys(), ...fallback.keys()])].sort()
    return compact(dates.map(d => obs(d, ring(d), RING_SUMMARY_SRC) ?? fallback.get(d) ?? null))
  }
  const ouraTemperature = new Map(compact(raw.wear.map(w => obs(w.date, w.temperatureDeviation, 'oura_cloud'))).map(o => [o.date, o]))
  const recoveryContributor = new Map(compact((raw.ouraCloudContributors ?? []).map(c => {
    const v = c.readinessContributors?.recovery_index
    const o = obs(c.date, typeof v === 'number' ? v : null, 'oura_cloud')
    return o ? { ...o, minMeaningfulChange: RECOVERY_CONTRIBUTOR_MIN_CHANGE } : null
  })).map(o => [o.date, o]))
  const nightBreathing = new Map(compact(nightList.map(([d, n]) => obs(d, n.respiratoryRate, n.respiratoryRateSource ?? 'sleep_sessions'))).map(o => [o.date, o]))

  const series: PreparedShadowHistory['series'] = {
    'sleep.duration': duration,
    'sleep.efficiency': compact(nightList.map(([d, n]) => obs(d, n.efficiency, sleepSrc(n)))),
    'sleep.deep_rem_share': compact(nightList.map(([d, n]) => obs(d, deepRemSharePct(n), sleepSrc(n)))),
    'sleep.latency': compact(nightList.map(([d, n]) => obs(d, n.onsetLatencySec == null ? null : n.onsetLatencySec / 60, sleepSrc(n)))),
    'sleep.timing': compact(nightList.map(([d, n]) =>
      obs(d, minutesFromNoon(new Date((n.sleepStart.getTime() + n.sleepEnd.getTime()) / 2).toISOString(), tz), sleepSrc(n)))),
    'sleep.balance': balance,
    'heart.overnight_hrv': nightlySeries(raw.bodyMetrics, 'hrvMs', 'HRV/night', 'night_hrv', wearByDate),
    'heart.overnight_rhr': nightlySeries(raw.bodyMetrics, 'restingHeartRate', 'RHR/night', 'night_rhr', wearByDate),
    // The ring's hours where its summary has them, else Oura's recovery-index contributor, as the live
    // composite takes it (#3001). The contributor is a 0–100 sub-score, not hours, so it carries its
    // own device label and is learned against its own nights only, with a floor in its own units.
    'heart.overnight_settling': perInput(d => summaryByDate.get(d)?.recoveryIndexHours, recoveryContributor),
    'heart.hr_recovery': [...hrrByDay.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([d, e]) => ({ date: d, value: median(e.values)!, source: e.source, rung: 'derived' as const })),
    // #2825: steps and SpO2 carry their device (`source_map`) too; a row from before provenance
    // keeps the table label.
    'activity.yesterday_movement': compact(metrics.map(m => obs(m.date, m.steps, m.stepsSource ?? 'body_metrics'))),
    'activity.zone_minutes_week': zoneWeek,
    'activity.training_load': trainingLoad,
    'body.temperature': perInput(d => summaryByDate.get(d)?.tempDevC, ouraTemperature),
    'body.breathing_rate': perInput(d => summaryByDate.get(d)?.breathAvgRpm, nightBreathing),
    'body.spo2': compact(metrics.map(m => obs(m.date, m.spo2Pct, m.spo2Source ?? 'body_metrics'))),
    'body.daytime_stress': daytimeStressSeries(raw),
    'body.weight_vs_plan': [...raw.weightVsPlan.entries()].map(([d, v]) => ({ date: d, value: v, source: 'energy_balance', rung: null })),
  }

  // Edge case #7: low-wear days and days flagged unwell leave every window.
  const excluded = new Map<string, 'low_wear' | 'unwell'>()
  for (const w of raw.wear) if (isLowWearDay(w.nonWearTimeSec)) excluded.set(w.date, 'low_wear')
  for (const d of raw.unwellDates) excluded.set(d, 'unwell')

  return { raw, series, excluded }
}

/**
 * Minutes of high daytime stress per day. Before the switch to the Oura API it is our own, from the
 * ring's daytime HRV (`oura_daily_derived`). From the switch day on it is Oura's `stress_high`, taken
 * as Oura calculated it (#2985), under source `oura_cloud`, so it learns its own normal (the scorer
 * keeps baselines per source) rather than joining ours. A day before the switch never reads
 * Oura's, so the older Cloud columns do not move a scored day.
 */
function daytimeStressSeries(raw: ShadowRawHistory): UnitObservation[] {
  const from = raw.ouraCloudFrom ?? null
  const byDay = new Map<string, UnitObservation>()
  for (const r of raw.derived) {
    const o = obs(r.day, r.stressHighMinutes, 'oura_daily_derived')
    if (o) byDay.set(r.day, o)
  }
  for (const w of raw.wear) {
    if (ringValueStands(w.date, from)) continue
    const o = obs(w.date, w.stressHigh == null ? null : w.stressHigh / 60, 'oura_cloud')
    if (o) byDay.set(w.date, o)
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** Units whose value for day `D` is the night keyed to `D`. Everything else reads `D − 1`. */
const NIGHT_UNITS: ReadonlySet<ShadowUnitId> = new Set<ShadowUnitId>([
  'sleep.duration', 'sleep.efficiency', 'sleep.deep_rem_share', 'sleep.latency', 'sleep.timing', 'sleep.balance',
  'heart.overnight_hrv', 'heart.overnight_rhr', 'heart.overnight_settling',
  'body.temperature', 'body.breathing_rate',
])

/** How far back a daytime unit may look for its most recent value. HR recovery takes the latest
 *  training day of the past week; everything else must be yesterday exactly. */
const DAYTIME_LOOKBACK: Partial<Record<ShadowUnitId, number>> = { 'heart.hr_recovery': 7 }

/** The scorer's input for readiness day `date`. History is everything before the scored value. */
export function assembleShadowInputs(prepared: PreparedShadowHistory, date: string): ShadowScoreInput {
  const units: ShadowScoreInput['units'] = {}
  const yesterday = shiftDateStr(date, -1)

  for (const [id, all] of Object.entries(prepared.series) as [ShadowUnitId, UnitObservation[]][]) {
    let today: UnitObservation | null
    if (NIGHT_UNITS.has(id)) {
      today = all.find(o => o.date === date) ?? null
    } else {
      // Daytime: the latest completed day within the unit's lookback — never `date` itself.
      const earliest = shiftDateStr(date, -(DAYTIME_LOOKBACK[id] ?? 1))
      today = [...all].reverse().find(o => o.date <= yesterday && o.date >= earliest) ?? null
    }
    const history = today ? all.filter(o => o.date < today!.date) : []
    const input: UnitInput = { today, history }
    if (id === 'activity.yesterday_movement') input.band = { lo: stepsFloorForAge(prepared.raw.ageYears) }
    if (id === 'activity.zone_minutes_week' && !prepared.raw.zoneSeconds) input.note = 'Nothing records this person\'s heart rate, so zone minutes are missing, not zero.'
    units[id] = input
  }

  // Fuel: yesterday's parts, scored together. Not logged is missing, never zero (edge case #12).
  const parts = prepared.raw.fuel.get(yesterday) ?? null
  const fuel = parts ? scoreFuel(parts) : null
  units['body.fuel'] = {
    today: fuel?.score == null ? null : { date: yesterday, value: fuel.score, source: 'nutrition_logs' },
    history: [],
    note: fuel
      ? `Parts (0–100, null = not logged): energy ${fmt(fuel.parts.energyDeviationKcal)}, protein ${fmt(fuel.parts.proteinRatio)}, hydration ${fmt(fuel.parts.hydrationRatio)}.`
      : 'Nothing logged for yesterday: fuel drops out.',
  }

  return { date, units, excludedDates: prepared.excluded, context: prepared.raw.context }
}

function fmt(v: number | null): string {
  return v == null ? 'null' : String(Math.round(v))
}
