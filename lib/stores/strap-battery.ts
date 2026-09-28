'use client'

/**
 * The chest strap's last-known battery level, remembered on this device (Q-111).
 *
 * The strap is not always connected, and a chip that only ever shows a live value is blank most of
 * the day — which reads as "no strap" rather than "not connected right now". The owner asked for
 * *live-when-connected, last-seen-when-disconnected*, and the last-seen half is what this holds.
 *
 * **`localStorage`, deliberately, and not a user preference.** It is a fact about one piece of
 * hardware paired to one phone: it must not sync, and `hydrateUserPreferences` would carry it to a
 * second device where it would be a lie. It is also not worth a server round-trip.
 *
 * **Two writers, one store, and that is the point.** The native service reports `battery` on
 * `PolarBleStatus`; the pairing screen reads the Battery Service characteristic directly over
 * browser BLE, because at pairing time the native service is not running yet. Before this, those
 * were two numbers displayed in two places with no relationship. Now they are two writers of one
 * value, so the Home chip has something to show from the first pairing onward.
 */

export const STRAP_BATTERY_KEY = 'ta_strap_battery_v1'

/**
 * How far back the low-water mark looks (BF-215).
 *
 * Long enough to span several workouts, so the sag that predicts failure is still on screen at the
 * moment the question is asked — *"should I change the cell before this one?"*. Short enough that a
 * replaced cell clears the old number without needing to detect the replacement, which nothing can:
 * a fresh CR2025 and a dying one both read 100 at rest.
 */
export const MIN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

export interface StrapBatteryReading {
  percent: number
  /** Epoch ms when it was read. Rendered as an age, never as a bare number. */
  at: number
  /**
   * The lowest reading inside `MIN_WINDOW_MS`, which is the number worth showing (BF-215).
   *
   * A CR2025 cannot recharge, so `100 → 30 → 100` is not a state of charge — it is the cell
   * drooping under a sustained BLE session and recovering at rest. The resting value stays high
   * until the cell is nearly dead, so the latest reading is the LEAST informative one and the sag
   * is the early warning.
   */
  min: number
  /** When `min` was read — how old the warning is, which the latest reading cannot say. */
  minAt: number
}

/** Wrong-shaped or out-of-range values are dropped rather than rendered — a `null` chip is honest. */
function parse(raw: string | null): StrapBatteryReading | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<StrapBatteryReading>
    if (typeof v.percent !== 'number' || typeof v.at !== 'number') return null
    if (!Number.isFinite(v.percent) || v.percent < 0 || v.percent > 100) return null
    if (!Number.isFinite(v.at) || v.at <= 0) return null
    // An entry written before BF-215 has no low-water mark. It is the reading itself rather than a
    // missing field: one reading is its own minimum, so the chip is correct from the first render
    // and does not need a migration or a blank state.
    const min = typeof v.min === 'number' && Number.isFinite(v.min) && v.min > 0 && v.min <= 100 ? v.min : v.percent
    const minAt = typeof v.minAt === 'number' && Number.isFinite(v.minAt) && v.minAt > 0 ? v.minAt : v.at
    return { percent: v.percent, at: v.at, min, minAt }
  } catch {
    return null
  }
}

export function readStrapBattery(): StrapBatteryReading | null {
  if (typeof window === 'undefined') return null
  try {
    return parse(window.localStorage.getItem(STRAP_BATTERY_KEY))
  } catch {
    return null
  }
}

/**
 * Records a reading. Silently ignores an implausible percentage rather than storing it: a strap
 * that has not completed its first Battery Service read reports `null`, and a stored `0` would
 * render as a flat battery forever.
 */
export function writeStrapBattery(percent: number | null | undefined, now: number = Date.now()): void {
  if (typeof window === 'undefined') return
  if (percent == null || !Number.isFinite(percent) || percent <= 0 || percent > 100) return
  // BF-140: `now` is the strap's own report time when native supplies one. A non-finite value
  // would make `ageMinutes` NaN and the chip neither fresh nor stale, so it falls back rather than
  // storing it — the same posture as the percentage guard above.
  if (!Number.isFinite(now)) now = Date.now()
  // The low-water mark carries across CONNECTIONS, not within one: the native service reads the
  // Battery Service once, when the strap becomes ready (`PolarGattClient.readBattery`, called from
  // the descriptor-write callback), so the value never moves inside a session and a within-session
  // minimum would be the reading itself. Across connections it moves — production has 100 on most
  // days and 30 through one 92-minute window.
  const prev = readStrapBattery()
  const expired = prev != null && now - prev.minAt > MIN_WINDOW_MS
  const min = prev == null || expired ? percent : Math.min(prev.min, percent)
  const minAt = prev == null || expired || percent < prev.min ? now : prev.minAt
  try {
    window.localStorage.setItem(STRAP_BATTERY_KEY, JSON.stringify({ percent, at: now, min, minAt }))
  } catch {
    // A full or blocked store is not worth failing a render over.
  }
}
