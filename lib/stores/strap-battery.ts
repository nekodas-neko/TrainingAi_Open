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

export interface StrapBatteryReading {
  percent: number
  /** Epoch ms when it was read. Rendered as an age, never as a bare number. */
  at: number
}

/** Wrong-shaped or out-of-range values are dropped rather than rendered — a `null` chip is honest. */
function parse(raw: string | null): StrapBatteryReading | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<StrapBatteryReading>
    if (typeof v.percent !== 'number' || typeof v.at !== 'number') return null
    if (!Number.isFinite(v.percent) || v.percent < 0 || v.percent > 100) return null
    if (!Number.isFinite(v.at) || v.at <= 0) return null
    return { percent: v.percent, at: v.at }
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
  try {
    window.localStorage.setItem(STRAP_BATTERY_KEY, JSON.stringify({ percent, at: now }))
  } catch {
    // A full or blocked store is not worth failing a render over.
  }
}
