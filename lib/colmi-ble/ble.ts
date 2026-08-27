// Colmi R09 connector: pair, connect, drain, post. LEARNING MODE (PS-8).
//
// In-WebView BLE via `@capacitor-community/bluetooth-le`, the same path the chest strap uses. No
// native plugin and therefore NO APK: this ships through a normal Railway deploy. Proven on the
// owner's S25 on 2026-08-26 — a Web Bluetooth client connected to this ring and returned live HR
// (plan §11g/§11h), and that API is this plugin's browser twin.
//
// The ring buffers its own history, so a sync is "open the app, drain what accumulated" rather than
// the Oura's continuous capture. That is why the WebView path's suspension while backgrounded does
// not matter here.
import { decodeV1, decodeBigData, bigDataPayloadLength, type ColmiFrame } from '@/lib/colmi-ble/decode'
import { resolveRelative, resolveSleepWindow, resolveActivityBucket, localDayStartSeconds } from '@/lib/colmi-ble/resolve-time'
import {
  V1_SERVICE, V1_WRITE, V1_NOTIFY, V2_SERVICE, V2_WRITE, V2_NOTIFY, NAME_PREFIX,
  cmdBattery, cmdSetDateTime, cmdPhoneName, cmdSyncActivity, cmdSyncHeartRate,
  cmdSyncHrv, cmdSyncStress, cmdSyncSleep, cmdSyncTemperature, cmdSyncSpo2,
  cmdReadAutoPref, cmdWriteAutoPref, AUTO_METRICS, type AutoMetric,
} from '@/lib/colmi-ble/protocol'
import { getPairedRing, setPairedRing, type PairedRing } from '@/lib/colmi-ble/paired-ring'

/** Gadgetbridge waits this long after connecting "to give the ring time to settle" before its
 *  first command. Copied rather than reasoned about — it is the only client known to work here. */
const SETTLE_MS = 2000
/**
 * How long to keep collecting notifications after the last command.
 *
 * Raised 12s → 30s after the first real overnight sync returned only a battery reading. The
 * history commands answer in multi-packet bursts (the heart-rate log alone can be 24 packets) and
 * a manual sync the user is watching can afford to wait. A drain that ends early is indistinguishable
 * from a ring with no history, which is the failure this whole diagnostic exists to tell apart.
 */
const DRAIN_MS = 30_000
const COMMAND_GAP_MS = 400

export interface ColmiSyncOutcome {
  ok: boolean
  /** Distinguishes "the ring said nothing" from "the ring had nothing", which look identical
   *  otherwise and must never be recorded as the same thing (plan §11e). */
  reason?: 'unavailable' | 'not-paired' | 'connect-failed' | 'silent' | 'post-failed'
  framesSeen: number
  readings: number
  sleepSegments: number
  stored?: { readings: number; sleep: number }
  /** What the route kept after its per-sample window and range filters, before the de-dup insert.
   *  `readings` sent minus this is what the FILTERS dropped; this minus `stored` is what the unique
   *  key deduped. Without both, 223 sent reaching 17 rows has two explanations and no way to pick. */
  accepted?: { readings: number; sleep: number }
  battery?: { percent: number; charging: boolean }
  /**
   * Every frame the ring sent, tallied by its command byte (`'0x73'`, `'0x43'`, …), plus how many
   * decoded to nothing usable.
   *
   * This is the number that tells the two failure modes apart, and without it they look identical:
   * a ring that recorded nothing overnight and a decoder that dropped everything both produce
   * "1 sample". If a history command's tag is absent here the ring never answered it; if it is
   * present and `readings` is still low, we answered and failed to map it.
   */
  diagnostics?: {
    frameTags: Record<string, number>
    unmapped: number
    /** A few raw frames we could not use, newest last — the input to a decoder fix. */
    unmappedHex: string[]
    /** How many heart-rate packets arrived carrying each sub-type byte, and how many samples each
     *  produced. `framesToPayload` reads that byte as a packet NUMBER and spaces the series by it;
     *  if the ring repeats a value instead of counting up, every packet lands on the same
     *  timestamps and all but one is discarded on the unique key. 122 samples reaching 7 rows is
     *  what that looks like from the database, and only this tally tells the two apart. */
    hrSubTypes: Record<string, { packets: number; samples: number }>
  }
  /** Which automatic measurements the ring reports as ON, read back AFTER we tried to enable them.
   *  A metric missing here recorded nothing, which is why an empty history is not proof of a
   *  ring that was not worn. */
  autoPrefs?: Partial<Record<AutoMetric, { enabled: boolean; intervalMinutes: number | null }>>
  message?: string
}

