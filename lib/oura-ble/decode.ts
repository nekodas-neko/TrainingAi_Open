/**
 * Oura Ring history-event decoders — ported byte-exact from open_oura's Rust
 * `crates/oura-protocol/src/events.rs` `decode_body` (the source of truth per the
 * oura-native-ble skill; NOT the docs). Pure and infallible: an unrecognised or
 * malformed body returns `null` so the raw bytes stay stored for later re-decode
 * (RE11). Every decoder below is pinned to a captured Ring-5 test vector.
 *
 * A ring "event" frame is tag–length–payload where the payload is a 4-byte
 * little-endian deciseconds timestamp followed by the event body. `decodeEventBody`
 * operates on the body (timestamp already stripped).
 */

export interface RawFrame {
  tag: number
  payload: Uint8Array
}

export interface HistoryEvent {
  tag: number
  name: string
  /** Ring clock, deciseconds. */
  timestampDs: number
  bodyHex: string
  decoded: Record<string, unknown> | null
}

const HISTORY_EVENT_PREFIX = 0x41

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase()
  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/.test(clean)) return new Uint8Array(0)
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16)
  return out
}

export function bytesToHex(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0')
  return s
}

/**
 * Parse a notification frame leniently (mirrors Rust `Packet::parse`): if the
 * declared length disagrees with the buffer, use the remaining bytes after the
 * 2-byte header (rings occasionally pad frames). Null if too short for a header.
 */
export function parseFrame(frame: Uint8Array): RawFrame | null {
  if (frame.length < 2) return null
  const tag = frame[0]
  const len = frame[1]
  const end = 2 + len
  const payload = end <= frame.length ? frame.slice(2, end) : frame.slice(2)
  return { tag, payload }
}

function le16(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8)
}
function le32(b: Uint8Array, i: number): number {
  // >>> 0 to keep it an unsigned 32-bit integer.
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0
}

// ─── per-tag decoders (each ported from events.rs, pinned to captured bytes) ───

/** One or more little-endian i16 temperatures in centi-°C; rejects out-of-range. */
function decodeTemperatures(body: Uint8Array): Record<string, unknown> | null {
  if (body.length === 0 || body.length % 2 !== 0) return null
  const temps: number[] = []
  for (let i = 0; i < body.length; i += 2) {
    const raw = body[i] | (body[i + 1] << 8)
    const centi = raw > 0x7fff ? raw - 0x10000 : raw // i16
    const celsius = centi / 100
    if (celsius < -40 || celsius > 85) return null
    temps.push(Math.round(celsius * 100) / 100)
  }
  return { temps_c: temps }
}

/** green_ibi_quality_event (0x80): `ibi = (b1 & 7) | (b0 << 3)`, quality `(b1>>3)&3`. */
function decodeGreenIbiQuality(body: Uint8Array): Record<string, unknown> | null {
  if (body.length < 2) return null
  const ibiMs: number[] = []
  const quality: number[] = []
  const hrBpm: number[] = []
  for (let i = 0; i + 2 <= body.length; i += 2) {
    const ibi = (body[i + 1] & 0x07) | (body[i] << 3)
    const q = (body[i + 1] >> 3) & 0x03
    if (q === 1 && ibi >= 300 && ibi <= 2000) hrBpm.push(Math.floor(60000 / ibi))
    ibiMs.push(ibi)
    quality.push(q)
  }
  return { ibi_ms: ibiMs, quality, hr_bpm: hrBpm }
}

/** ibi_and_amplitude_event (0x60): fixed 14-byte packed layout. */
function decodeIbiAmplitude(body: Uint8Array): Record<string, unknown> | null {
  if (body.length !== 14) return null
  const b = body
  const ibiMs = [
    (b[6] & 1) | (b[0] << 3) | ((b[12] >> 5) & 6),
    (b[7] & 1) | (b[1] << 3) | ((b[12] >> 3) & 6),
    (b[8] & 1) | (b[2] << 3) | ((b[12] >> 1) & 6),
    (b[9] & 1) | (b[3] << 3) | ((b[12] & 3) << 1),
    (b[10] & 1) | (b[4] << 3) | ((b[13] >> 5) & 6),
    (b[11] & 1) | (b[5] << 3) | ((b[13] >> 3) & 6),
  ]
  const shift = (b[13] & 0x0f) === 7 ? 0 : (b[13] & 0x0f) + 1
  const amplitude = [0, 1, 2, 3, 4, 5].map((k) => (b[6 + k] >> 1) << shift)
  const hrBpm = ibiMs.filter((i) => i >= 300 && i <= 2000).map((i) => Math.floor(60000 / i))
  return { ibi_ms: ibiMs, amplitude, hr_bpm: hrBpm }
}

