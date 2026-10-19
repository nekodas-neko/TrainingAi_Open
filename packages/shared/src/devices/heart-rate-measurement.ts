// Pure decoders for the standard BLE Heart Rate Service (0x180D) and Battery Service (0x180F).
// Shared by the current app's in-WebView strap path (`lib/live-hr/`) and TrainingAi Preview
// (`mobile/`), so both read the strap byte-for-byte the same way. The Kotlin twin is
// `PolarProtocol.parseHeartRateMeasurement` in the Capacitor app. Decoders never throw: a malformed
// notification returns null and the stream carries on.
//
// The Polar H10 emits ~1 Hz Heart Rate Measurement notifications carrying bpm, the sensor-contact
// flag ("strap is on the chest"), and every RR interval (beat-to-beat) since the last packet.
export interface HrMeasurement {
  bpm: number
  /** RR intervals in ms (converted from 1/1024 s units). */
  rr: number[]
  /** true/false when the device supports contact detection (the H10 does); null otherwise. */
  contact: boolean | null
}

/** 0x2A37 layout: [flags:1][hr:1|2][energy:2]?[rr:2]*, all little-endian. */
export function parseHeartRateMeasurement(v: Uint8Array): HrMeasurement | null {
  if (v.length < 2) return null
  const flags = v[0]
  const hr16 = (flags & 0x01) !== 0
  const contactSupported = (flags & 0x04) !== 0
  const energyPresent = (flags & 0x08) !== 0
  const rrPresent = (flags & 0x10) !== 0
  let i = 1
  let bpm: number
  if (hr16) {
    if (v.length < 3) return null
    bpm = v[1] | (v[2] << 8)
    i = 3
  } else {
    bpm = v[1]
    i = 2
  }
  if (energyPresent) i += 2 // uint16 energy expended — skipped
  const rr: number[] = []
  if (rrPresent) {
    for (; i + 1 < v.length; i += 2) {
      const raw = v[i] | (v[i + 1] << 8) // 1/1024 s units
      rr.push(Math.round((raw / 1024) * 1000))
    }
  }
  return { bpm, rr, contact: contactSupported ? (flags & 0x02) !== 0 : null }
}

/**
 * A Device Information string such as Firmware Revision (0x2A26): UTF-8, often padded with NULs.
 * Only printable ASCII is kept, which every revision string the H10 sends is. Null when empty.
 */
export function parseRevisionString(v: Uint8Array): string | null {
  let text = ''
  for (const byte of v) {
    if (byte === 0) break
    if (byte >= 0x20 && byte < 0x7f) text += String.fromCharCode(byte)
  }
  text = text.trim()
  return text ? text : null
}

/** 0x2A19 Battery Level: one uint8 percentage. Anything outside 0–100 is not a reading. */
export function parseBatteryLevel(v: Uint8Array): number | null {
  if (v.length < 1) return null
  return v[0] <= 100 ? v[0] : null
}