async function getBle() {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return null
    const { BleClient } = await import('@capacitor-community/bluetooth-le')
    return BleClient
  } catch { return null }
}

/** OS picker filtered to the ring's advertised name prefix. */
export async function pairColmiRing(): Promise<PairedRing | null> {
  const Ble = await getBle()
  if (!Ble) return null
  await Ble.initialize()
  const device = await Ble.requestDevice({
    namePrefix: NAME_PREFIX,
    optionalServices: [V1_SERVICE, V2_SERVICE],
  })
  const paired = { deviceId: device.deviceId, name: device.name ?? 'Colmi ring' }
  setPairedRing(paired)
  return paired
}

export function forgetColmiRing(): void { setPairedRing(null) }

interface SyncOptions {
  /** Today's date in the USER's timezone, 'YYYY-MM-DD'. The caller resolves it; this module never
   *  reads a clock for calendar purposes. */
  todayStr: string
  timezone: string
  /** Local wall-clock parts, user's timezone, for setting the ring's own clock. */
  now: { year: number; month: number; day: number; hour: number; minute: number; second: number }
  /** How many days of activity history to request. */
  activityDays?: number
  /**
   * Switch on every automatic measurement before draining. Default true, and it is the reason a
   * night of wear produces anything: each metric has its own switch on the ring, a ring whose
   * switches are off records nothing, and it syncs perfectly cleanly while doing so.
   *
   * Idempotent — writing "on" to a switch already on is free — so this runs every sync rather than
   * once at pairing, because a factory reset or the vendor app could turn them back off and nothing
   * would tell us.
   */
  enableAutoMetrics?: boolean
  /** Heart-rate sampling interval in minutes. The ring rounds to 5 and caps at 60. */
  hrIntervalMinutes?: number
}

/**
 * Connect, run the sync commands, decode what comes back, and post it.
 *
 * Collect-then-post rather than streaming: the ring answers asynchronously across both notify
 * characteristics and a single batched write is one round trip instead of dozens.
 */
