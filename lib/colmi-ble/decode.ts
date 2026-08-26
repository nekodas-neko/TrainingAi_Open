// Colmi R09 response decoders.
//
// PURE and INFALLIBLE. Every parser returns a value — an unrecognised or malformed frame decodes to
// `{ kind: 'unknown' }`, never a throw. Same rule the Oura pipeline runs on: a decoder that throws
// takes down the ingest path for one bad frame, and the frame is data either way.
//
// ⏱ NO ABSOLUTE TIMESTAMPS. Every parser returns time as the ring expresses it — `daysAgo`,
// `minuteOfDay`, or BCD date parts — and never constructs a Date. Gadgetbridge resolves these with
// `Calendar.getInstance()`, i.e. the device's own zone; this repo bans that (CLAUDE.md's timezone
// rule), because a phone in another zone would then key a night's sleep to the wrong day. The caller
// resolves against the user's timezone with the `date-utils` helpers.
//
// Layouts from Gadgetbridge `YawellRingPacketHandler.java`; see protocol.ts for the source order.
// ⚠️ LEARNING MODE — nothing here may reach a scoring input (plan §2).

import { CMD, PUSH, BIG_DATA_TYPE, PACKET_SIZE, u16, fromBcd, isValidPacket } from '@/lib/colmi-ble/protocol'

export interface BatteryReading { kind: 'battery'; percent: number; charging: boolean }
export interface RealtimeHeartRate { kind: 'realtimeHeartRate'; bpm: number }

/** One 15-minute activity bucket. `quarterHour` is the ring's index into the day (0–95). */
export interface ActivityBucket {
  kind: 'activity'
  year: number; month: number; day: number
  /** 0–95. Local hour is `quarterHour / 4`, minute `(quarterHour % 4) * 15`. */
  quarterHour: number
  calories: number; steps: number; distanceMetres: number
  packetIndex: number; packetTotal: number
  /** True on the last packet of the sweep — the signal to stop pulling. */
  isFinal: boolean
}

/** A value sampled every 30 minutes through one day (HRV in ms, stress unitless). */
export interface HalfHourSeries {
  kind: 'hrv' | 'stress'
  packetIndex: number
  packetTotal: number | null
  /** Empty when the ring reports no history (`packetIndex === 0xff`). */
  points: { minuteOfDay: number; value: number }[]
  isEmpty: boolean
}

export interface HeartRateLog {
  kind: 'heartRateLog'
  subType: number
  /** Set only on the header packet: how many packets follow, and their spacing in minutes. */
  packetTotal: number | null
  intervalMinutes: number | null
  /** Unix seconds, present only on sub-type 1 — the ring's own epoch reference for the series. */
  startedAtUnixSec: number | null
  values: number[]
  isFinal: boolean
  isEmpty: boolean
}

export interface SleepStageSpan { stage: number; minutes: number }
export interface SleepSession {
  daysAgo: number
  /** Minutes after midnight of `daysAgo`. When `startMinute > endMinute` the session began before
   *  that midnight, i.e. `startMinute - 1440` relative to it. */
  startMinute: number
  endMinute: number
  stages: SleepStageSpan[]
}
export interface SleepHistory { kind: 'sleep'; sessions: SleepSession[] }

/** Half-hourly skin temperature. `celsius` is already scaled (`raw / 10 + 20`). */
export interface TemperatureHistory {
  kind: 'temperature'
  readings: { daysAgo: number; minuteOfDay: number; celsius: number }[]
}

export interface Spo2History {
  kind: 'spo2'
  readings: { daysAgo: number; hour: number; min: number; max: number }[]
}

export interface UnknownFrame { kind: 'unknown'; command: number | null; reason: string }

export type ColmiFrame =
  | BatteryReading | RealtimeHeartRate | ActivityBucket | HalfHourSeries
  | HeartRateLog | SleepHistory | TemperatureHistory | Spo2History | UnknownFrame

const unknown = (command: number | null, reason: string): UnknownFrame => ({ kind: 'unknown', command, reason })

function bytes(v: ArrayLike<number> | null | undefined): number[] | null {
  if (!v || v.length === 0) return null
  const out: number[] = []
  for (let i = 0; i < v.length; i++) out.push(v[i] & 0xff)
  return out
}

// ── V1 (16-byte) frames ────────────────────────────────────────────────────────────────────

/**
 * Decode one notification from `V1_NOTIFY`.
 *
 * `validateChecksum` defaults false: the ring's own pushes have been observed valid, but rejecting a
 * frame on a checksum we have not exhaustively confirmed would silently drop real data. Turn it on
 * once a corpus exists.
 */
