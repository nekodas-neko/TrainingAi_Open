/**
 * #3001 (the rule of #2991, applied to the remaining personal normals): a normal is learned from
 * one device's own nights.
 *
 * Oura measures some things differently from the ring (lowest 30-second sample against the lowest
 * 5-minute bin for resting HR; an "average" HRV against a median of gated rMSSD), so an Oura night
 * judged against a ring-built normal reads as a change in the person that is really a change in the
 * ruler. The device is the `source` stored beside each value (`source_map`); a reading with no source
 * is one group of its own, like readiness's `unknown`.
 *
 * "The device in use" is the source of the newest reading. Its normal is **mature** once it has
 * `minNights` readings. Until then it is **warming up**, and the other device's nights are never
 * folded in. What a caller does while it warms is its own call, and both answers are returned:
 * - a score that can leave an input out (the sleep score, the displayed baselines) reads `value`,
 *   which is null while warming up;
 * - a number that must exist (heart-rate zones, Body Battery's reserve) reads `value ?? carriedOver`:
 *   the previous device's own mature normal, so the number holds still instead of jumping at the
 *   switch, and `provisional` when there is no previous device at all, so a first-time user still
 *   gets a number from what they have.
 *
 * A leaf module: imports nothing, so a client bundle may take it.
 */

/** The group a reading with no stored source belongs to. */
export const UNKNOWN_DEVICE = 'unknown'

/** A stored source as a device key. */
export const deviceOf = (source: string | null | undefined): string => source ?? UNKNOWN_DEVICE

export interface DeviceReading {
  /** Local date, `YYYY-MM-DD`. Orders readings; the newest names the device in use. */
  date: string
  value: number | null | undefined
  source?: string | null
}

export interface DeviceNormalOptions {
  /** Readings the device needs before its normal counts. */
  minNights: number
  /** How the readings combine. Default `mean`. */
  aggregate?: 'mean' | 'median'
  /** Only the newest N readings of the device go into its normal. Default: all given. */
  window?: number
  /**
   * The device to learn for, when the caller knows it (the night being scored names its own). Default:
   * the source of the newest reading.
   */
  device?: string
}

export interface DeviceNormal {
  /** The device in use: the source of the newest reading. Null with no readings. */
  source: string | null
  /** Its readings, newest window only, counted. */
  nights: number
  /** Its normal once mature; null while warming up. Never mixes in another device. */
  value: number | null
  /** Its normal from however many nights it has, mature or not. Null with no readings. */
  provisional: number | null
  /**
   * The normal of the most recent OTHER device that is mature on its own, for a caller that must
   * show a number while the device in use warms up. Null when no other device qualifies.
   */
  carriedOver: { source: string; nights: number; value: number } | null
}

const sourceOf = (r: { source?: string | null }) => deviceOf(r.source)

function combine(values: number[], how: 'mean' | 'median'): number {
  if (how === 'mean') return values.reduce((a, b) => a + b, 0) / values.length
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** The readings that carry a usable number, oldest first. */
function usable(readings: readonly DeviceReading[]): (DeviceReading & { value: number })[] {
  return readings
    .filter((r): r is DeviceReading & { value: number } => r.value != null && Number.isFinite(r.value))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** The source of the newest usable reading: the device in use. Null with none. */
export function currentDevice(readings: readonly DeviceReading[]): string | null {
  const rows = usable(readings)
  return rows.length ? sourceOf(rows[rows.length - 1]) : null
}

/**
 * The readings of the device in use, oldest first. For a caller that needs the rows themselves (a
 * recent-versus-baseline ratio), not just the normal.
 */
export function currentDeviceReadings<T extends DeviceReading>(readings: readonly T[]): T[] {
  const device = currentDevice(readings)
  if (device == null) return []
  return readings
    .filter(r => r.value != null && Number.isFinite(r.value) && sourceOf(r) === device)
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function perDeviceNormal(readings: readonly DeviceReading[], opts: DeviceNormalOptions): DeviceNormal {
  const how = opts.aggregate ?? 'mean'
  const rows = usable(readings)
  if (rows.length === 0) return { source: opts.device ?? null, nights: 0, value: null, provisional: null, carriedOver: null }

  const device = opts.device ?? sourceOf(rows[rows.length - 1])
  const own = rows.filter(r => sourceOf(r) === device)
  const windowed = opts.window != null ? own.slice(-opts.window) : own
  const provisional = windowed.length ? combine(windowed.map(r => r.value), how) : null

  // The other devices, most recently measured first; the first that is mature on its own carries over.
  const lastSeen = new Map<string, string>()
  for (const r of rows) if (sourceOf(r) !== device) lastSeen.set(sourceOf(r), r.date)
  let carriedOver: DeviceNormal['carriedOver'] = null
  for (const [source] of [...lastSeen.entries()].sort((a, b) => b[1].localeCompare(a[1]))) {
    const theirs = rows.filter(r => sourceOf(r) === source)
    const theirWindow = opts.window != null ? theirs.slice(-opts.window) : theirs
    if (theirWindow.length >= opts.minNights) {
      carriedOver = { source, nights: theirWindow.length, value: combine(theirWindow.map(r => r.value), how) }
      break
    }
  }

  return {
    source: device,
    nights: windowed.length,
    value: windowed.length >= opts.minNights ? provisional : null,
    provisional,
    carriedOver,
  }
}

/**
 * The number a caller that must have one reads: the device's own normal once mature, else the
 * previous device's, else what the device in use has so far. Null only with no readings.
 */
export function normalOrCarriedOver(n: DeviceNormal): number | null {
  return n.value ?? n.carriedOver?.value ?? n.provisional
}

/**
 * The rows whose `value` is a usable number and whose device is the one in use (the source of the
 * newest such row), in the order given. For a caller built on a recent-versus-older comparison, which
 * must compare two stretches of one device's nights and never one stretch of the ring with one of Oura.
 */
export function rowsOfDeviceInUse<T extends { date: string }>(
  rows: readonly T[],
  value: (row: T) => number | null | undefined,
  source: (row: T) => string | null | undefined,
): T[] {
  const positive = (r: T) => { const v = value(r); return v != null && Number.isFinite(v) && v > 0 ? v : null }
  const device = currentDevice(rows.map(r => ({ date: r.date, value: positive(r), source: source(r) })))
  if (device == null) return []
  return rows.filter(r => positive(r) != null && deviceOf(source(r)) === device)
}