export async function syncColmiRing(opts: SyncOptions): Promise<ColmiSyncOutcome> {
  const empty: ColmiSyncOutcome = { ok: false, framesSeen: 0, readings: 0, sleepSegments: 0 }
  const Ble = await getBle()
  if (!Ble) return { ...empty, reason: 'unavailable', message: 'Bluetooth is only available in the app.' }

  const paired = getPairedRing()
  if (!paired) return { ...empty, reason: 'not-paired', message: 'No ring paired yet.' }

  const frames: ColmiFrame[] = []
  let framesSeen = 0
  let battery: { percent: number; charging: boolean } | undefined
  // V2 payloads arrive split across notifications and must be reassembled before they mean anything.
  let bigDataBuffer: number[] = []

  const autoPrefs: NonNullable<ColmiSyncOutcome['autoPrefs']> = {}
  const frameTags: Record<string, number> = {}
  // The archival copy. Every frame, before any decoding — including the ones the decoders read
  // fine, because "read fine" is a claim the bytes are what checks.
  const rawFrames: { channel: 'v1' | 'v2'; tag: number | null; hex: string }[] = []
  const hrSubTypes: Record<string, { packets: number; samples: number }> = {}
  const unmappedHex: string[] = []
  let unmapped = 0
  const toHex = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')

  const note = (bytes: Uint8Array, frame: ColmiFrame, channel: 'v1' | 'v2' = 'v1') => {
    const tag = `0x${(bytes[0] ?? 0).toString(16).padStart(2, '0')}`
    if (rawFrames.length < MAX_RAW_FRAMES) {
      rawFrames.push({ channel, tag: bytes[0] ?? null, hex: toHex(bytes) })
    }
    frameTags[tag] = (frameTags[tag] ?? 0) + 1
    if (frame.kind === 'heartRateLog') {
      const key = `s${frame.subType}`
      const seen = hrSubTypes[key] ?? { packets: 0, samples: 0 }
      hrSubTypes[key] = {
        packets: seen.packets + 1,
        samples: seen.samples + frame.values.filter(v => v > 0).length,
      }
    }
    if (frame.kind === 'unknown' && !SENTINEL_REASONS.has(frame.reason)) {
      unmapped++
      if (unmappedHex.length < MAX_UNMAPPED_HEX) unmappedHex.push(toHex(bytes))
    }
  }

  const onV1 = (view: DataView) => {
    framesSeen++
    const bytes = new Uint8Array(view.buffer)
    const f = decodeV1(bytes)
    note(bytes, f)
    if (f.kind === 'battery') battery = { percent: f.percent, charging: f.charging }
    if (f.kind === 'autoPref') autoPrefs[f.metric] = { enabled: f.enabled, intervalMinutes: f.intervalMinutes }
    frames.push(f)
  }

  const onV2 = (view: DataView) => {
    framesSeen++
    const chunk = Array.from(new Uint8Array(view.buffer))
    bigDataBuffer = bigDataBuffer.length === 0 ? chunk : bigDataBuffer.concat(chunk)
    const declared = bigDataPayloadLength(bigDataBuffer)
    if (declared === null) { bigDataBuffer = []; return }          // not a frame start — drop and resync
    if (bigDataBuffer.length < declared + 6) return                 // more to come
    const whole = Uint8Array.from(bigDataBuffer)
    const decoded = decodeBigData(whole)
    note(whole, decoded, 'v2')
    frames.push(decoded)
    bigDataBuffer = []
  }

  try {
    await Ble.initialize()
    await Ble.connect(paired.deviceId, () => { /* disconnect is handled by the outcome below */ })
  } catch (e) {
    return { ...empty, reason: 'connect-failed', message: connectHint(e) }
  }

  try {
    await Ble.startNotifications(paired.deviceId, V1_SERVICE, V1_NOTIFY, onV1)
    await Ble.startNotifications(paired.deviceId, V2_SERVICE, V2_NOTIFY, onV2)
    await sleep(SETTLE_MS)

    const write = async (service: string, characteristic: string, bytes: Uint8Array) => {
      await Ble.write(paired.deviceId, service, characteristic, new DataView(bytes.buffer as ArrayBuffer))
      await sleep(COMMAND_GAP_MS)
    }
    const v1 = (b: Uint8Array) => write(V1_SERVICE, V1_WRITE, b)
    const v2 = (b: Uint8Array) => write(V2_SERVICE, V2_WRITE, b)

    // Order copied from Gadgetbridge's own connect sequence: identify, set the clock, then ask.
    await v1(cmdPhoneName('TA'))
    await v1(cmdSetDateTime(opts.now))
    await v1(cmdBattery())

    // Switch the recording on BEFORE draining, then read the switches back. Enabling first means
    // tonight is covered even if this is the first sync; reading back after means the outcome
    // reports what the ring actually has on rather than what we asked for.
    if (opts.enableAutoMetrics !== false) {
      for (const metric of AUTO_METRICS) {
        await v1(cmdWriteAutoPref(metric, true, opts.hrIntervalMinutes ?? 5))
      }
    }
    for (const metric of AUTO_METRICS) await v1(cmdReadAutoPref(metric))
    const days = opts.activityDays ?? 3
    for (let d = 0; d < days; d++) await v1(cmdSyncActivity(d))
    // One request per day: the heart-rate log is addressed BY day, unlike HRV and stress which
    // return the current day unasked. Walk back from today so a sync after midnight still collects
    // the night that has just ended.
    for (let d = 0; d < days; d++) {
      const dayStr = shiftDay(opts.todayStr, -d)
      await v1(cmdSyncHeartRate(localDayStartSeconds(dayStr)))
    }
    await v1(cmdSyncHrv())
    await v1(cmdSyncStress())
    await v2(cmdSyncSleep())
    await v2(cmdSyncTemperature())
    await v2(cmdSyncSpo2())

    await sleep(DRAIN_MS)
  } catch (e) {
    return { ...empty, framesSeen, reason: 'connect-failed', message: describe(e) }
  } finally {
    try { await Ble.stopNotifications(paired.deviceId, V1_SERVICE, V1_NOTIFY) } catch { /* closing */ }
    try { await Ble.stopNotifications(paired.deviceId, V2_SERVICE, V2_NOTIFY) } catch { /* closing */ }
    try { await Ble.disconnect(paired.deviceId) } catch { /* closing */ }
  }

  const diagnostics = { frameTags, unmapped, unmappedHex, hrSubTypes }

  if (framesSeen === 0) {
    // The ring's application processor sleeps when it has been still, and a sleeping ring is
    // indistinguishable from a broken one over GATT (plan §11e). Say so rather than recording "no
    // data" — and do NOT treat this as a successful empty sync.
    return { ...empty, diagnostics, reason: 'silent',
             message: 'The ring did not respond. Put it on or place it on the charger and try again.' }
  }

  const payload = framesToPayload(frames, opts)
  try {
    const res = await fetch('/api/colmi/samples', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, rawFrames }),
      cache: 'no-store',
    })
    if (!res.ok) {
      return { ok: false, framesSeen, reason: 'post-failed', battery, autoPrefs, diagnostics,
               readings: payload.readings.length, sleepSegments: payload.sleep.length,
               message: `Upload failed (${res.status}).` }
    }
    const body = await res.json() as {
      stored?: { readings: number; sleep: number }
      accepted?: { readings: number; sleep: number }
    }
    return { ok: true, framesSeen, battery, autoPrefs, diagnostics,
             readings: payload.readings.length, sleepSegments: payload.sleep.length,
             stored: body.stored, accepted: body.accepted }
  } catch (e) {
    return { ok: false, framesSeen, reason: 'post-failed', battery, autoPrefs, diagnostics,
             readings: payload.readings.length, sleepSegments: payload.sleep.length, message: describe(e) }
  }
}

