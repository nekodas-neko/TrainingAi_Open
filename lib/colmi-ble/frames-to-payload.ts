// Decoded Colmi frames → ingest payload. LEARNING MODE (PS-8).
//
// Split out of `ble.ts` so the SERVER can run it (PS-21 Stage A). Nothing here touches Bluetooth or
// the DOM: frames in, readings out. That is what lets one decoder serve both the in-app sync and a
// native transport service that only carries bytes — and, more importantly, lets a decoder fix be
// applied RETROACTIVELY by re-reading `colmi_raw_frames`, which is how three of this integration's
// defects were repaired without re-wearing the ring.
import { decodeV1, decodeBigData, type ColmiFrame } from '@/lib/colmi-ble/decode'
import { resolveRelative, resolveSleepWindow, resolveActivityBucket, wallClockSecondsToEpochMs } from '@/lib/colmi-ble/resolve-time'

/** Heart-rate log packet numbering. Packet 0 is the header, packet 1 carries the start time and 9
 *  samples, and every packet after it carries 13 that continue the same series. */
const HR_LOG_HEADER = 0
const HR_LOG_ANCHOR = 1
const HR_ANCHOR_SAMPLES = 9
const HR_CONTINUATION_SAMPLES = 13
/** Used only until the header names the real one — the ring's own default is 5 minutes. */
const HR_DEFAULT_INTERVAL_MINUTES = 5

/** Everything the mapping needs to turn the ring's relative time into instants. Both are resolved
 *  by the CALLER — the client from the device's clock, the server from the user's stored timezone —
 *  because this module never reads a clock for calendar purposes. */
export interface PayloadTimeContext {
  /** Today's date, 'YYYY-MM-DD', already in `timezone`. Anchors every `daysAgo` the ring reports.
   *  Re-decoding archived frames therefore needs the day they were CAPTURED, not the day of the
   *  re-decode: pass the wrong one and every relative reading shifts by the difference. */
  todayStr: string
  timezone: string
}

export interface ColmiPayload {
  readings: { kind: string; at: number; value: number; valueHigh?: number }[]
  sleep: { startedAt: number; endedAt: number; stage: number; minutes: number }[]
}

/** Pure: decoded frames in, ingest payload out. Split out so the mapping is testable without BLE. */
export function framesToPayload(frames: ColmiFrame[], opts: PayloadTimeContext): ColmiPayload {
  const readings: ColmiPayload['readings'] = []
  const sleepOut: ColmiPayload['sleep'] = []
  const { todayStr, timezone: tz } = opts
  // Carried across frames: the heart-rate log is one series split over numbered packets, and the
  // clock it starts from is named once, in packet 1.
  let hrAnchorSec: number | null = null
  let hrIntervalMinutes = HR_DEFAULT_INTERVAL_MINUTES

  for (const f of frames) {
    switch (f.kind) {
      case 'battery':
        readings.push({ kind: 'battery', at: Date.now(), value: f.percent })
        break

      case 'autoPref':
        break   // configuration state, surfaced on the outcome — not a sample

      case 'realtimeHeartRate':
        if (f.bpm > 0) readings.push({ kind: 'heart_rate', at: Date.now(), value: f.bpm })
        break

      case 'activity': {
        if (f.isFinal && f.steps === 0 && f.year === 0) break     // end-of-sweep marker, not a bucket
        const at = resolveActivityBucket(f.year, f.month, f.day, f.quarterHour, tz)
        if (!at) break
        const ms = at.getTime()
        if (f.steps > 0) readings.push({ kind: 'steps', at: ms, value: f.steps })
        if (f.calories > 0) readings.push({ kind: 'calories', at: ms, value: f.calories })
        if (f.distanceMetres > 0) readings.push({ kind: 'distance', at: ms, value: f.distanceMetres })
        break
      }

      case 'hrv':
      case 'stress':
        for (const p of f.points) {
          readings.push({ kind: f.kind, at: resolveRelative(todayStr, 0, p.minuteOfDay, tz).getTime(), value: p.value })
        }
        break

      case 'heartRateLog': {
        if (f.isEmpty) break
        // The ring answers one request with a numbered series covering the whole day. Packet 0 is a
        // header, packet 1 names the clock, and packets 2..n continue from it — so only packet 1
        // carries `startedAtUnixSec`, and dropping the rest for lack of one threw away 24 of 26
        // packets. Worse, the 9 samples packet 1 does carry are the first 45 minutes after local
        // midnight, which is exactly when nobody is awake to have a heart rate recorded: they came
        // back as zeros, were filtered, and the whole log read as "the ring sent nothing".
        if (f.subType === HR_LOG_HEADER) {
          hrAnchorSec = null
          if (f.intervalMinutes && f.intervalMinutes > 0) hrIntervalMinutes = f.intervalMinutes
          break
        }
        if (f.subType === HR_LOG_ANCHOR) hrAnchorSec = f.startedAtUnixSec
        if (hrAnchorSec === null) break
        const index = f.subType === HR_LOG_ANCHOR
          ? 0
          : HR_ANCHOR_SAMPLES + (f.subType - HR_LOG_ANCHOR - 1) * HR_CONTINUATION_SAMPLES
        const stepMs = hrIntervalMinutes * 60_000
        f.values.forEach((bpm, i) => {
          // A zero is "not measured", not a reading of zero — the ring stores a slot for every
          // interval whether or not it sampled one.
          // The anchor is the local-wall-clock-as-UTC value we sent, echoed back — not an epoch.
          if (bpm > 0) readings.push({ kind: 'heart_rate', at: wallClockSecondsToEpochMs(hrAnchorSec!, tz) + (index + i) * stepMs, value: bpm })
        })
        break
      }

      case 'sleep':
        for (const s of f.sessions) {
          const win = resolveSleepWindow(todayStr, s.daysAgo, s.startMinute, s.endMinute, tz)
          let cursor = win.startedAt.getTime()
          for (const span of s.stages) {
            const end = cursor + span.minutes * 60_000
            sleepOut.push({ startedAt: cursor, endedAt: end, stage: span.stage, minutes: span.minutes })
            cursor = end
          }
        }
        break

      case 'temperature':
        for (const r of f.readings) {
          readings.push({ kind: 'temperature', at: resolveRelative(todayStr, r.daysAgo, r.minuteOfDay, tz).getTime(), value: r.celsius })
        }
        break

      case 'spo2':
        for (const r of f.readings) {
          readings.push({
            kind: 'spo2',
            at: resolveRelative(todayStr, r.daysAgo, r.hour * 60, tz).getTime(),
            value: r.min, valueHigh: r.max,
          })
        }
        break
    }
  }
  return { readings, sleep: sleepOut }
}


