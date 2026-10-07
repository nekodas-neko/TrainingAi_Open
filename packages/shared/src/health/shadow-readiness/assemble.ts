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
import { hrr60Candidates, nightlyCandidates } from '@trainingai/shared/inputs/adapters'
import { resolveSlots, type InputName } from '@trainingai/shared/inputs/cascade'
import { stepsFloorForAge, type ShadowUnitId } from './model'
import { scoreFuel, type FuelParts, type ShadowContext, type ShadowScoreInput, type UnitInput, type UnitObservation } from './score'

/** What the service reads, for a range of readiness days plus their lookback. */
export interface ShadowRawHistory {
  tz: string
  ageYears: number | null
  sleepSessions: readonly (AggregatableSleep & { date: string })[]
  bodyMetrics: readonly {
    date: string
    hrvMs?: number | null
    restingHeartRate?: number | null
    steps?: number | null
    spo2Pct?: number | null
  }[]
  dailySummaries: readonly { date: string; recoveryIndexHours: number | null; tempDevC: number | null; breathAvgRpm: number | null }[]
  /** `oura_daily` wear rows, for low-wear exclusion. */
  wear: readonly { date: string; nonWearTimeSec?: number | null }[]
  derived: readonly { day: string; stressHighMinutes: number | null }[]
  /** Strength sessions with their total volume. */
  workouts: readonly { startedAt: Date; volumeKg: number }[]
  /** The active program, for the ACWR baselining rule (OR-210). Null = no program to judge. */
  program: ProgramAgeInput | null
  /** Per-set HR rows (`set_hr_stats`), for HRR60. */
  setHr: readonly { setLogId: string; drop60s: number | null; coverageOk: boolean; source: string | null; loggedAt: Date | null }[]
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

const DAY_MS = 86_400_000

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
  const cands = nightlyCandidates(rows.map(r => ({ date: r.date, value: r[field] ?? null })), route, wearByDate, 'body_metrics')
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
  const sleepSrc = 'sleep_sessions'

  const duration = compact(nightList.map(([d, n]) => obs(d, n.durationHours, sleepSrc)))
  const durationByDate = new Map(duration.map(o => [o.date, o.value]))
  const balance = compact(nightList.map(([d]) => {
    const week = Array.from({ length: 7 }, (_, i) => durationByDate.get(shiftDateStr(d, -i))).filter((v): v is number => v != null)
    return week.length >= 4 ? obs(d, week.reduce((a, b) => a + b, 0) / week.length, sleepSrc) : null
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
    const end = dateStrMidnightInTz(shiftDateStr(d, 1), tz)
    const start = end.getTime() - 28 * DAY_MS
    // OR-210: for the first 28 days of a program the chronic window still holds the previous
    // routine, so the ratio is withheld — the same rule every ACWR consumer applies. The program is
    // the one active now (no history of programs is stored), so a replayed day before it began is
    // withheld too.
    if (acwrBaselineDaysRemaining(raw.program, end) > 0) return null
    const window = sessions.filter(s => s.startedAt.getTime() >= start && s.startedAt.getTime() < end.getTime())
    return obs(d, computeVolumeAcwr(window, end).acwr, 'workout_sessions')
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

  const series: PreparedShadowHistory['series'] = {
    'sleep.duration': duration,
    'sleep.efficiency': compact(nightList.map(([d, n]) => obs(d, n.efficiency, sleepSrc))),
    'sleep.latency': compact(nightList.map(([d, n]) => obs(d, n.onsetLatencySec == null ? null : n.onsetLatencySec / 60, sleepSrc))),
    'sleep.timing': compact(nightList.map(([d, n]) =>
      obs(d, minutesFromNoon(new Date((n.sleepStart.getTime() + n.sleepEnd.getTime()) / 2).toISOString(), tz), sleepSrc))),
    'sleep.balance': balance,
    'heart.overnight_hrv': nightlySeries(raw.bodyMetrics, 'hrvMs', 'HRV/night', 'night_hrv', wearByDate),
    'heart.overnight_rhr': nightlySeries(raw.bodyMetrics, 'restingHeartRate', 'RHR/night', 'night_rhr', wearByDate),
    'heart.overnight_settling': compact(summaries.map(s => obs(s.date, s.recoveryIndexHours, 'oura_daily_summary'))),
    'heart.hr_recovery': [...hrrByDay.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([d, e]) => ({ date: d, value: median(e.values)!, source: e.source, rung: 'derived' as const })),
    'activity.yesterday_movement': compact(metrics.map(m => obs(m.date, m.steps, 'body_metrics'))),
    'activity.zone_minutes_week': zoneWeek,
    'activity.training_load': trainingLoad,
    'body.temperature': compact(summaries.map(s => obs(s.date, s.tempDevC, 'oura_daily_summary'))),
    'body.breathing_rate': compact(summaries.map(s => obs(s.date, s.breathAvgRpm, 'oura_daily_summary'))),
    'body.spo2': compact(metrics.map(m => obs(m.date, m.spo2Pct, 'body_metrics'))),
    'body.daytime_stress': compact([...raw.derived].sort((a, b) => a.day.localeCompare(b.day)).map(r => obs(r.day, r.stressHighMinutes, 'oura_daily_derived'))),
    'body.weight_vs_plan': [...raw.weightVsPlan.entries()].map(([d, v]) => ({ date: d, value: v, source: 'energy_balance', rung: null })),
  }

  // Edge case #7: low-wear days and days flagged unwell leave every window.
  const excluded = new Map<string, 'low_wear' | 'unwell'>()
  for (const w of raw.wear) if (isLowWearDay(w.nonWearTimeSec)) excluded.set(w.date, 'low_wear')
  for (const d of raw.unwellDates) excluded.set(d, 'unwell')

  return { raw, series, excluded }
}

/** Units whose value for day `D` is the night keyed to `D`. Everything else reads `D − 1`. */
const NIGHT_UNITS: ReadonlySet<ShadowUnitId> = new Set<ShadowUnitId>([
  'sleep.duration', 'sleep.efficiency', 'sleep.latency', 'sleep.timing', 'sleep.balance',
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