/** hrv_event (0x5d): pairs of (avg HR bpm, avg RMSSD ms), one per 5 min. */
function decodeHrv(body: Uint8Array): Record<string, unknown> | null {
  if (body.length === 0 || body.length % 2 !== 0) return null
  const hr: number[] = []
  const rmssd: number[] = []
  for (let i = 0; i < body.length; i += 2) {
    hr.push(body[i])
    rmssd.push(body[i + 1])
  }
  return { hr_bpm: hr, rmssd_ms: rmssd, interval_min: 5 }
}

/** spo2_event (0x6f): header byte + one SpO2 %/sample; trailing 0xff sentinel dropped. */
function decodeSpo2(body: Uint8Array): Record<string, unknown> | null {
  if (body.length < 2) return null
  let end = body.length
  if (body[end - 1] === 0xff) end -= 1
  const spo2 = Array.from(body.slice(1, end))
  if (spo2.length === 0) return null
  return { spo2_percent: spo2 }
}

/** spo2_r_pi_event (0x8b): header + 3-byte samples (R u16 BE /16384, PI u8/255×0.05). */
function decodeSpo2RPi(body: Uint8Array): Record<string, unknown> | null {
  if (body.length < 4 || (body.length - 1) % 3 !== 0) return null
  const r: number[] = []
  const pi: number[] = []
  let o = 1
  while (o + 3 <= body.length) {
    const rv = ((body[o] << 8) | body[o + 1]) / 16384
    r.push(Math.round(rv * 1000) / 1000)
    pi.push(Math.round((body[o + 2] / 255) * 0.05 * 10000) / 10000)
    o += 3
  }
  return { r, perfusion_index: pi }
}

function decodeAscii(body: Uint8Array): Record<string, unknown> | null {
  // Strip ALL null bytes, not just trailing: an interior NUL in a JSON string
  // is rejected by Postgres jsonb ("unsupported Unicode escape sequence") and would
  // 500 the ingest. debug_data (0x61) routes embedded-null payloads through here.
  const text = new TextDecoder().decode(body).replace(/\0/g, '').trim()
  return text.length === 0 ? null : { ascii: text }
}

/** debug_data (0x61): printable → ascii; binary subtype 0x24 → battery. */
function decodeDebugData(body: Uint8Array): Record<string, unknown> | null {
  if (body.length === 0) return null
  const printable = body.every((b) => b === 0 || (b >= 0x20 && b < 0x7f))
  if (printable) return decodeAscii(body)
  if (body[0] === 0x11 && body.length >= 5) {
    return { kind: 'charging_time', subtype: 0x11, charging_time: le32(body, 1), _status: 'unvalidated' }
  }
  if (body[0] === 0x24 && body.length >= 4) {
    const v: Record<string, unknown> = {
      kind: 'battery_level_changed',
      subtype: 0x24,
      battery_pct: body[1],
      voltage_mv: le16(body, 2),
    }
    if (body.length > 4) {
      v.flag_a = (body[4] >> 1) & 1
      v.flag_b = body[4] & 1
    }
    return v
  }
  return { kind: 'debug_data', subtype: body[0], raw: bytesToHex(body) }
}

/** time_sync (0x42): u32 LE unix timestamp. */
function decodeTimeSync(body: Uint8Array): Record<string, unknown> | null {
  if (body.length < 4) return null
  return { unix_time: le32(body, 0) }
}

/** state_change / wear_event (0x45 / 0x53): state byte + ASCII description. */
function decodeStateText(body: Uint8Array): Record<string, unknown> | null {
  if (body.length === 0) return null
  const text = new TextDecoder().decode(body.slice(1)).replace(/\0/g, '').trim()
  return { state: body[0], text }
}

const SLEEP_PHASES = ['deep', 'light', 'rem', 'awake'] as const

/** sleep_phase_* (0x4b / 0x4e / 0x5a): header byte + 2-bit hypnogram codes (4/byte, MSB-first). */
function decodeSleepPhases(body: Uint8Array): Record<string, unknown> | null {
  if (body.length < 2) return null
  const phases: string[] = []
  for (let i = 1; i < body.length; i++) {
    for (const shift of [6, 4, 2, 0]) phases.push(SLEEP_PHASES[(body[i] >> shift) & 0x03])
  }
  return { header: body[0], phases }
}