export function decodeV1(value: ArrayLike<number> | null | undefined, validateChecksum = false): ColmiFrame {
  const v = bytes(value)
  if (!v) return unknown(null, 'empty frame')
  if (v.length !== PACKET_SIZE) return unknown(v[0] ?? null, `expected ${PACKET_SIZE} bytes, got ${v.length}`)
  if (validateChecksum && !isValidPacket(v)) return unknown(v[0], 'checksum mismatch')

  switch (v[0]) {
    case CMD.NOTIFICATION:
      // Unsolicited push. Byte 1 is the sub-type; battery is the only one carrying a payload we
      // decode today. Measured on the owner's ring: 73-0C-64-00-…-E3 → 100%, not charging.
      if (v[1] === PUSH.BATTERY_LEVEL) return { kind: 'battery', percent: v[2], charging: v[3] === 1 }
      return unknown(v[0], `unhandled push sub-type 0x${v[1].toString(16)}`)

    case CMD.BATTERY:
      return { kind: 'battery', percent: v[1], charging: v[2] === 1 }

    case CMD.REALTIME_HEART_RATE:
    case CMD.MANUAL_HEART_RATE:
      return { kind: 'realtimeHeartRate', bpm: v[1] }

    case CMD.SYNC_ACTIVITY:
      return decodeActivity(v)

    case CMD.SYNC_HRV:
      return decodeHalfHourSeries(v, 'hrv')

    case CMD.SYNC_STRESS:
      return decodeHalfHourSeries(v, 'stress')

    case CMD.SYNC_HEART_RATE:
      return decodeHeartRateLog(v)

    default:
      return unknown(v[0], 'unrecognised command byte')
  }
}

function decodeActivity(v: number[]): ColmiFrame {
  if (v[1] === 0xff) return unknown(v[0], 'no activity history')
  // 0xf0 marks the end of the sweep rather than a bucket.
  if (v[1] === 0xf0) {
    return { kind: 'activity', year: 0, month: 0, day: 0, quarterHour: 0, calories: 0, steps: 0,
             distanceMetres: 0, packetIndex: 0, packetTotal: 0, isFinal: true }
  }
  const packetIndex = v[5]
  const packetTotal = v[6]
  return {
    kind: 'activity',
    year: 2000 + fromBcd(v[1]),
    month: fromBcd(v[2]),
    day: fromBcd(v[3]),
    quarterHour: v[4],
    // Newer firmware scales calories by 10; left raw so the caller decides rather than this module
    // guessing a firmware revision it cannot see.
    calories: u16(v[7], v[8]),
    steps: u16(v[9], v[10]),
    distanceMetres: u16(v[11], v[12]),
    packetIndex,
    packetTotal,
    isFinal: packetIndex === packetTotal - 1,
  }
}

/** HRV and stress share a layout: one byte per 30-minute slot, spread over numbered packets. */
function decodeHalfHourSeries(v: number[], kind: 'hrv' | 'stress'): HalfHourSeries {
  const packetIndex = v[1]
  if (packetIndex === 0xff) return { kind, packetIndex, packetTotal: null, points: [], isEmpty: true }
  if (packetIndex === 0) return { kind, packetIndex, packetTotal: v[2], points: [], isEmpty: false }

  // Packet 1 carries 12 slots and starts at byte 3; later packets carry 13 and start at byte 2.
  const start = packetIndex === 1 ? 3 : 2
  const minutesBefore = packetIndex > 1 ? 12 * 30 + (packetIndex - 2) * 13 * 30 : 0
  const points: { minuteOfDay: number; value: number }[] = []
  for (let i = start; i < v.length - 1; i++) {
    const value = v[i]
    if (value === 0) continue          // zero means "no sample", not a reading of zero
    points.push({ minuteOfDay: minutesBefore + (i - start) * 30, value })
  }
  return { kind, packetIndex, packetTotal: null, points, isEmpty: false }
}

function decodeHeartRateLog(v: number[]): HeartRateLog {
  const subType = v[1]
  const base: HeartRateLog = {
    kind: 'heartRateLog', subType, packetTotal: null, intervalMinutes: null,
    startedAtUnixSec: null, values: [], isFinal: false, isEmpty: false,
  }
  if (subType === 0xff) return { ...base, isEmpty: true }
  if (subType === 0) return { ...base, packetTotal: v[2], intervalMinutes: v[3] }
  if (subType === 1) {
    // Signed 32-bit little-endian unix seconds, then 9 samples.
    const ts = (v[2] | (v[3] << 8) | (v[4] << 16) | (v[5] << 24)) | 0
    return { ...base, startedAtUnixSec: ts, values: v.slice(6, 15) }
  }
  return { ...base, values: v.slice(2, 15), isFinal: subType === 23 }
}

// ── V2 "big data" frames ───────────────────────────────────────────────────────────────────

