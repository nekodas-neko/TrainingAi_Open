/**
 * The ring's battery health from timestamped readings (#3069): drain per day, days between charges,
 * time to charge, last charged and days left. Pure and DB-free, so the server route and every client
 * read one calculation.
 *
 * The readings are Bluetooth polls and Oura Cloud `ring_battery_level` rows together; the source does
 * not matter here. A charge session is inferred from the level: it opens on a rise of at least
 * `CHARGE_NOISE_PCT` and runs from the last reading before the rise to the last rise, so its length
 * is only as good as the readings' spacing; the server read keeps full resolution around charges
 * (`getRingBatteryReadings`). Oura reports no capacity, so "health" is drain: a rising line means the
 * ring holds charge for less time than it did.
 */
import { dayKeyInTz } from '../date-utils'

export interface RingBatteryReading {
  tsMs: number
  percent: number
  charging: boolean | null
}

export interface RingBatteryDay {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string
  /** Percentage points lost per 24 h of off-charger time that day. */
  drainPct: number
}

export interface RingBatteryHealth {
  latest: { percent: number; charging: boolean; tsMs: number; ageMinutes: number } | null
  /** Level over the last 30 days of off-charger days; `null` until `MIN_DRAIN_DAYS` days have it. */
  drainPerDayPct: number | null
  /** The level now divided by `drainPerDayPct`; `null` while charging or without a drain figure. */
  daysLeft: number | null
  daysBetweenCharges: number | null
  avgChargeSec: number | null
  lastChargedMs: number | null
  series: RingBatteryDay[]
}

/** Two readings further apart than this say nothing about the drain between them. */
export const MAX_DRAIN_GAP_MS = 8 * 3_600_000
/** A day needs at least this much off-charger time between readings to give a drain figure. */
export const MIN_DAY_COVERAGE_HOURS = 8
export const MIN_DRAIN_DAYS = 3
const DRAIN_WINDOW_DAYS = 30
/** A rise must exceed this many points to open a charge session. */
const CHARGE_NOISE_PCT = 2
const DAY_MS = 86_400_000
/** A reading with a usable instant and a level in [0, 100]. */
const clean = (r: RingBatteryReading) => Number.isFinite(r.tsMs) && r.percent >= 0 && r.percent <= 100

/**
 * Drain per 24 h of off-charger time, for each local day with enough of it. Only a fall between two
 * neighbouring readings counts, and only when neither reports charging and they are close enough
 * to tell; a rise is a charge and its time is left out of the day's coverage.
 */
export function dailyDrain(readings: readonly RingBatteryReading[], tz: string): RingBatteryDay[] {
  const sorted = readings.filter(clean).sort((a, b) => a.tsMs - b.tsMs)
  const days = new Map<string, { lost: number; ms: number }>()
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i]
    const gap = b.tsMs - a.tsMs
    if (gap <= 0 || gap > MAX_DRAIN_GAP_MS || a.charging || b.charging || b.percent > a.percent) continue
    const day = dayOf(b.tsMs, tz)
    const d = days.get(day) ?? { lost: 0, ms: 0 }
    d.lost += a.percent - b.percent
    d.ms += gap
    days.set(day, d)
  }
  return [...days.entries()]
    .filter(([, d]) => d.ms >= MIN_DAY_COVERAGE_HOURS * 3_600_000)
    .map(([day, d]) => ({ day, drainPct: (d.lost / d.ms) * DAY_MS }))
    .sort((x, y) => (x.day < y.day ? -1 : 1))
}

/** The local calendar day of an instant, dash form. */
const dayOf = (ms: number, tz: string, daysAgo = 0) => dayKeyInTz(tz, daysAgo, new Date(ms)).replace(/\//g, '-')

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

interface ChargeSession { startMs: number; endMs: number }

/** Charge sessions from the level alone: a rise opens one, further rises extend it, a fall closes it. */
function chargeSessions(sorted: readonly RingBatteryReading[]): ChargeSession[] {
  const sessions: ChargeSession[] = []
  let open: ChargeSession | null = null
  for (let k = 1; k < sorted.length; k++) {
    const prev = sorted[k - 1], cur = sorted[k]
    if (cur.percent > prev.percent) {
      if (open) open.endMs = cur.tsMs
      else if (cur.percent - prev.percent >= CHARGE_NOISE_PCT) open = { startMs: prev.tsMs, endMs: cur.tsMs }
    } else if (cur.percent < prev.percent && open) {
      sessions.push(open)
      open = null
    }
    // equal: a session stays open
  }
  if (open) sessions.push(open)
  return sessions
}

export function summariseRingBattery(readings: readonly RingBatteryReading[], tz: string, now = Date.now()): RingBatteryHealth {
  const sorted = readings.filter(clean).sort((a, b) => a.tsMs - b.tsMs)
  const last = sorted[sorted.length - 1]
  const latest = last
    ? { percent: last.percent, charging: last.charging === true, tsMs: last.tsMs, ageMinutes: Math.max(0, Math.round((now - last.tsMs) / 60_000)) }
    : null

  const series = dailyDrain(sorted, tz)
  const recent = series.filter(d => d.day >= dayOf(now, tz, DRAIN_WINDOW_DAYS - 1))
  const drainPerDayPct = recent.length >= MIN_DRAIN_DAYS ? mean(recent.map(d => d.drainPct)) : null
  const daysLeft = latest && !latest.charging && drainPerDayPct && drainPerDayPct > 0 ? latest.percent / drainPerDayPct : null

  const sessions = chargeSessions(sorted)
  const starts = sessions.map(s => s.startMs)
  const gaps = starts.slice(1).map((s, i) => (s - starts[i]) / DAY_MS)
  const lastSession = sessions[sessions.length - 1]
  const lastCharging = [...sorted].reverse().find(r => r.charging)
  const lastChargedMs = Math.max(lastSession?.endMs ?? 0, lastCharging?.tsMs ?? 0) || null

  return {
    latest,
    drainPerDayPct,
    daysLeft,
    daysBetweenCharges: mean(gaps),
    avgChargeSec: mean(sessions.map(s => (s.endMs - s.startMs) / 1000)),
    lastChargedMs,
    series,
  }
}