/** Heart-rate log packet numbering. Packet 0 is the header, packet 1 carries the start time and 9
 *  samples, and every packet after it carries 13 that continue the same series. */
const HR_LOG_HEADER = 0
const HR_LOG_ANCHOR = 1
const HR_ANCHOR_SAMPLES = 9
const HR_CONTINUATION_SAMPLES = 13
/** Used only until the header names the real one — the ring's own default is 5 minutes. */
const HR_DEFAULT_INTERVAL_MINUTES = 5

/** Answers that ARE understood, and mean "nothing to send". They decode to `unknown` because they
 *  carry no sample, and counting them as not-understood made a healthy sync report frames it could
 *  not read — which is the opposite of what the panel is for. */
const SENTINEL_REASONS = new Set(['no activity history'])

/** The route caps the array at 500; stop before it so an oversized sync loses the samples' own
 *  request rather than being rejected whole. A sync sends about 66. */
const MAX_RAW_FRAMES = 480

const MAX_UNMAPPED_HEX = 8

export interface ColmiPayload {
  readings: { kind: string; at: number; value: number; valueHigh?: number }[]
  sleep: { startedAt: number; endedAt: number; stage: number; minutes: number }[]
}

/** Pure: decoded frames in, ingest payload out. Split out so the mapping is testable without BLE. */
export function framesToPayload(frames: ColmiFrame[], opts: Pick<SyncOptions, 'todayStr' | 'timezone'>): ColmiPayload {
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
          if (bpm > 0) readings.push({ kind: 'heart_rate', at: hrAnchorSec! * 1000 + (index + i) * stepMs, value: bpm })
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

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Shift a 'YYYY-MM-DD' key by whole days. Pure date-key arithmetic, no zone involved. */
function shiftDay(dayStr: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayStr)
  if (!m) return dayStr
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}
const describe = (e: unknown) => e instanceof Error ? e.message : 'Unknown error'

function connectHint(e: unknown): string {
  // A peripheral takes exactly ONE connection and stops advertising while it is held, so a ring
  // held by another app is invisible rather than busy — and that presents as "not found", which
  // reads identically to out-of-range or a flat battery unless we say so (plan §11g).
  return `${describe(e)} — if another app (Gadgetbridge, QRing, a BLE scanner) is connected to the ring, disconnect it first.`
}