/** One archived frame: the bytes exactly as the ring sent them, plus which channel carried it. */
export interface RawFrameInput {
  channel: 'v1' | 'v2'
  hex: string
}

/**
 * Archived hex back into decoded frames.
 *
 * ORDER IS LOAD-BEARING and is the caller's to preserve. The heart-rate log is one series split
 * across numbered packets whose start time is named once, in packet 1; `framesToPayload` carries
 * that anchor forward, so a reordered array silently reassigns every sample's timestamp. The client
 * posts frames in arrival order and the route decodes them in that order — a re-decode reading from
 * the table must sort by insertion, never by anything derived from the frame's contents.
 *
 * A frame that will not decode comes back as `unknown` rather than throwing, matching the live
 * path: an undecodable frame must never cost the sync the frames around it.
 */
export function decodeRawFrames(rows: readonly RawFrameInput[]): ColmiFrame[] {
  const out: ColmiFrame[] = []
  for (const row of rows) {
    const bytes = hexToBytes(row.hex)
    if (!bytes) { out.push({ kind: 'unknown', command: null, reason: 'unreadable hex' }); continue }
    out.push(row.channel === 'v2' ? decodeBigData(bytes) : decodeV1(bytes))
  }
  return out
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    if (!Number.isFinite(byte)) return null
    out[i] = byte
  }
  return out
}

/**
 * Put archived frames back into an order `framesToPayload` can replay.
 *
 * `framesToPayload` is single-pass and order-dependent, which is correct for a live sync: frames
 * arrive in the order the ring sent them. Replaying the ARCHIVE is not that. All frames of one sync
 * are written in a single insert, so `received_at` and `created_at` are the transaction clock and
 * identical across every row — measured 2026-09-02, 31 frames, one timestamp — and rows stored
 * before migration 263 have no `seq` either. Read back, the heart-rate log comes out shuffled, and
 * a shuffle that puts a continuation before its anchor drops the whole log.
 *
 * The heart-rate log is the only order-sensitive frame, and it carries its own position: packet 0
 * is the header, 1 the anchor, and the rest continue in packet order. Sorting them by that number
 * restores the sequence without inventing anything. Everything else keeps its relative order.
 *
 * The limit is honest and checked: ONE sync can hold several days' logs, each its own header and
 * anchor, and a continuation packet does not say which run it belongs to. With more than one anchor
 * the runs cannot be told apart without the original order, so this returns the input untouched
 * rather than interleaving two days into one wrong series.
 */
export function sortFramesForReplay(frames: readonly ColmiFrame[]): ColmiFrame[] {
  const hrIndexes: number[] = []
  let anchors = 0
  frames.forEach((f, i) => {
    if (f.kind !== 'heartRateLog') return
    hrIndexes.push(i)
    if (f.subType === HR_LOG_ANCHOR) anchors++
  })
  if (hrIndexes.length === 0 || anchors > 1) return [...frames]

  const sorted = hrIndexes
    .map(i => frames[i] as Extract<ColmiFrame, { kind: 'heartRateLog' }>)
    .sort((a, b) => a.subType - b.subType)
  const out = [...frames]
  hrIndexes.forEach((slot, n) => { out[slot] = sorted[n] })
  return out
}