const round2 = (v: number) => Math.round(v * 100) / 100
const round4 = (v: number) => Math.round(v * 10000) / 10000

/** A body of little-endian u16 samples under a single key (ambient 0x59, intensity 0x74). */
function decodeU16Samples(body: Uint8Array, key: string): Record<string, unknown> | null {
  if (body.length === 0 || body.length % 2 !== 0) return null
  const v: number[] = []
  for (let i = 0; i < body.length; i += 2) v.push(le16(body, i))
  return { [key]: v }
}

/** activity_information (0x50): state byte + per-bin MET levels.
 *  Scale: `b < 128 → b×0.1`, else `12.8 + (b−128)×0.2` MET. */
function decodeActivityInfo(body: Uint8Array): Record<string, unknown> | null {
  if (body.length === 0) return null
  const met: number[] = []
  for (let i = 1; i < body.length; i++) {
    const b = body[i]
    met.push(round2(b < 0x80 ? b * 0.1 : 12.8 + (b - 128) * 0.2))
  }
  return { state: body[0], met }
}

/** motion_event (0x47): `b0>>5` orientation, `b0&0x1f` motion-seconds, three i8
 *  average-axis values ×8, optional low/high intensity 6-bit values (bit 6 set → reject). */
function decodeMotion(body: Uint8Array): Record<string, unknown> | null {
  if (body.length < 4) return null
  const i8 = (b: number) => (b > 0x7f ? b - 0x100 : b)
  const v: Record<string, unknown> = {
    orientation: body[0] >> 5,
    motion_seconds: body[0] & 0x1f,
    avg_x: i8(body[1]) * 8,
    avg_y: i8(body[2]) * 8,
    avg_z: i8(body[3]) * 8,
  }
  if (body.length >= 5) {
    if (body[4] & 0x40) return null
    v.low_intensity = body[4] & 0x3f
  }
  if (body.length >= 6) {
    if (body[5] & 0x40) return null
    v.high_intensity = body[5] & 0x3f
  }
  return v
}

/** bedtime_period (0x76): detected sleep window as two u32 LE ring deciseconds. */
function decodeBedtimePeriod(body: Uint8Array): Record<string, unknown> | null {
  if (body.length < 8) return null
  const start = le32(body, 0)
  const end = le32(body, 4)
  const hours = Math.max(0, end - start) / 10 / 3600
  return { bedtime_start_ds: start, bedtime_end_ds: end, duration_hours: round2(hours) }
}

/** sleep_acm_period (0x72): six accelerometer MAD statistics — three
 *  `int + frac/255` then three `12-bit/4095 + high-nibble` fixed-point values. */
function decodeSleepAcmPeriod(body: Uint8Array): Record<string, unknown> | null {
  if (body.length < 12) return null
  const fp = (frac: number, intg: number) => intg + frac / 255
  const q12 = (lo: number, hi: number) => (lo | ((hi & 0x0f) << 8)) / 4095 + (hi >> 4)
  return {
    acm_mad: [
      round4(fp(body[0], body[1])),
      round4(fp(body[2], body[3])),
      round4(fp(body[4], body[5])),
      round4(q12(body[6], body[7])),
      round4(q12(body[8], body[9])),
      round4(q12(body[10], body[11])),
    ],
  }
}

/** cva_raw_ppg_data (0x81): signed-int8 deltas; cumulative-sum reconstructs the
 *  PPG ADC samples (per-event, relative to this event's start). */
function decodeCvaRawPpg(body: Uint8Array): Record<string, unknown> | null {
  if (body.length === 0) return null
  const samples: number[] = []
  let acc = 0
  for (let i = 0; i < body.length; i++) {
    acc += body[i] > 0x7f ? body[i] - 0x100 : body[i]
    samples.push(acc)
  }
  return { ppg_samples: samples, n: samples.length }
}

/** A single leading byte under a named key (alert_event 0x56). */
function decodeFirstByte(body: Uint8Array, key: string): Record<string, unknown> | null {
  return body.length > 0 ? { [key]: body[0] } : null
}

/** motion_period (0x6b): header packs type (bits 6-7) and the final byte's sample
 *  count (bits 4-5); each following byte holds four 2-bit motion levels, MSB-first. */
