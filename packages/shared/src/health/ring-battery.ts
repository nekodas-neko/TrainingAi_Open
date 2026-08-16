/**
 * Ring battery telemetry aggregator — pure, DB-free. Given the ring's `0x61` battery events over a
 * window (level changes + device-reported charging-time), derives the owner's three questions: how
 * much it drains per day, how much each charge session adds, and its average charging time.
 *
 * The decoder feeding this is reverse-engineered and `unvalidated` (see `decodeDebugData`); `sane`
 * surfaces obviously-garbage values (battery_pct out of [0,100], implausible charge duration) so the
 * admin console can warn rather than present nonsense. Real device validation is on-device only.
 */

export interface RingBatteryEvent {
  tsMs: number
  kind: 'battery_level_changed' | 'charging_time'
  batteryPct: number | null      // present on battery_level_changed
  chargingTimeSec: number | null // present on charging_time (device-reported)
}

export interface ChargeSession {
  startMs: number
  endMs: number
  startPct: number
  endPct: number
  deltaPct: number               // endPct - startPct
  durationSec: number            // device charging_time if one covers the session, else span
  chargingTimeSource: 'device' | 'span'
}

export interface RingBatteryAnalytics {
  avgDailyDrainPct: number | null   // summed level DECREASES ÷ observed span days
  chargeSessions: ChargeSession[]
  avgChargePerSessionPct: number | null
  avgChargingTimeSec: number | null // mean of session durations (device-time preferred)
  levelSampleCount: number
  spanDays: number | null           // (last − first level ts) in days
  sane: boolean
}

const DAY_MS = 86_400_000
const CHARGE_NOISE_PCT = 2         // a rise must exceed this to open a charge session
const CHARGE_MATCH_MARGIN_MS = 10 * 60_000
const MAX_PLAUSIBLE_CHARGE_SEC = 6 * 3600

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

export function analyzeRingBattery(events: RingBatteryEvent[]): RingBatteryAnalytics {
  const sorted = [...events].sort((a, b) => a.tsMs - b.tsMs)
  const levels = sorted.filter(e => e.kind === 'battery_level_changed' && e.batteryPct != null)
  const chargeTimes = sorted.filter(e => e.kind === 'charging_time' && e.chargingTimeSec != null)

  const sane =
    levels.every(e => e.batteryPct! >= 0 && e.batteryPct! <= 100) &&
    chargeTimes.every(c => c.chargingTimeSec! >= 0 && c.chargingTimeSec! < MAX_PLAUSIBLE_CHARGE_SEC)

  // Pick the device charging_time that covers a session, else fall back to the wall-clock span.
  const durationForSession = (startMs: number, endMs: number): { sec: number; source: 'device' | 'span' } => {
    const hit = chargeTimes.find(c => c.tsMs >= startMs - CHARGE_MATCH_MARGIN_MS && c.tsMs <= endMs + CHARGE_MATCH_MARGIN_MS)
    if (hit) return { sec: hit.chargingTimeSec!, source: 'device' }
    return { sec: Math.round((endMs - startMs) / 1000), source: 'span' }
  }

  const sessions: ChargeSession[] = []
  let open: { startPct: number; startMs: number; endPct: number; endMs: number } | null = null
  let totalDecrease = 0

  const closeOpen = () => {
    if (!open) return
    const { sec, source } = durationForSession(open.startMs, open.endMs)
    sessions.push({
      startMs: open.startMs, endMs: open.endMs, startPct: open.startPct, endPct: open.endPct,
      deltaPct: open.endPct - open.startPct, durationSec: sec, chargingTimeSource: source,
    })
    open = null
  }

  for (let k = 1; k < levels.length; k++) {
    const prev = levels[k - 1].batteryPct!, cur = levels[k].batteryPct!
    if (cur > prev) {
      if (open) { open.endPct = cur; open.endMs = levels[k].tsMs }
      else if (cur - prev >= CHARGE_NOISE_PCT) {
        open = { startPct: prev, startMs: levels[k - 1].tsMs, endPct: cur, endMs: levels[k].tsMs }
      }
    } else if (cur < prev) {
      totalDecrease += prev - cur
      closeOpen()
    }
    // equal: non-decreasing — a session stays open, no drain accrues.
  }
  closeOpen()

  const spanDays = levels.length >= 2 ? (levels[levels.length - 1].tsMs - levels[0].tsMs) / DAY_MS : null
  const avgDailyDrainPct = spanDays != null && spanDays > 0 ? totalDecrease / spanDays : null

  return {
    avgDailyDrainPct,
    chargeSessions: sessions,
    avgChargePerSessionPct: mean(sessions.map(s => s.deltaPct)),
    avgChargingTimeSec: mean(sessions.map(s => s.durationSec)),
    levelSampleCount: levels.length,
    spanDays,
    sane,
  }
}
