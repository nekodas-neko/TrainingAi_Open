// Pure decoders for the Renpho ES-20M (QN-Scale family) wire format, so TrainingAi Preview reads
// the scale the way the Capacitor app does. The Kotlin twin is `ScaleProtocol` in
// android/app/src/main/java/com/trainingai/app/scale/ScaleProtocol.kt; the byte layouts come from
// the owner's real nRF Connect captures (2026-07-27), not from memory. Decoders never throw: a
// malformed notification returns null and the stream carries on.
//
// Who a weigh-in belongs to is not decided here or on the phone. The server bands it against the
// account's last confirmed weight (`SCALE_WEIGHT_CLAIM_PCT` and `SCALE_WEIGHT_ANOMALY_PCT` in
// lib/scale-ble/composition.ts, applied by POST /api/scale-ble/samples), and computes body
// composition from the impedance. A client sends what the scale said and reads the verdict.

export const SCALE_SERVICE = '0000ffe0-0000-1000-8000-00805f9b34fb'
/** Notify: the weight and impedance stream. */
export const SCALE_MEASUREMENT = '0000ffe1-0000-1000-8000-00805f9b34fb'
/** Write: the request-measurement commands. */
export const SCALE_REQUEST = '0000ffe3-0000-1000-8000-00805f9b34fb'

/** The command that triggered real weigh-in notifications in the Phase 0 capture. */
export const REQUEST_MEASUREMENT_CMD: readonly number[] = [0x13, 0x09, 0x15, 0x01, 0x10, 0x00, 0x00, 0x00, 0x42]

/**
 * Speculative, not verified against our own hardware: asks for readings the scale stored while
 * nothing was connected. Ported from a third-party client for the same scale family. The scale
 * either answers in the layout of {@link parseStoredRecord} or stays silent.
 */
export const REQUEST_STORED_MEASUREMENTS_CMD: readonly number[] = [0x22, 0x04, 0x15]

export interface WeightPacket {
  weightKg: number
  /** False while the measurement is still settling: weight only, impedance not yet ready. */
  stable: boolean
  impedanceOhmsA: number
  impedanceOhmsB: number
  rawHex: string
}

export interface StoredWeightPacket {
  weightKg: number
  measuredAtEpochSeconds: number
  resistance1Ohms: number
  resistance2Ohms: number
  count: number
  index: number
  rawHex: string
}

const hex = (raw: Uint8Array) => Array.from(raw, (b) => b.toString(16).padStart(2, '0')).join('')

/**
 * One FFE1 notification. Null on anything malformed and on the handshake-identification packet the
 * scale sends on subscribe (marker 0x12, which carries its own MAC and is never a reading).
 *
 * 11 bytes: [0] 0x10 marker · [1] 0x0B length · [2] 0x15 · [3-4] weight, big-endian, ÷100 kg ·
 * [5] stable flag (0x01 once final) · [6-7] impedance A · [8-9] impedance B · [10] sum of bytes
 * 0-9 mod 256.
 */
export function parseWeightPacket(raw: Uint8Array): WeightPacket | null {
  if (raw.length < 11 || raw[0] !== 0x10) return null
  let sum = 0
  for (let i = 0; i < 10; i++) sum += raw[i]
  if ((sum & 0xff) !== raw[10]) return null
  return {
    weightKg: ((raw[3] << 8) | raw[4]) / 100,
    stable: raw[5] === 0x01,
    impedanceOhmsA: (raw[6] << 8) | raw[7],
    impedanceOhmsB: (raw[8] << 8) | raw[9],
    rawHex: hex(raw),
  }
}

/** The scale's own clock starts at 2000-01-01 00:00:00 UTC. */
const STORED_RECORD_EPOCH_OFFSET_SECONDS = 946_656_000
const STORED_RECORD_MARKER = 0x23
const STORED_RECORD_MIN_SIZE = 19

/**
 * A drained stored-measurement record. Speculative, like {@link REQUEST_STORED_MEASUREMENTS_CMD}:
 * only the little-endian timestamp is documented by the source; weight and resistance are assumed
 * big-endian by analogy with the live packet. 19 bytes: [0] 0x23 marker · [3] records left ·
 * [4] this record's index · [5-8] seconds since the scale's epoch · [9-10] weight ÷100 kg ·
 * [11-12] resistance 1 · [13-14] resistance 2.
 */
export function parseStoredRecord(raw: Uint8Array): StoredWeightPacket | null {
  if (raw.length < STORED_RECORD_MIN_SIZE || raw[0] !== STORED_RECORD_MARKER) return null
  const offset = (raw[5] | (raw[6] << 8) | (raw[7] << 16) | (raw[8] << 24)) >>> 0
  return {
    weightKg: ((raw[9] << 8) | raw[10]) / 100,
    measuredAtEpochSeconds: STORED_RECORD_EPOCH_OFFSET_SECONDS + offset,
    resistance1Ohms: (raw[11] << 8) | raw[12],
    resistance2Ohms: (raw[13] << 8) | raw[14],
    count: raw[3],
    index: raw[4],
    rawHex: hex(raw),
  }
}

/**
 * The scale has been seen repeating one stable frame up to three times, ~500 ms apart, before it
 * goes quiet. Only a frame that differs from the last one reported, or one that arrives after this
 * window, is a new weigh-in.
 */
export const STABLE_REPEAT_WINDOW_MS = 10_000

export function isRepeatedStableFrame(
  rawHex: string,
  last: { rawHex: string; at: number } | null,
  now: number,
): boolean {
  return last !== null && last.rawHex === rawHex && now - last.at < STABLE_REPEAT_WINDOW_MS
}

/** One gram. A replay is the same decoded packet, so this only has to survive float equality. */
const SAME_READING_TOLERANCE_KG = 0.001

/**
 * Whether an unstable reading shows a NEW weigh-in has begun. Cheap scales replay their last
 * buffered notification when a client resubscribes, and a replay carries the value it carried the
 * first time, so a reading identical to the capture just taken cannot be a new person stepping on.
 * The Kotlin twin is `ScaleWeighInGate.isNewWeighInEvidence`.
 */
export function isNewWeighInEvidence(weightKg: number, lastCapturedKg: number | null): boolean {
  return lastCapturedKg === null || Math.abs(weightKg - lastCapturedKg) >= SAME_READING_TOLERANCE_KG
}