function decodeMotionPeriod(body: Uint8Array): Record<string, unknown> | null {
  if (body.length < 2) return null
  const header = body[0]
  const lastCount = (header >> 4) & 0x03
  const levels: number[] = []
  for (let i = 1; i < body.length; i++) {
    const n = i === body.length - 1 ? lastCount : 4
    for (let k = 0; k < n; k++) levels.push((body[i] >> (6 - 2 * k)) & 0x03)
  }
  return { period_type: header >> 6, low_nibble: header & 0x0f, motion_levels: levels }
}

/** feature_session (0x6c): [feature_id][session_status][optional u16 LE value]. */
function decodeFeatureSession(body: Uint8Array): Record<string, unknown> | null {
  if (body.length < 2) return null
  const v: Record<string, unknown> = { feature_id: body[0], session_status: body[1] }
  if (body.length >= 4) v.value = le16(body, 2)
  return v
}

/** BLE/radio telemetry + diagnostics (0x5b/0x79/0x82/0x83): device-internal
 *  layouts — tag by name, keep the subtype discriminator and raw body. */
function decodeTelemetry(body: Uint8Array, kind: string): Record<string, unknown> | null {
  if (body.length === 0) return null
  return { kind, subtype: body[0], raw: bytesToHex(body) }
}

// ── UNVALIDATED decoders — layouts ported from the native parser via open_oura,
// not yet confirmed against captured bytes (these event types haven't appeared in
// our syncs). Each result carries `_status: 'unvalidated'`; drop the marker once a
// real sample confirms the field mapping (mirrors events.rs's convention). ──

/** sleep_summary_1 (0x49): two minute-offsets from the event's ring time. */
function decodeSleepSummary1(body: Uint8Array): Record<string, unknown> | null {
  if (body.length < 4) return null
  return { start_offset_min: le16(body, 0), end_offset_min: le16(body, 2), _status: 'unvalidated' }
}

/** sleep_summary_2 (0x4c): 14-byte record (u64, u16, u32); names unresolved. */
function decodeSleepSummary2(body: Uint8Array): Record<string, unknown> | null {
  if (body.length !== 14) return null
  // u64 as Number (values observed are far below 2^53).
  const fieldA = le32(body, 0) + le32(body, 4) * 0x100000000
  return { field_a_u64: fieldA, field_b_u16: le16(body, 8), field_c_u32: le32(body, 10), _status: 'unvalidated' }
}

/** sleep_summary_3 (0x4f): 11-byte record; three ÷8 fixed-point fields. */
function decodeSleepSummary3(body: Uint8Array): Record<string, unknown> | null {
  if (body.length !== 11) return null
  return {
    field_a: body[0] >> 3,
    field_b: body[1] >> 3,
    field_c: (le16(body, 2) >> 3) & 0xff,
    field_d_u32: le32(body, 4),
    field_e_u16: le16(body, 8),
    field_f_u8: body[10],
    _status: 'unvalidated',
  }
}

/** sleep_summary_4 (0x58): 7-byte record (u32, u16, u8). */
function decodeSleepSummary4(body: Uint8Array): Record<string, unknown> | null {
  if (body.length !== 7) return null
  return { field_a_u32: le32(body, 0), field_b_u16: le16(body, 4), field_c_u8: body[6], _status: 'unvalidated' }
}

/** real_steps_features_1/2 (0x7e/0x7f): 14-byte record. **On-device finding
 *  (2026-07-09, v1.122.16+):** captured before/after a counted 100-step walk, every
 *  byte changes with high entropy and NO byte/LE16/packed field tracks the step count
 *  — these are per-window accelerometer **feature vectors** (the ring's step-model
 *  inputs; the name says `..._FEATURE_*`), not a plaintext count. The running step
 *  total is computed downstream (phone/ecore, tier-2) and is NOT on this frame. The
 *  guess-unpacking below is kept only so the tester can surface the raw bytes; do not
 *  read `fields[]` as a count. See `docs/superpowers/plans/2026-07-09-oura-ble-steps.md`
 *  (hunting the count in an activity-summary event via the tester's frame dump). */
