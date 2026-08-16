/**
 * Accel-capture primitive: the feature-toggle half of the ring's accurate step counter.
 *
 * The ring's automatic measurements (DAYTIME_HR + SPO2 + REAL_STEPS) share the single
 * accelerometer and PREEMPT the realtime 0x33 stream — with them on, `startAccel` acks but no
 * frames arrive (confirmed on-device via native command/response logging). So an accurate accel
 * capture must turn them OFF for the window, then restore them.
 *
 * `restoreAutoMeasurements` is load-bearing: if a capture ever left the measurements off, the
 * ring would silently stop recording HR/SpO₂/steps. Callers MUST restore on every exit path
 * (stop, disconnect, unmount, error) — hence the guaranteed-restore contract, not best-effort.
 */
import type { OuraBlePlugin } from './plugin'

/** The automatic-measurement feature ids that hog the accelerometer (mirror
 *  OuraProtocol.FeatureId: DAYTIME_HR=0x02, SPO2=0x04, REAL_STEPS=0x0b).
 *  Later on-device testing narrowed this: only REAL_STEPS actually blocks the 0x33
 *  stream — DAYTIME_HR and SPO2 keep recording internally while accel streams (proven
 *  via the HR-coverage readout). Callers that can tolerate it should prefer turning off
 *  REAL_STEPS alone (battery-soak does); this all-off variant remains for the tester's
 *  worst-case-clean captures. */
export const AUTO_MEASUREMENT_FEATURE_IDS = [0x02, 0x04, 0x0b] as const
export const FEATURE_REAL_STEPS = 0x0b
export const FEATURE_MODE_OFF = 0x00

/** Turn the automatic measurements OFF so the realtime accelerometer (0x33) can stream. */
export async function disableAutoMeasurements(plugin: OuraBlePlugin): Promise<void> {
  for (const feature of AUTO_MEASUREMENT_FEATURE_IDS) {
    try {
      await plugin.setFeatureMode({ feature, mode: FEATURE_MODE_OFF })
    } catch {
      /* older APKs may not implement setFeatureMode — capture just won't stream, no harm */
    }
  }
}

/**
 * Restore the automatic measurements (DAYTIME_HR + SPO2 + REAL_STEPS → AUTOMATIC). Reuses the
 * same plugin call the service fires on every connect, so it matches the ring's normal state.
 * Never throws — a restore failure must not mask the caller's own error handling, but callers
 * should treat leaving this un-called as a bug (measurements stay off).
 */
export async function restoreAutoMeasurements(plugin: OuraBlePlugin): Promise<void> {
  try {
    await plugin.enableMeasurement()
  } catch {
    /* best effort; the service also re-enables on its next connect */
  }
}

/**
 * Admin opt-in for the AUTOMATIC background capture (Chunk 1b). Default OFF: automatic
 * capture disables the ring's HR/SpO₂/steps recording for each window, so it only runs
 * once the owner has flipped this on-device after verifying the restore in the tester.
 * localStorage-backed so it survives reloads and is instantly reversible if anything looks off.
 */
const AUTO_CAPTURE_KEY = 'ta_ring_auto_capture'

export function isAutoCaptureEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_CAPTURE_KEY) === '1'
  } catch {
    return false
  }
}

export function setAutoCaptureEnabled(on: boolean): void {
  try {
    localStorage.setItem(AUTO_CAPTURE_KEY, on ? '1' : '0')
  } catch {
    /* storage unavailable — stays default-off */
  }
}
