// lib/live-hr/hr-measurement.ts
// Pure parser for the standard BLE Heart Rate Measurement characteristic (0x2A37).
// The Polar H10 emits ~1 Hz notifications carrying bpm, the sensor-contact flag
// ("strap is on the chest"), and every RR interval (beat-to-beat) since the last
// packet — the raw material for live HRV.
export interface HrMeasurement {
  bpm: number
  /** RR intervals in ms (converted from 1/1024 s units). */
  rr: number[]
  /** true/false when the device supports contact detection (the H10 does); null otherwise. */
  contact: boolean | null
}

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