function decodeRealSteps(body: Uint8Array): Record<string, unknown> | null {
  if (body.length !== 14) return null
  const p = body
  const fields = [
    (p[3] >> 7) | (p[0] << 1),
    p[1] << 1,
    p[2] << 1,
    p[3] & 0x7f,
    p[4], p[5], p[6], p[7],
    (p[11] >> 7) | (p[8] << 1),
    p[9] << 1,
    p[10] << 1,
    p[11] & 0x7f,
    p[12], p[13],
  ]
  return { fields, _status: 'unvalidated' }
}

/** aohr_event (0x86): always-on HR — flag, base offset, count, then `count`
 *  2-byte samples (bpm, quality) at a fixed 1920 ms interval. */
function decodeAohr(body: Uint8Array): Record<string, unknown> | null {
  if (body.length < 3) return null
  const count = body[2]
  if (body.length !== count * 2 + 3) return null
  const bpm: number[] = []
  const quality: number[] = []
  for (let i = 0; i < count; i++) {
    bpm.push(body[3 + 2 * i])
    quality.push(body[4 + 2 * i])
  }
  return { flag: body[0] & 1, base_offset: body[1], interval_ms: 1920, bpm, quality, _status: 'unvalidated' }
}

/** ambient_event (0x84): signed-16 samples at a 5-minute interval. */
function decodeAmbient(body: Uint8Array): Record<string, unknown> | null {
  if (body.length === 0 || body.length % 2 !== 0) return null
  const values: number[] = []
  for (let i = 0; i < body.length; i += 2) {
    const raw = le16(body, i)
    values.push(raw > 0x7fff ? raw - 0x10000 : raw)
  }
  return { values, interval_min: 5, _status: 'unvalidated' }
}

/** atlas_metadata (0x87): bioZ stream "start" control message (subtype 0 only). */
function decodeAtlasMetadata(body: Uint8Array): Record<string, unknown> | null {
  if (body.length !== 10 || body[0] !== 0) return null
  return {
    subtype: body[0],
    sensor_type: body[1],
    cfg_a: body[3],
    cfg_b: body[4],
    channel_count: body[5],
    cfg_word: le32(body, 6),
    _status: 'unvalidated',
  }
}

/** atlas_raw_bioz_data (0x88): delta-coded i32 stream; a 0x80 byte escapes into a
 *  3-byte 24-bit LE absolute sample (sign-extended). */
function decodeAtlasRawBioz(body: Uint8Array): Record<string, unknown> | null {
  if (body.length === 0) return null
  const samples: number[] = []
  let run = 0
  let modeAbs = false
  let acc = 0
  let k = 0
  for (let i = 0; i < body.length; i++) {
    const b = body[i]
    if (!modeAbs) {
      if (b === 0x80) {
        modeAbs = true; acc = 0; k = 0
      } else {
        run += b > 0x7f ? b - 0x100 : b
        samples.push(run)
      }
    } else {
      acc |= b << (k * 8)
      k += 1
      if (k === 3) {
        if (acc & 0x800000) acc |= -0x1000000 // sign-extend 24-bit
        run = acc
        samples.push(run)
        modeAbs = false
      }
    }
  }
  return { samples, _status: 'unvalidated' }
}

export function decodeEventBody(tag: number, body: Uint8Array): Record<string, unknown> | null {
  // Infallible (RE11 / CLAUDE.md): a decoder bug on a real byte pattern must never
  // throw and 500 the ingest — the raw body_hex is archival and re-decodable later.
  try {
    return decodeEventBodyInner(tag, body)
  } catch {
    return null
  }
}