/** Header length of a V2 frame: `0xbc`, type, u16 length, u16 CRC. */
export const BIG_DATA_HEADER = 6

/** Declared payload length of a V2 frame, or null when the frame is too short to say. Callers use
 *  it to know whether more packets are still to come — the ring splits large payloads. */
export function bigDataPayloadLength(value: ArrayLike<number> | null | undefined): number | null {
  const v = bytes(value)
  if (!v || v.length < 4 || v[0] !== CMD.BIG_DATA) return null
  return u16(v[2], v[3])
}

/** True once `value` holds a complete V2 frame (header + declared payload). */
export function isBigDataComplete(value: ArrayLike<number> | null | undefined): boolean {
  const len = bigDataPayloadLength(value)
  return len !== null && (value as ArrayLike<number>).length >= len + BIG_DATA_HEADER
}

/** Decode a reassembled V2 frame. Pass the whole thing — partial frames decode to `unknown`. */
export function decodeBigData(value: ArrayLike<number> | null | undefined): ColmiFrame {
  const v = bytes(value)
  if (!v) return unknown(null, 'empty frame')
  if (v[0] !== CMD.BIG_DATA) return unknown(v[0] ?? null, 'not a big-data frame')
  if (v.length < BIG_DATA_HEADER) return unknown(v[0], 'truncated big-data header')
  const length = u16(v[2], v[3])
  if (v.length < length + BIG_DATA_HEADER) return unknown(v[0], 'incomplete big-data payload')

  switch (v[1]) {
    case BIG_DATA_TYPE.SLEEP:       return decodeSleep(v, length)
    case BIG_DATA_TYPE.TEMPERATURE: return decodeTemperature(v, length)
    case BIG_DATA_TYPE.SPO2:        return decodeSpo2(v, length)
    default: return unknown(v[0], `unhandled big-data type 0x${v[1].toString(16)}`)
  }
}

function decodeSleep(v: number[], length: number): ColmiFrame {
  if (length < 2) return { kind: 'sleep', sessions: [] }   // the ring's "no sleep history" answer
  const dayCount = v[6]
  const sessions: SleepSession[] = []
  let i = 7
  for (let d = 0; d < dayCount; d++) {
    if (i + 5 >= v.length) break                            // truncated — keep what parsed
    const daysAgo = v[i++]
    const dayBytes = v[i++]
    const startMinute = u16(v[i], v[i + 1]); i += 2
    const endMinute = u16(v[i], v[i + 1]); i += 2
    const stages: SleepStageSpan[] = []
    // dayBytes counts the 4 start/end bytes plus 2 per stage span.
    for (let j = 4; j < dayBytes; j += 2) {
      if (i + 1 >= v.length) break
      const stage = v[i]
      const minutes = v[i + 1]
      i += 2
      if (minutes > 0) stages.push({ stage, minutes })      // a zero-length span is padding
    }
    sessions.push({ daysAgo, startMinute, endMinute, stages })
  }
  return { kind: 'sleep', sessions }
}

function decodeTemperature(v: number[], length: number): ColmiFrame {
  const readings: TemperatureHistory['readings'] = []
  let i = BIG_DATA_HEADER
  let daysAgo = -1
  while (daysAgo !== 0 && i - BIG_DATA_HEADER < length && i < v.length) {
    daysAgo = v[i++]
    i++                                       // one unknown byte, observed as 0x1e
    for (let hour = 0; hour <= 23; hour++) {
      if (i + 1 >= v.length) break
      const onTheHour = v[i++]
      const halfPast = v[i++]
      // Raw 0 means "no sample". Scale: raw/10 + 20 °C.
      if (onTheHour > 0) readings.push({ daysAgo, minuteOfDay: hour * 60, celsius: onTheHour / 10 + 20 })
      if (halfPast > 0) readings.push({ daysAgo, minuteOfDay: hour * 60 + 30, celsius: halfPast / 10 + 20 })
      if (i - BIG_DATA_HEADER >= length) break
    }
  }
  return { kind: 'temperature', readings }
}

function decodeSpo2(v: number[], length: number): ColmiFrame {
  const readings: Spo2History['readings'] = []
  let i = BIG_DATA_HEADER
  let daysAgo = -1
  while (daysAgo !== 0 && i - BIG_DATA_HEADER < length && i < v.length) {
    daysAgo = v[i++]
    for (let hour = 0; hour <= 23; hour++) {
      if (i + 1 >= v.length) break
      const min = v[i++]
      const max = v[i++]
      if (min > 0 && max > 0) readings.push({ daysAgo, hour, min, max })
      if (i - BIG_DATA_HEADER >= length) break
    }
  }
  return { kind: 'spo2', readings }
}