function decodeEventBodyInner(tag: number, body: Uint8Array): Record<string, unknown> | null {
  switch (tag) {
    case 0x42:
      return decodeTimeSync(body)
    case 0x43:
      return decodeAscii(body)
    case 0x61:
      return decodeDebugData(body)
    case 0x45:
    case 0x53:
      return decodeStateText(body)
    case 0x46:
    case 0x69:
    case 0x75:
      return decodeTemperatures(body)
    case 0x5d:
      return decodeHrv(body)
    case 0x80:
      return decodeGreenIbiQuality(body)
    case 0x60:
      return decodeIbiAmplitude(body)
    case 0x6f:
      return decodeSpo2(body)
    case 0x8b:
      return decodeSpo2RPi(body)
    case 0x4b:
    case 0x4e:
    case 0x5a:
      return decodeSleepPhases(body)
    case 0x59:
      return decodeU16Samples(body, 'ambient')
    case 0x74:
      return decodeU16Samples(body, 'intensity')
    case 0x50:
      return decodeActivityInfo(body)
    case 0x47:
      return decodeMotion(body)
    case 0x76:
      return decodeBedtimePeriod(body)
    case 0x72:
      return decodeSleepAcmPeriod(body)
    case 0x81:
      return decodeCvaRawPpg(body)
    case 0x56:
      return decodeFirstByte(body, 'alert_type')
    case 0x6b:
      return decodeMotionPeriod(body)
    case 0x6c:
      return decodeFeatureSession(body)
    case 0x5b:
      return decodeTelemetry(body, 'ble_connection_ind')
    case 0x79:
      return decodeTelemetry(body, 'self_test_data')
    case 0x82:
      return decodeTelemetry(body, 'scan_start')
    case 0x83:
      return decodeTelemetry(body, 'scan_end')
    case 0x49:
      return decodeSleepSummary1(body)
    case 0x4c:
      return decodeSleepSummary2(body)
    case 0x4f:
      return decodeSleepSummary3(body)
    case 0x58:
      return decodeSleepSummary4(body)
    case 0x7e:
    case 0x7f:
      return decodeRealSteps(body)
    case 0x86:
      return decodeAohr(body)
    case 0x84:
      return decodeAmbient(body)
    case 0x87:
      return decodeAtlasMetadata(body)
    case 0x88:
      return decodeAtlasRawBioz(body)
    default:
      return null
  }
}

const EVENT_NAMES: Record<number, string> = {
  0x41: 'ring_start', 0x42: 'time_sync', 0x43: 'debug_event', 0x44: 'ibi_event',
  0x45: 'state_change', 0x46: 'temp_event', 0x47: 'motion_event', 0x48: 'sleep_period_information',
  0x49: 'sleep_summary_1', 0x4a: 'ppg_amplitude', 0x4b: 'sleep_phase_information',
  0x4c: 'sleep_summary_2', 0x4d: 'ring_sleep_feature_information', 0x4e: 'sleep_phase_details',
  0x4f: 'sleep_summary_3', 0x50: 'activity_information', 0x51: 'activity_summary_1',
  0x52: 'activity_summary_2', 0x53: 'wear_event', 0x54: 'recovery_summary', 0x55: 'sleep_heart_rate',
  0x56: 'alert_event', 0x57: 'ring_sleep_feature_information_2', 0x58: 'sleep_summary_4',
  0x59: 'eda_event', 0x5a: 'sleep_phase_data', 0x5b: 'ble_connection',
  0x5c: 'user_information', 0x5d: 'hrv_event', 0x5e: 'self_test_event', 0x5f: 'raw_acm_event',
  0x60: 'ibi_and_amplitude_event', 0x61: 'debug_data', 0x62: 'on_demand_meas',
  0x63: 'ppg_peak_event', 0x64: 'raw_ppg_event', 0x65: 'on_demand_session',
  0x66: 'on_demand_motion', 0x67: 'raw_ppg_summary', 0x68: 'raw_ppg_data',
  0x69: 'temp_period', 0x6a: 'sleep_period_information_2', 0x6b: 'motion_period',
  0x6c: 'feature_session', 0x6d: 'meas_quality_event', 0x6e: 'spo2_ibi_and_amplitude_event',
  0x6f: 'spo2_event', 0x70: 'spo2_smoothed_event',
  0x71: 'green_ibi_and_amplitude_event', 0x72: 'sleep_acm_period', 0x73: 'ehr_trace_event',
  0x74: 'ehr_acm_intensity_event', 0x75: 'sleep_temp_event', 0x76: 'bedtime_period',
  0x77: 'spo2_dc_event', 0x79: 'self_test_data_event', 0x7a: 'tag_event',
  0x7e: 'real_step_event_feature_1', 0x7f: 'real_step_event_feature_2',
  0x80: 'green_ibi_quality_event', 0x81: 'cva_raw_ppg_data', 0x82: 'scan_start',
  0x83: 'scan_end', 0x84: 'ambient_event', 0x86: 'aohr_event', 0x87: 'atlas_metadata',
  0x88: 'atlas_raw_bioz_data', 0x8b: 'spo2_r_pi_event',
}

export function eventName(tag: number): string {
  return EVENT_NAMES[tag] ?? 'unknown'
}

/** Command/response frames (tag < 0x41 — protocol traffic, not history events). */
const COMMAND_NAMES: Record<number, string> = {
  0x06: 'set_realtime', 0x08: 'firmware_version', 0x0c: 'battery_req', 0x0d: 'battery',
  0x10: 'get_history', 0x11: 'history_batch_done', 0x12: 'sync_time', 0x13: 'sync_time_ack',
  0x16: 'ble_fast_hr', 0x18: 'serial_number', 0x1c: 'enable_notifications',
  0x1d: 'notifications_ack',
}

/** Sub-ops of the extended-op tag 0x2f. The req/resp pairs: nonce 2b→2c,
 *  authenticate 2d→2e, feature status 20→21, set feature mode 22→23. */
const EXT_SUBOP_NAMES: Record<number, string> = {
  0x20: 'feature_status_req', 0x21: 'feature_status', 0x22: 'set_feature_mode',
  0x23: 'set_feature_mode_ack', 0x2b: 'nonce_req', 0x2c: 'nonce',
  0x2d: 'authenticate', 0x2e: 'auth_result',
}

/** Convert a ring deciseconds timestamp to wall-clock epoch ms using an anchor.
 *  The ring clock is a monotonic deciseconds counter since its own epoch (reset
 *  on a re-key), so an absolute UTC value doesn't fit the 4-byte field — we anchor
 *  it with one known `(anchorDs ↔ anchorUtcMs)` correspondence (the newest drained
 *  event ≈ its ingest time). Slope is fixed at 100 ms per decisecond. */
export function measuredAtMs(ringDs: number, anchorDs: number, anchorUtcMs: number): number {
  return anchorUtcMs + (ringDs - anchorDs) * 100
}

/** Inverse of measuredAtMs — convert a wall-clock epoch ms back to ring deciseconds
 *  using the same anchor. Used where a caller only has wall-clock time (e.g. the
 *  accel-only live step tester, which has no ring ds for its frames) but needs to
 *  store a ds-keyed value (step_live_windows) for the ds-domain merge in
 *  lib/health/step-estimate.ts. */
export function dsFromMeasuredAtMs(utcMs: number, anchorDs: number, anchorUtcMs: number): number {
  return anchorDs + (utcMs - anchorUtcMs) / 100
}

/** Median seconds between consecutive events, from a list of ring deciseconds
 *  timestamps — the measured cadence of a metric. Null for fewer than 2 samples. */
export function cadenceSecFromDs(dsList: number[]): number | null {
  if (dsList.length < 2) return null
  const sorted = [...dsList].sort((a, b) => a - b)
  const deltas: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i] - sorted[i - 1]
    if (d > 0) deltas.push(d) // drop duplicate-timestamp batches (same event, many samples)
  }
  if (deltas.length === 0) return null
  deltas.sort((a, b) => a - b)
  const mid = Math.floor(deltas.length / 2)
  const medianDs = deltas.length % 2 ? deltas[mid] : (deltas[mid - 1] + deltas[mid]) / 2
  return Math.round(medianDs / 10) // deciseconds → seconds
}

/** Human-readable label for any frame the tester sees, history event or command
 *  response. Falls back to a hex tag so an unmapped op is still identifiable. */
export function frameLabel(tag: number, subOp: number | null): string {
  if (tag >= HISTORY_EVENT_PREFIX) return eventName(tag)
  if (tag === 0x2f && subOp != null) return EXT_SUBOP_NAMES[subOp] ?? `ext_0x${subOp.toString(16).padStart(2, '0')}`
  return COMMAND_NAMES[tag] ?? `cmd_0x${tag.toString(16).padStart(2, '0')}`
}

/**
 * Turn a raw history-event frame into a decoded HistoryEvent, or null if the frame
 * is not a history event (tag < 0x41) or too short to hold the 4-byte timestamp.
 */
export function parseHistoryEvent(frame: RawFrame): HistoryEvent | null {
  if (frame.tag < HISTORY_EVENT_PREFIX) return null
  const p = frame.payload
  if (p.length < 4) return null
  const timestampDs = le32(p, 0)
  const body = p.slice(4)
  return {
    tag: frame.tag,
    name: eventName(frame.tag),
    timestampDs,
    bodyHex: bytesToHex(body),
    decoded: decodeEventBody(frame.tag, body),
  }
}

/** Convenience for the ingest route: hex frame → HistoryEvent (or null). */
export function historyEventFromHex(frameHex: string): HistoryEvent | null {
  const frame = parseFrame(hexToBytes(frameHex))
  return frame ? parseHistoryEvent(frame) : null
}
